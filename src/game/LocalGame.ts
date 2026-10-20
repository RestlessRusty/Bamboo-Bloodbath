import { NET_SEND_EVERY, SIM_DT } from '../config';
import { Simulation } from '../sim/Simulation';
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
 */
export class LocalGame implements Session {
  paused = false;
  private readonly sim: Simulation;
  private readonly presenter: Presenter;
  private readonly inputs = new Map<string, PlayerInput>();
  private readonly remoteIds: string[];
  private prev: Snapshot;
  private curr: Snapshot;
  private acc = 0;
  private ended = false;
  private sendCounter = 0;
  private pendingEvents: GameEvent[] = [];

  constructor(
    private readonly ctx: GameContext,
    specs: readonly PlayerSpec[],
    private readonly localId: string,
    private readonly onEnd: (snap: Snapshot) => void,
    private readonly link: HostLink | null = null,
  ) {
    this.sim = new Simulation(ctx.renderer.currentMap, specs);
    this.presenter = new Presenter(ctx, specs, localId);
    this.remoteIds = specs.filter((s) => !s.bot && s.id !== localId).map((s) => s.id);
    this.curr = this.sim.snapshot();
    this.prev = this.curr;
    ctx.renderer.setPlayers(specs, localId);
    ctx.hud.setTeam(specs, localId);
  }

  get isOver(): boolean {
    return this.ended;
  }

  get canPause(): boolean {
    return this.link === null;
  }

  /** A guest left mid-match: their panda keeps going on autopilot. */
  convertToBot(id: string): void {
    this.sim.setBot(id, true);
    const i = this.remoteIds.indexOf(id);
    if (i >= 0) this.remoteIds.splice(i, 1);
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
    input.setCrackerCount(this.curr.survivors.find((s) => s.id === this.localId)?.crackers ?? 0);
  }

  dispose(): void {
    this.sim.dispose();
    this.ctx.renderer.clearPlayers();
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
