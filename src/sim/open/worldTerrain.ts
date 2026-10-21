import { lerp, smoothstep, valueNoise } from '../../core/math';
import type { Circle, MapLayout } from '../mapLayout';
import type { Bridge, Pt, RidgeShape } from '../river';
import { Terrain, WATER_LEVEL } from '../terrain';
import { biomeTable, type BiomeField } from './biomes';
import { distToSegment, GridIndex } from './worldIndex';

// The same shaping numbers as terrain.ts, so rivers, ponds and clearings look like on the normal maps.
/** Clearings, river banks and bridge approaches sit at this height. */
export const FLAT_LEVEL = 0.2;
const RIVER_BANK = 6;
const FORD_DEPTH = 0.08;
const GROUND_FLOOR = 0.05;
const DIP_KEEP = 0.1;
const POND_SHORE = 7;

/** Height samples every metre; bilinear in between. */
const STEP = 1;
/** The ground's slow fields (smooth level, big bumps, relief) every 4 m. */
const COARSE = 4;
/** Rolling ground rises up to this much where the relief is 1 (before biome lift and hills). */
const MACRO_HEIGHT = 4.5;
/** On high ground river banks and pond shores slope down over a longer way, so water never sits in a pit. */
const BANK_PER_METRE = 2.5;
const BANK_MAX = 30;
const SHORE_PER_METRE = 2;
const SHORE_MAX = 24;
/** The world edge rises into a rim of hills over this width… */
const RIM = 44;
const RIM_HEIGHT = 11;
/** …except where a river cuts through it (within this far of the water). */
const RIM_CUT = 40;
/** River segments are bucketed this far beyond the water: wide banks, the rim cut and nearRiver() all fit. */
const RIVER_EXTRA = RIM_CUT + 2;
/** Bucket cells. */
const CELL = 16;

/** How far a river bank slopes up to ground of height `h`. */
export function riverBankWidth(h: number): number {
  return Math.min(BANK_MAX, RIVER_BANK + Math.max(0, h - FLAT_LEVEL) * BANK_PER_METRE);
}

/** How far a pond's shore slopes up to ground of height `h`. */
export function pondShoreWidth(h: number): number {
  return Math.min(SHORE_MAX, POND_SHORE + Math.max(0, h - FLAT_LEVEL) * SHORE_PER_METRE);
}

/**
 * The slow part of the open world's ground, on a 4 m grid: the smooth level (big rolling swells, biome
 * relief and highland lift), the 22 m bumps on top, and the relief that scales the small bumps. Roads,
 * yards and the camp settle at the smooth level; the generator asks it where the ground is high.
 */
export class GroundField {
  private readonly half: number;
  private readonly cells: number;
  private readonly level: Float32Array;
  private readonly rough: Float32Array;
  private readonly relief: Float32Array;
  /** Filled by sample(). */
  sLevel = 0;
  sRough = 0;
  sRelief = 0;

  constructor(seed: number, size: number, biomes: BiomeField) {
    this.half = size / 2;
    this.cells = Math.round(size / COARSE);
    const n = this.cells + 1;
    this.level = new Float32Array(n * n);
    this.rough = new Float32Array(n * n);
    this.relief = new Float32Array(n * n);
    const reliefOf = biomeTable((g) => g.relief);
    const liftOf = biomeTable((g) => g.lift);
    for (let j = 0; j < n; j++) {
      const z = -this.half + j * COARSE;
      for (let i = 0; i < n; i++) {
        const x = -this.half + i * COARSE;
        const k = j * n + i;
        const relief = biomes.mix(x, z, reliefOf);
        const swell = valueNoise(x / 150, z / 150, seed + 101) * 0.65 + valueNoise(x / 60, z / 60, seed + 103) * 0.35;
        this.level[k] = Math.max(FLAT_LEVEL, smoothstep(0.3, 0.8, swell) * MACRO_HEIGHT * relief + biomes.mix(x, z, liftOf));
        this.rough[k] = (valueNoise(x / 22, z / 22, seed) - 0.5) * 2.2;
        this.relief[k] = relief;
      }
    }
  }

  /** The smooth ground level at a point: no bumps, hills or carving. */
  levelAt(x: number, z: number): number {
    this.sample(x, z);
    return this.sLevel;
  }

  /** Bilinear level, bumps and relief at a point, into sLevel / sRough / sRelief. */
  sample(x: number, z: number): void {
    const n = this.cells + 1;
    let fx = (x + this.half) / COARSE;
    let fz = (z + this.half) / COARSE;
    fx = fx < 0 ? 0 : fx > this.cells - 1e-6 ? this.cells - 1e-6 : fx;
    fz = fz < 0 ? 0 : fz > this.cells - 1e-6 ? this.cells - 1e-6 : fz;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * n + i;
    this.sLevel = bilinear(this.level, k, n, tx, tz);
    this.sRough = bilinear(this.rough, k, n, tx, tz);
    this.sRelief = bilinear(this.relief, k, n, tx, tz);
  }
}

function bilinear(g: Float32Array, k: number, n: number, tx: number, tz: number): number {
  const top = g[k] + (g[k + 1] - g[k]) * tx;
  const bottom = g[k + n] + (g[k + n + 1] - g[k + n]) * tx;
  return top + (bottom - top) * tz;
}

/** A river or ridge spine, its arc lengths (as CurveShape keeps them), and its segments bucketed. */
interface Curve {
  pts: readonly Pt[];
  cum: Float64Array;
  reach: number;
  idx: GridIndex;
}

/** Result of projectOn(). */
const hit = { d: 0, s: 0 };

/**
 * CurveShape.project restricted to a few of the curve's segments (the ones bucketed near the point):
 * the same maths, so the same answer. False when none is within reach; else `hit` holds d and s.
 */
function projectOn(c: Curve, segs: readonly number[], x: number, z: number): boolean {
  let best = c.reach * c.reach;
  let bestS = 0;
  let found = false;
  for (let k = 0; k < segs.length; k++) {
    const i = segs[k];
    const a = c.pts[i - 1];
    const b = c.pts[i];
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
      bestS = c.cum[i - 1] + (c.cum[i] - c.cum[i - 1]) * t;
      found = true;
    }
  }
  if (!found) return false;
  hit.d = Math.sqrt(best);
  hit.s = bestS;
  return true;
}

function curveOf(pts: readonly Pt[], reach: number, half: number): Curve {
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  const idx = new GridIndex(half, CELL);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    idx.add(i, Math.min(a.x, b.x) - reach, Math.min(a.z, b.z) - reach, Math.max(a.x, b.x) + reach, Math.max(a.z, b.z) + reach);
  }
  return { pts, cum, reach, idx };
}

/** Same as terrain.ts's ridgeProfile, from a projection: 1 on the crest, 0 at the foot and inside passes. */
function ridgeProfile(ridge: RidgeShape, d: number, s: number): number {
  if (d >= ridge.halfWidth) return 0;
  return (1 - smoothstep(ridge.crest, ridge.halfWidth, d)) * (1 - ridge.openAt(s));
}

const circleBox = (idx: GridIndex, item: number, x: number, z: number, r: number) => idx.add(item, x - r, z - r, x + r, z + r);

/**
 * The open world's terrain. Shaped like the normal maps (the same rivers, ponds, ridges and clearings)
 * but over 1 km with rolling ground, biome relief and a rim of hills at the edge. Heights are computed
 * once into a 1 m grid and read back bilinearly; ridge, river, pond and bridge queries look only at the
 * features bucketed near the point. The crossings, bridges, fords, rivers and ridges themselves come
 * from Terrain, built from the same layout.
 */
export class WorldTerrain extends Terrain {
  private readonly src: MapLayout;
  private readonly seed: number;
  private readonly half: number;
  /** Height samples per side. */
  private readonly n: number;
  private readonly heights: Float32Array;
  private readonly ridgeCurves: Curve[];
  private readonly riverCurves: Curve[];
  private readonly cell: GridIndex;
  private readonly hillIdx: GridIndex;
  private readonly roadIdx: GridIndex;
  private readonly clearIdx: GridIndex;
  private readonly pondIdx: GridIndex;
  private readonly fordIdx: GridIndex;
  private readonly bridgeIdx: GridIndex;
  private readonly roadSegs: { ax: number; az: number; bx: number; bz: number; hw: number }[] = [];
  /** The camp and every POI yard, each flattened to the smooth level at its middle. */
  private readonly clears: (Circle & { level: number })[];
  private readonly peakHeight: number;

  constructor(layout: MapLayout, ground: GroundField) {
    super(layout);
    this.src = layout;
    this.seed = layout.seed;
    this.half = layout.size / 2;
    const half = this.half;

    this.ridgeCurves = this.ridges.map((r) => curveOf(r.pts, r.halfWidth + 1, half));
    this.riverCurves = this.rivers.map((r) => curveOf(r.pts, r.halfWidth + RIVER_EXTRA, half));
    // One shared cell grid: every index below uses the same cells, so a sample looks its cell up once.
    this.cell = new GridIndex(half, CELL);
    this.hillIdx = new GridIndex(half, CELL);
    layout.hills.forEach((h, i) => circleBox(this.hillIdx, i, h.x, h.z, h.r));
    this.roadIdx = new GridIndex(half, CELL);
    for (const road of layout.roads ?? []) {
      const hw = road.width / 2;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1];
        const b = road.points[i];
        const m = hw + 6;
        this.roadIdx.add(this.roadSegs.length, Math.min(a.x, b.x) - m, Math.min(a.z, b.z) - m, Math.max(a.x, b.x) + m, Math.max(a.z, b.z) + m);
        this.roadSegs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, hw });
      }
    }
    this.clears = [layout.start, ...(layout.clear ?? [])].map((c) => ({ x: c.x, z: c.z, r: c.r, level: ground.levelAt(c.x, c.z) }));
    this.clearIdx = new GridIndex(half, CELL);
    this.clears.forEach((c, i) => circleBox(this.clearIdx, i, c.x, c.z, c.r + 8));
    this.pondIdx = new GridIndex(half, CELL);
    layout.ponds.forEach((p, i) => circleBox(this.pondIdx, i, p.x, p.z, p.r + SHORE_MAX));
    this.fordIdx = new GridIndex(half, CELL);
    this.fords.forEach((f, i) => circleBox(this.fordIdx, i, f.x, f.z, f.r));
    this.bridgeIdx = new GridIndex(half, CELL);
    this.bridges.forEach((b, i) => circleBox(this.bridgeIdx, i, b.x, b.z, b.halfLength + b.halfWidth));

    this.n = Math.round(layout.size / STEP) + 1;
    const n = this.n;
    this.heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      const z = -half + j * STEP;
      for (let i = 0; i < n; i++) this.heights[j * n + i] = this.compute(-half + i * STEP, z, ground);
    }
    this.peakHeight = layout.hills.reduce((m, h) => Math.max(m, this.heightAt(h.x, h.z)), 0);
  }

  heightAt(x: number, z: number): number {
    const n = this.n;
    let fx = (x + this.half) / STEP;
    let fz = (z + this.half) / STEP;
    fx = fx < 0 ? 0 : fx > n - 1.000001 ? n - 1.000001 : fx;
    fz = fz < 0 ? 0 : fz > n - 1.000001 ? n - 1.000001 : fz;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    return bilinear(this.heights, j * n + i, n, fx - i, fz - j);
  }

  bridgeAt(x: number, z: number): Bridge | null {
    const list = this.bridgeIdx.at(x, z);
    for (let i = 0; i < list.length; i++) {
      const b = this.bridges[list[i]];
      const rx = x - b.x;
      const rz = z - b.z;
      if (Math.abs(rx * b.dirX + rz * b.dirZ) <= b.halfLength && Math.abs(rz * b.dirX - rx * b.dirZ) <= b.halfWidth) return b;
    }
    return null;
  }

  isIce(x: number, z: number): boolean {
    const list = this.pondIdx.at(x, z);
    for (let i = 0; i < list.length; i++) {
      const p = this.src.ponds[list[i]];
      if (p.frozen && (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < p.r * p.r) return true;
    }
    return false;
  }

  isWall(x: number, z: number): boolean {
    const cell = this.cell.cellOf(x, z);
    for (let k = 0; k < this.ridgeCurves.length; k++) {
      const c = this.ridgeCurves[k];
      const segs = c.idx.cells[cell];
      if (!segs || !projectOn(c, segs, x, z)) continue;
      const r = this.ridges[k];
      if (hit.d < r.wallHalf && r.openAt(hit.s) < 0.5) return true;
    }
    return false;
  }

  ridgeAmount(x: number, z: number): number {
    const cell = this.cell.cellOf(x, z);
    let a = 0;
    for (let k = 0; k < this.ridgeCurves.length; k++) {
      const c = this.ridgeCurves[k];
      const segs = c.idx.cells[cell];
      if (!segs || !projectOn(c, segs, x, z)) continue;
      a = Math.max(a, ridgeProfile(this.ridges[k], hit.d, hit.s));
    }
    return a;
  }

  nearRiver(x: number, z: number, gap: number): boolean {
    if (gap > RIVER_EXTRA) return super.nearRiver(x, z, gap);
    return this.riverEdge(x, z) < gap;
  }

  /**
   * Distance from the nearest river's water edge (negative in the water), or Infinity when more than
   * ~40 m away. Handy for shore colours.
   */
  riverEdge(x: number, z: number): number {
    const cell = this.cell.cellOf(x, z);
    let best = Infinity;
    for (let k = 0; k < this.riverCurves.length; k++) {
      const c = this.riverCurves[k];
      const segs = c.idx.cells[cell];
      if (!segs || !projectOn(c, segs, x, z)) continue;
      best = Math.min(best, hit.d - this.rivers[k].halfWidth);
    }
    return best;
  }

  /** Height of the highest hill summit, for colouring and camera zoom. */
  peak(): number {
    return this.peakHeight;
  }

  /** 1 in the middle of a ford, 0 outside (terrain.ts's fordAmount, over the fords nearby). */
  private fordAt(x: number, z: number, cell: number): number {
    const list = this.fordIdx.cells[cell];
    if (!list) return 0;
    let a = 0;
    for (let i = 0; i < list.length; i++) {
      const f = this.fords[list[i]];
      a = Math.max(a, 1 - smoothstep(f.r * 0.6, f.r, Math.hypot(x - f.x, z - f.z)));
    }
    return a;
  }

  /**
   * The analytic height field, evaluated once per grid sample. Same steps as Terrain.heightAt (noise,
   * hills, roads, ridges, clearings, rivers, ponds, edge), except that roads and clearings settle at the
   * smooth ground level instead of one fixed height, and banks and shores widen on high ground.
   */
  private compute(x: number, z: number, ground: GroundField): number {
    const seed = this.seed;
    const cell = this.cell.cellOf(x, z);
    ground.sample(x, z);
    const level = ground.sLevel;

    let h = level + (ground.sRough + (valueNoise(x / 7, z / 7, seed + 17) - 0.5) * 0.45) * (0.45 + 0.55 * ground.sRelief);
    // As on the normal maps: dips flatten out above the water line, so the only water is in ponds and rivers.
    if (h < GROUND_FLOOR) h = GROUND_FLOOR - (GROUND_FLOOR - h) * DIP_KEEP;

    const hills = this.hillIdx.cells[cell];
    if (hills) {
      for (let i = 0; i < hills.length; i++) {
        const hill = this.src.hills[hills[i]];
        const d2 = (x - hill.x) * (x - hill.x) + (z - hill.z) * (z - hill.z);
        if (d2 < hill.r * hill.r) h += hill.h * 0.5 * (1 + Math.cos((Math.PI * Math.sqrt(d2)) / hill.r));
      }
    }

    // Dirt tracks: smoothed to the ground's level, so they run over the swells without bumps.
    const roads = this.roadIdx.cells[cell];
    if (roads) {
      // Distance beyond the nearest road's edge; flat to 1 m past it, back to normal ground 6 m past it.
      let best = Infinity;
      for (let i = 0; i < roads.length; i++) {
        const s = this.roadSegs[roads[i]];
        best = Math.min(best, distToSegment(x, z, s.ax, s.az, s.bx, s.bz) - s.hw);
      }
      if (best < 6) h = lerp(level, h, smoothstep(1, 6, best));
    }

    for (let k = 0; k < this.ridgeCurves.length; k++) {
      const c = this.ridgeCurves[k];
      const segs = c.idx.cells[cell];
      if (!segs || !projectOn(c, segs, x, z)) continue;
      const ridge = this.ridges[k];
      const amount = ridgeProfile(ridge, hit.d, hit.s);
      if (amount > 0) h += ridge.def.height * amount * (0.85 + 0.3 * valueNoise(x / 6, z / 6, seed + 29));
    }

    // The camp and the abandoned buildings' yards: flat at the ground's level there.
    const clears = this.clearIdx.cells[cell];
    if (clears) {
      for (let i = 0; i < clears.length; i++) {
        const c = this.clears[clears[i]];
        h = lerp(c.level, h, smoothstep(c.r, c.r + 8, Math.hypot(x - c.x, z - c.z)));
      }
    }

    // Rivers: flat banks, then a channel whose middle sits `depth` below the water (less at fords).
    let rimCut = 0;
    for (let k = 0; k < this.riverCurves.length; k++) {
      const c = this.riverCurves[k];
      const segs = c.idx.cells[cell];
      if (!segs || !projectOn(c, segs, x, z)) continue;
      const d = hit.d;
      const river = this.rivers[k];
      const hw = river.halfWidth;
      h = lerp(FLAT_LEVEL, h, smoothstep(hw + 3, hw + 3 + riverBankWidth(h), d));
      rimCut = Math.max(rimCut, 1 - smoothstep(hw + 3, hw + RIM_CUT, d));
      if (d < hw) {
        const t = d / hw;
        const depth = lerp(river.depth, FORD_DEPTH, this.fordAt(x, z, cell));
        h -= (FLAT_LEVEL - WATER_LEVEL + depth) * (1 - t * t);
      }
    }

    // Ponds: flatten around, then carve a bowl (frozen ponds stay flat: the ice is the floor).
    const ponds = this.pondIdx.cells[cell];
    if (ponds) {
      for (let i = 0; i < ponds.length; i++) {
        const pond = this.src.ponds[ponds[i]];
        const dp = Math.hypot(x - pond.x, z - pond.z);
        const shore = pondShoreWidth(h);
        if (dp > pond.r + shore) continue;
        h = lerp(FLAT_LEVEL, h, smoothstep(pond.r, pond.r + shore, dp));
        if (dp < pond.r && !pond.frozen) {
          const t = dp / pond.r;
          h -= (FLAT_LEVEL - WATER_LEVEL + pond.depth) * (1 - t * t);
        }
      }
    }

    // A rim of hills along the edge, so the world feels enclosed; rivers keep flowing out through it.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    if (edge > this.half - RIM && rimCut < 1) {
      const rise = RIM_HEIGHT * (0.7 + 0.6 * valueNoise(x / 40, z / 40, seed + 71));
      h += smoothstep(this.half - RIM, this.half - 2, edge) * rise * (1 - rimCut);
    }
    return h;
  }
}
