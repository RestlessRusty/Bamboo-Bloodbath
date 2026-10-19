import { lerp, smoothstep, valueNoise } from '../core/math';
import type { MapLayout } from './mapLayout';

export const WATER_LEVEL = -0.12;
const FLAT_LEVEL = 0.2;

/** Analytic height field shared by physics (via the grid) and rendering. */
export class Terrain {
  readonly waterLevel = WATER_LEVEL;

  constructor(private readonly layout: MapLayout) {}

  heightAt(x: number, z: number): number {
    const { seed, hill, pond, start, goal, size } = this.layout;

    let h = (valueNoise(x / 22, z / 22, seed) - 0.5) * 2.2 + (valueNoise(x / 7, z / 7, seed + 17) - 0.5) * 0.45;

    const dh = Math.hypot(x - hill.x, z - hill.z);
    if (dh < hill.r) h += hill.h * 0.5 * (1 + Math.cos((Math.PI * dh) / hill.r));

    // Flat clearings at the start camp and the rescue hut.
    for (const c of [start, goal]) {
      h = lerp(FLAT_LEVEL, h, smoothstep(c.r, c.r + 8, Math.hypot(x - c.x, z - c.z)));
    }

    // Flatten around the pond, then carve a bowl whose centre sits `depth` below the water.
    const dp = Math.hypot(x - pond.x, z - pond.z);
    h = lerp(FLAT_LEVEL, h, smoothstep(pond.r, pond.r + 7, dp));
    if (dp < pond.r) {
      const t = dp / pond.r;
      h -= (FLAT_LEVEL - WATER_LEVEL + pond.depth) * (1 - t * t);
    }

    // Rise towards the edges so the valley feels enclosed.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(size / 2 - 4, size / 2 + 16, edge) * 5;

    return h;
  }

  isWater(x: number, z: number): boolean {
    return this.heightAt(x, z) < WATER_LEVEL - 0.15;
  }
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
