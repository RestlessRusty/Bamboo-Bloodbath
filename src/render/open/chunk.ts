import * as THREE from 'three';
import type { MapTheme } from '../../sim/mapLayout';
import { OPEN } from '../../sim/open/config';
import type { WorldMirror } from '../../sim/open/mirror';
import { BIOME_IDS, type ResourceNode } from '../../sim/open/types';
import type { StalkProp } from '../../sim/props';
import { BOULDER_SHAPES, pickHex, rockMatrix, rockShape } from '../world';
import { Batch } from './bake';
import { ChunkBiomes, type OpenContext } from './context';
import { ChunkPieces } from './pieces';
import { buildTerrainChunk } from './terrainChunk';

/** Instances that draw one node (or crate) full, and the ones that draw what's left of it. */
interface Toggle {
  full: { batch: Batch; index: number }[];
  spent: { batch: Batch; index: number }[];
  /** Currently showing the spent look. */
  spentShown: boolean;
}

/** Rings up a bamboo stalk, as a fraction of its height (same as world.ts). */
const RINGS = [0.22, 0.45, 0.68, 0.88];
/** A grove's stalks are the ones this close to its edge. */
const GROVE_PAD = 0.6;

/** Theme of the biome at a point. */
type ThemeAt = (x: number, z: number) => MapTheme;

const o = new THREE.Object3D();
const c3 = new THREE.Color();
const MOSS_DARK = 0.8;

/** Resets the scratch object to the identity before placing an instance. */
function reset(): THREE.Object3D {
  o.position.set(0, 0, 0);
  o.rotation.set(0, 0, 0);
  o.scale.set(1, 1, 1);
  return o;
}

/**
 * One 64 m chunk of the open world: its ground, water, trees, rocks, bamboo, resource nodes, crates,
 * decoration and building pieces, each kind one instanced batch. Geometry and materials are the world's
 * (OpenAssets / PieceKit); a chunk only owns its terrain mesh and instance buffers, freed by `dispose`.
 */
export class ChunkView {
  readonly group = new THREE.Group();
  readonly x0: number;
  readonly z0: number;
  readonly pieces: ChunkPieces;
  private readonly terrainGeo: THREE.BufferGeometry;
  private readonly meshes: THREE.Object3D[] = [];
  private readonly nodes = new Map<number, Toggle>();
  private readonly crates = new Map<number, Toggle>();

  constructor(
    private readonly ctx: OpenContext,
    readonly cx: number,
    readonly cz: number,
  ) {
    const half = OPEN.worldSize / 2;
    this.x0 = -half + cx * OPEN.chunk;
    this.z0 = -half + cz * OPEN.chunk;
    const { map, world, assets } = ctx;
    const biomes = new ChunkBiomes(world, this.x0, this.z0);
    const themeAt: ThemeAt = (x, z) => ctx.themes[biomes.dominant(x, z)];

    const ground = buildTerrainChunk(ctx, biomes, cx, cz);
    this.terrainGeo = ground.mesh.geometry;
    this.group.add(ground.mesh);
    if (ground.wet) {
      const water = new THREE.Mesh(assets.waterPlane, assets.water(BIOME_IDS[biomes.dominant(ground.lowX, ground.lowZ)]));
      water.position.set(this.x0 + OPEN.chunk / 2, map.terrain.waterLevel, this.z0 + OPEN.chunk / 2);
      water.receiveShadow = true;
      this.group.add(water);
    }
    // Frozen ponds: a sheet of ice with a frosty rim, drawn by the chunk holding the pond's middle.
    for (const pond of map.layout.ponds) {
      if (!pond.frozen || !this.holds(pond.x, pond.z)) continue;
      const y = map.terrain.heightAt(pond.x, pond.z) + 0.03;
      const ice = new THREE.Mesh(assets.disc, assets.ice);
      ice.position.set(pond.x, y, pond.z);
      ice.scale.set(pond.r, 1, pond.r);
      ice.receiveShadow = true;
      const rim = new THREE.Mesh(assets.discRim, assets.iceRim);
      rim.position.set(pond.x, y + 0.01, pond.z);
      rim.scale.set(pond.r, 1, pond.r);
      this.group.add(ice, rim);
    }

    const contents = world.chunkContents(cx, cz);
    const out = this.meshes;
    this.buildTrees(contents.trees, themeAt);
    this.buildRocks(contents.rocks, contents.stones, themeAt);
    this.buildStalks(contents.stalks, themeAt);
    this.buildNodes(contents.nodes);
    this.buildCrates(contents.crates);
    this.buildDecor(themeAt);

    // Spent looks were built in place (so the bounding spheres cover them) and start hidden.
    for (const t of this.nodes.values()) hideSpent(t);
    for (const t of this.crates.values()) hideSpent(t);

    this.pieces = new ChunkPieces(ctx.kit, map.terrain);
    if (out.length) this.group.add(...out);
    this.group.add(this.pieces.group);
  }

  /** (x, z) lies in this chunk. */
  holds(x: number, z: number): boolean {
    return x >= this.x0 && x < this.x0 + OPEN.chunk && z >= this.z0 && z < this.z0 + OPEN.chunk;
  }

  /** Squared distance from (x, z) to the nearest point of the chunk. */
  dist2(x: number, z: number): number {
    const dx = Math.max(this.x0 - x, 0, x - this.x0 - OPEN.chunk);
    const dz = Math.max(this.z0 - z, 0, z - this.z0 - OPEN.chunk);
    return dx * dx + dz * dz;
  }

  /** Depleted nodes show their stump / pebbles / cut stubs instead of the full prop. */
  refreshNodes(mirror: WorldMirror | null): void {
    for (const [id, t] of this.nodes) {
      const left = mirror ? mirror.nodeLeft(id) : 1;
      setSpent(t, left <= 0);
    }
  }

  refreshCrates(mirror: WorldMirror | null): void {
    for (const [id, t] of this.crates) setSpent(t, mirror ? mirror.crateOpen(id) : false);
  }

  dispose(): void {
    for (const m of this.meshes) if (m instanceof THREE.InstancedMesh) m.dispose();
    this.terrainGeo.dispose();
    this.pieces.dispose();
    this.group.clear();
  }

  // ---------------------------------------------------------------- builders

  private toggle(map: Map<number, Toggle>, id: number): Toggle {
    let t = map.get(id);
    if (!t) {
      t = { full: [], spent: [], spentShown: false };
      map.set(id, t);
    }
    return t;
  }

  /** Same placement and colours as world.ts' buildTrees; trees that are nodes also get a stump. */
  private buildTrees(list: readonly number[], themeAt: ThemeAt): void {
    if (!list.length) return;
    const { assets, map, treeNode } = this.ctx;
    const trunk = new Batch(assets.trunk, assets.plain, true, true);
    const round = new Batch(assets.roundLeaves, assets.plain, true, true);
    const pine = new Batch(assets.pineLeaves, assets.plain, true, true);
    const snow = new Batch(assets.pineSnow, assets.plain, true, true);
    const stump = new Batch(assets.stump.body, assets.painted, false, true);
    const stumpInk = assets.stump.ink ? new Batch(assets.stump.ink, assets.ink, false, true) : null;
    for (const i of list) {
      const t = map.props.trees[i];
      if (!t) continue;
      const theme = themeAt(t.x, t.z);
      reset().position.set(t.x, t.y - 0.1, t.z);
      o.rotation.y = t.rot;
      o.scale.setScalar(t.scale);
      o.updateMatrix();
      const node = treeNode[i];
      const full: { batch: Batch; index: number }[] = [];
      full.push({ batch: trunk, index: trunk.add(o.matrix, c3.setHex(theme.trunk)) });
      if (t.kind === 'pine') {
        full.push({ batch: pine, index: pine.add(o.matrix, c3.setHex(pickHex(theme.pineLeaves, t.tint))) });
        if (theme.snowCaps) full.push({ batch: snow, index: snow.add(o.matrix, c3.setHex(0xffffff)) });
      } else {
        full.push({ batch: round, index: round.add(o.matrix, c3.setHex(pickHex(theme.roundLeaves, t.tint))) });
      }
      if (node < 0) continue;
      const tg = this.toggle(this.nodes, node);
      tg.full.push(...full);
      reset().position.set(t.x, t.y - 0.05, t.z);
      o.rotation.y = t.rot;
      o.scale.setScalar(t.scale);
      o.updateMatrix();
      tg.spent.push({ batch: stump, index: stump.add(o.matrix) });
      if (stumpInk) tg.spent.push({ batch: stumpInk, index: stumpInk.add(o.matrix) });
    }
    const out = this.meshes;
    trunk.finish(out, true, true);
    round.finish(out, true, true);
    pine.finish(out, true, true);
    snow.finish(out, true, true);
    stump.finish(out, true, true);
    stumpInk?.finish(out, false, false);
  }

  /** Same look as world.ts' buildRocks: three boulder shapes, ink, moss or snow caps; rock nodes leave pebbles. */
  private buildRocks(rocks: readonly number[], stones: readonly number[], themeAt: ThemeAt): void {
    if (!rocks.length && !stones.length) return;
    const { assets, map, rockNode } = this.ctx;
    const terrain = map.terrain;
    const bodies: Batch[] = [];
    const inks: Batch[] = [];
    const caps: (Batch | null)[] = [];
    for (let s = 0; s < BOULDER_SHAPES; s++) {
      const shape = assets.boulders[s];
      bodies.push(new Batch(shape.body, assets.painted, true, true));
      inks.push(new Batch(shape.outline, assets.ink, false, true));
      caps.push(shape.cap ? new Batch(shape.cap, assets.cap, true, true) : null);
    }
    const pebbles = new Batch(assets.pebbles.body, assets.painted, true, true);
    const pebbleInk = assets.pebbles.ink ? new Batch(assets.pebbles.ink, assets.ink, false, true) : null;

    const add = (index: number, solid: boolean) => {
      const r = solid ? map.props.rocks[index] : map.props.stones[index];
      if (!r) return;
      const theme = themeAt(r.x, r.z);
      const s = rockShape(r);
      const m = rockMatrix(terrain, r);
      const full: { batch: Batch; index: number }[] = [];
      full.push({ batch: bodies[s], index: bodies[s].add(m, c3.setHex(pickHex(theme.rocks, r.tint))) });
      full.push({ batch: inks[s], index: inks[s].add(m) });
      // Snow on every rock in the snow, elsewhere moss (the biome's grass, darker) on about half of them.
      const snowy = !!theme.snowCaps;
      const cap = caps[s];
      if (cap && (snowy || (r.tint * 13.7) % 1 < 0.5)) {
        if (snowy) c3.setHex(0xffffff);
        else c3.setHex(pickHex(theme.grass, (r.tint * 5.3) % 1)).multiplyScalar(MOSS_DARK);
        full.push({ batch: cap, index: cap.add(m, c3) });
      }
      const node = solid ? rockNode[index] : -1;
      if (node < 0) return;
      const tg = this.toggle(this.nodes, node);
      tg.full.push(...full);
      reset().position.set(r.x, r.y, r.z);
      o.rotation.y = r.rot;
      o.scale.setScalar(r.scale);
      o.updateMatrix();
      tg.spent.push({ batch: pebbles, index: pebbles.add(o.matrix, c3.setHex(pickHex(theme.rocks, r.tint))) });
      if (pebbleInk) tg.spent.push({ batch: pebbleInk, index: pebbleInk.add(o.matrix) });
    };
    for (const i of rocks) add(i, true);
    for (const i of stones) add(i, false);

    const out = this.meshes;
    for (let s = 0; s < BOULDER_SHAPES; s++) {
      bodies[s].finish(out, true, true);
      inks[s].finish(out, false, false);
      caps[s]?.finish(out, false, true);
    }
    pebbles.finish(out, true, true);
    pebbleInk?.finish(out, false, false);
  }

  /**
   * Bamboo: hiding thickets drawn like world.ts (stalks with rings and leaf tufts, or snowy shrubs where
   * the biome says so), and the stalks of bamboo groves, which are always bamboo and disappear when cut.
   */
  private buildStalks(list: readonly number[], themeAt: ThemeAt): void {
    if (!list.length) return;
    const { assets, map, world, themes, bambooBiome } = this.ctx;
    // Groves here or next door: a grove near the chunk edge has stalks on both sides of it.
    const groves: ResourceNode[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = this.cx + dx;
        const z = this.cz + dz;
        if (x < 0 || z < 0 || x >= world.chunks || z >= world.chunks) continue;
        for (const id of world.chunkContents(x, z).nodes) {
          const n = world.nodes[id];
          if (n && n.kind === 'grove' && this.dist2(n.x, n.z) < (n.r + GROVE_PAD) ** 2) groves.push(n);
        }
      }
    }
    const groveOf = (s: StalkProp): number => {
      for (const g of groves) if (Math.hypot(s.x - g.x, s.z - g.z) < g.r + GROVE_PAD) return g.id;
      return -1;
    };

    const stalk = new Batch(assets.stalk, assets.plain, true, true);
    const ring = new Batch(assets.stalkRing, assets.plain, true, true);
    const tuft = new Batch(assets.leafTuft, assets.plain, true, true);
    const shrub = new Batch(assets.shrub, assets.plain);
    const shrubCap = new Batch(assets.shrub, assets.plain);
    const base = (s: StalkProp) => {
      reset().position.set(s.x, s.y - 0.05, s.z);
      o.rotation.set(s.leanX, 0, s.leanZ);
      return o;
    };
    for (const i of list) {
      const s = map.props.stalks[i];
      if (!s) continue;
      const grove = groveOf(s);
      const theme = grove >= 0 ? themes[bambooBiome] : themeAt(s.x, s.z);
      if (grove < 0 && theme.thicketStyle === 'shrub') {
        const r = 0.45 + s.height * 0.12;
        reset().position.set(s.x, s.y + r * 0.55, s.z);
        o.rotation.set(s.leanX, s.tint * 6.28, s.leanZ);
        o.scale.set(r, r * 0.75, r);
        o.updateMatrix();
        shrub.add(o.matrix, c3.setHex(pickHex(theme.stalks, s.tint)));
        reset().position.set(s.x, s.y + r * 0.95, s.z);
        o.rotation.set(0, s.tint * 4.1, 0);
        o.scale.set(r * 0.78, r * 0.4, r * 0.78);
        o.updateMatrix();
        shrubCap.add(o.matrix, c3.setHex(theme.stalkNode));
        continue;
      }
      const slots: { batch: Batch; index: number }[] | null = grove >= 0 ? this.toggle(this.nodes, grove).full : null;
      base(s).scale.set(1, s.height, 1);
      o.updateMatrix();
      const k = stalk.add(o.matrix, c3.setHex(pickHex(theme.stalks, s.tint)));
      slots?.push({ batch: stalk, index: k });
      for (const f of RINGS) {
        base(s).translateY(s.height * f);
        o.updateMatrix();
        const kr = ring.add(o.matrix, c3.setHex(theme.stalkNode));
        slots?.push({ batch: ring, index: kr });
      }
      for (const [f, scale] of TUFTS) {
        base(s).translateY(s.height * f);
        o.rotateY(s.tint * 6.28 + f);
        o.scale.setScalar(scale);
        o.updateMatrix();
        const kt = tuft.add(o.matrix, c3.setHex(pickHex(theme.stalkLeaves, (s.tint * 7.3) % 1)));
        slots?.push({ batch: tuft, index: kt });
      }
    }
    const out = this.meshes;
    stalk.finish(out, true, true);
    ring.finish(out, false, false);
    tuft.finish(out, true, true);
    shrub.finish(out, true, true);
    shrubCap.finish(out, false, false);
  }

  /** Grove stubs and scrap heaps for the nodes whose middle is in this chunk. */
  private buildNodes(list: readonly number[]): void {
    const { assets, map, world } = this.ctx;
    const terrain = map.terrain;
    let stubs: Batch | null = null;
    let stubInk: Batch | null = null;
    let scrap: Batch | null = null;
    let scrapInk: Batch | null = null;
    let spent: Batch | null = null;
    let spentInk: Batch | null = null;
    for (const id of list) {
      const n = world.nodes[id];
      if (!n || (n.kind !== 'grove' && n.kind !== 'scrap')) continue;
      reset().position.set(n.x, terrain.heightAt(n.x, n.z), n.z);
      o.rotation.y = id * 2.4;
      const tg = this.toggle(this.nodes, id);
      if (n.kind === 'grove') {
        o.scale.setScalar(n.r / 1.2);
        o.updateMatrix();
        stubs ??= new Batch(assets.groveStubs.body, assets.painted, false, true);
        tg.spent.push({ batch: stubs, index: stubs.add(o.matrix) });
        if (assets.groveStubs.ink) {
          stubInk ??= new Batch(assets.groveStubs.ink, assets.ink, false, true);
          tg.spent.push({ batch: stubInk, index: stubInk.add(o.matrix) });
        }
        continue;
      }
      o.scale.setScalar(n.r);
      o.updateMatrix();
      scrap ??= new Batch(assets.scrap.body, assets.painted, false, true);
      tg.full.push({ batch: scrap, index: scrap.add(o.matrix) });
      if (assets.scrap.ink) {
        scrapInk ??= new Batch(assets.scrap.ink, assets.ink, false, true);
        tg.full.push({ batch: scrapInk, index: scrapInk.add(o.matrix) });
      }
      spent ??= new Batch(assets.scrapSpent.body, assets.painted, false, true);
      tg.spent.push({ batch: spent, index: spent.add(o.matrix) });
      if (assets.scrapSpent.ink) {
        spentInk ??= new Batch(assets.scrapSpent.ink, assets.ink, false, true);
        tg.spent.push({ batch: spentInk, index: spentInk.add(o.matrix) });
      }
    }
    const out = this.meshes;
    stubs?.finish(out, true, true);
    stubInk?.finish(out, false, false);
    scrap?.finish(out, true, true);
    scrapInk?.finish(out, false, false);
    spent?.finish(out, false, true);
    spentInk?.finish(out, false, false);
  }

  /** Supply crates: closed until someone empties them, then open (for everyone, for good). */
  private buildCrates(list: readonly number[]): void {
    if (!list.length) return;
    const { assets, map, world } = this.ctx;
    const closed = new Batch(assets.crate.body, assets.painted, false, true);
    const closedInk = assets.crate.ink ? new Batch(assets.crate.ink, assets.ink, false, true) : null;
    const open = new Batch(assets.crateOpen.body, assets.painted, false, true);
    const openInk = assets.crateOpen.ink ? new Batch(assets.crateOpen.ink, assets.ink, false, true) : null;
    for (const id of list) {
      const c = world.crates[id];
      if (!c) continue;
      reset().position.set(c.x, map.terrain.heightAt(c.x, c.z), c.z);
      o.rotation.y = id * 1.7;
      o.updateMatrix();
      const tg = this.toggle(this.crates, id);
      tg.full.push({ batch: closed, index: closed.add(o.matrix) });
      if (closedInk) tg.full.push({ batch: closedInk, index: closedInk.add(o.matrix) });
      tg.spent.push({ batch: open, index: open.add(o.matrix) });
      if (openInk) tg.spent.push({ batch: openInk, index: openInk.add(o.matrix) });
    }
    const out = this.meshes;
    closed.finish(out, true, true);
    closedInk?.finish(out, false, false);
    open.finish(out, true, true);
    openInk?.finish(out, false, false);
  }

  /** Grass, flowers and lily pads from the world's on-demand scatter, like world.ts' decor (no shadows). */
  private buildDecor(themeAt: ThemeAt): void {
    const { assets, map, world } = this.ctx;
    const decor = world.chunkDecor(this.cx, this.cz);
    const grass = new Batch(assets.grass, assets.plain);
    const flowers = new Batch(assets.flower, assets.plain);
    const lilies = new Batch(assets.lily, assets.plain);
    for (const g of decor.grass) {
      reset().position.set(g.x, g.y - 0.02, g.z);
      o.rotation.y = g.rot;
      o.scale.setScalar(g.scale);
      o.updateMatrix();
      grass.add(o.matrix, c3.setHex(pickHex(themeAt(g.x, g.z).grass, g.tint)));
    }
    for (const f of decor.flowers) {
      reset().position.set(f.x, f.y, f.z);
      o.scale.setScalar(f.scale);
      o.updateMatrix();
      flowers.add(o.matrix, c3.setHex(pickHex(themeAt(f.x, f.z).flowers, f.tint)));
    }
    for (const l of decor.lilies) {
      const palette = themeAt(l.x, l.z).lilies;
      reset().position.set(l.x, map.terrain.waterLevel + 0.02, l.z);
      o.rotation.y = l.rot;
      o.scale.setScalar(l.scale);
      o.updateMatrix();
      lilies.add(o.matrix, c3.setHex(palette.length ? pickHex(palette, l.tint) : LILY));
    }
    const out = this.meshes;
    grass.finish(out, false, false);
    flowers.finish(out, false, false);
    lilies.finish(out, false, false);
  }
}

/** Leaf tufts per stalk: at the top full size, and a smaller one lower down (same as world.ts). */
const TUFTS: readonly [number, number][] = [
  [1, 1],
  [0.7, 0.7],
];
/** Lily pads in a biome without lily colours of its own. */
const LILY = 0x5f9a4a;

function hideSpent(t: Toggle): void {
  for (const s of t.spent) s.batch.show(s.index, false);
  t.spentShown = false;
}

function setSpent(t: Toggle, spent: boolean): void {
  if (spent === t.spentShown) return;
  t.spentShown = spent;
  for (const s of t.full) s.batch.show(s.index, !spent);
  for (const s of t.spent) s.batch.show(s.index, spent);
}
