import { SURVIVOR } from '../../config';
import { valueNoise } from '../../core/math';
import { Rng } from '../../core/rng';
import type { Circle, MapLayout, Pond } from '../mapLayout';
import type { DecorProp, MapProps, RockProp, SpotProp, StalkProp, TreeProp } from '../props';
import { BIOMES, biomeTable, type BiomeField } from './biomes';
import { chunkOf, OPEN } from './config';
import { BIOME_IDS, type Poi, type ResourceNode } from './types';
import { ShapeIndex } from './worldIndex';
import type { WorldTerrain } from './worldTerrain';

/**
 * Everything that grows or lies about in the open world, the way props.ts does it for the normal maps
 * but per biome and over a jittered grid (so it's one pass, not rejection sampling over the whole world):
 * hiding thickets, bamboo groves, snack spots, trees, boulders, pebbles, ridge scree and scrap piles,
 * plus the resource nodes they make. Grass, flowers and lilies are made per chunk on demand (ChunkDecor).
 */

const HALF = OPEN.worldSize / 2;

// The same spacing rules as props.ts.
/** How far before and after each bridge, ford or pass its walkway is kept free of trees and rocks. */
const PASSAGE_APPROACH = 6;
/** Room beside a walkway: the biggest rock plus a panda still can't narrow it. */
const PASSAGE_PAD = 2.5;
/** Solid boulders are at least knee-high on a panda. */
const ROCK_MIN_HEIGHT = 0.55;
/** Collider radius as a share of a boulder's visible radius. */
const ROCK_HIT = 0.9;
/** Scree up a ridge flank stays inside the ridge wall, plus a panda's radius. */
const WALL_STANDOFF = SURVIVOR.radius;

/** Boulders this big (collider radius) can be mined; smaller ones are just in the way. */
const NODE_ROCK = 0.6;
/** Bamboo groves and scrap piles: no collider, you walk into them to hit them. */
const GROVE_R = 1.2;
const SCRAP_R = 1;
/** Thickets stay this far inside the rim. */
const THICKET_EDGE = 50;

export interface ScatterInput {
  seed: number;
  terrain: WorldTerrain;
  biomes: BiomeField;
  layout: MapLayout;
  /** layout.thickets, filled in here. */
  thickets: Circle[];
  pois: readonly Poi[];
  /** Centres of the buildings' pieces and crates: scrap piles keep off them. */
  taken: readonly { x: number; z: number }[];
}

export function scatterWorld(input: ScatterInput): { props: MapProps; nodes: ResourceNode[] } {
  const { seed, terrain, biomes, layout, thickets, pois } = input;
  const rng = new Rng(seed ^ 0x7ee5);
  const start = layout.start;

  // Keep-outs, bucketed. The pads asked for below stay within each index's maxPad.
  const poiIdx = new ShapeIndex(HALF, 32, 14);
  for (const p of pois) poiIdx.circle(p.x, p.z, p.r);
  const roadIdx = new ShapeIndex(HALF, 32, 14);
  for (const road of layout.roads ?? []) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1];
      const b = road.points[i];
      roadIdx.segment(a.x, a.z, b.x, b.z, road.width / 2);
    }
  }
  // The whole walkway of every bridge, ford and pass with a run-up on both sides, and its two ends.
  const passIdx = new ShapeIndex(HALF, 32, 14);
  const endIdx = new ShapeIndex(HALF, 32, 14);
  for (const c of terrain.crossings) {
    const len = c.length || 1;
    const ux = ((c.b.x - c.a.x) / len) * PASSAGE_APPROACH;
    const uz = ((c.b.z - c.a.z) / len) * PASSAGE_APPROACH;
    passIdx.segment(c.a.x - ux, c.a.z - uz, c.b.x + ux, c.b.z + uz, c.halfWidth);
    endIdx.circle(c.a.x, c.a.z, 0);
    endIdx.circle(c.b.x, c.b.z, 0);
  }
  const pondIdx = new ShapeIndex(HALF, 32, 14);
  for (const p of layout.ponds) pondIdx.circle(p.x, p.z, p.r);
  const hillIdx = new ShapeIndex(HALF, 32, 8);
  for (const h of layout.hills) hillIdx.circle(h.x, h.z, 0);
  const thicketIdx = new ShapeIndex(HALF, 32, 14);
  const groveIdx = new ShapeIndex(HALF, 32, 6);
  const takenIdx = new ShapeIndex(HALF, 16, 2);
  for (const t of input.taken) takenIdx.circle(t.x, t.z, 0);
  /** Trees, rocks, groves, snack spots and scrap: for spacing. */
  const solids = new ShapeIndex(HALF, 8, 5);

  const fromCamp = (x: number, z: number) => Math.hypot(x - start.x, z - start.z);
  // Everything that must stay free of props (except the ridges, which boulders sit at the foot of).
  // `extra`: the prop's own radius.
  const nearFeature = (x: number, z: number, extra = 0) =>
    Math.max(Math.abs(x), Math.abs(z)) > HALF - 3 - extra ||
    fromCamp(x, z) < start.r + 4 + extra ||
    pondIdx.near(x, z, 2.5 + extra) ||
    terrain.nearRiver(x, z, 2.5 + extra) ||
    endIdx.near(x, z, 5 + extra) ||
    passIdx.near(x, z, PASSAGE_PAD + extra) ||
    hillIdx.near(x, z, 6) ||
    poiIdx.near(x, z, 1 + extra) ||
    roadIdx.near(x, z, 2.5 + extra) ||
    thicketIdx.near(x, z, 1.5 + extra) ||
    groveIdx.near(x, z, 1.5 + extra);
  const keepClear = (x: number, z: number, extra = 0) => terrain.ridgeAmount(x, z) > 0.02 || nearFeature(x, z, extra);
  const pickupSpotOk = (x: number, z: number) =>
    Math.abs(x) < HALF - 4 &&
    Math.abs(z) < HALF - 4 &&
    !pondIdx.near(x, z, 1.5) &&
    !terrain.nearRiver(x, z, 1.5) &&
    !endIdx.near(x, z, 3) &&
    !passIdx.near(x, z, 0.5) &&
    terrain.ridgeAmount(x, z) < 0.02 &&
    !poiIdx.near(x, z, 0.5) &&
    !roadIdx.near(x, z, 0.5) &&
    !terrain.isWet(x, z);

  // ---- hiding thickets: thick in the bamboo forest, here and there elsewhere
  const thicketChance = biomeTable((g) => g.thickets);
  const bamboo = BIOME_IDS.indexOf('bamboo');
  forGrid(24, 9, rng, (x, z) => {
    if (rng.next() >= biomes.mix(x, z, thicketChance)) return;
    const r = rng.range(4, 6.5) + biomes.weight(x, z, bamboo) * rng.range(0, 1.2);
    if (Math.max(Math.abs(x), Math.abs(z)) > HALF - THICKET_EDGE - r || fromCamp(x, z) < start.r + r + 12) return;
    if (poiIdx.near(x, z, r + 4) || roadIdx.near(x, z, r + 4) || passIdx.near(x, z, r + 3) || endIdx.near(x, z, r + 4)) return;
    if (pondIdx.near(x, z, r + 4) || thicketIdx.near(x, z, r + 6) || terrain.nearRiver(x, z, r + 3) || terrain.isWet(x, z)) return;
    for (let k = 0; k < 5; k++) {
      const a = (k / 4) * Math.PI * 2;
      const d = k === 4 ? 0 : r + 2;
      if (terrain.ridgeAmount(x + Math.cos(a) * d, z + Math.sin(a) * d) > 0.02) return;
    }
    thickets.push({ x, z, r });
    thicketIdx.circle(x, z, r);
  });

  // ---- bamboo groves: little clumps you cut for bamboo (no collider)
  const groveChance = biomeTable((g) => g.groves);
  const groves: Circle[] = [];
  const stalks: StalkProp[] = [];
  forGrid(16, 6, rng, (x, z) => {
    if (rng.next() >= biomes.mix(x, z, groveChance)) return;
    if (keepClear(x, z, GROVE_R) || thicketIdx.near(x, z, GROVE_R + 2.5) || groveIdx.near(x, z, GROVE_R + 3) || terrain.isWet(x, z)) return;
    groves.push({ x, z, r: GROVE_R });
    groveIdx.circle(x, z, GROVE_R);
    solids.circle(x, z, GROVE_R);
  });

  // Thicket stalks, as props.ts plants them; then the groves' (always inside the grove's radius, so a cut
  // grove can hide exactly its own).
  for (const t of thickets) {
    const n = Math.round(t.r * t.r * 1.5);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * t.r;
      const x = t.x + Math.cos(a) * d;
      const z = t.z + Math.sin(a) * d;
      stalks.push({
        x,
        y: terrain.heightAt(x, z),
        z,
        height: rng.range(3.4, 5.8) * (1 - 0.35 * (d / t.r)),
        leanX: rng.range(-0.08, 0.08),
        leanZ: rng.range(-0.08, 0.08),
        tint: rng.next(),
      });
    }
  }
  for (const g of groves) {
    const n = 6 + Math.floor(rng.next() * 4);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * g.r * 0.85;
      const x = g.x + Math.cos(a) * d;
      const z = g.z + Math.sin(a) * d;
      stalks.push({
        x,
        y: terrain.heightAt(x, z),
        z,
        height: rng.range(2.8, 4.6),
        leanX: rng.range(-0.1, 0.1),
        leanZ: rng.range(-0.1, 0.1),
        tint: rng.next(),
      });
    }
  }

  // ---- bamboo snacks: one beside each thicket and some groves, plus a few in the open
  const bambooSpots: SpotProp[] = [];
  const addSpot = (x: number, z: number) => {
    bambooSpots.push({ x, y: terrain.heightAt(x, z), z });
    solids.circle(x, z, 0.9);
  };
  for (const t of thickets) {
    const a = rng.range(0, Math.PI * 2);
    const x = t.x + Math.cos(a) * (t.r + 0.8);
    const z = t.z + Math.sin(a) * (t.r + 0.8);
    if (pickupSpotOk(x, z)) addSpot(x, z);
  }
  for (const g of groves) {
    if (rng.next() > 0.4) continue;
    const a = rng.range(0, Math.PI * 2);
    const x = g.x + Math.cos(a) * (g.r + 0.8);
    const z = g.z + Math.sin(a) * (g.r + 0.8);
    if (pickupSpotOk(x, z) && !solids.near(x, z, 0.3)) addSpot(x, z);
  }
  const openSpots = bambooSpots.length + 60;
  for (let i = 0; i < 3000 && bambooSpots.length < openSpots; i++) {
    const x = rng.range(-HALF + 30, HALF - 30);
    const z = rng.range(-HALF + 30, HALF - 30);
    if (!pickupSpotOk(x, z) || fromCamp(x, z) < start.r + 6 || solids.near(x, z, 3) || thicketIdx.near(x, z, 1)) continue;
    addSpot(x, z);
  }

  // ---- trees: dense pine woods, sparse fields, in clumps
  const treeChance = biomeTable((g) => g.trees);
  const pineShare = biomeTable((_, id) => BIOMES[id].theme.pineShare);
  const treeGap = biomeTable((_, id) => (id === 'pine' ? 3.4 : id === 'snow' ? 3.8 : 4.2));
  const trees: TreeProp[] = [];
  forGrid(5, 2, rng, (x, z) => {
    const clump = 0.35 + 1.3 * valueNoise(x / 48, z / 48, seed + 5);
    if (rng.next() >= biomes.mix(x, z, treeChance) * clump) return;
    if (keepClear(x, z) || solids.near(x, z, biomes.mix(x, z, treeGap))) return;
    const scale = rng.range(0.8, 1.3);
    const radius = 0.38 * scale;
    trees.push({
      x,
      y: terrain.heightAt(x, z),
      z,
      scale,
      rot: rng.range(0, Math.PI * 2),
      kind: rng.next() < biomes.mix(x, z, pineShare) ? 'pine' : 'round',
      tint: rng.next(),
      radius,
      collide: true,
    });
    solids.circle(x, z, radius);
  });

  // ---- boulders, as props.ts: heights, partners, pebbles and scree from their own stream
  const rockRng = new Rng(seed ^ 0x2b0c);
  const boulder = (x: number, z: number, scale: number, rot: number, tint: number, solid: boolean): RockProp => ({
    x,
    y: terrain.heightAt(x, z),
    z,
    scale,
    height: Math.max(solid ? ROCK_MIN_HEIGHT : 0, scale * rockRng.range(0.7, 1.05)),
    rot,
    tint,
    radius: solid ? scale * ROCK_HIT : 0,
  });
  const rockChance = biomeTable((g) => g.rocks);
  const rocks: RockProp[] = [];
  const stones: RockProp[] = [];
  forGrid(9, 3.5, rng, (x, z) => {
    if (rng.next() >= biomes.mix(x, z, rockChance)) return;
    if (keepClear(x, z) || solids.near(x, z, 3)) return;
    const main = boulder(x, z, rng.range(0.55, 1.3), rng.range(0, Math.PI * 2), rng.next(), true);
    rocks.push(main);
    // Big ones sometimes get a smaller one leaning on them (checked before the main one counts as a solid).
    if (main.scale > 0.85 && rockRng.next() < 0.55) {
      const a = rockRng.range(0, Math.PI * 2);
      const scale = main.scale * rockRng.range(0.45, 0.65);
      const d = (main.scale + scale) * 0.72;
      const px = main.x + Math.cos(a) * d;
      const pz = main.z + Math.sin(a) * d;
      const partner = boulder(px, pz, scale, rockRng.range(0, Math.PI * 2), rockRng.next(), true);
      if (!solids.near(px, pz, scale + 1.6) && !keepClear(px, pz)) {
        rocks.push(partner);
        solids.circle(px, pz, partner.radius);
      }
    }
    solids.circle(x, z, main.radius);
    const pebbles = Math.floor(rockRng.range(0, 4));
    for (let k = 0; k < pebbles; k++) {
      const a = rockRng.range(0, Math.PI * 2);
      const d = main.scale + rockRng.range(0.15, 0.9);
      const pebble = boulder(main.x + Math.cos(a) * d, main.z + Math.sin(a) * d, rockRng.range(0.12, 0.28), rockRng.range(0, Math.PI * 2), rockRng.next(), false);
      if (pebble.y > terrain.waterLevel + 0.05) stones.push(pebble);
    }
  });

  // Ridges: loose boulders along the crest (out of reach, no colliders), solid ones half buried at the foot.
  const slope = (x: number, z: number) => {
    const e = 0.6;
    return Math.hypot(terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z), terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
  };
  for (const ridge of terrain.ridges) {
    for (let s = 0; s < ridge.length; s += 4.5) {
      const p = ridge.at(ridge.fractionOf(s));
      for (const side of [-1, 1]) {
        const roll = rockRng.next();
        const scale = rockRng.range(0.5, 1.2);
        const foot = roll < 0.3;
        const d = foot ? ridge.wallHalf + WALL_STANDOFF + rockRng.range(-0.2, 0.5) : rockRng.range(0, ridge.crest * 0.9);
        const x = p.x - p.tz * side * d;
        const z = p.z + p.tx * side * d;
        const rock = boulder(x, z, scale, rockRng.range(0, Math.PI * 2), rockRng.next(), foot);
        if (roll > 0.6) continue;
        if (foot) {
          if (nearFeature(x, z) || solids.near(x, z, scale + 1.6)) continue;
          rocks.push(rock);
          solids.circle(x, z, rock.radius);
        } else {
          if (!terrain.isWall(x, z) || passIdx.near(x, z, scale + 4) || slope(x, z) > 0.9) continue;
          stones.push(rock);
        }
      }
    }
  }

  // ---- scrap piles: in the yards of the buildings, and lying about the quarry and the fields
  const scrap: Circle[] = [];
  for (const poi of pois) {
    const want = 1 + (rng.next() < 0.6 ? 1 : 0);
    for (let tries = 0, n = 0; tries < 10 && n < want; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(poi.r - 3, poi.r - 1);
      const x = poi.x + Math.cos(a) * d;
      const z = poi.z + Math.sin(a) * d;
      if (terrain.isWet(x, z) || terrain.ridgeAmount(x, z) > 0.02 || roadIdx.near(x, z, 0.5) || takenIdx.near(x, z, 1.8) || solids.near(x, z, SCRAP_R + 0.5)) continue;
      scrap.push({ x, z, r: SCRAP_R });
      solids.circle(x, z, SCRAP_R);
      n++;
    }
  }
  const scrapChance = biomeTable((g) => g.scrap);
  forGrid(20, 7, rng, (x, z) => {
    if (rng.next() >= biomes.mix(x, z, scrapChance)) return;
    if (keepClear(x, z, SCRAP_R) || solids.near(x, z, SCRAP_R + 1.5) || terrain.isWet(x, z)) return;
    scrap.push({ x, z, r: SCRAP_R });
    solids.circle(x, z, SCRAP_R);
  });

  // ---- resource nodes: every tree, every boulder big enough, every grove and scrap pile
  const nodes: ResourceNode[] = [];
  trees.forEach((t, i) => {
    nodes.push({ id: nodes.length, kind: 'tree', x: t.x, z: t.z, r: t.radius, gives: 'wood', amount: Math.round(8 + 6 * t.scale), prop: i });
  });
  rocks.forEach((r, i) => {
    if (r.radius >= NODE_ROCK) nodes.push({ id: nodes.length, kind: 'rock', x: r.x, z: r.z, r: r.radius, gives: 'stone', amount: Math.round(6 + 6 * r.scale), prop: i });
  });
  for (const g of groves) nodes.push({ id: nodes.length, kind: 'grove', x: g.x, z: g.z, r: g.r, gives: 'bamboo', amount: 15, prop: -1 });
  for (const s of scrap) nodes.push({ id: nodes.length, kind: 'scrap', x: s.x, z: s.z, r: s.r, gives: 'scrap', amount: 6 + Math.floor(rng.next() * 3), prop: -1 });

  return {
    props: { trees, rocks, stones, stalks, grass: [], flowers: [], lilies: [], bambooSpots, racks: [] },
    nodes,
  };
}

/** Calls `visit` once per cell of a `step` m grid over the world, at a point jittered up to ±`jitter`. */
function forGrid(step: number, jitter: number, rng: Rng, visit: (x: number, z: number) => void): void {
  const n = Math.floor(OPEN.worldSize / step);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -HALF + (i + 0.5) * step + rng.range(-jitter, jitter);
      const z = -HALF + (j + 0.5) * step + rng.range(-jitter, jitter);
      visit(x, z);
    }
  }
}

export interface Decor {
  grass: DecorProp[];
  flowers: DecorProp[];
  lilies: DecorProp[];
}

/** Chunks' decor kept around: the renderer asks again when it rebuilds a chunk it just dropped. */
const DECOR_CACHE = 12;
/** Grass tries per chunk (about as dense as Bamboo Valley's where the chance is 1) and flower patches. */
const GRASS_TRIES = 190;
const FLOWER_TRIES = 7;

/**
 * Render-only scatter (grass, flowers, lilies) for one chunk, made from the seed and the chunk's
 * position, so it's the same every time and on every device. The last few chunks are cached.
 */
export class ChunkDecor {
  private readonly cache = new Map<number, Decor>();
  private readonly grassChance = biomeTable((g) => g.grass);
  private readonly flowerChance = biomeTable((g) => g.flowers);
  private readonly chunks = OPEN.worldSize / OPEN.chunk;
  /** Ponds by chunk of their centre. */
  private readonly ponds = new Map<number, Pond[]>();

  constructor(
    private readonly seed: number,
    private readonly terrain: WorldTerrain,
    private readonly biomes: BiomeField,
    ponds: readonly Pond[],
    private readonly pois: readonly Poi[],
  ) {
    for (const p of ponds) {
      const k = chunkOf(p.z) * this.chunks + chunkOf(p.x);
      const list = this.ponds.get(k);
      if (list) list.push(p);
      else this.ponds.set(k, [p]);
    }
  }

  get(cx: number, cz: number): Decor {
    const key = cz * this.chunks + cx;
    const cached = this.cache.get(key);
    if (cached) {
      // Most recently used goes to the back.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const decor = this.make(cx, cz, key);
    this.cache.set(key, decor);
    if (this.cache.size > DECOR_CACHE) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    return decor;
  }

  private make(cx: number, cz: number, key: number): Decor {
    const { terrain, biomes } = this;
    const rng = new Rng((this.seed ^ Math.imul(key + 1, 0x9e3779b1)) >>> 0);
    const x0 = -HALF + cx * OPEN.chunk;
    const z0 = -HALF + cz * OPEN.chunk;
    // Not in water, on ice, up the rock faces or inside a building.
    const plantable = (x: number, z: number, y: number) =>
      y > terrain.waterLevel + 0.05 && terrain.ridgeAmount(x, z) < 0.3 && !terrain.isIce(x, z) && !this.pois.some((p) => Math.hypot(x - p.x, z - p.z) < p.r - 3);

    const grass: DecorProp[] = [];
    for (let i = 0; i < GRASS_TRIES; i++) {
      const x = x0 + rng.next() * OPEN.chunk;
      const z = z0 + rng.next() * OPEN.chunk;
      const keep = rng.next() < biomes.mix(x, z, this.grassChance);
      const scale = rng.range(0.7, 1.4);
      const rot = rng.range(0, Math.PI * 2);
      const tint = rng.next();
      if (!keep) continue;
      const y = terrain.heightAt(x, z);
      if (plantable(x, z, y)) grass.push({ x, y, z, scale, rot, tint });
    }

    const flowers: DecorProp[] = [];
    for (let c = 0; c < FLOWER_TRIES; c++) {
      const px = x0 + 3 + rng.next() * (OPEN.chunk - 6);
      const pz = z0 + 3 + rng.next() * (OPEN.chunk - 6);
      const tint = rng.next();
      if (rng.next() >= biomes.mix(px, pz, this.flowerChance) * 0.8) continue;
      for (let i = 0; i < 9; i++) {
        const x = px + rng.range(-2.5, 2.5);
        const z = pz + rng.range(-2.5, 2.5);
        const y = terrain.heightAt(x, z);
        if (plantable(x, z, y)) flowers.push({ x, y, z, scale: rng.range(0.8, 1.2), rot: 0, tint });
      }
    }

    const lilies: DecorProp[] = [];
    for (const pond of this.ponds.get(key) ?? []) {
      if (pond.frozen || !BIOMES[biomes.biomeAt(pond.x, pond.z)].theme.lilies.length) continue;
      const count = Math.round(pond.r * 0.9);
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * pond.r * 0.65;
        lilies.push({
          x: pond.x + Math.cos(a) * d,
          y: terrain.waterLevel,
          z: pond.z + Math.sin(a) * d,
          scale: rng.range(0.7, 1.2),
          rot: rng.range(0, Math.PI * 2),
          tint: rng.next(),
        });
      }
    }
    return { grass, flowers, lilies };
  }
}
