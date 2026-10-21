import { NET_INTERP_TICKS, SIM_HZ } from '../config';
import type { PlayerInput, PlayerSpec, Snapshot } from '../sim/types';
import { Presenter } from './Presenter';
import type { GameContext, Session } from './Session';

const INPUT_SEND_INTERVAL = 1 / 30;
const MAX_BUFFER = 40;

/** Network hooks for a guest. */
export interface ClientLink {
  sendInput(input: PlayerInput): void;
  requestEnd(): void;
}

/**
 * A guest's view of a match: sends inputs to the host and draws the host's snapshots,
 * slightly in the past so it can interpolate smoothly between them.
 */
export class RemoteGame implements Session {
  paused = false;
  readonly canPause = false;
  private readonly presenter: Presenter;
  private readonly buffer: Snapshot[] = [];
  private renderTick = -1;
  private ended = false;
  private sendTimer = 0;
  private pending: PlayerInput = { mx: 0, mz: 0, ax: 0, az: 0, attack: false, dash: false, cracker: false };

  constructor(
    private readonly ctx: GameContext,
    specs: readonly PlayerSpec[],
    private readonly localId: string,
    private readonly onEnd: (snap: Snapshot) => void,
    private readonly link: ClientLink,
  ) {
    this.presenter = new Presenter(ctx, specs, localId);
    ctx.renderer.setPlayers(specs, localId);
    ctx.hud.setTeam(specs, localId);
  }

  get isOver(): boolean {
    return this.ended;
  }

  /** The host checks it and ends the match for everyone. */
  requestEnd(): void {
    if (!this.ended) this.link.requestEnd();
  }

  receive(snap: Snapshot): void {
    const last = this.buffer[this.buffer.length - 1];
    if (last && snap.tick <= last.tick) return;
    this.buffer.push(snap);
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
    this.presenter.present(snap.events, snap);
    if (snap.phase !== 'playing' && !this.ended) {
      this.ended = true;
      this.onEnd(snap);
    }
  }

  frame(dt: number, fps: number | null): void {
    const { renderer, hud } = this.ctx;
    this.sendInputs(dt);

    const latest = this.buffer[this.buffer.length - 1];
    if (!latest) return;

    // Play back slightly behind the newest snapshot, nudging the clock to stay there.
    const target = latest.tick - NET_INTERP_TICKS;
    if (this.renderTick < 0 || Math.abs(this.renderTick - target) > 30) this.renderTick = target;
    else this.renderTick += dt * SIM_HZ + (target - this.renderTick) * 0.05;
    if (this.ended) this.renderTick = latest.tick;

    let a = this.buffer[0];
    let b = a;
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].tick <= this.renderTick && this.buffer[i + 1].tick > this.renderTick) {
        a = this.buffer[i];
        b = this.buffer[i + 1];
        break;
      }
      if (this.buffer[i + 1].tick <= this.renderTick) a = b = this.buffer[i + 1];
    }
    const alpha = b.tick > a.tick ? Math.min(1, Math.max(0, (this.renderTick - a.tick) / (b.tick - a.tick))) : 1;

    renderer.updateGame(this.ended ? 0 : dt, a, b, alpha, this.localId);
    hud.update(latest, fps);
    this.ctx.input.setCrackerCount(latest.survivors.find((s) => s.id === this.localId)?.crackers ?? 0);
  }

  dispose(): void {
    this.ctx.renderer.clearPlayers();
  }

  /** Sample every frame, send at 30 Hz; taps and swipes between sends are not lost. */
  private sendInputs(dt: number): void {
    const i = this.ctx.input.sample();
    const p = this.pending;
    p.mx = i.mx;
    p.mz = i.mz;
    if (i.ax !== 0 || i.az !== 0) {
      p.ax = i.ax;
      p.az = i.az;
    }
    p.attack ||= i.attack;
    p.dash ||= i.dash;
    p.cracker ||= i.cracker;

    this.sendTimer += dt;
    if (this.sendTimer < INPUT_SEND_INTERVAL) return;
    this.sendTimer = 0;
    this.link.sendInput(p);
    this.pending = { mx: p.mx, mz: p.mz, ax: 0, az: 0, attack: false, dash: false, cracker: false };
  }
}
