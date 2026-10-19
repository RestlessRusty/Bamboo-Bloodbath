import type { Circle } from './mapLayout';

const CELL = 6;

/** Spatial hash of static round obstacles (trees, rocks) for quick "what's near me" queries. */
export class Obstacles {
  private readonly cells = new Map<number, Circle[]>();
  private maxR = 0;

  constructor(list: readonly Circle[]) {
    for (const c of list) {
      const k = this.key(Math.floor(c.x / CELL), Math.floor(c.z / CELL));
      let cell = this.cells.get(k);
      if (!cell) this.cells.set(k, (cell = []));
      cell.push(c);
      this.maxR = Math.max(this.maxR, c.r);
    }
  }

  /** Obstacles whose edge is within `r` of (x, z). Reuses `out`. */
  near(x: number, z: number, r: number, out: Circle[]): Circle[] {
    out.length = 0;
    const reach = r + this.maxR;
    const x0 = Math.floor((x - reach) / CELL);
    const x1 = Math.floor((x + reach) / CELL);
    const z0 = Math.floor((z - reach) / CELL);
    const z1 = Math.floor((z + reach) / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const cell = this.cells.get(this.key(ix, iz));
        if (!cell) continue;
        for (const c of cell) if (Math.hypot(c.x - x, c.z - z) < r + c.r) out.push(c);
      }
    }
    return out;
  }

  private key(ix: number, iz: number): number {
    return (ix + 1000) * 4000 + (iz + 1000);
  }
}
