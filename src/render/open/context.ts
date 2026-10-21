import type { GameMap } from '../../sim/gameMap';
import type { MapTheme } from '../../sim/mapLayout';
import { OPEN } from '../../sim/open/config';
import { BIOME_IDS, type BiomeId, type OpenWorldData } from '../../sim/open/types';
import { GroundPalette } from '../world';
import type { OpenAssets } from './assets';
import type { PieceKit } from './pieces';

export const NB = BIOME_IDS.length;
/** Ground palette fields, 3 floats each (linear RGB), in this order per biome. */
export const PAL = { a: 0, b: 3, high: 6, thicket: 9, clearing: 12, shore: 15, mud: 18, rim: 21, cliff: 24 } as const;
export const PAL_SIZE = 27;

/** Everything a streamed chunk needs from its world, made once per world. */
export interface OpenContext {
  readonly map: GameMap;
  readonly world: OpenWorldData;
  readonly assets: OpenAssets;
  readonly kit: PieceKit;
  /** Biome themes by BIOME_IDS index. */
  readonly themes: readonly MapTheme[];
  /** Ground palettes of every biome (NB × PAL_SIZE floats). */
  readonly palettes: Float32Array;
  /** Height where hilltop colouring is complete. */
  readonly peak: number;
  /** Tree / rock prop index → resource node id drawn by it, or -1. */
  readonly treeNode: Int32Array;
  readonly rockNode: Int32Array;
  readonly bambooBiome: number;
}

export function makeContext(map: GameMap, assets: OpenAssets, kit: PieceKit): OpenContext {
  const world = map.open!;
  const themes = BIOME_IDS.map((id) => world.biomes[id].theme);
  const palettes = new Float32Array(NB * PAL_SIZE);
  themes.forEach((theme, b) => {
    const pal = new GroundPalette(map, theme);
    const fields = [pal.a, pal.b, pal.high, pal.thicket, pal.clearing, pal.shore, pal.mud, pal.rim, pal.cliff];
    fields.forEach((c, f) => palettes.set([c.r, c.g, c.b], b * PAL_SIZE + f * 3));
  });
  const treeNode = new Int32Array(map.props.trees.length).fill(-1);
  const rockNode = new Int32Array(map.props.rocks.length).fill(-1);
  for (const n of world.nodes) {
    if (n.kind === 'tree' && n.prop >= 0 && n.prop < treeNode.length) treeNode[n.prop] = n.id;
    else if (n.kind === 'rock' && n.prop >= 0 && n.prop < rockNode.length) rockNode[n.prop] = n.id;
  }
  return {
    map,
    world,
    assets,
    kit,
    themes,
    palettes,
    peak: new GroundPalette(map).peak,
    treeNode,
    rockNode,
    bambooBiome: BIOME_IDS.indexOf('bamboo'),
  };
}

/** Lattice spacing of a chunk's biome weights: smooth enough, and far fewer calls than one per vertex. */
const LAT = 4;
const LN = OPEN.chunk / LAT + 1;

/**
 * Biome weights over one chunk on a world-aligned 4 m lattice, filtered bilinearly in between. The
 * lattice points on a chunk's edge are the same as its neighbour's, so colours meet without a seam.
 */
export class ChunkBiomes {
  private readonly w = new Float32Array(LN * LN * NB);
  private readonly tmp = new Float32Array(NB);

  constructor(
    world: OpenWorldData,
    private readonly x0: number,
    private readonly z0: number,
  ) {
    const rec: Record<BiomeId, number> = { meadow: 0, bamboo: 0, pine: 0, snow: 0, fen: 0, quarry: 0, farm: 0 };
    for (let j = 0; j < LN; j++) {
      for (let i = 0; i < LN; i++) {
        world.biomeWeights(x0 + i * LAT, z0 + j * LAT, rec);
        const o = (j * LN + i) * NB;
        for (let b = 0; b < NB; b++) this.w[o + b] = rec[BIOME_IDS[b]];
      }
    }
  }

  /** Weights of every biome at (x, z) into `out` (NB long). */
  at(x: number, z: number, out: Float32Array): Float32Array {
    const fx = Math.min(LN - 1.001, Math.max(0, (x - this.x0) / LAT));
    const fz = Math.min(LN - 1.001, Math.max(0, (z - this.z0) / LAT));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = (j * LN + i) * NB;
    const b = a + NB;
    const c = a + LN * NB;
    const d = c + NB;
    const w = this.w;
    for (let k = 0; k < NB; k++) {
      out[k] = (w[a + k] * (1 - u) + w[b + k] * u) * (1 - v) + (w[c + k] * (1 - u) + w[d + k] * u) * v;
    }
    return out;
  }

  /** Index (into BIOME_IDS) of the strongest biome at (x, z). */
  dominant(x: number, z: number): number {
    const w = this.at(x, z, this.tmp);
    let best = 0;
    for (let k = 1; k < NB; k++) if (w[k] > w[best]) best = k;
    return best;
  }
}
