import { Rng } from '../../core/rng';
import type { GameMap } from '../gameMap';
import type { Circle, MapLayout } from '../mapLayout';
import { Route } from '../route';
import { buildTerrainGrid } from '../terrain';
import { BIOMES, BiomeField } from './biomes';
import { chunkOf, OPEN, OPEN_MAP_ID } from './config';
import { buildPoi, poiName } from './pois';
import type { ChunkContents, Crate, OpenWorldData, Piece, Poi } from './types';
import { campSpot, planWorld } from './worldLayout';
import { ChunkDecor, scatterWorld } from './worldProps';
import { GroundField, WorldTerrain } from './worldTerrain';

/**
 * Infinite mode's world: a 1 km square of blended biomes generated from a seed, the same on every device.
 *
 * In order: a camp spot in the meadow near the middle, the biome map around it, the slow ground swells,
 * then the layout (rivers, ridges, abandoned buildings, tracks, hills, ponds; worldLayout.ts), the
 * terrain grids (worldTerrain.ts), the buildings' pieces and crates (pois.ts), the props and resource
 * nodes (worldProps.ts), and last the chunk index the renderer and physics stream by.
 */

/** The spawn camp's flat clearing. */
const CAMP_RADIUS = 14;

interface ChunkLists {
  trees: number[];
  rocks: number[];
  stones: number[];
  stalks: number[];
  bamboo: number[];
  nodes: number[];
  crates: number[];
  pois: number[];
}

const NO_CONTENTS: ChunkContents = { trees: [], rocks: [], stones: [], stalks: [], bamboo: [], nodes: [], crates: [], pois: [] };

export function createOpenWorld(seed: number): GameMap {
  const s = seed >>> 0;
  const size = OPEN.worldSize;

  // The camp: somewhere 70–120 m out from the middle; the biome map makes that meadow, then it settles
  // on a spot that really is.
  const rng = new Rng(s ^ 0x0be7);
  const a = rng.range(0, Math.PI * 2);
  const d = rng.range(70, 120);
  const guess = { x: Math.cos(a) * d, z: Math.sin(a) * d };
  const biomes = new BiomeField(s, size, guess);
  const campAt = campSpot(biomes, guess);
  const camp: Circle = { x: campAt.x, z: campAt.z, r: CAMP_RADIUS };
  const ground = new GroundField(s, size, biomes);
  const plan = planWorld(new Rng(s ^ 0x1a70), biomes, ground, camp);

  // The abandoned buildings: names, pieces (ids 1..n) and crates.
  const poiRng = new Rng(s ^ 0x9015);
  const names = new Set<string>(plan.pois.flatMap((p) => (p.name ? [p.name] : [])));
  const pois: Poi[] = [];
  const poiPieces: Piece[] = [];
  const crates: Crate[] = [];
  plan.pois.forEach((p, i) => {
    pois.push({ id: i, kind: p.kind, name: p.name ?? poiName(p.kind, p.x, p.z, poiRng, names), x: p.x, z: p.z, r: p.r });
    const built = buildPoi(p, i, poiPieces.length + 1, poiRng);
    poiPieces.push(...built.pieces);
    for (const c of built.crates) crates.push({ id: crates.length, x: c.x, z: c.z, poi: i, loot: c.loot });
  });

  // Thickets are scattered once the terrain exists (the terrain doesn't depend on them).
  const thickets: Circle[] = [];
  const layout: MapLayout = {
    id: OPEN_MAP_ID,
    name: 'The Wilds',
    blurb: 'An open world that never ends: gather, build, survive.',
    seed: s,
    size,
    renderSize: size,
    start: camp,
    goal: camp,
    goalStyle: 'none',
    racks: [],
    hills: plan.hills,
    ponds: plan.ponds,
    rivers: plan.rivers,
    ridges: plan.ridges,
    thickets,
    landmarks: [],
    roads: plan.roads,
    clear: pois.map((p) => ({ x: p.x, z: p.z, r: p.r })),
    density: { trees: 0, rocks: 0, grass: 0, flowerPatches: 0 },
    theme: BIOMES.meadow.theme,
  };
  const terrain = new WorldTerrain(layout, ground);

  const taken = [
    ...poiPieces.map((p) => ({ x: (p.gx + 0.5) * OPEN.tile, z: (p.gz + 0.5) * OPEN.tile })),
    ...crates.map((c) => ({ x: c.x, z: c.z })),
  ];
  const { props, nodes } = scatterWorld({ seed: s, terrain, biomes, layout, thickets, pois, taken });
  layout.density = { trees: props.trees.length, rocks: props.rocks.length, grass: 0, flowerPatches: 0 };

  // Chunk index: everything by the chunk its middle is in (buildings: every chunk their yard reaches).
  const chunks = size / OPEN.chunk;
  const lists: ChunkLists[] = [];
  for (let i = 0; i < chunks * chunks; i++) lists.push({ trees: [], rocks: [], stones: [], stalks: [], bamboo: [], nodes: [], crates: [], pois: [] });
  const into = (x: number, z: number) => lists[chunkOf(z) * chunks + chunkOf(x)];
  props.trees.forEach((t, i) => into(t.x, t.z).trees.push(i));
  props.rocks.forEach((r, i) => into(r.x, r.z).rocks.push(i));
  props.stones.forEach((r, i) => into(r.x, r.z).stones.push(i));
  props.stalks.forEach((t, i) => into(t.x, t.z).stalks.push(i));
  props.bambooSpots.forEach((b, i) => into(b.x, b.z).bamboo.push(i));
  nodes.forEach((n, i) => into(n.x, n.z).nodes.push(i));
  crates.forEach((c, i) => into(c.x, c.z).crates.push(i));
  for (const p of pois) {
    for (let cz = chunkOf(p.z - p.r); cz <= chunkOf(p.z + p.r); cz++) {
      for (let cx = chunkOf(p.x - p.r); cx <= chunkOf(p.x + p.r); cx++) lists[cz * chunks + cx].pois.push(p.id);
    }
  }

  const decor = new ChunkDecor(s, terrain, biomes, layout.ponds, pois);
  const open: OpenWorldData = {
    seed: s,
    size,
    spawn: { x: camp.x, z: camp.z },
    biomes: BIOMES,
    biomeAt: (x, z) => biomes.biomeAt(x, z),
    biomeWeights: (x, z, out) => biomes.weights(x, z, out),
    pois,
    poiPieces,
    nodes,
    crates,
    chunks,
    chunkContents: (cx, cz) => (cx >= 0 && cx < chunks && cz >= 0 && cz < chunks ? (lists[cz * chunks + cx] ?? NO_CONTENTS) : NO_CONTENTS),
    chunkDecor: (cx, cz) => decor.get(Math.max(0, Math.min(chunks - 1, cx)), Math.max(0, Math.min(chunks - 1, cz))),
  };

  return {
    layout,
    terrain,
    route: new Route(layout),
    props,
    // A placeholder: open mode streams its terrain per chunk.
    grid: buildTerrainGrid(terrain, 8, 1),
    open,
  };
}
