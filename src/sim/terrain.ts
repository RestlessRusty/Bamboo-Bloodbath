import { lerp, smoothstep, valueNoise } from '../core/math';
import type { Circle, MapLayout } from './mapLayout';
import { RidgeShape, RiverShape, type Bridge, type Crossing } from './river';

export const WATER_LEVEL = -0.12;
const FLAT_LEVEL = 0.2;
/** Width of the slope from a river's flat banks back to normal ground. */
const RIVER_BANK = 6;
/** How far the bed of a ford sits below the water: shallow enough for zombies. */
const FORD_DEPTH = 0.08;
/** Natural dips flatten out below this height… */
const GROUND_FLOOR = 0.05;
/** …keeping only this fraction of their depth, so they never reach the water line. */
const DIP_KEEP = 0.1;

/** Analytic height field shared by physics (via the grid) and rendering. */
export class Terrain {
  readonly waterLevel = WATER_LEVEL;
  readonly rivers: RiverShape[];
  readonly bridges: Bridge[] = [];
  readonly fords: Circle[] = [];
  readonly ridges: RidgeShape[];
  /** Every bridge, ford and ridge pass, with an end on each side. */
  readonly crossings: Crossing[] = [];

  constructor(private readonly layout: MapLayout) {
    this.ridges = layout.ridges.map((r) => new RidgeShape(r, r.width / 2 + 1));
    for (const ridge of this.ridges) {
      for (const g of ridge.gaps) {
        const p = ridge.at(ridge.fractionOf(g.s));
        this.crossings.push(crossing('gap', p, -p.tz, p.tx, ridge.halfWidth + 2, g.half));
      }
    }
    this.rivers = layout.rivers.map((r) => new RiverShape(r, r.width / 2 + RIVER_BANK + 5));
    for (const river of this.rivers) {
      const hw = river.halfWidth;
      for (const f of river.def.bridges) {
        const p = river.at(f);
        const bridge: Bridge = { x: p.x, z: p.z, dirX: -p.tz, dirZ: p.tx, halfLength: hw + 2.5, halfWidth: 1.5, top: FLAT_LEVEL + 0.05 };
        this.bridges.push(bridge);
        this.crossings.push(crossing('bridge', p, bridge.dirX, bridge.dirZ, bridge.halfLength + 1.2, bridge.halfWidth));
      }
      for (const f of river.def.fords) {
        const p = river.at(f);
        const ford = { x: p.x, z: p.z, r: Math.max(4, river.def.width * 0.75) };
        this.fords.push(ford);
        // fordAmount is full inside 0.6 r: that's the part shallow enough to wade.
        this.crossings.push(crossing('ford', p, -p.tz, p.tx, hw + 2.5, ford.r * 0.6));
      }
    }
  }

  heightAt(x: number, z: number): number {
    const { seed, hills, ponds, start, goal, size } = this.layout;

    let h = (valueNoise(x / 22, z / 22, seed) - 0.5) * 2.2 + (valueNoise(x / 7, z / 7, seed + 17) - 0.5) * 0.45;
    // Low spots in the noise used to sink below the water line: muddy patches with no visible water
    // that still slowed everyone down. Squash them so the only water is in ponds and rivers.
    if (h < GROUND_FLOOR) h = GROUND_FLOOR - (GROUND_FLOOR - h) * DIP_KEEP;

    for (const hill of hills) {
      const dh = Math.hypot(x - hill.x, z - hill.z);
      if (dh < hill.r) h += hill.h * 0.5 * (1 + Math.cos((Math.PI * dh) / hill.r));
    }

    // Roads: flat, so carts roll straight. Before the ridges, which still rise beside a road through a pass.
    for (const road of this.layout.roads ?? []) {
      const hw = road.width / 2;
      h = lerp(FLAT_LEVEL, h, smoothstep(hw + 1, hw + 6, roadDistance(road.points, x, z)));
    }

    // Ridges: steep walls with a rough crest, cut open at the passes.
    for (const ridge of this.ridges) {
      const amount = ridgeProfile(ridge, x, z);
      if (amount > 0) h += ridge.def.height * amount * (0.85 + 0.3 * valueNoise(x / 6, z / 6, seed + 29));
    }

    // Flat clearings at the start camp and the rescue hut.
    for (const c of [start, goal]) {
      h = lerp(FLAT_LEVEL, h, smoothstep(c.r, c.r + 8, Math.hypot(x - c.x, z - c.z)));
    }
    // …and a flat yard around each building.
    for (const l of this.layout.landmarks ?? []) {
      h = lerp(FLAT_LEVEL, h, smoothstep(l.r + 3, l.r + 9, Math.hypot(x - l.x, z - l.z)));
    }

    // Rivers: flat banks, then a channel whose middle sits `depth` below the water (less at fords).
    let inRiver = 0;
    for (const river of this.rivers) {
      const d = river.distance(x, z);
      if (d === Infinity) continue;
      const hw = river.halfWidth;
      // Perfectly flat for 3 m beside the water, so bridge decks meet the bank without a step.
      const bank = smoothstep(hw + 3, hw + 3 + RIVER_BANK, d);
      h = lerp(FLAT_LEVEL, h, bank);
      inRiver = Math.max(inRiver, 1 - bank);
      if (d < hw) {
        const t = d / hw;
        const depth = lerp(river.depth, FORD_DEPTH, this.fordAmount(x, z));
        h -= (FLAT_LEVEL - WATER_LEVEL + depth) * (1 - t * t);
      }
    }

    // Flatten around each pond, then carve a bowl whose centre sits `depth` below the water.
    // Frozen ponds stay flat: the ice is the floor.
    for (const pond of ponds) {
      const dp = Math.hypot(x - pond.x, z - pond.z);
      if (dp > pond.r + 7) continue;
      h = lerp(FLAT_LEVEL, h, smoothstep(pond.r, pond.r + 7, dp));
      if (dp < pond.r && !pond.frozen) {
        const t = dp / pond.r;
        h -= (FLAT_LEVEL - WATER_LEVEL + pond.depth) * (1 - t * t);
      }
    }

    // Rise towards the edges so the valley feels enclosed (rivers keep flowing out through the hills).
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(size / 2 - 4, size / 2 + 16, edge) * 5 * (1 - inRiver);

    return h;
  }

  /** Too deep for zombies (they can't swim); pandas swim slowly. Bridge decks are dry. */
  isWater(x: number, z: number): boolean {
    return this.heightAt(x, z) < WATER_LEVEL - 0.15 && !this.onBridge(x, z);
  }

  /** Any water at all, shallow fords included: slows everyone down. */
  isWet(x: number, z: number): boolean {
    return this.heightAt(x, z) < WATER_LEVEL - 0.03 && !this.onBridge(x, z);
  }

  /** Walking surface: the terrain, or a bridge deck above it. */
  groundAt(x: number, z: number): number {
    const h = this.heightAt(x, z);
    const b = this.bridgeAt(x, z);
    return b ? Math.max(h, b.top) : h;
  }

  onBridge(x: number, z: number): boolean {
    return this.bridgeAt(x, z) !== null;
  }

  bridgeAt(x: number, z: number): Bridge | null {
    for (const b of this.bridges) {
      const rx = x - b.x;
      const rz = z - b.z;
      if (Math.abs(rx * b.dirX + rz * b.dirZ) <= b.halfLength && Math.abs(rz * b.dirX - rx * b.dirZ) <= b.halfWidth) return b;
    }
    return null;
  }

  /** On a frozen pond: slippery. */
  isIce(x: number, z: number): boolean {
    return this.layout.ponds.some((p) => p.frozen && Math.hypot(x - p.x, z - p.z) < p.r);
  }

  /** Inside a ridge's unclimbable core (passes excluded). */
  isWall(x: number, z: number): boolean {
    for (const r of this.ridges) {
      const p = r.project(x, z);
      if (p.d < r.wallHalf && r.openAt(p.s) < 0.5) return true;
    }
    return false;
  }

  /** 0 on open ground, 1 on a ridge crest. */
  ridgeAmount(x: number, z: number): number {
    let a = 0;
    for (const r of this.ridges) a = Math.max(a, ridgeProfile(r, x, z));
    return a;
  }

  /** Within `gap` of a river's water. */
  nearRiver(x: number, z: number, gap: number): boolean {
    return this.rivers.some((r) => r.distance(x, z) < r.halfWidth + gap);
  }

  /** 1 in the middle of a ford, 0 outside. */
  private fordAmount(x: number, z: number): number {
    let a = 0;
    for (const f of this.fords) a = Math.max(a, 1 - smoothstep(f.r * 0.6, f.r, Math.hypot(x - f.x, z - f.z)));
    return a;
  }

  /** Unit vector pointing uphill (out of any water), or zero on flat ground. */
  uphill(x: number, z: number): { x: number; z: number } {
    const e = 0.5;
    const gx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const gz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const l = Math.hypot(gx, gz);
    return l > 1e-4 ? { x: gx / l, z: gz / l } : { x: 0, z: 0 };
  }

  /** Height of the highest hill summit, for colouring and camera zoom. */
  peak(): number {
    return this.layout.hills.reduce((m, h) => Math.max(m, h.h), 0);
  }
}

/** Distance from (x, z) to the nearest point of a polyline. */
export function roadDistance(points: readonly { x: number; z: number }[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
    best = Math.min(best, Math.hypot(a.x + abx * t - x, a.z + abz * t - z));
  }
  return best;
}

/** 1 on the crest, falling to 0 at the foot, and 0 inside passes. */
function ridgeProfile(ridge: RidgeShape, x: number, z: number): number {
  const p = ridge.project(x, z);
  if (p.d >= ridge.halfWidth) return 0;
  return (1 - smoothstep(ridge.crest, ridge.halfWidth, p.d)) * (1 - ridge.openAt(p.s));
}

function crossing(
  kind: Crossing['kind'],
  p: { x: number; z: number },
  dx: number,
  dz: number,
  half: number,
  halfWidth: number,
): Crossing {
  return {
    kind,
    a: { x: p.x - dx * half, z: p.z - dz * half },
    b: { x: p.x + dx * half, z: p.z + dz * half },
    length: half * 2,
    halfWidth,
  };
}

export interface TerrainGrid {
  positions: Float32Array;
  indices: Uint32Array;
  size: number;
  seg: number;
}

/** Regular grid sampled from the height field; used for both the physics trimesh and the render mesh. */
export function buildTerrainGrid(terrain: Terrain, size: number, seg: number): TerrainGrid {
  const n = seg + 1;
  const step = size / seg;
  const half = size / 2;
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const k = (j * n + i) * 3;
      positions[k] = x;
      positions[k + 1] = terrain.heightAt(x, z);
      positions[k + 2] = z;
    }
  }
  // Counter-clockwise seen from above, so normals point up.
  const indices = new Uint32Array(seg * seg * 6);
  let p = 0;
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i;
      const b = a + n;
      const c = a + 1;
      const d = b + 1;
      indices[p++] = a;
      indices[p++] = b;
      indices[p++] = c;
      indices[p++] = c;
      indices[p++] = b;
      indices[p++] = d;
    }
  }
  return { positions, indices, size, seg };
}
