import type { Ridge, River } from './mapLayout';

export interface Pt {
  x: number;
  z: number;
}

/** A walkable bridge deck across a river. */
export interface Bridge {
  x: number;
  z: number;
  /** Unit vector along the deck (across the river). */
  dirX: number;
  dirZ: number;
  halfLength: number;
  halfWidth: number;
  /** Height of the walking surface. */
  top: number;
}

/** A way past an obstacle: a bridge or ford over a river, or a pass through a ridge. Has an end on each side. */
export interface Crossing {
  kind: 'bridge' | 'ford' | 'gap';
  a: Pt;
  b: Pt;
  length: number;
  /** Half the width of the walkway (bridge deck, shallow part of a ford, floor of a pass). */
  halfWidth: number;
}

const STEPS = 8;

/** Uniform Catmull-Rom through the control points, so curves bend smoothly. */
function smooth(points: readonly Pt[]): Pt[] {
  const n = points.length;
  if (n < 2) return points.map((p) => ({ ...p }));
  const out: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];
    for (let s = 0; s < STEPS; s++) {
      const t = s / STEPS;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push({ ...points[n - 1] });
  return out;
}

/** A smoothed curve with fast distance queries. Base of rivers and ridges. */
export class CurveShape {
  readonly pts: Pt[];
  readonly length: number;
  private readonly cum: number[];
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minZ: number;
  private readonly maxZ: number;

  /** `reach`: points farther than this from the curve count as "far" (cheap early out). */
  constructor(
    points: readonly Pt[],
    private readonly reach: number,
  ) {
    this.pts = smooth(points);
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.length = this.cum[this.cum.length - 1];
    this.minX = Math.min(...this.pts.map((p) => p.x)) - reach;
    this.maxX = Math.max(...this.pts.map((p) => p.x)) + reach;
    this.minZ = Math.min(...this.pts.map((p) => p.z)) - reach;
    this.maxZ = Math.max(...this.pts.map((p) => p.z)) + reach;
  }

  /** Distance from the curve, or Infinity when farther than `reach`. */
  distance(x: number, z: number): number {
    return this.project(x, z).d;
  }

  /** Distance from the curve and how far along it (arc length) the closest point is. `d` is Infinity beyond `reach`. */
  project(x: number, z: number): { d: number; s: number } {
    if (x < this.minX || x > this.maxX || z < this.minZ || z > this.maxZ) return { d: Infinity, s: 0 };
    let best = this.reach * this.reach;
    let bestS = 0;
    let found = false;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1e-9;
      let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = a.x + abx * t - x;
      const dz = a.z + abz * t - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        bestS = this.cum[i - 1] + (this.cum[i] - this.cum[i - 1]) * t;
        found = true;
      }
    }
    return found ? { d: Math.sqrt(best), s: bestS } : { d: Infinity, s: 0 };
  }

  /** Point and unit direction at fraction `f` (0–1) of the length. */
  at(f: number): { x: number; z: number; tx: number; tz: number } {
    const target = Math.max(0, Math.min(1, f)) * this.length;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < target) i++;
    const a = this.pts[i - 1];
    const b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const u = (target - this.cum[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, tx: (b.x - a.x) / seg, tz: (b.z - a.z) / seg };
  }
}

export class RiverShape extends CurveShape {
  readonly halfWidth: number;
  readonly depth: number;

  constructor(
    readonly def: River,
    reach: number,
  ) {
    super(def.points, reach);
    this.halfWidth = def.width / 2;
    this.depth = def.depth;
  }
}

/** Width of the slope between a pass's floor and the full ridge. */
const GAP_EDGE = 3;

export class RidgeShape extends CurveShape {
  /** Half the width at the foot. */
  readonly halfWidth: number;
  /** Half the width of the flat crest. */
  readonly crest: number;
  /** Half the thickness of the invisible wall that stops everyone. */
  readonly wallHalf: number;
  /** Passes: arc-length position and half the width of the floor. */
  readonly gaps: { s: number; half: number }[];

  constructor(
    readonly def: Ridge,
    reach: number,
  ) {
    super(def.points, reach);
    this.halfWidth = def.width / 2;
    this.crest = this.halfWidth * 0.35;
    this.wallHalf = Math.max(1, this.halfWidth - 1);
    this.gaps = def.gaps.map((g) => ({ s: this.project(g.x, g.z).s, half: g.width / 2 }));
  }

  /** 1 inside a pass, 0 where the ridge is whole; `s` is arc length along the ridge. */
  openAt(s: number): number {
    let a = 0;
    for (const g of this.gaps) a = Math.max(a, 1 - smoothstep01((Math.abs(s - g.s) - g.half) / GAP_EDGE));
    return a;
  }

  /** Arc length → fraction, for `at`. */
  fractionOf(s: number): number {
    return this.length > 0 ? s / this.length : 0;
  }
}

function smoothstep01(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}
