import * as THREE from 'three';
import { SURVIVOR } from '../config';
import { clamp, damp, lerp } from '../core/math';
import type { PandaVariant, WeaponType } from '../sim/types';
import { addOutline, sharedGeometry, toon } from './toon';
import { buildWeapon, HOLD_ANGLE } from './weaponModels';

interface Palette {
  fur: number;
  dark: number;
  muzzle: number;
  patch: number;
  band: number;
  cheek: number;
  tail: number;
  /** Set for ringed (red panda) tails. */
  ring?: number;
}

export const PANDA_LOOKS: Record<PandaVariant, { label: string; palette: Palette; zombieTint: number }> = {
  giant: {
    label: 'Giant Panda',
    palette: { fur: 0xfaf7f2, dark: 0x2a2523, muzzle: 0xffffff, patch: 0x2a2523, band: 0x2a2523, cheek: 0xffa3b5, tail: 0xfaf7f2 },
    zombieTint: 0xffffff,
  },
  red: {
    label: 'Red Panda',
    palette: { fur: 0xd0612e, dark: 0x3d2219, muzzle: 0xfff3e2, patch: 0x8e3816, band: 0xd0612e, cheek: 0xff9f8a, tail: 0xd0612e, ring: 0xf0c08f },
    zombieTint: 0xffa47a,
  },
  brown: {
    label: 'Brown Panda',
    palette: { fur: 0xf2e6d2, dark: 0x6f4b33, muzzle: 0xfffaf0, patch: 0x6f4b33, band: 0x6f4b33, cheek: 0xffa3a3, tail: 0xf2e6d2 },
    zombieTint: 0xe6cfb0,
  },
  ink: {
    label: 'Ink Panda',
    palette: { fur: 0x34303b, dark: 0xf5f1e8, muzzle: 0x4a4552, patch: 0xf5f1e8, band: 0xf5f1e8, cheek: 0xff8fb8, tail: 0x34303b },
    zombieTint: 0x8a8597,
  },
};

export interface PandaPose {
  speed: number;
  attackT: number;
  dashing: boolean;
  downed: boolean;
  /** Damage flash 0..1. */
  hurt: number;
}

const NOSE = 0x1d1a1a;

interface PandaGeos {
  sphere: THREE.SphereGeometry;
  band: THREE.SphereGeometry;
  arm: THREE.CapsuleGeometry;
  leg: THREE.CapsuleGeometry;
  smile: THREE.TorusGeometry;
}
let geoCache: PandaGeos | null = null;
const geos = (): PandaGeos =>
  (geoCache ??= {
    sphere: sharedGeometry(new THREE.SphereGeometry(1, 20, 14)),
    band: sharedGeometry(new THREE.SphereGeometry(1, 20, 6, 0, Math.PI * 2, 0.62, 0.42)),
    arm: sharedGeometry(new THREE.CapsuleGeometry(0.11, 0.2, 4, 10)),
    leg: sharedGeometry(new THREE.CapsuleGeometry(0.13, 0.12, 4, 10)),
    smile: sharedGeometry(new THREE.TorusGeometry(0.04, 0.01, 4, 12, Math.PI)),
  });

const easeOut = (u: number) => 1 - (1 - u) * (1 - u);
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

/**
 * A chubby panda built from spheres and capsules, with procedural animation.
 * Faces +Z, feet at y = 0, about 1.5 m tall.
 */
export class PandaModel {
  readonly root = new THREE.Group();
  private readonly pose = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly tail = new THREE.Group();
  private readonly holder = new THREE.Group();
  private readonly eyes: THREE.Group[] = [];
  private readonly armRBase: THREE.Vector3;
  private weapon: WeaponType;
  private walk = 0;
  private stride = 0;
  private lean = 0;
  private down = 0;
  private idle = Math.random() * 10;
  private blink = 1 + Math.random() * 3;

  constructor(
    readonly variant: PandaVariant,
    weapon: WeaponType,
  ) {
    this.weapon = weapon;
    const P = PANDA_LOOKS[variant].palette;
    const G = geos();
    const blob = (
      parent: THREE.Object3D,
      color: number,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      outline = false,
      geo: THREE.BufferGeometry = G.sphere,
    ) => {
      const m = new THREE.Mesh(geo, toon(color));
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.castShadow = true;
      parent.add(m);
      if (outline) addOutline(m, 1.07);
      return m;
    };

    this.root.add(this.pose);
    this.pose.add(this.body, this.legL, this.legR);

    for (const [leg, side] of [
      [this.legL, 1],
      [this.legR, -1],
    ] as const) {
      leg.position.set(0.17 * side, 0.32, 0);
      const m = new THREE.Mesh(G.leg, toon(P.dark));
      m.position.y = -0.15;
      m.castShadow = true;
      leg.add(m);
      addOutline(m, 1.12);
    }

    // Torso, with the classic black shoulder band.
    blob(this.body, P.fur, 0, 0.6, 0, 0.42, 0.43, 0.4, true);
    if (P.band !== P.fur) blob(this.body, P.band, 0, 0.6, 0, 0.425, 0.435, 0.405, false, G.band);

    this.tail.position.set(0, 0.42, -0.36);
    this.body.add(this.tail);
    if (P.ring !== undefined) {
      for (let i = 0; i < 6; i++) {
        const r = 0.13 - i * 0.008;
        blob(this.tail, i % 2 ? P.ring : P.tail, 0, 0.03 * i + 0.01 * i * i, -0.12 * i, r, r, r, true);
      }
    } else {
      blob(this.tail, P.tail, 0, 0, 0, 0.09, 0.09, 0.09, true);
    }

    // Head.
    this.head.position.set(0, 1.13, 0.04);
    this.body.add(this.head);
    const H = this.head;
    blob(H, P.fur, 0, 0, 0, 0.375, 0.355, 0.36, true);
    for (const s of [1, -1]) {
      blob(H, P.dark, 0.24 * s, 0.28, -0.04, 0.11, 0.11, 0.066, true);
      const patch = blob(H, P.patch, 0.135 * s, 0.03, 0.305, 0.078, 0.1, 0.045);
      patch.rotation.z = 0.45 * s;

      const eye = new THREE.Group();
      eye.position.set(0.13 * s, 0.05, 0.335);
      H.add(eye);
      blob(eye, 0xffffff, 0, 0, 0, 0.05, 0.05, 0.04);
      blob(eye, 0x1b1716, 0, -0.005, 0.027, 0.034, 0.034, 0.025);
      blob(eye, 0xffffff, -0.012 * s, 0.015, 0.048, 0.012, 0.012, 0.008);
      this.eyes.push(eye);

      blob(H, P.cheek, 0.215 * s, -0.08, 0.285, 0.055, 0.033, 0.02);
    }
    blob(H, P.muzzle, 0, -0.09, 0.29, 0.16, 0.11, 0.105, true);
    blob(H, NOSE, 0, -0.045, 0.385, 0.06, 0.04, 0.035);
    const smile = new THREE.Mesh(G.smile, toon(NOSE));
    smile.position.set(0, -0.11, 0.385);
    smile.rotation.z = Math.PI;
    H.add(smile);

    // Arms pivot at the shoulder; rotation order YXZ = pitch first, then yaw around the body.
    for (const [arm, side] of [
      [this.armL, 1],
      [this.armR, -1],
    ] as const) {
      arm.position.set(0.37 * side, 0.79, 0.03);
      arm.rotation.order = 'YXZ';
      this.body.add(arm);
      const m = new THREE.Mesh(G.arm, toon(P.dark));
      m.position.y = -0.16;
      m.castShadow = true;
      arm.add(m);
      addOutline(m, 1.14);
    }
    this.armRBase = this.armR.position.clone();

    this.holder.position.set(0, -0.34, 0.02);
    this.armR.add(this.holder);
    this.setWeapon(weapon, true);
  }

  setWeapon(type: WeaponType, force = false): void {
    if (type === this.weapon && !force) return;
    this.weapon = type;
    this.holder.clear();
    this.holder.rotation.x = HOLD_ANGLE[type];
    this.holder.add(buildWeapon(type));
  }

  /** Hide the javelin once it has been thrown. */
  setWeaponVisible(visible: boolean): void {
    this.holder.visible = visible;
  }

  update(dt: number, pose: PandaPose): void {
    const moving = pose.speed > 0.25 && !pose.downed;
    this.stride = lerp(this.stride, moving ? Math.min(1, pose.speed / SURVIVOR.speed) : 0, damp(12, dt));
    if (moving) this.walk += dt * (5 + pose.speed * 2.2);
    this.idle += dt;
    const st = this.stride;
    const s = Math.sin(this.walk);
    const c = Math.cos(this.walk);

    this.legL.rotation.x = s * 0.8 * st;
    this.legR.rotation.x = -s * 0.8 * st;

    // Waddle: bob, sway, lean into the walk (a lot more when dashing).
    this.lean = lerp(this.lean, pose.dashing ? 0.45 : 0.1 * st, damp(14, dt));
    this.body.position.y = Math.abs(c) * 0.07 * st + Math.sin(this.idle * 2.2) * 0.012;
    this.body.rotation.set(this.lean, 0, s * 0.09 * st);

    this.head.rotation.set(-this.lean * 0.5, Math.sin(this.idle * 0.7) * 0.15 * (1 - st), -s * 0.06 * st);
    this.tail.rotation.y = Math.sin(this.idle * 3 + this.walk) * 0.35;

    const armsBack = pose.dashing ? 0.9 : 0;
    this.armL.rotation.set(-s * 0.7 * st + armsBack, 0, 0.2);
    this.armR.rotation.set(s * 0.7 * st + armsBack, 0, -0.2);
    this.armR.position.copy(this.armRBase);
    if (pose.attackT >= 0 && !pose.downed) this.poseAttack(clamp(pose.attackT, 0, 1));

    // Downed: flop onto the back and wave the arms and legs for help.
    this.down = lerp(this.down, pose.downed ? 1 : 0, damp(10, dt));
    this.pose.rotation.x = (-this.down * Math.PI) / 2;
    this.pose.position.y = this.down * 0.4;
    if (pose.downed) {
      const flail = Math.sin(this.idle * 9);
      this.armL.rotation.set(-2.6 + flail * 0.4, 0, 0.5);
      this.armR.rotation.set(-2.6 - flail * 0.4, 0, -0.5);
      this.legL.rotation.x = -0.8 + flail * 0.3;
      this.legR.rotation.x = -0.8 - flail * 0.3;
      this.head.rotation.y = Math.sin(this.idle * 2) * 0.4;
    }

    // Squash on taking damage.
    const h = pose.hurt;
    this.pose.scale.set(1 + h * 0.15, 1 - h * 0.15, 1 + h * 0.15);

    this.blink -= dt;
    if (this.blink < -0.12) this.blink = 2 + Math.random() * 3;
    const eyeY = this.blink < 0 || pose.hurt > 0.6 ? 0.15 : 1;
    for (const e of this.eyes) e.scale.y = eyeY;
  }

  private poseAttack(t: number): void {
    if (this.weapon === 'knife') {
      // Wind up to the right, slash across, recover.
      let yaw: number;
      let pitch = -1.25;
      if (t < 0.25) yaw = lerp(0, -1.1, easeOut(seg(t, 0, 0.25)));
      else if (t < 0.55) yaw = lerp(-1.1, 1.0, easeOut(seg(t, 0.25, 0.55)));
      else {
        const r = easeOut(seg(t, 0.55, 1));
        yaw = lerp(1.0, 0, r);
        pitch = lerp(-1.25, 0, r);
      }
      this.armR.rotation.set(pitch, yaw, 0);
      this.body.rotation.y = yaw * 0.25;
    } else if (this.weapon === 'axe') {
      // Raise overhead, chop down hard, recover.
      let pitch: number;
      if (t < 0.4) pitch = lerp(0, -3.3, easeOut(seg(t, 0, 0.4)));
      else if (t < 0.6) {
        const u = seg(t, 0.4, 0.6);
        pitch = lerp(-3.3, -0.8, u * u);
      } else pitch = lerp(-0.8, 0, easeOut(seg(t, 0.6, 1)));
      this.armR.rotation.set(pitch, 0.25, 0);
      this.armL.rotation.set(pitch, -0.25, 0);
      if (t > 0.45 && t < 0.75) this.body.rotation.x = this.lean + 0.2;
    } else {
      // Javelin: arm back, then hurl over the shoulder.
      let pitch: number;
      if (t < 0.4) pitch = lerp(0, 0.9, easeOut(seg(t, 0, 0.4)));
      else if (t < 0.6) pitch = lerp(0.9, -1.6, easeOut(seg(t, 0.4, 0.6)));
      else pitch = lerp(-1.6, 0, easeOut(seg(t, 0.6, 1)));
      this.armR.rotation.set(pitch - 0.3, 0, -0.2);
      this.body.rotation.y = t < 0.45 ? -0.35 : lerp(-0.35, 0.2, seg(t, 0.45, 0.6));
    }
  }
}
