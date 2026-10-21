import { valueNoise } from '../../core/math';
import { Rng } from '../../core/rng';
import type { MapTheme } from '../mapLayout';
import { RIVER_CROSSING } from '../maps/riverCrossing';
import { SNOWY_PASS } from '../maps/snowyPass';
import { FIREFLY_FEN } from '../maps/story/fireflyFen';
import { QUARRY_ROAD } from '../maps/story/quarryRoad';
import { SPROUT_FARM } from '../maps/story/sproutFarm';
import { BAMBOO_VALLEY } from '../maps/valley';
import { BIOME_IDS, type BiomeDef, type BiomeId } from './types';

/**
 * The open world's seven biomes: their looks (MapThemes borrowed from the hand-made maps where one fits)
 * and how the generator dresses them, plus the BiomeField that says which biome is where, blending
 * smoothly across the borders.
 */

/** Deep green and shady: Bamboo Valley's palette, darker, with tall bamboo. */
const BAMBOO_FOREST: MapTheme = {
  ...BAMBOO_VALLEY.theme,
  sky: 0xc6ead4,
  fogNear: 45,
  fogFar: 120,
  hemiGround: 0x4f7f3a,
  ground: {
    ...BAMBOO_VALLEY.theme.ground,
    a: 0x7cc455,
    b: 0x5aa444,
    high: 0x9fd46a,
    thicket: 0x4a8a35,
    rim: 0x4a7f38,
  },
  roundLeaves: [0x5db34a, 0x4fa040, 0x6cc24a],
  pineShare: 0.15,
  grass: [0x6ab84a, 0x5aa840, 0x7cc855],
  flowers: [0xffffff, 0xffe066],
  stalks: [0x7fbf45, 0x6faf3f, 0x8fcf52],
  stalkNode: 0x4f8a2e,
  stalkLeaves: [0x4fa23e, 0x5fb347, 0x3f8f35],
};

/** Dark firs on mossy ground: River Crossing's palette without the blossoms. */
const PINE_WOODS: MapTheme = {
  ...RIVER_CROSSING.theme,
  sky: 0xbfe0ea,
  fogNear: 45,
  fogFar: 125,
  hemiGround: 0x4f6f45,
  ground: {
    ...RIVER_CROSSING.theme.ground,
    a: 0x6fa055,
    b: 0x5a8a48,
    high: 0x8fb46a,
    thicket: 0x4a7a3e,
    clearing: 0xb89e72,
    rim: 0x4a7040,
  },
  roundLeaves: [0x4f8f4a, 0x5a9a50, 0x467f44],
  pineLeaves: [0x2f6b4f, 0x3a7a55, 0x2a6045],
  pineShare: 0.9,
  grass: [0x5f9a4a, 0x6aa852, 0x568f45],
  flowers: [0xffffff, 0xc39bff, 0xffe066],
};

/** Firefly Fen, with the mist pulled in closer. */
const MISTY_FEN: MapTheme = { ...FIREFLY_FEN.theme, fogNear: 30, fogFar: 105 };

export const BIOMES: Readonly<Record<BiomeId, BiomeDef>> = {
  meadow: { id: 'meadow', name: 'Meadow', theme: BAMBOO_VALLEY.theme },
  bamboo: { id: 'bamboo', name: 'Bamboo Forest', theme: BAMBOO_FOREST },
  pine: { id: 'pine', name: 'Pine Woods', theme: PINE_WOODS },
  snow: { id: 'snow', name: 'Snowy Highlands', theme: SNOWY_PASS.theme },
  fen: { id: 'fen', name: 'Misty Fen', theme: MISTY_FEN },
  quarry: { id: 'quarry', name: 'Old Quarry', theme: QUARRY_ROAD.theme },
  farm: { id: 'farm', name: 'Farmland', theme: SPROUT_FARM.theme },
};

/** How the generator shapes and fills a biome. Chances are per candidate spot of a jittered grid. */
export interface BiomeGen {
  /** How much the ground rolls (× the terrain's macro height) and how bumpy it is. */
  relief: number;
  /** Raised ground, in metres (highlands). */
  lift: number;
  /** Hill height scale. */
  hills: number;
  /** Chance of a tree per 5 m spot. */
  trees: number;
  /** …of a boulder per 9 m spot. */
  rocks: number;
  /** …of a hiding thicket per 24 m spot. */
  thickets: number;
  /** …of a bamboo grove (a resource node) per 16 m spot. */
  groves: number;
  /** …of a scrap pile per 20 m spot. */
  scrap: number;
  /** Chance a pond proposed here is kept. */
  ponds: number;
  /** Decor: chance per grass spot and per flower patch. */
  grass: number;
  flowers: number;
}

export const BIOME_GEN: Readonly<Record<BiomeId, BiomeGen>> = {
  meadow: { relief: 0.7, lift: 0, hills: 0.8, trees: 0.09, rocks: 0.07, thickets: 0.09, groves: 0.07, scrap: 0.004, ponds: 0.3, grass: 1, flowers: 1 },
  bamboo: { relief: 0.9, lift: 0, hills: 0.9, trees: 0.12, rocks: 0.05, thickets: 0.5, groves: 0.2, scrap: 0.003, ponds: 0.2, grass: 0.8, flowers: 0.35 },
  pine: { relief: 1.1, lift: 0, hills: 1, trees: 0.38, rocks: 0.1, thickets: 0.04, groves: 0.02, scrap: 0.003, ponds: 0.25, grass: 0.6, flowers: 0.3 },
  snow: { relief: 1.3, lift: 2, hills: 1, trees: 0.22, rocks: 0.14, thickets: 0.05, groves: 0.01, scrap: 0.004, ponds: 0.6, grass: 0.45, flowers: 0.15 },
  fen: { relief: 0.15, lift: 0, hills: 0.35, trees: 0.14, rocks: 0.05, thickets: 0.09, groves: 0.05, scrap: 0.003, ponds: 1, grass: 1, flowers: 1.4 },
  quarry: { relief: 0.9, lift: 0, hills: 0.8, trees: 0.04, rocks: 0.55, thickets: 0.03, groves: 0.02, scrap: 0.07, ponds: 0.35, grass: 0.5, flowers: 0.3 },
  farm: { relief: 0.35, lift: 0, hills: 0.55, trees: 0.04, rocks: 0.03, thickets: 0.07, groves: 0.07, scrap: 0.04, ponds: 0.2, grass: 1, flowers: 0.8 },
};

/** One number per biome, in BIOME_IDS order, for BiomeField.mix(). */
export function biomeTable(pick: (g: BiomeGen, id: BiomeId) => number): number[] {
  return BIOME_IDS.map((id) => pick(BIOME_GEN[id], id));
}

/** Biome sites per side of the world (a jittered grid of 25). */
const SITES_PER_SIDE = 5;
/** Borders blend over about this many metres. */
const BLEND = 48;
/** Borders wobble this far, at this scale, so they don't run straight. */
const WARP = 90;
const WARP_SCALE = 120;
/** The weight grid's spacing; weights are bilinear in between. */
const STEP = 4;
const KINDS = BIOME_IDS.length;

/**
 * Which biome is where: every site of a jittered 5 × 5 grid gets a biome, and a point belongs to its
 * nearest site (measured through a noise warp, for ragged borders). Near a border the weights of the
 * sites about as close blend smoothly. The camp's two nearest sites are always meadow.
 */
export class BiomeField {
  readonly sites: { x: number; z: number; biome: number }[] = [];
  private readonly half: number;
  /** Grid cells per side. */
  private readonly cells: number;
  /** KINDS weights per grid point, row by row from the north-west corner. */
  private readonly grid: Float32Array;
  // Set by locate(): the four grid points around a query and how far between them it is.
  private k00 = 0;
  private k10 = 0;
  private k01 = 0;
  private k11 = 0;
  private tx = 0;
  private tz = 0;

  constructor(seed: number, size: number, spawn: { x: number; z: number }) {
    const rng = new Rng(seed ^ 0xb10e);
    this.half = size / 2;
    const cell = size / SITES_PER_SIDE;
    for (let j = 0; j < SITES_PER_SIDE; j++) {
      for (let i = 0; i < SITES_PER_SIDE; i++) {
        this.sites.push({
          x: -this.half + (i + 0.5 + rng.range(-0.32, 0.32)) * cell,
          z: -this.half + (j + 0.5 + rng.range(-0.32, 0.32)) * cell,
          biome: 0,
        });
      }
    }
    // The camp's neighbourhood is meadow; everything else is shuffled from a fixed mix so every world has
    // every biome, a few times over.
    const bySpawn = this.sites.map((_, i) => i).sort((a, b) => dist(this.sites[a], spawn) - dist(this.sites[b], spawn));
    const pool: BiomeId[] = ['meadow', 'meadow', 'bamboo', 'bamboo', 'bamboo', 'bamboo', 'pine', 'pine', 'pine', 'pine', 'snow', 'snow', 'snow', 'fen', 'fen', 'fen', 'quarry', 'quarry', 'quarry', 'quarry', 'farm', 'farm', 'farm'];
    for (let i = pool.length - 1; i > 0; i--) {
      const k = Math.floor(rng.next() * (i + 1));
      [pool[i], pool[k]] = [pool[k], pool[i]];
    }
    bySpawn.forEach((site, rank) => {
      this.sites[site].biome = rank < 2 ? 0 : BIOME_IDS.indexOf(pool[rank - 2]);
    });

    this.cells = Math.round(size / STEP);
    const n = this.cells + 1;
    this.grid = new Float32Array(n * n * KINDS);
    const d = new Float32Array(this.sites.length);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) this.exact(-this.half + i * STEP, -this.half + j * STEP, seed, d, (j * n + i) * KINDS);
    }
  }

  /** The strongest biome at a point. */
  biomeAt(x: number, z: number): BiomeId {
    return BIOME_IDS[this.indexAt(x, z)];
  }

  /** Index (in BIOME_IDS) of the strongest biome at a point. */
  indexAt(x: number, z: number): number {
    this.locate(x, z);
    let best = 0;
    let bestW = -1;
    for (let b = 0; b < KINDS; b++) {
      const w = this.lerp(b);
      if (w > bestW) {
        bestW = w;
        best = b;
      }
    }
    return best;
  }

  /** Weight of every biome at a point (summing to 1). Fills and returns `out`. */
  weights(x: number, z: number, out: Record<BiomeId, number>): Record<BiomeId, number> {
    this.locate(x, z);
    for (let b = 0; b < KINDS; b++) out[BIOME_IDS[b]] = this.lerp(b);
    return out;
  }

  /** Weight of one biome (index in BIOME_IDS) at a point. */
  weight(x: number, z: number, b: number): number {
    this.locate(x, z);
    return this.lerp(b);
  }

  /** A per-biome number (BIOME_IDS order, see biomeTable) blended by the weights at a point. */
  mix(x: number, z: number, values: readonly number[]): number {
    this.locate(x, z);
    let v = 0;
    for (let b = 0; b < KINDS; b++) v += this.lerp(b) * values[b];
    return v;
  }

  private locate(x: number, z: number): void {
    const n = this.cells + 1;
    let fx = (x + this.half) / STEP;
    let fz = (z + this.half) / STEP;
    fx = fx < 0 ? 0 : fx > this.cells - 1e-6 ? this.cells - 1e-6 : fx;
    fz = fz < 0 ? 0 : fz > this.cells - 1e-6 ? this.cells - 1e-6 : fz;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    this.tx = fx - i;
    this.tz = fz - j;
    this.k00 = (j * n + i) * KINDS;
    this.k10 = this.k00 + KINDS;
    this.k01 = this.k00 + n * KINDS;
    this.k11 = this.k01 + KINDS;
  }

  private lerp(b: number): number {
    const g = this.grid;
    const top = g[this.k00 + b] + (g[this.k10 + b] - g[this.k00 + b]) * this.tx;
    const bottom = g[this.k01 + b] + (g[this.k11 + b] - g[this.k01 + b]) * this.tx;
    return top + (bottom - top) * this.tz;
  }

  /** The weights at a grid point, written into the grid at `k`. `d` is scratch (one per site). */
  private exact(x: number, z: number, seed: number, d: Float32Array, k: number): void {
    const wx = x + (valueNoise(x / WARP_SCALE, z / WARP_SCALE, seed + 1) - 0.5) * WARP;
    const wz = z + (valueNoise(x / WARP_SCALE, z / WARP_SCALE, seed + 2) - 0.5) * WARP;
    let dMin = Infinity;
    for (let i = 0; i < this.sites.length; i++) {
      const s = this.sites[i];
      d[i] = Math.sqrt((s.x - wx) * (s.x - wx) + (s.z - wz) * (s.z - wz));
      if (d[i] < dMin) dMin = d[i];
    }
    let sum = 0;
    for (let i = 0; i < this.sites.length; i++) {
      const f = 1 - (d[i] - dMin) / BLEND;
      if (f <= 0) continue;
      const w = f * f * (3 - 2 * f);
      this.grid[k + this.sites[i].biome] += w;
      sum += w;
    }
    for (let b = 0; b < KINDS; b++) this.grid[k + b] /= sum;
  }
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
