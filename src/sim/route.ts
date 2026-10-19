import type { MapLayout } from './mapLayout';
import type { Pt } from './river';

/** Once this close to a waypoint, head for the one after it. */
const REACHED = 6;

/** The way from the camp to the hut: start → waypoints → goal, as a polyline. */
export class Route {
  readonly pts: Pt[];
  readonly length: number;
  private readonly cum: number[];

  constructor(layout: MapLayout) {
    this.pts = [layout.start, ...(layout.route ?? []), layout.goal].map((p) => ({ x: p.x, z: p.z }));
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(this.pts[i].x - this.pts[i - 1].x, this.pts[i].z - this.pts[i - 1].z));
    }
    this.length = this.cum[this.cum.length - 1] || 1;
  }

  /**
   * Where (x, z) is along the route: distance covered, the next point to walk towards,
   * and how far it still is to the hut that way.
   */
  locate(x: number, z: number): { along: number; next: Pt; remaining: number } {
    let best = Infinity;
    let seg = 1;
    let along = 0;
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1];
      const b = this.pts[i];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
      const d = Math.hypot(a.x + abx * t - x, a.z + abz * t - z);
      if (d < best) {
        best = d;
        seg = i;
        along = this.cum[i - 1] + (this.cum[i] - this.cum[i - 1]) * t;
      }
    }
    let i = seg;
    if (i < this.pts.length - 1 && Math.hypot(this.pts[i].x - x, this.pts[i].z - z) < REACHED) i++;
    const next = this.pts[i];
    const remaining = Math.hypot(next.x - x, next.z - z) + (this.length - this.cum[i]);
    return { along, next, remaining };
  }

  /** Point at fraction `f` (0–1) of the way, with the unit direction of travel there. */
  at(f: number): { x: number; z: number; dx: number; dz: number } {
    const target = Math.max(0, Math.min(1, f)) * this.length;
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < target) i++;
    const a = this.pts[i - 1];
    const b = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const u = (target - this.cum[i - 1]) / seg;
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, dx: (b.x - a.x) / seg, dz: (b.z - a.z) / seg };
  }
}
