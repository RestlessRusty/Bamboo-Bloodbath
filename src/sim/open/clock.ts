import { OPEN } from './config';

/**
 * The world's clock: seconds since the world began, and the day / time of day / night that follow from it.
 * Day 1 starts at clock 0 (dawn). The rules step it and turn the changes into 'dawn' / 'dusk' events.
 */
export class WorldClock {
  private t: number;

  constructor(clock: number) {
    this.t = Number.isFinite(clock) && clock > 0 ? clock : 0;
  }

  step(dt: number): void {
    this.t += dt;
  }

  /** Seconds since the world began. */
  get total(): number {
    return this.t;
  }

  /** Day 1 is the first day. */
  get day(): number {
    return Math.floor(this.t / OPEN.dayLength) + 1;
  }

  /** Time of day 0..1, 0 = dawn. */
  get time(): number {
    const f = this.t / OPEN.dayLength;
    return f - Math.floor(f);
  }

  get night(): boolean {
    const t = this.time;
    return t >= OPEN.nightStart && t < OPEN.nightEnd;
  }
}
