/**
 * Spatial buckets for the open world: square cells over the world, each listing the items whose area of
 * influence reaches into it. A point query then only looks at the handful of hills, ponds, river bends…
 * nearby instead of all of them, which is what keeps the 1 m height grid and the prop scatter fast.
 */

const NONE: readonly number[] = [];

export class GridIndex {
  /** Cells per side. */
  readonly n: number;
  /** Item lists by cell (`cz * n + cx`); undefined where nothing reaches. */
  readonly cells: (number[] | undefined)[];

  /** Covers the square [-half, half]²; points outside fall into the nearest edge cell. */
  constructor(
    private readonly half: number,
    readonly cell: number,
  ) {
    this.n = Math.ceil((half * 2) / cell);
    this.cells = new Array<number[] | undefined>(this.n * this.n).fill(undefined);
  }

  /** Cell of a point (clamped to the grid). */
  cellOf(x: number, z: number): number {
    return this.clamp(Math.floor((z + this.half) / this.cell)) * this.n + this.clamp(Math.floor((x + this.half) / this.cell));
  }

  /** Lists `item` in every cell the box touches. */
  add(item: number, minX: number, minZ: number, maxX: number, maxZ: number): void {
    const x0 = this.clamp(Math.floor((minX + this.half) / this.cell));
    const x1 = this.clamp(Math.floor((maxX + this.half) / this.cell));
    const z0 = this.clamp(Math.floor((minZ + this.half) / this.cell));
    const z1 = this.clamp(Math.floor((maxZ + this.half) / this.cell));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = cz * this.n + cx;
        const list = this.cells[k];
        if (list) list.push(item);
        else this.cells[k] = [item];
      }
    }
  }

  /** Items that may reach (x, z). */
  at(x: number, z: number): readonly number[] {
    return this.cells[this.cellOf(x, z)] ?? NONE;
  }

  private clamp(i: number): number {
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
  }
}

export function distToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz || 1e-9;
  let t = ((x - ax) * abx + (z - az) * abz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + abx * t - x;
  const dz = az + abz * t - z;
  return Math.sqrt(dx * dx + dz * dz);
}

interface Shape {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  r: number;
}

/** Circles and capsules (round-ended segments) to keep things away from: POI yards, roads, passages, ponds… */
export class ShapeIndex {
  private readonly shapes: Shape[] = [];
  private readonly grid: GridIndex;

  /** `maxPad`: the biggest gap `near()` will be asked about (shapes are bucketed that much wider). */
  constructor(
    half: number,
    cell: number,
    private readonly maxPad: number,
  ) {
    this.grid = new GridIndex(half, cell);
  }

  get count(): number {
    return this.shapes.length;
  }

  circle(x: number, z: number, r: number): void {
    this.segment(x, z, x, z, r);
  }

  segment(ax: number, az: number, bx: number, bz: number, r: number): void {
    const id = this.shapes.length;
    this.shapes.push({ ax, az, bx, bz, r });
    const m = r + this.maxPad;
    this.grid.add(id, Math.min(ax, bx) - m, Math.min(az, bz) - m, Math.max(ax, bx) + m, Math.max(az, bz) + m);
  }

  /** Closer than `pad` (at most maxPad) to the edge of any shape. */
  near(x: number, z: number, pad: number): boolean {
    const list = this.grid.at(x, z);
    for (let i = 0; i < list.length; i++) {
      const s = this.shapes[list[i]];
      if (distToSegment(x, z, s.ax, s.az, s.bx, s.bz) < s.r + pad) return true;
    }
    return false;
  }
}
