import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ZOMBIE } from '../config';
import { clamp, lerp, lerpAngle } from '../core/math';
import type { ZombieSnap } from '../sim/types';
import { toonGradient } from './toon';

const MAX_ZOMBIES = 90;

/** Zombie panda palette: sickly fur, red eyes, bloody mouth, a hole in the cheek. */
const C = {
  fur: 0xbac7a6,
  dark: 0x3b4136,
  patch: 0x2c2826,
  muzzle: 0xd4dcc6,
  eye: 0xf1eda0,
  pupil: 0x9a0f12,
  nose: 0x1d1a1a,
  mouth: 0x5a0b0d,
  teeth: 0xfffdf0,
  blood: 0xb3191e,
  hole: 0x240909,
  rim: 0x8a1c1c,
};

type V3 = [number, number, number];

interface PartDef {
  geo: THREE.BufferGeometry;
  color: number;
  pos: V3;
  scale: V3;
  rot?: V3;
  /** Include in the outline hull, scaled by this factor. */
  outline?: number;
}

function transformed(geo: THREE.BufferGeometry, p: PartDef, k: number): THREE.BufferGeometry {
  const [rx, ry, rz] = p.rot ?? [0, 0, 0];
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(p.scale[0] * k, p.scale[1] * k, p.scale[2] * k),
  );
  return geo.clone().applyMatrix4(m);
}

/** Bake a list of parts into one vertex-coloured geometry plus one outline geometry. */
function bake(parts: PartDef[]): { colored: THREE.BufferGeometry; outline: THREE.BufferGeometry } {
  const colored = parts.map((p) => {
    const g = transformed(p.geo, p, 1);
    const c = new THREE.Color(p.color);
    const n = g.getAttribute('position').count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  const outline = parts.filter((p) => p.outline).map((p) => transformed(p.geo, p, p.outline!));
  return { colored: mergeGeometries(colored)!, outline: mergeGeometries(outline)! };
}

function buildGeometries() {
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  const band = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0.62, 0.42);
  const arm = new THREE.CapsuleGeometry(0.11, 0.2, 3, 8);
  const leg = new THREE.CapsuleGeometry(0.13, 0.12, 3, 8);
  const cone = new THREE.ConeGeometry(1, 1, 6);

  // Body space: same layout as the survivor PandaModel.
  const body = bake([
    { geo: sphere, color: C.fur, pos: [0, 0.62, 0], scale: [0.42, 0.44, 0.4], outline: 1.07 },
    { geo: band, color: C.dark, pos: [0, 0.62, 0], scale: [0.425, 0.445, 0.405] },
    { geo: sphere, color: C.blood, pos: [0.12, 0.8, 0.355], scale: [0.1, 0.14, 0.05] },
    { geo: sphere, color: C.blood, pos: [-0.08, 0.6, 0.38], scale: [0.07, 0.1, 0.035] },
    { geo: sphere, color: C.fur, pos: [0, 0.42, -0.38], scale: [0.09, 0.09, 0.09], outline: 1.1 },
  ]);

  // Head space (pivot at the neck).
  const head = bake([
    { geo: sphere, color: C.fur, pos: [0, 0, 0], scale: [0.395, 0.34, 0.36], outline: 1.07 },
    { geo: sphere, color: C.dark, pos: [0.25, 0.27, -0.04], scale: [0.11, 0.11, 0.066], outline: 1.1 },
    { geo: sphere, color: C.dark, pos: [-0.24, 0.23, -0.04], scale: [0.08, 0.065, 0.05], outline: 1.12 }, // torn ear
    { geo: sphere, color: C.patch, pos: [0.135, 0.03, 0.305], scale: [0.085, 0.105, 0.045], rot: [0, 0, 0.45] },
    { geo: sphere, color: C.patch, pos: [-0.135, 0.02, 0.305], scale: [0.085, 0.105, 0.045], rot: [0, 0, -0.45] },
    { geo: sphere, color: C.eye, pos: [0.13, 0.05, 0.335], scale: [0.062, 0.062, 0.045] },
    { geo: sphere, color: C.pupil, pos: [0.13, 0.05, 0.378], scale: [0.02, 0.02, 0.012] },
    { geo: sphere, color: C.eye, pos: [-0.13, 0.03, 0.335], scale: [0.05, 0.028, 0.04] }, // droopy eye
    { geo: sphere, color: C.pupil, pos: [-0.13, 0.03, 0.372], scale: [0.016, 0.014, 0.01] },
    { geo: sphere, color: C.muzzle, pos: [0, -0.09, 0.29], scale: [0.16, 0.11, 0.105], outline: 1.08 },
    { geo: sphere, color: C.nose, pos: [0, -0.045, 0.385], scale: [0.06, 0.04, 0.035] },
    { geo: sphere, color: C.mouth, pos: [0, -0.13, 0.375], scale: [0.085, 0.05, 0.035] },
    { geo: cone, color: C.teeth, pos: [0.03, -0.105, 0.398], scale: [0.013, 0.035, 0.013], rot: [0, 0, Math.PI] },
    { geo: cone, color: C.teeth, pos: [-0.03, -0.105, 0.398], scale: [0.013, 0.035, 0.013], rot: [0, 0, Math.PI] },
    { geo: sphere, color: C.blood, pos: [0, -0.17, 0.37], scale: [0.09, 0.035, 0.03] },
    { geo: sphere, color: C.blood, pos: [0.05, -0.2, 0.355], scale: [0.025, 0.05, 0.02] },
    { geo: sphere, color: C.blood, pos: [-0.045, -0.215, 0.345], scale: [0.02, 0.045, 0.02] },
    { geo: sphere, color: C.rim, pos: [-0.215, -0.07, 0.27], scale: [0.075, 0.06, 0.03] }, // cheek hole
    { geo: sphere, color: C.hole, pos: [-0.222, -0.07, 0.288], scale: [0.05, 0.04, 0.02] },
  ]);

  // Arm space (pivot at the shoulder), with a bloody paw.
  const armGeo = bake([
    { geo: arm, color: C.dark, pos: [0, -0.16, 0], scale: [1, 1, 1], outline: 1.14 },
    { geo: sphere, color: C.blood, pos: [0, -0.33, 0.06], scale: [0.06, 0.05, 0.04] },
  ]);
  const legGeo = bake([{ geo: leg, color: C.dark, pos: [0, -0.15, 0], scale: [1, 1, 1], outline: 1.12 }]);

  return { body, head, arm: armGeo, leg: legGeo };
}

interface Anim {
  walk: number;
  seen: number;
}

/**
 * All zombies drawn with 8 instanced meshes (4 parts + 4 outlines), animated by
 * computing each part's matrix through a dummy skeleton.
 */
export class HordeView {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly arms: THREE.InstancedMesh;
  private readonly legs: THREE.InstancedMesh;
  private readonly outlines: THREE.InstancedMesh[];
  private readonly anim = new Map<number, Anim>();
  private frame = 0;

  // Dummy skeleton reused for every zombie.
  private readonly root = new THREE.Object3D();
  private readonly pose = new THREE.Object3D();
  private readonly torso = new THREE.Object3D();
  private readonly neck = new THREE.Object3D();
  private readonly armL = new THREE.Object3D();
  private readonly armR = new THREE.Object3D();
  private readonly legL = new THREE.Object3D();
  private readonly legR = new THREE.Object3D();
  private readonly color = new THREE.Color();
  private readonly hurtColor = new THREE.Color(0xff5050);

  constructor() {
    const g = buildGeometries();
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() });
    const ink = new THREE.MeshBasicMaterial({ color: 0x2b1e1a, side: THREE.BackSide });
    const make = (geo: THREE.BufferGeometry, material: THREE.Material, count: number, shadow: boolean) => {
      const m = new THREE.InstancedMesh(geo, material, count);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadow;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    this.body = make(g.body.colored, mat, MAX_ZOMBIES, true);
    this.head = make(g.head.colored, mat, MAX_ZOMBIES, true);
    this.arms = make(g.arm.colored, mat, MAX_ZOMBIES * 2, false);
    this.legs = make(g.leg.colored, mat, MAX_ZOMBIES * 2, false);
    this.outlines = [
      make(g.body.outline, ink, MAX_ZOMBIES, false),
      make(g.head.outline, ink, MAX_ZOMBIES, false),
      make(g.arm.outline, ink, MAX_ZOMBIES * 2, false),
      make(g.leg.outline, ink, MAX_ZOMBIES * 2, false),
    ];

    this.root.add(this.pose);
    this.pose.add(this.torso, this.legL, this.legR);
    this.torso.add(this.neck, this.armL, this.armR);
    this.neck.position.set(0, 1.08, 0.04);
    this.armL.position.set(0.37, 0.84, 0.03);
    this.armR.position.set(-0.37, 0.84, 0.03);
    this.armL.rotation.order = 'YXZ';
    this.armR.rotation.order = 'YXZ';
    this.legL.position.set(0.17, 0.32, 0);
    this.legR.position.set(-0.17, 0.32, 0);
  }

  update(
    dt: number,
    prev: readonly ZombieSnap[],
    curr: readonly ZombieSnap[],
    alpha: number,
    time: number,
    tint: (z: ZombieSnap, out: THREE.Color) => void,
  ): void {
    this.frame++;
    const prevById = new Map<number, ZombieSnap>();
    for (const z of prev) prevById.set(z.id, z);

    let n = 0;
    for (const z of curr) {
      if (n >= MAX_ZOMBIES) break;
      const p = prevById.get(z.id) ?? z;
      let a = this.anim.get(z.id);
      if (!a) {
        a = { walk: Math.random() * 6, seen: 0 };
        this.anim.set(z.id, a);
      }
      a.seen = this.frame;
      a.walk += dt * (2 + z.speed * 2.5);

      this.poseZombie(z, a, time);
      this.root.position.set(lerp(p.x, z.x, alpha), lerp(p.y, z.y, alpha), lerp(p.z, z.z, alpha));
      this.root.rotation.set(0, lerpAngle(p.rot, z.rot, alpha), 0);
      this.root.updateMatrixWorld(true);

      this.body.setMatrixAt(n, this.torso.matrixWorld);
      this.head.setMatrixAt(n, this.neck.matrixWorld);
      this.arms.setMatrixAt(n * 2, this.armL.matrixWorld);
      this.arms.setMatrixAt(n * 2 + 1, this.armR.matrixWorld);
      this.legs.setMatrixAt(n * 2, this.legL.matrixWorld);
      this.legs.setMatrixAt(n * 2 + 1, this.legR.matrixWorld);
      this.outlines[0].setMatrixAt(n, this.torso.matrixWorld);
      this.outlines[1].setMatrixAt(n, this.neck.matrixWorld);
      this.outlines[2].setMatrixAt(n * 2, this.armL.matrixWorld);
      this.outlines[2].setMatrixAt(n * 2 + 1, this.armR.matrixWorld);
      this.outlines[3].setMatrixAt(n * 2, this.legL.matrixWorld);
      this.outlines[3].setMatrixAt(n * 2 + 1, this.legR.matrixWorld);

      tint(z, this.color);
      if (z.hurt > 0) this.color.lerp(this.hurtColor, z.hurt * 0.7);
      this.body.setColorAt(n, this.color);
      this.head.setColorAt(n, this.color);
      this.arms.setColorAt(n * 2, this.color);
      this.arms.setColorAt(n * 2 + 1, this.color);
      this.legs.setColorAt(n * 2, this.color);
      this.legs.setColorAt(n * 2 + 1, this.color);
      n++;
    }

    for (const m of [this.body, this.head, ...this.outlines.slice(0, 2)]) m.count = n;
    for (const m of [this.arms, this.legs, ...this.outlines.slice(2)]) m.count = n * 2;
    for (const m of [this.body, this.head, this.arms, this.legs, ...this.outlines]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }

    for (const [id, a] of this.anim) if (a.seen !== this.frame) this.anim.delete(id);
  }

  private poseZombie(z: ZombieSnap, a: Anim, time: number): void {
    const stride = clamp(z.speed / ZOMBIE.speed, 0, 1);
    const s = Math.sin(a.walk);
    const c = Math.cos(a.walk);
    const wobble = Math.sin(time * 1.3 + z.id) * 0.05;

    this.pose.position.set(0, 0, 0);
    this.pose.rotation.set(0, 0, 0);
    this.legL.rotation.set(s * 0.7 * stride, 0, 0);
    this.legR.rotation.set(-s * 0.7 * stride, 0, 0);
    this.torso.position.set(0, Math.abs(c) * 0.06 * stride, 0);
    this.torso.rotation.set(0.15 + stride * 0.1, 0, s * 0.14 * stride + wobble);
    // Droopy, lolling head.
    this.neck.rotation.set(0.1, Math.sin(time * 0.8 + z.id) * 0.2, 0.3 * Math.sin(z.id) + Math.sin(time * 2 + z.id) * 0.05);
    // Classic zombie arms-forward reach.
    this.armL.rotation.set(-1.35 + s * 0.25, 0, 0.15);
    this.armR.rotation.set(-1.35 - s * 0.25, 0, -0.15);

    switch (z.state) {
      case 'bite': {
        const k = z.t < 0.55 ? z.t / 0.55 : 1 - (z.t - 0.55) / 0.45;
        this.torso.rotation.x = 0.15 + 0.45 * k;
        this.neck.rotation.x = -0.4 * k;
        this.armL.rotation.x = -1.6 - 0.3 * k;
        this.armR.rotation.x = -1.6 - 0.3 * k;
        break;
      }
      case 'lunge':
        this.torso.rotation.x = 0.55;
        this.armL.rotation.x = -1.75;
        this.armR.rotation.x = -1.75;
        break;
      case 'stun':
        this.torso.rotation.z = Math.sin(time * 30) * 0.25;
        this.neck.rotation.z += Math.sin(time * 25) * 0.3;
        break;
      case 'dying': {
        // Topple backwards, then sink into the ground.
        const fall = Math.min(1, z.t / 0.3);
        this.pose.rotation.x = (-fall * Math.PI) / 2;
        this.pose.position.y = fall * 0.4 - Math.max(0, (z.t - 0.55) / 0.45) * 0.9;
        this.armL.rotation.x = -2.8;
        this.armR.rotation.x = -2.8;
        this.legL.rotation.x = -0.6;
        this.legR.rotation.x = -0.9;
        break;
      }
      default:
        break;
    }
  }
}
