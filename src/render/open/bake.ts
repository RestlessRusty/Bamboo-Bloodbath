import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** One coloured primitive of a model, placed in the model's own space (like a child mesh would be). */
export interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  x: number;
  y: number;
  z: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Ink hull around this part, scaled this much about its own centre (like `addOutline`); absent: none. */
  ink?: number;
}

/** A model baked into one vertex-coloured geometry, plus its ink hull (null when no part asked for one). */
export interface Baked {
  body: THREE.BufferGeometry;
  ink: THREE.BufferGeometry | null;
}

const m4 = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const col = new THREE.Color();

/** The part's primitive moved into place, non-indexed with just positions and normals (so any mix merges). */
function placed(p: Part, k: number): THREE.BufferGeometry {
  euler.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
  m4.compose(pos.set(p.x, p.y, p.z), quat.setFromEuler(euler), scl.set((p.sx ?? 1) * k, (p.sy ?? 1) * k, (p.sz ?? 1) * k));
  const src = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position'));
  g.setAttribute('normal', src.getAttribute('normal'));
  g.applyMatrix4(m4);
  return g;
}

/**
 * Bakes parts into one geometry coloured per vertex, so a whole model is one instanced draw (and its
 * outline a second). The source primitives are only read: callers make throwaway ones.
 */
export function bake(parts: readonly Part[]): Baked {
  const bodies = parts.map((p) => {
    const g = placed(p, 1);
    const n = g.getAttribute('position').count;
    const colors = new Float32Array(n * 3);
    col.setHex(p.color);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const hulls = parts.filter((p) => p.ink).map((p) => placed(p, p.ink!));
  return { body: mergeGeometries(bodies)!, ink: hulls.length ? mergeGeometries(hulls)! : null };
}

/** Shorthand for a part. */
export function part(geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, extra?: Partial<Part>): Part {
  return { geo, color, x, y, z, ...extra };
}

const WHITE = new THREE.Color(0xffffff);
const ZERO_SCALE = [0, 1, 2, 4, 5, 6, 8, 9, 10];

/**
 * One instanced batch of a streamed chunk, filled in one go (`add`, then `finish`). With `toggles`, it keeps
 * a copy of every matrix so single instances can be hidden (scaled to nothing where they stand, so the
 * bounding sphere stays right) and shown again: depleted nodes, opened crates.
 */
export class Batch {
  mesh: THREE.InstancedMesh | null = null;
  private readonly m: number[] = [];
  private readonly c: number[] = [];
  private orig: Float32Array | null = null;

  constructor(
    private readonly geo: THREE.BufferGeometry,
    private readonly mat: THREE.Material,
    private readonly colored = true,
    private readonly toggles = false,
  ) {}

  get size(): number {
    return this.m.length / 16;
  }

  /** Adds an instance; returns its index. */
  add(matrix: THREE.Matrix4, color?: THREE.Color): number {
    const i = this.size;
    const e = matrix.elements;
    for (let k = 0; k < 16; k++) this.m.push(e[k]);
    if (this.colored) {
      const c = color ?? WHITE;
      this.c.push(c.r, c.g, c.b);
    }
    return i;
  }

  /** Builds the mesh (null when nothing was added) into `out`. */
  finish(out: THREE.Object3D[], cast: boolean, receive: boolean): THREE.InstancedMesh | null {
    const n = this.size;
    if (!n) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    (mesh.instanceMatrix.array as Float32Array).set(this.m);
    mesh.instanceMatrix.needsUpdate = true;
    if (this.colored) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.c), 3);
    if (this.toggles) this.orig = new Float32Array(this.m);
    mesh.computeBoundingSphere();
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    this.m.length = 0;
    this.c.length = 0;
    this.mesh = mesh;
    out.push(mesh);
    return mesh;
  }

  /** Shows or hides instance `i` (toggling batches only). */
  show(i: number, on: boolean): void {
    const mesh = this.mesh;
    const orig = this.orig;
    if (!mesh || !orig) return;
    const a = mesh.instanceMatrix.array as Float32Array;
    const o = i * 16;
    for (let k = 0; k < 16; k++) a[o + k] = orig[o + k];
    if (!on) for (const k of ZERO_SCALE) a[o + k] = 0;
    mesh.instanceMatrix.needsUpdate = true;
  }
}
