import { MAX_PLAYERS, NET_SEND_EVERY, SIM_DT } from '../config';
import { WorldMirror } from '../sim/open/mirror';
import type { OpenCommand, WorldJoin, WorldSave } from '../sim/open/types';
import { Simulation, type SimOptions } from '../sim/Simulation';
import type { GameEvent, PlayerInput, PlayerSpec, Snapshot } from '../sim/types';
import { Presenter } from './Presenter';
import type { GameContext, Session } from './Session';

/** Network hooks when this device hosts a multiplayer match. */
export interface HostLink {
  inputFor(id: string): PlayerInput | undefined;
  sendSnapshot(snap: Snapshot): void;
}

/**
 * A match whose simulation runs on this device: single player, or the host of a multiplayer room.
 * Fixed 60 Hz simulation; rendering interpolates between the last two ticks.
 *
 * Infinite mode (`options.open`): the renderer and HUDs draw the world from a WorldMirror kept up to
 * date with the simulation's world events, exactly like a guest's, so every device shows the same thing.
 */
export class LocalGame implements Session {
  paused = false;
  private readonly sim: Simulation;
  private readonly presenter: Presenter;
  private readonly inputs = new Map<string, PlayerInput>();
  private readonly remoteIds: string[];
  /** The team as it is now (pandas change hands when guests leave, rejoin or drop in). */
  private readonly specs: PlayerSpec[];
  private prev: Snapshot;
  private curr: Snapshot;
  private acc = 0;
  private ended = false;
  private sendCounter = 0;
  private pendingEvents: GameEvent[] = [];
  /** Infinite mode: the world as the renderer and HUDs see it. */
  private readonly mirror: WorldMirror | null = null;

  constructor(
    private readonly ctx: GameContext,
    specs: readonly PlayerSpec[],
    private readonly localId: string,
    private readonly onEnd: (snap: Snapshot) => void,
    private readonly link: HostLink | null = null,
    options: SimOptions = {},
  ) {
    const map = ctx.renderer.currentMap;
    this.sim = new Simulation(map, specs, options);
    this.presenter = new Presenter(ctx, specs, localId);
    this.specs = specs.map((s) => ({ ...s }));
    this.remoteIds = specs.filter((s) => !s.bot && s.id !== localId).map((s) => s.id);
    this.curr = this.sim.snapshot();
    this.prev = this.curr;
    ctx.renderer.setPlayers(specs, localId);
    ctx.hud.setTeam(specs, localId);
    // Taken after the first snapshot, so it already holds whatever setting up the world changed.
    const join = options.open ? this.sim.joinWorld() : null;
    if (join) {
      this.mirror = new WorldMirror(map, join);
      ctx.renderer.setOpenMirror(this.mirror);
      ctx.hud.setOpenMirror(this.mirror);
      ctx.openHud?.start(map, this.mirror, localId);
    }
  }

  get isOver(): boolean {
    return this.ended;
  }

  get canPause(): boolean {
    return this.link === null;
  }

  /**
   * A panda changes hands mid-match: a guest left (`bot` true, it keeps going on autopilot), came back,
   * or a newcomer took over a bot (`bot` false, with their name).
   */
  setSpec(spec: PlayerSpec): void {
    const i = this.specs.findIndex((s) => s.id === spec.id);
    if (i < 0) return;
    this.specs[i] = { ...spec };
    this.sim.setBot(spec.id, spec.bot, spec.name);
    const r = this.remoteIds.indexOf(spec.id);
    if (spec.bot && r >= 0) this.remoteIds.splice(r, 1);
    if (!spec.bot && r < 0 && spec.id !== this.localId) this.remoteIds.push(spec.id);
    this.refreshTeam(false);
  }

  /** A bot buddy's panda still in the game, for a player joining mid-match (a standing one if possible). */
  freeBotSeat(): string | null {
    if (this.ended) return null;
    let downed: string | null = null;
    for (const s of this.curr.survivors) {
      const spec = this.specs.find((x) => x.id === s.id);
      // Only real bot buddies: a guest who dropped out keeps their panda for when they're back.
      if (!spec?.bot || spec.npc || !spec.id.startsWith('b')) continue;
      if (s.state === 'active') return s.id;
      if (s.state === 'downed') downed ??= s.id;
    }
    return downed;
  }

  /** Infinite mode: a guest drops into the world with a panda of their own (restored from the save by name). */
  addSeat(spec: PlayerSpec): boolean {
    if (!this.mirror || this.ended || this.specs.length >= MAX_PLAYERS || this.specs.some((s) => s.id === spec.id)) return false;
    this.sim.addOpenSurvivor(spec);
    this.specs.push({ ...spec });
    if (!spec.bot && spec.id !== this.localId) this.remoteIds.push(spec.id);
    this.refreshTeam(true);
    return true;
  }

  /** Infinite mode: a guest left, and their panda leaves the world with them (the rules keep it for the save). */
  removeSeat(id: string): void {
    const i = this.specs.findIndex((s) => s.id === id);
    if (!this.mirror || i < 0 || id === this.localId) return;
    this.sim.removeSurvivor(id);
    this.specs.splice(i, 1);
    const r = this.remoteIds.indexOf(id);
    if (r >= 0) this.remoteIds.splice(r, 1);
    this.inputs.delete(id);
    this.refreshTeam(true);
  }

  /** Infinite mode: the world as it is now, for a guest joining. */
  joinWorld(): WorldJoin | null {
    return this.mirror ? this.sim.joinWorld() : null;
  }

  /** Infinite mode: everything to store (`now`: epoch ms); null in other matches. */
  saveWorld(now: number): WorldSave | null {
    return this.mirror ? this.sim.saveWorld(now) : null;
  }

  /** Infinite mode: a build / craft command from the local player, or (host) from the guest playing panda `id`. */
  command(cmd: OpenCommand): void;
  command(id: string, cmd: OpenCommand): void;
  command(a: string | OpenCommand, b?: OpenCommand): void {
    if (!this.mirror || this.ended) return;
    if (typeof a === 'string') {
      if (b) this.sim.command(a, b);
    } else {
      this.sim.command(this.localId, a);
    }
  }

  /** Also called for a guest's request: the simulation checks it's still allowed. */
  requestEnd(): void {
    if (this.ended || !this.sim.endEarly()) return;
    this.prev = this.curr;
    this.curr = this.sim.snapshot();
    this.mirror?.apply(this.curr.events);
    this.presenter.present(this.curr.events, this.curr);
    this.broadcast();
    this.ended = true;
    this.onEnd(this.curr);
  }

  frame(dt: number, fps: number | null): void {
    const { renderer, input, hud } = this.ctx;

    const frozen = (this.paused && this.canPause) || this.ended;
    if (!frozen) {
      this.acc += Math.min(dt, 0.25);
      while (this.acc >= SIM_DT && !this.ended) {
        this.inputs.set(this.localId, input.sample());
        if (this.link) {
          for (const id of this.remoteIds) {
            const remote = this.link.inputFor(id);
            if (remote) this.inputs.set(id, remote);
          }
        }
        this.sim.step(this.inputs);
        this.prev = this.curr;
        this.curr = this.sim.snapshot();
        this.acc -= SIM_DT;
        // The world changes first, so what the presenter's effects and messages refer to is already drawn.
        this.mirror?.apply(this.curr.events);
        this.presenter.present(this.curr.events, this.curr);
        this.broadcast();
        if (this.curr.phase !== 'playing') {
          this.ended = true;
          this.onEnd(this.curr);
        }
      }
    }

    renderer.updateGame(frozen ? 0 : dt, this.prev, this.curr, frozen ? 1 : this.acc / SIM_DT, this.localId);
    hud.update(this.curr, fps);
    if (this.mirror) this.ctx.openHud?.update(this.curr);
    this.ctx.story?.update(this.curr, frozen ? 0 : dt);
    const me = this.curr.survivors.find((s) => s.id === this.localId);
    input.setCrackerCount(me?.crackers ?? 0);
    input.setOtherWeapon(me?.state === 'active' ? me.other : null);
  }

  dispose(): void {
    this.sim.dispose();
    this.ctx.renderer.clearPlayers();
    if (this.mirror) {
      this.ctx.openHud?.stop();
      this.ctx.renderer.setGhost(null);
      this.ctx.renderer.setOpenMirror(null);
      this.ctx.hud.setOpenMirror(null);
      this.ctx.input.setBuildMode(false);
    }
  }

  /** The team changed: `added` when pandas joined or left the world (new models), not just changed hands. */
  private refreshTeam(added: boolean): void {
    this.presenter.setSpecs(this.specs);
    if (added) this.ctx.renderer.setPlayers(this.specs, this.localId);
    else this.ctx.renderer.updateSpecs(this.specs, this.localId);
    this.ctx.hud.setTeam(this.specs, this.localId);
  }

  private broadcast(): void {
    if (!this.link) return;
    this.pendingEvents.push(...this.curr.events);
    this.sendCounter++;
    if (this.sendCounter < NET_SEND_EVERY && this.curr.phase === 'playing') return;
    this.link.sendSnapshot({ ...this.curr, events: this.pendingEvents });
    this.pendingEvents = [];
    this.sendCounter = 0;
  }
}
