import * as THREE from 'three';
import { clamp, smoothstep, valueNoise } from '../../core/math';
import type { Circle } from '../../sim/mapLayout';
import { OPEN } from '../../sim/open/config';
import { NB, PAL, PAL_SIZE, type ChunkBiomes, type OpenContext } from './context';

/** 2 m cells (the physics streams ~2 m too). */
const SEG = 32;
/** Cells whose corners differ by more than this are cliff: split finer and drawn as faceted rock. */
const STEEP_RISE = 1.3;
/** Each cliff cell becomes CLIFF_SUB × CLIFF_SUB smaller ones. */
const CLIFF_SUB = 2;
/** How far cliff vertices get pushed about, for a craggy face. */
const CLIFF_ROUGH = 0.3;

export interface TerrainChunk {
  mesh: THREE.Mesh;
  /** Some ground is under water: the chunk needs a water plane. */
  wet: boolean;
  /** Its lowest point (the water there takes that biome's colour). */
  lowX: number;
  lowZ: number;
}

interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  hw: number;
}

/**
 * The ground of one chunk: the same look as `buildTerrain` in world.ts (smooth toon ground, cliffs split
 * finer and faceted, ground colours from the theme), with the theme blended between biomes per vertex.
 * Heights and normals come from the height field itself, sampling a ring of cells beyond the chunk, so
 * neighbouring chunks meet without cracks or lighting seams.
 */
export function buildTerrainChunk(ctx: OpenContext, biomes: ChunkBiomes, cx: number, cz: number): TerrainChunk {
  const { map, palettes: P, peak } = ctx;
  const terrain = map.terrain;
  const { layout } = map;
  const seed = layout.seed;
  const wl = terrain.waterLevel;
  const half = OPEN.worldSize / 2;
  const size = OPEN.chunk;
  const x0 = -half + cx * size;
  const z0 = -half + cz * size;
  const step = size / SEG;
  const S = CLIFF_SUB;
  const fine = SEG * S + 1;
  // Keep samples inside the world: the generated height grids may not reach past its edge.
  const hAt = (x: number, z: number) => terrain.heightAt(clamp(x, -half, half), clamp(z, -half, half));

  // Heights of the chunk's grid plus one ring of cells around it (i, j from -1 to SEG + 1).
  const n = SEG + 3;
  const H = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) H[j * n + i] = hAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
  const gy = (i: number, j: number) => H[(j + 1) * n + i + 1];

  // Cliff cells, the ring included (cells -1..SEG): a neighbour's cliff edge has to be split like ours.
  const cn = SEG + 2;
  const steep = new Uint8Array(cn * cn);
  for (let j = -1; j <= SEG; j++) {
    for (let i = -1; i <= SEG; i++) {
      const a = gy(i, j);
      const b = gy(i + 1, j);
      const c = gy(i, j + 1);
      const d = gy(i + 1, j + 1);
      steep[(j + 1) * cn + i + 1] = Math.max(a, b, c, d) - Math.min(a, b, c, d) > STEEP_RISE ? 1 : 0;
    }
  }
  const isSteep = (i: number, j: number) => steep[(j + 1) * cn + i + 1] === 1;

  // Only the features that can touch this chunk get looked at per vertex.
  const x1 = x0 + size;
  const z1 = z0 + size;
  const near = (c: { x: number; z: number }, r: number) =>
    c.x + r > x0 - 1 && c.x - r < x1 + 1 && c.z + r > z0 - 1 && c.z - r < z1 + 1;
  const thickets = layout.thickets.filter((t) => near(t, t.r + 2));
  const ponds = layout.ponds.filter((p) => near(p, p.r + 1.5));
  const clearings: Circle[] = [layout.start, ...ctx.world.pois].filter((c) => near(c, c.r));
  const rivers: Seg[] = [];
  for (const river of terrain.rivers) {
    const pad = river.halfWidth + 2;
    for (let k = 1; k < river.pts.length; k++) {
      const a = river.pts[k - 1];
      const b = river.pts[k];
      if (Math.max(a.x, b.x) + pad < x0 - 1 || Math.min(a.x, b.x) - pad > x1 + 1) continue;
      if (Math.max(a.z, b.z) + pad < z0 - 1 || Math.min(a.z, b.z) - pad > z1 + 1) continue;
      rivers.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, hw: river.halfWidth });
    }
  }
  const hasRidges = terrain.ridges.length > 0;

  // Ground colour: the biomes' palettes blended at the vertex, then the same recipe as terrainColor().
  const wts = new Float32Array(NB);
  const pal = new Float32Array(PAL_SIZE);
  let r = 0;
  let g = 0;
  let b = 0;
  const mix = (f: number, t: number) => {
    if (t <= 0) return;
    r += (pal[f] - r) * t;
    g += (pal[f + 1] - g) * t;
    b += (pal[f + 2] - b) * t;
  };
  const color = (x: number, y: number, z: number, steepness: number, out: number[]) => {
    biomes.at(x, z, wts);
    pal.fill(0);
    for (let k = 0; k < NB; k++) {
      const w = wts[k];
      if (w < 0.002) continue;
      const o = k * PAL_SIZE;
      for (let f = 0; f < PAL_SIZE; f++) pal[f] += w * P[o + f];
    }
    const t = valueNoise(x / 9, z / 9, seed + 3);
    r = pal[PAL.a] + (pal[PAL.b] - pal[PAL.a]) * t;
    g = pal[PAL.a + 1] + (pal[PAL.b + 1] - pal[PAL.a + 1]) * t;
    b = pal[PAL.a + 2] + (pal[PAL.b + 2] - pal[PAL.a + 2]) * t;
    mix(PAL.high, smoothstep(2.5, peak, y));
    let rock = y > wl ? smoothstep(0.25, 0.5, steepness) : 0;
    let crest = 0;
    if (hasRidges) {
      const ra = terrain.ridgeAmount(x, z);
      if (ra > 0) {
        rock = Math.max(rock, smoothstep(0.08, 0.4, ra));
        crest = smoothstep(0.82, 0.97, ra) * 0.9;
      }
    }
    if (rock > 0) {
      const band = Math.sin(y * 2.3 + valueNoise(x / 7, z / 7, seed + 41) * 5);
      const grit = valueNoise(x * 0.9, z * 0.9, seed + 43) - 0.5;
      const k = 1 + band * 0.1 + grit * 0.25;
      const c = PAL.cliff;
      r += (pal[c] * k - r) * rock;
      g += (pal[c + 1] * k - g) * rock;
      b += (pal[c + 2] * k - b) * rock;
    }
    mix(PAL.high, crest);
    for (const th of thickets) {
      const d = Math.hypot(x - th.x, z - th.z);
      if (d < th.r + 2) mix(PAL.thicket, 1 - smoothstep(th.r - 1, th.r + 2, d));
    }
    for (const c of clearings) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.r) mix(PAL.clearing, (1 - smoothstep(c.r * 0.4, c.r, d)) * 0.55);
    }
    for (const p of ponds) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + 1.5) mix(PAL.shore, 1 - smoothstep(p.r - 1.5, p.r + 1.5, d));
    }
    if (rivers.length) {
      let best = Infinity;
      let hw = 0;
      for (const s of rivers) {
        const abx = s.bx - s.ax;
        const abz = s.bz - s.az;
        const len2 = abx * abx + abz * abz || 1e-9;
        const u = clamp(((x - s.ax) * abx + (z - s.az) * abz) / len2, 0, 1);
        const d = Math.hypot(s.ax + abx * u - x, s.az + abz * u - z) - s.hw;
        if (d < best) {
          best = d;
          hw = s.hw;
        }
      }
      // `best` is the distance from the water's edge; the recipe wants it from the middle.
      const d = best + hw;
      if (d < hw + 1.5) mix(PAL.shore, 1 - smoothstep(hw - 1.5, hw + 1.5, d));
    }
    if (y < wl) mix(PAL.mud, 0.8 * smoothstep(0, 0.3, wl - y));
    mix(PAL.rim, smoothstep(half - 2, half + 12, Math.max(Math.abs(x), Math.abs(z))));
    out.push(r, g, b);
  };

  // Cells touching a line of the fine lattice: one inside a cell, two on a cell border.
  const cellsOf = (f: number, out: number[]): number => {
    if (f % S === 0) {
      out[0] = f / S - 1;
      out[1] = f / S;
      return 2;
    }
    out[0] = Math.floor(f / S);
    return 1;
  };
  const ci = [0, 0];
  const cj = [0, 0];

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const lookup = new Int32Array(fine * fine).fill(-1);
  let lowY = Infinity;
  let lowX = x0 + size / 2;
  let lowZ = z0 + size / 2;
  // Fine lattice indices of the whole world, so roughness agrees between chunks.
  const gfi0 = cx * SEG * S;
  const gfj0 = cz * SEG * S;
  const vertex = (fi: number, fj: number): number => {
    const key = fj * fine + fi;
    const known = lookup[key];
    if (known >= 0) return known;
    const bx = x0 + (fi / S) * step;
    const bz = z0 + (fj / S) * step;
    let x = bx;
    let z = bz;
    const ni = cellsOf(fi, ci);
    const nj = cellsOf(fj, cj);
    let allSteep = true;
    for (let a = 0; a < ni; a++) for (let c = 0; c < nj; c++) if (!isSteep(ci[a], cj[c])) allSteep = false;
    const corner = fi % S === 0 && fj % S === 0;
    let y: number;
    if (corner) y = gy(fi / S, fj / S);
    else if (allSteep) y = hAt(x, z);
    else if (fi % S === 0) {
      const j = Math.floor(fj / S);
      y = gy(fi / S, j) + (gy(fi / S, j + 1) - gy(fi / S, j)) * ((fj % S) / S);
    } else {
      const i = Math.floor(fi / S);
      y = gy(i, fj / S) + (gy(i + 1, fj / S) - gy(i, fj / S)) * ((fi % S) / S);
    }
    // Slope from the height field (not this mesh's triangles), so both sides of a chunk border agree.
    let dx: number;
    let dz: number;
    if (corner) {
      const i = fi / S;
      const j = fj / S;
      dx = (gy(i + 1, j) - gy(i - 1, j)) / (2 * step);
      dz = (gy(i, j + 1) - gy(i, j - 1)) / (2 * step);
    } else {
      dx = (hAt(bx + 1, bz) - hAt(bx - 1, bz)) / 2;
      dz = (hAt(bx, bz + 1) - hAt(bx, bz - 1)) / 2;
    }
    const inv = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
    // Not near the water line, where the shore has to match where the water really is.
    if (allSteep && y > wl + 0.4) {
      const gfi = gfi0 + fi;
      const gfj = gfj0 + fj;
      x += (valueNoise(gfi * 0.7, gfj * 0.7, seed + 51) - 0.5) * 2 * CLIFF_ROUGH;
      z += (valueNoise(gfi * 0.7, gfj * 0.7, seed + 53) - 0.5) * 2 * CLIFF_ROUGH;
      y += (valueNoise(gfi * 0.7, gfj * 0.7, seed + 57) - 0.5) * 2 * CLIFF_ROUGH;
    }
    if (y < lowY) {
      lowY = y;
      lowX = x;
      lowZ = z;
    }
    const k = pos.length / 3;
    pos.push(x, y, z);
    nor.push(-dx * inv, inv, -dz * inv);
    color(x, y, z, 1 - inv, col);
    lookup[key] = k;
    return k;
  };

  // Counter-clockwise seen from above, like the physics grid.
  const smoothTris: number[] = [];
  const cliffTris: number[] = [];
  const quad = (out: number[], fi: number, fj: number, s: number) => {
    const a = vertex(fi, fj);
    const bb = vertex(fi, fj + s);
    const c = vertex(fi + s, fj);
    const d = vertex(fi + s, fj + s);
    out.push(a, bb, c, c, bb, d);
  };
  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      if (!isSteep(i, j)) {
        quad(smoothTris, i * S, j * S, S);
        continue;
      }
      for (let sj = 0; sj < S; sj++) for (let si = 0; si < S; si++) quad(cliffTris, i * S + si, j * S + sj, 1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(smoothTris.concat(cliffTris));
  geo.addGroup(0, smoothTris.length, 0);
  geo.addGroup(smoothTris.length, cliffTris.length, 1);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, ctx.assets.ground);
  mesh.receiveShadow = true;
  return { mesh, wet: lowY < wl - 0.02, lowX, lowZ };
}
