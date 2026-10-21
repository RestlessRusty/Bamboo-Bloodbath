import * as THREE from 'three';
import { smoothstep } from '../../core/math';
import type { GameMap } from '../../sim/gameMap';
import { chunkOf, OPEN, tileCenter } from '../../sim/open/config';
import type { WorldMirror } from '../../sim/open/mirror';
import { BIOME_IDS, type BiomeId, type GhostSpec, type Piece } from '../../sim/open/types';
import { buildRoads } from '../storyBuildings';
import { disposeObject } from '../toon';
import { buildCamp, buildCrossings } from '../world';
import { OpenAssets } from './assets';
import { ChunkView } from './chunk';
import { makeContext, NB, PAL, PAL_SIZE, type OpenContext } from './context';
import { Ghost, PieceKit } from './pieces';
import { OpenSky } from './sky';

/** Chunks this close to the camera's focus get built (one per frame, nearest first)… */
const LOAD = 170;
/** …and are dropped (GPU buffers freed) once further than this. */
const DROP = 230;
/** Built at once around a fresh camera (new match, first frame), so there's ground under your feet. */
const PRIME = 48;
/** Dropping far chunks is checked this often (frames). */
const DROP_EVERY = 30;
/** Campfire flames are drawn this far away; the nearest few also light up the night. */
const FLAME_RANGE = 70;
const MAX_FLAMES = 32;
const LIGHTS = 4;
const LIGHT_RANGE = 45;
const LIGHT_POWER = 12;
/** Gate doors animate in chunks this close. */
const GATE_RANGE = 40;
/** Survivors tracked for gates (positions as x, z pairs). */
const MAX_ACTORS = 8;

const EMPTY: readonly Piece[] = [];

interface Fire {
  x: number;
  y: number;
  z: number;
}

/**
 * The open world, streamed: 64 m chunks of terrain and props are built around the camera's focus and
 * dropped behind it. Bridges, fords, roads and the spawn camp are built once for the whole world.
 * Building pieces, depleted nodes, opened crates and loot bags come from the WorldMirror; campfires
 * flicker and light up the night. Same surface as the normal world (`group`, `update`, `dispose`).
 */
export class OpenWorldView {
  readonly group = new THREE.Group();
  readonly sky: OpenSky;
  private readonly map: GameMap;
  private readonly ctx: OpenContext;
  private readonly assets: OpenAssets;
  private readonly kit: PieceKit;
  private readonly chunks = new Map<number, ChunkView>();
  /** Chunks per side. */
  private readonly n: number;
  private readonly camp: { group: THREE.Group; update(time: number): void; fire: THREE.Vector3 };
  private readonly fixed: THREE.Object3D[];
  private mirror: WorldMirror | null = null;
  private seenRev = -1;
  /** Pieces by chunk key (all of the world's, loaded or not: it's what a chunk gets when it's built). */
  private buckets = new Map<number, Piece[]>();
  private fires: Fire[] = [];
  private readonly flameOuter: THREE.InstancedMesh;
  private readonly flameInner: THREE.InstancedMesh;
  private readonly lights: THREE.PointLight[] = [];
  private readonly lightPick = new Int32Array(LIGHTS);
  private readonly lightDist = new Float32Array(LIGHTS);
  private readonly bags = new Map<number, THREE.Group>();
  private readonly bagGroup = new THREE.Group();
  private readonly ghost: Ghost;
  private readonly actors = new Float32Array(MAX_ACTORS * 2);
  private actorCount = 0;
  private frame = 0;
  private readonly tmpM = new THREE.Matrix4();

  constructor(map: GameMap) {
    const world = map.open!;
    this.map = map;
    this.n = world.chunks;
    this.assets = new OpenAssets(map);
    this.kit = new PieceKit(this.assets.painted, this.assets.ink);
    this.ctx = makeContext(map, this.assets, this.kit);
    this.sky = new OpenSky(world);

    // The sign at camp points at the nearest abandoned building: somewhere to start looking.
    const { start } = map.layout;
    let toward: { x: number; z: number } | undefined;
    for (const p of world.pois) {
      if (!toward || Math.hypot(p.x - start.x, p.z - start.z) < Math.hypot(toward.x - start.x, toward.z - start.z)) toward = p;
    }
    this.camp = buildCamp(map, toward);
    this.fixed = [buildCrossings(map), buildRoads(map), buildSkirt(map, this.ctx), this.camp.group];
    this.group.add(...this.fixed);

    const flameGeo = (r: number, h: number) => new THREE.ConeGeometry(r, h, 6);
    this.flameOuter = new THREE.InstancedMesh(flameGeo(0.28, 0.75), new THREE.MeshBasicMaterial({ color: 0xff8a2b }), MAX_FLAMES);
    this.flameInner = new THREE.InstancedMesh(flameGeo(0.15, 0.45), new THREE.MeshBasicMaterial({ color: 0xffe066 }), MAX_FLAMES);
    for (const f of [this.flameOuter, this.flameInner]) {
      f.count = 0;
      f.frustumCulled = false;
      f.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(f);
    }
    for (let i = 0; i < LIGHTS; i++) {
      const light = new THREE.PointLight(0xff9a40, 0, 12, 2);
      light.visible = false;
      this.lights.push(light);
      this.group.add(light);
    }
    this.ghost = new Ghost(this.kit, map.terrain);
    this.group.add(this.bagGroup, this.ghost.group);
  }

  /** Builds every missing chunk near (x, z) right now: for a new camera, before the first frame. */
  prime(x: number, z: number): void {
    this.forEachChunkNear(x, z, PRIME, (cx, cz) => {
      if (!this.chunks.has(cz * this.n + cx)) this.build(cx, cz);
    });
  }

  /** The mirror of this world (null: no pieces, every node full, every crate closed). */
  setMirror(m: WorldMirror | null): void {
    this.mirror = m;
    this.seenRev = m ? m.rev : -1;
    // Whatever was pending is covered by the full rebuild below.
    m?.takeDirty();
    this.buckets = new Map();
    if (m) for (const p of m.pieces.values()) this.bucketOf(this.keyOf(p)).push(p);
    for (const [key, c] of this.chunks) {
      c.pieces.set(this.buckets.get(key) ?? EMPTY);
      c.refreshNodes(m);
      c.refreshCrates(m);
    }
    this.collectFires();
    this.rebuildBags();
  }

  setGhost(g: GhostSpec | null): void {
    this.ghost.set(g);
  }

  /** Where the pandas are (x, z pairs), for gates to swing open. */
  setActors(xz: ArrayLike<number>, n: number): void {
    this.actorCount = Math.min(n, MAX_ACTORS);
    for (let i = 0; i < this.actorCount * 2; i++) this.actors[i] = xz[i];
  }

  update(dt: number, time: number, fx: number, fz: number): void {
    this.frame++;
    this.stream(fx, fz);
    this.sync();
    this.camp.update(time);
    this.ghost.update(time);
    for (const c of this.chunks.values()) {
      if (c.dist2(fx, fz) < GATE_RANGE * GATE_RANGE) c.pieces.animate(dt, this.actors, this.actorCount);
    }
    this.updateFires(time, fx, fz);
    this.assets.bagGlow.opacity = 0.35 + 0.2 * Math.sin(time * 3);
    let i = 0;
    for (const bag of this.bags.values()) {
      const body = bag.children[1];
      if (body) {
        body.position.y = 0.12 + Math.sin(time * 2.2 + i) * 0.06;
        body.rotation.y = time * 0.8 + i;
      }
      i++;
    }
  }

  dispose(): void {
    for (const c of this.chunks.values()) c.dispose();
    this.chunks.clear();
    for (const g of this.fixed) disposeObject(g);
    this.flameOuter.geometry.dispose();
    this.flameInner.geometry.dispose();
    (this.flameOuter.material as THREE.Material).dispose();
    (this.flameInner.material as THREE.Material).dispose();
    this.flameOuter.dispose();
    this.flameInner.dispose();
    this.bagGroup.clear();
    this.bags.clear();
    this.ghost.dispose();
    this.kit.dispose();
    this.assets.dispose();
    this.group.clear();
  }

  // ---------------------------------------------------------------- streaming

  private keyOf(p: Piece): number {
    return chunkOf(tileCenter(p.gz)) * this.n + chunkOf(tileCenter(p.gx));
  }

  private bucketOf(key: number): Piece[] {
    let b = this.buckets.get(key);
    if (!b) {
      b = [];
      this.buckets.set(key, b);
    }
    return b;
  }

  /** Squared distance from (x, z) to chunk (cx, cz). */
  private chunkDist2(cx: number, cz: number, x: number, z: number): number {
    const x0 = -OPEN.worldSize / 2 + cx * OPEN.chunk;
    const z0 = -OPEN.worldSize / 2 + cz * OPEN.chunk;
    const dx = Math.max(x0 - x, 0, x - x0 - OPEN.chunk);
    const dz = Math.max(z0 - z, 0, z - z0 - OPEN.chunk);
    return dx * dx + dz * dz;
  }

  private forEachChunkNear(x: number, z: number, r: number, fn: (cx: number, cz: number) => void): void {
    const r2 = r * r;
    for (let cz = chunkOf(z - r); cz <= chunkOf(z + r); cz++) {
      for (let cx = chunkOf(x - r); cx <= chunkOf(x + r); cx++) if (this.chunkDist2(cx, cz, x, z) < r2) fn(cx, cz);
    }
  }

  /** One chunk per frame at most: the nearest missing one in range. Far ones are dropped now and then. */
  private stream(fx: number, fz: number): void {
    let best = -1;
    let bestD = LOAD * LOAD;
    const z0 = chunkOf(fz - LOAD);
    const z1 = chunkOf(fz + LOAD);
    const x0 = chunkOf(fx - LOAD);
    const x1 = chunkOf(fx + LOAD);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const key = cz * this.n + cx;
        if (this.chunks.has(key)) continue;
        const d = this.chunkDist2(cx, cz, fx, fz);
        if (d < bestD) {
          bestD = d;
          best = key;
        }
      }
    }
    if (best >= 0) this.build(best % this.n, Math.floor(best / this.n));

    if (this.frame % DROP_EVERY !== 0) return;
    for (const [key, c] of this.chunks) {
      if (c.dist2(fx, fz) < DROP * DROP) continue;
      this.group.remove(c.group);
      c.dispose();
      this.chunks.delete(key);
    }
  }

  private build(cx: number, cz: number): void {
    const key = cz * this.n + cx;
    const c = new ChunkView(this.ctx, cx, cz);
    c.pieces.set(this.buckets.get(key) ?? EMPTY);
    c.refreshNodes(this.mirror);
    c.refreshCrates(this.mirror);
    this.chunks.set(key, c);
    this.group.add(c.group);
  }

  /** Applies what changed in the mirror since last frame, chunk by chunk. */
  private sync(): void {
    const m = this.mirror;
    if (!m || m.rev === this.seenRev) return;
    this.seenRev = m.rev;
    const dirty = m.takeDirty();
    if (dirty.pieces.size) {
      for (const key of dirty.pieces) this.buckets.set(key, []);
      for (const p of m.pieces.values()) {
        const key = this.keyOf(p);
        if (dirty.pieces.has(key)) this.bucketOf(key).push(p);
      }
      for (const key of dirty.pieces) this.chunks.get(key)?.pieces.set(this.buckets.get(key) ?? EMPTY);
      this.collectFires();
    }
    if (dirty.nodes.size) {
      // A grove at a chunk edge has stalks next door too.
      const seen = new Set<number>();
      for (const key of dirty.nodes) {
        const cx = key % this.n;
        const cz = Math.floor(key / this.n);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = cx + dx;
            const z = cz + dz;
            if (x < 0 || z < 0 || x >= this.n || z >= this.n) continue;
            const k = z * this.n + x;
            if (seen.has(k)) continue;
            seen.add(k);
            this.chunks.get(k)?.refreshNodes(m);
          }
        }
      }
    }
    for (const key of dirty.crates) this.chunks.get(key)?.refreshCrates(m);
    if (dirty.bags) this.rebuildBags();
  }

  // ---------------------------------------------------------------- campfires and bags

  /** Standing campfires, for flames and lights. */
  private collectFires(): void {
    const fires: Fire[] = [];
    const m = this.mirror;
    if (m) {
      for (const p of m.pieces.values()) {
        if (p.kind !== 'campfire' || p.ruined) continue;
        const x = tileCenter(p.gx);
        const z = tileCenter(p.gz);
        fires.push({ x, y: this.map.terrain.heightAt(x, z), z });
      }
    }
    this.fires = fires;
  }

  private updateFires(time: number, fx: number, fz: number): void {
    // Flames on every campfire in sight, flickering like the one at camp.
    let n = 0;
    const m = this.tmpM;
    for (let i = 0; i < this.fires.length && n < MAX_FLAMES; i++) {
      const f = this.fires[i];
      if (Math.abs(f.x - fx) > FLAME_RANGE || Math.abs(f.z - fz) > FLAME_RANGE) continue;
      const k = 1 + Math.sin(time * 17 + i * 1.7) * 0.08 + Math.sin(time * 23 + i) * 0.06;
      this.flameOuter.setMatrixAt(n, m.makeScale(1, k, 1).setPosition(f.x, f.y + 0.37, f.z));
      this.flameInner.setMatrixAt(n, m.makeScale(1, 2 - k, 1).setPosition(f.x, f.y + 0.25, f.z));
      n++;
    }
    this.flameOuter.count = n;
    this.flameInner.count = n;
    if (n) {
      this.flameOuter.instanceMatrix.needsUpdate = true;
      this.flameInner.instanceMatrix.needsUpdate = true;
    }

    // Warm lights on the nearest few, at night. All four are on or off together: a changing light
    // count would recompile every shader.
    const night = smoothstep(0.05, 0.6, this.sky.night);
    const on = night > 0.01;
    for (const l of this.lights) l.visible = on;
    if (!on) return;
    const pick = this.lightPick;
    const dist = this.lightDist;
    pick.fill(-2);
    dist.fill(LIGHT_RANGE * LIGHT_RANGE);
    const camp = this.camp.fire;
    for (let i = -1; i < this.fires.length; i++) {
      const f = i < 0 ? camp : this.fires[i];
      const d = (f.x - fx) ** 2 + (f.z - fz) ** 2;
      if (d >= dist[LIGHTS - 1]) continue;
      let k = LIGHTS - 1;
      while (k > 0 && dist[k - 1] > d) {
        dist[k] = dist[k - 1];
        pick[k] = pick[k - 1];
        k--;
      }
      dist[k] = d;
      pick[k] = i;
    }
    for (let k = 0; k < LIGHTS; k++) {
      const l = this.lights[k];
      const i = pick[k];
      if (i === -2) {
        l.intensity = 0;
        continue;
      }
      const f = i < 0 ? camp : this.fires[i];
      l.position.set(f.x, f.y + 1.1, f.z);
      l.intensity = LIGHT_POWER * night * (1 + Math.sin(time * 13 + k * 2.1) * 0.1 + Math.sin(time * 29 + k) * 0.06);
    }
  }

  /** Loot bags lying about: a backpack bobbing over a gold ring (few of them, so plain meshes). */
  private rebuildBags(): void {
    this.bagGroup.clear();
    this.bags.clear();
    const m = this.mirror;
    if (!m) return;
    const a = this.assets;
    for (const b of m.bags.values()) {
      const g = new THREE.Group();
      g.position.set(b.x, this.map.terrain.heightAt(b.x, b.z), b.z);
      const glow = new THREE.Mesh(a.ring, a.bagGlow);
      glow.position.y = 0.05;
      glow.scale.setScalar(1.3);
      const body = new THREE.Mesh(a.bag.body, a.painted);
      body.castShadow = true;
      if (a.bag.ink) body.add(new THREE.Mesh(a.bag.ink, a.ink));
      g.add(glow, body);
      this.bagGroup.add(g);
      this.bags.set(b.id, g);
    }
  }
}

/**
 * Ground beyond the world's edge, rising into hills and fading into the fog, so walking to the rim
 * never shows the end of the world. Its inner edge follows the terrain's edge vertex for vertex.
 */
function buildSkirt(map: GameMap, ctx: OpenContext): THREE.Mesh {
  const half = OPEN.worldSize / 2;
  const step = OPEN.chunk / 32;
  const perSide = OPEN.worldSize / step;
  const rings = [0, 40, 600];
  const lift = [0, 9, 9];
  const pts: { x: number; z: number; dx: number; dz: number }[] = [];
  // Round the square, corners pointing out diagonally so neighbouring strips meet.
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < perSide; i++) {
      const t = -half + i * step;
      const corner = i === 0;
      const s = Math.SQRT1_2;
      if (side === 0) pts.push({ x: t, z: -half, dx: corner ? -s : 0, dz: -(corner ? s : 1) });
      else if (side === 1) pts.push({ x: half, z: t, dx: corner ? s : 1, dz: corner ? -s : 0 });
      else if (side === 2) pts.push({ x: -t, z: half, dx: corner ? s : 0, dz: corner ? s : 1 });
      else pts.push({ x: -half, z: -t, dx: corner ? -s : -1, dz: corner ? s : 0 });
    }
  }
  const pal = ctx.palettes;
  const wts: Record<BiomeId, number> = { meadow: 0, bamboo: 0, pine: 0, snow: 0, fen: 0, quarry: 0, farm: 0 };
  const pos: number[] = [];
  const col: number[] = [];
  for (const p of pts) {
    const y = map.terrain.heightAt(p.x, p.z);
    // The rim colour of the biomes there.
    ctx.world.biomeWeights(p.x * 0.995, p.z * 0.995, wts);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let k = 0; k < NB; k++) {
      const w = wts[BIOME_IDS[k]];
      const o = k * PAL_SIZE + PAL.rim;
      r += pal[o] * w;
      g += pal[o + 1] * w;
      b += pal[o + 2] * w;
    }
    for (let i = 0; i < rings.length; i++) {
      pos.push(p.x + p.dx * rings[i], y + lift[i], p.z + p.dz * rings[i]);
      col.push(r, g, b);
    }
  }
  const idx: number[] = [];
  const count = pts.length;
  const R = rings.length;
  for (let i = 0; i < count; i++) {
    const a = i * R;
    const b = ((i + 1) % count) * R;
    for (let r = 0; r < R - 1; r++) idx.push(a + r, a + r + 1, b + r, b + r, a + r + 1, b + r + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Its own material (not the chunks'): disposeObject frees it with the skirt.
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}
