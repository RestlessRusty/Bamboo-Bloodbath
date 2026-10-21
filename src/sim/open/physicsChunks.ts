import type { Collider, ColliderDesc, World } from '@dimforge/rapier3d-compat';
import { SIM_HZ } from '../../config';
import type { GameMap } from '../gameMap';
import { RAPIER } from '../physics';
import type { RockProp, TreeProp } from '../props';
import { chunkOf, OPEN } from './config';

/** Trunk collider of a tree. Shared with Simulation.buildStatic so normal maps and the open world match exactly. */
export function treeCollider(t: TreeProp): ColliderDesc {
  return RAPIER.ColliderDesc.cylinder(2, t.radius).setTranslation(t.x, t.y + 1.5, t.z);
}

/** Boulders: as tall as they look (plus a bit underground for slopes), so nothing invisible sticks out. */
export function rockCollider(r: RockProp): ColliderDesc {
  const below = 0.6;
  return RAPIER.ColliderDesc.cylinder((r.height + below) / 2, r.radius).setTranslation(r.x, r.y + (r.height - below) / 2, r.z);
}

/** Terrain cell of a chunk's trimesh: 32 × 32 cells per 64 m chunk. */
const STEP = 2;
const SEG = OPEN.chunk / STEP;
/** A body loads the chunks within this many chunks of its own… */
const LOAD_RING = 1;
/** …and keeps the ones within this many from being unloaded… */
const KEEP_RING = 2;
/** …for this long after the last body left. */
const UNLOAD_TICKS = 10 * SIM_HZ;
/** Chunks of the outer ring built per update (the one a body stands in is always built at once). */
const LOAD_BUDGET = 2;
/** ensure() also builds neighbours this close to the point, so nobody stands on an unbuilt seam. */
const ENSURE_PAD = 4;

/** What PhysicsChunks needs of a survivor or a zombie. */
interface Mover {
  readonly x: number;
  readonly z: number;
  readonly body: object | null;
}

/**
 * Streams the open world's ground into the physics world: per 64 m chunk, a terrain trimesh on a 2 m grid
 * plus the chunk's tree and rock colliders, only around bodies. A whole-world trimesh and every tree of a
 * 1 km world would cost a phone far too much memory and broad-phase time.
 */
export class PhysicsChunks {
  private readonly n: number;
  private readonly half: number;
  private readonly loaded = new Map<number, Collider[]>();
  /** Tick a body was last within KEEP_RING of each chunk. */
  private readonly lastNear: Float64Array;
  /** Chunks of the outer ring waiting to be built this update (deduplicated by wantStamp). */
  private readonly want: Int32Array;
  private readonly wantStamp: Float64Array;
  /** One vertex buffer reused for every chunk (Rapier copies it), and the grid's triangles, the same for all. */
  private readonly positions = new Float32Array((SEG + 1) * (SEG + 1) * 3);
  private readonly indices: Uint32Array;
  private now = 0;

  constructor(
    private readonly world: World,
    private readonly map: GameMap,
  ) {
    this.n = Math.round(OPEN.worldSize / OPEN.chunk);
    this.half = OPEN.worldSize / 2;
    const cells = this.n * this.n;
    this.lastNear = new Float64Array(cells).fill(-Infinity);
    this.want = new Int32Array(cells);
    this.wantStamp = new Float64Array(cells).fill(-1);

    // Counter-clockwise seen from above, like buildTerrainGrid, so normals point up.
    const v = SEG + 1;
    this.indices = new Uint32Array(SEG * SEG * 6);
    let p = 0;
    for (let j = 0; j < SEG; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * v + i;
        const b = a + v;
        const c = a + 1;
        const d = b + 1;
        this.indices[p++] = a;
        this.indices[p++] = b;
        this.indices[p++] = c;
        this.indices[p++] = c;
        this.indices[p++] = b;
        this.indices[p++] = d;
      }
    }
  }

  /** Builds the ground under (x, z) right away: call before spawning or teleporting a body there. */
  ensure(x: number, z: number): void {
    const x0 = chunkOf(x - ENSURE_PAD);
    const x1 = chunkOf(x + ENSURE_PAD);
    const z0 = chunkOf(z - ENSURE_PAD);
    const z1 = chunkOf(z + ENSURE_PAD);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = cz * this.n + cx;
        if (this.lastNear[k] < this.now) this.lastNear[k] = this.now;
        if (!this.loaded.has(k)) this.load(k);
      }
    }
  }

  /**
   * Every few ticks: builds the chunks around the bodies (at most `budget` of the outer ring at once) and
   * drops the ones nobody has been near for a while.
   */
  update(tick: number, groups: readonly (readonly Mover[])[], budget = LOAD_BUDGET): void {
    this.now = tick;
    const n = this.n;
    let wanted = 0;
    for (const list of groups) {
      for (const m of list) {
        if (!m.body) continue;
        this.ensure(m.x, m.z);
        const cx = chunkOf(m.x);
        const cz = chunkOf(m.z);
        for (let dz = -KEEP_RING; dz <= KEEP_RING; dz++) {
          const z = cz + dz;
          if (z < 0 || z >= n) continue;
          for (let dx = -KEEP_RING; dx <= KEEP_RING; dx++) {
            const x = cx + dx;
            if (x < 0 || x >= n) continue;
            const k = z * n + x;
            this.lastNear[k] = tick;
            if (Math.abs(dx) > LOAD_RING || Math.abs(dz) > LOAD_RING) continue;
            if (this.wantStamp[k] === tick || this.loaded.has(k)) continue;
            this.wantStamp[k] = tick;
            this.want[wanted++] = k;
          }
        }
      }
    }

    for (let i = 0; i < wanted && budget > 0; i++) {
      const k = this.want[i];
      if (this.loaded.has(k)) continue;
      this.load(k);
      budget--;
    }

    for (const [k, colliders] of this.loaded) {
      if (tick - this.lastNear[k] <= UNLOAD_TICKS) continue;
      for (const c of colliders) this.world.removeCollider(c, false);
      this.loaded.delete(k);
    }
  }

  private load(k: number): void {
    const open = this.map.open;
    if (!open) return;
    const cx = k % this.n;
    const cz = (k - cx) / this.n;
    const x0 = -this.half + cx * OPEN.chunk;
    const z0 = -this.half + cz * OPEN.chunk;

    // Same sample points on both sides of a seam (integer metres), so neighbouring chunks meet without gaps.
    const terrain = this.map.terrain;
    const pos = this.positions;
    let p = 0;
    for (let j = 0; j <= SEG; j++) {
      const z = z0 + j * STEP;
      for (let i = 0; i <= SEG; i++) {
        const x = x0 + i * STEP;
        pos[p++] = x;
        pos[p++] = terrain.heightAt(x, z);
        pos[p++] = z;
      }
    }

    const world = this.world;
    const colliders: Collider[] = [world.createCollider(RAPIER.ColliderDesc.trimesh(pos, this.indices).setFriction(0.3))];
    const { trees, rocks } = this.map.props;
    const contents = open.chunkContents(cx, cz);
    for (const i of contents.trees) {
      const t = trees[i];
      if (t.collide) colliders.push(world.createCollider(treeCollider(t)));
    }
    for (const i of contents.rocks) colliders.push(world.createCollider(rockCollider(rocks[i])));
    this.loaded.set(k, colliders);
  }
}
