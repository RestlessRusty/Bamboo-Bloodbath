import * as THREE from 'three';
import { damp, lerpAngle } from '../core/math';
import type { GameMap } from '../sim/gameMap';
import type { StoryDeviceKind, StoryItemKind, StorySnap } from '../sim/types';
import { addOutline, disposeObject, toon } from './toon';

const ITEM_GLOW: Record<StoryItemKind, number> = {
  battery: 0xffe066,
  lotus: 0xff9fd0,
  glowcap: 0x7affd8,
  sack: 0xb6ff5a,
  keycard: 0x7ab8ff,
};
/** MegaSprout green, and the cure's teal. */
const SPROUT = 0x8fe03a;
const CURE = 0x4fd1b0;
/** Matches the mission's default working distance (the ring shows where to stand). */
const DEVICE_RING = 2.6;
const WHEEL_R = 0.42;

interface DeviceView {
  root: THREE.Group;
  /** Turns with progress: lever arm, valve wheel, gate boom. */
  moving: THREE.Object3D | null;
  lamp: THREE.MeshBasicMaterial;
  /** MegaSprout spraying out of a pump that's still on. */
  spray: THREE.Mesh[];
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  fill: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  beam: THREE.Mesh;
  /** Shown open-ness of a gate, eased towards 0 / 1. */
  open: number;
}

interface CartView {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  x: number;
  z: number;
  yaw: number;
  roll: number;
}

/** Story mode extras: items to collect, machinery, the cart, the zone to defend, and a light beam over the objective. */
export class StoryView {
  readonly group = new THREE.Group();
  private readonly items = new Map<number, THREE.Group>();
  private readonly zone: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private zoneR = 0;
  private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private devices: DeviceView[] = [];
  private cart: CartView | null = null;
  private lastTime = -1;

  constructor(private readonly map: GameMap) {
    this.zone = new THREE.Mesh(
      new THREE.RingGeometry(0.94, 1, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7affd8, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    this.zone.visible = false;
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 60, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x9ffff0,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.beam.visible = false;
    this.group.add(this.zone, this.beam);
  }

  update(time: number, s: StorySnap): void {
    const terrain = this.map.terrain;
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;

    const seen = new Set<number>();
    for (const it of s.items) {
      seen.add(it.id);
      let view = this.items.get(it.id);
      if (!view) {
        view = new THREE.Group();
        view.position.set(it.x, it.y, it.z);
        // Each item owns its geometry and material: freed when it's picked up.
        const glow = new THREE.Mesh(
          new THREE.RingGeometry(0.45, 0.62, 24).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: ITEM_GLOW[it.kind], transparent: true, opacity: 0.6, depthWrite: false }),
        );
        glow.position.y = 0.05;
        glow.scale.setScalar(1.4);
        view.add(glow);
        const model = buildItem(it.kind);
        model.name = 'model';
        view.add(model);
        this.items.set(it.id, view);
        this.group.add(view);
      }
      const model = view.getObjectByName('model');
      if (model) {
        model.position.y = 0.45 + Math.sin(time * 2.4 + it.id) * 0.1;
        model.rotation.y = time * 1.3 + it.id;
      }
    }
    for (const [id, view] of this.items) {
      if (seen.has(id)) continue;
      this.group.remove(view);
      disposeObject(view);
      this.items.delete(id);
    }

    this.updateDevices(time, dt, s);
    this.updateCart(dt, s);

    const z = s.zone;
    this.zone.visible = !!z;
    if (z) {
      if (z.r !== this.zoneR) {
        this.zoneR = z.r;
        this.zone.scale.setScalar(z.r);
      }
      this.zone.position.set(z.x, terrain.heightAt(z.x, z.z) + 0.1, z.z);
      // Pulses while nobody is holding it.
      this.zone.material.opacity = s.holding ? 0.75 : 0.35 + 0.35 * Math.abs(Math.sin(time * 4));
    }

    // Beam over the objective, unless the rescue hut's own beam already marks it.
    const t = s.target;
    const { goal, goalStyle } = this.map.layout;
    const atHut = !!t && goalStyle !== 'none' && Math.hypot(t.x - goal.x, t.z - goal.z) < 3;
    this.beam.visible = !!t && !atHut;
    if (t && !atHut) {
      this.beam.position.set(t.x, terrain.heightAt(t.x, t.z) + 30, t.z);
      this.beam.material.opacity = 0.14 + 0.08 * Math.sin(time * 1.7);
    }
  }

  dispose(): void {
    disposeObject(this.group);
  }

  // ---------------------------------------------------------------- machinery

  private updateDevices(time: number, dt: number, s: StorySnap): void {
    if (this.devices.length !== s.devices.length) {
      for (const d of this.devices) {
        this.group.remove(d.root);
        disposeObject(d.root);
      }
      this.devices = s.devices.map((d) => {
        const view = buildDevice(d.kind);
        view.root.position.set(d.x, this.map.terrain.heightAt(d.x, d.z), d.z);
        view.root.rotation.y = d.yaw;
        this.group.add(view.root);
        return view;
      });
    }
    s.devices.forEach((d, i) => {
      const v = this.devices[i];
      if (!v) return;
      const working = d.live && !d.done;
      v.ring.visible = working;
      v.fill.visible = working && d.t > 0;
      v.beam.visible = working;
      if (working) {
        v.ring.material.opacity = d.t > 0 ? 0.85 : 0.35 + 0.35 * Math.abs(Math.sin(time * 4));
        v.fill.scale.setScalar(Math.max(0.01, d.t) * DEVICE_RING);
        (v.beam.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.06 * Math.sin(time * 1.7 + i);
      }
      v.lamp.color.setHex(d.done ? 0x7cff5a : working && Math.sin(time * 8) > 0 ? 0xffb12a : 0xff3b30);
      for (const [k, drop] of v.spray.entries()) {
        drop.visible = !d.done;
        if (d.done) continue;
        // Droplets arcing out of the nozzle into the water.
        const f = (time * 1.2 + k / v.spray.length) % 1;
        drop.position.set(Math.sin(k * 2.3) * 0.3 * f, 2.3 + f * 1.4 - f * f * 3.4, 1.2 + f * 3.2);
      }
      if (d.kind === 'gate') {
        v.open += ((d.done ? 1 : 0) - v.open) * damp(3, dt);
        if (v.moving) v.moving.rotation.x = -v.open * 1.35;
      } else if (v.moving) {
        const f = d.done ? 1 : d.t;
        if (d.kind === 'lever') v.moving.rotation.x = -0.7 + f * 1.4;
        else v.moving.rotation.z = f * Math.PI * 3;
      }
    });
  }

  // ---------------------------------------------------------------- cart

  private updateCart(dt: number, s: StorySnap): void {
    const c = s.cart;
    if (!c) {
      if (this.cart) this.cart.root.visible = false;
      return;
    }
    if (!this.cart) {
      this.cart = { ...buildCart(), x: c.x, z: c.z, yaw: c.yaw, roll: 0 };
      this.group.add(this.cart.root);
    }
    const v = this.cart;
    v.root.visible = true;
    // Ease towards the simulation's cart so it glides between ticks.
    const k = dt > 0 ? damp(14, dt) : 1;
    const px = v.x;
    const pz = v.z;
    v.x += (c.x - v.x) * k;
    v.z += (c.z - v.z) * k;
    v.yaw = lerpAngle(v.yaw, c.yaw, k);
    v.roll += Math.hypot(v.x - px, v.z - pz) / WHEEL_R;
    v.root.position.set(v.x, this.map.terrain.heightAt(v.x, v.z), v.z);
    v.root.rotation.y = v.yaw;
    for (const w of v.wheels) w.rotation.x = v.roll;
  }
}

function buildItem(kind: StoryItemKind): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, outline = 1.12) => {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    if (outline) addOutline(m, outline);
    return m;
  };

  if (kind === 'battery') {
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 12), 0x2b2b30, 0, 0, 0);
    add(new THREE.CylinderGeometry(0.165, 0.165, 0.2, 12), 0xffc93a, 0, 0.12, 0, 0);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 8), 0xd8d8d8, 0, 0.29, 0, 0);
  } else if (kind === 'lotus') {
    // Pink petals around a yellow middle, on a couple of leaves.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const petal = add(new THREE.ConeGeometry(0.1, 0.38, 5), i % 2 ? 0xffb3d6 : 0xff8fc4, Math.cos(a) * 0.12, 0.08, Math.sin(a) * 0.12, 0);
      petal.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
    }
    add(new THREE.SphereGeometry(0.09, 8, 6), 0xffe066, 0, 0.12, 0, 0);
    add(new THREE.CylinderGeometry(0.32, 0.32, 0.03, 12), 0x4f9a55, 0, -0.1, 0, 0);
  } else if (kind === 'sack') {
    // A burlap sack of MegaSprout, tied at the top, with a green label.
    const body = add(new THREE.SphereGeometry(0.3, 12, 10), 0xd8c08a, 0, 0, 0);
    body.scale.set(1, 1.15, 0.85);
    add(new THREE.ConeGeometry(0.14, 0.22, 8), 0xc9ae74, 0, 0.38, 0, 1.08);
    add(new THREE.TorusGeometry(0.09, 0.025, 5, 12).rotateX(Math.PI / 2), 0x7a5238, 0, 0.3, 0, 0);
    add(new THREE.BoxGeometry(0.32, 0.18, 0.04), SPROUT, 0, 0.02, 0.26, 0);
  } else if (kind === 'keycard') {
    // A Bristle Bio keycard: orange card, green stripe, gold chip.
    add(new THREE.BoxGeometry(0.5, 0.32, 0.04), 0xd9662a, 0, 0, 0);
    add(new THREE.BoxGeometry(0.5, 0.07, 0.045), SPROUT, 0, 0.08, 0, 0);
    add(new THREE.BoxGeometry(0.1, 0.08, 0.05), 0xffd34d, -0.14, -0.05, 0, 0);
  } else {
    // Mushroom with a glowing cap.
    add(new THREE.CylinderGeometry(0.07, 0.1, 0.32, 8), 0xf2ead8, 0, -0.04, 0);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x7affd8 }),
    );
    cap.position.y = 0.1;
    cap.scale.y = 0.75;
    g.add(cap);
    add(new THREE.SphereGeometry(0.04, 6, 4), 0xffffff, 0.1, 0.24, 0.06, 0);
    add(new THREE.SphereGeometry(0.035, 6, 4), 0xffffff, -0.08, 0.22, -0.08, 0);
  }
  return g;
}

/** A device, built facing +Z (its `face`), with its working ring and beam. */
function buildDevice(kind: StoryDeviceKind): DeviceView {
  const root = new THREE.Group();
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, outline = 1.06) => {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    parent.add(m);
    if (outline) addOutline(m, outline);
    return m;
  };
  const lamp = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
  const bulb = (x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), lamp);
    m.position.set(x, y, z);
    root.add(m);
  };
  let moving: THREE.Object3D | null = null;
  const spray: THREE.Mesh[] = [];

  if (kind === 'lever') {
    // A control box on a post with a big lever on its side.
    add(root, new THREE.BoxGeometry(0.22, 1.1, 0.22), 0x5f6f7c, 0, 0.55, 0);
    add(root, new THREE.BoxGeometry(0.7, 0.55, 0.4), 0xffc93a, 0, 1.3, 0);
    add(root, new THREE.BoxGeometry(0.72, 0.1, 0.42), 0x2b1e1a, 0, 1.5, 0, 0);
    const pivot = new THREE.Group();
    pivot.position.set(0.42, 1.3, 0);
    root.add(pivot);
    add(pivot, new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), 0x8c8f96, 0, 0.35, 0, 0);
    add(pivot, new THREE.SphereGeometry(0.1, 8, 6), 0xe2463f, 0, 0.72, 0);
    moving = pivot;
    bulb(0, 1.75, 0);
  } else if (kind === 'pump') {
    // A Bristle Bio pump: green tank, a pipe arching over the bank, MegaSprout gushing out.
    add(root, new THREE.BoxGeometry(1.6, 1.1, 1.6), 0x6f7a82, 0, 0.55, 0);
    add(root, new THREE.CylinderGeometry(0.6, 0.6, 1.2, 12), SPROUT, 0, 1.7, 0);
    add(root, new THREE.CylinderGeometry(0.18, 0.18, 1.6, 8).rotateX(Math.PI / 2), 0x8c8f96, 0, 2.2, 0.9);
    add(root, new THREE.CylinderGeometry(0.24, 0.14, 0.4, 8).rotateX(Math.PI / 2), 0x5f6f7c, 0, 2.2, 1.8);
    const wheel = new THREE.Group();
    wheel.position.set(0.85, 0.7, 0);
    wheel.rotation.y = Math.PI / 2;
    root.add(wheel);
    add(wheel, new THREE.TorusGeometry(0.3, 0.05, 6, 14), 0xe2463f, 0, 0, 0, 0);
    moving = wheel;
    const dropMat = new THREE.MeshBasicMaterial({ color: 0xb6ff5a, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 8; i++) {
      const drop = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), dropMat);
      root.add(drop);
      spray.push(drop);
    }
    bulb(0, 2.45, 0);
  } else if (kind === 'valve') {
    // A pipe coming out of the ground with a big red wheel.
    add(root, new THREE.CylinderGeometry(0.28, 0.28, 1.2, 10), 0x6f8a6a, 0, 0.6, 0);
    add(root, new THREE.CylinderGeometry(0.28, 0.28, 1.6, 10).rotateZ(Math.PI / 2), 0x6f8a6a, 0, 1.1, 0);
    const wheel = new THREE.Group();
    wheel.position.set(0, 1.1, 0.45);
    root.add(wheel);
    add(wheel, new THREE.TorusGeometry(0.5, 0.07, 6, 18), 0xe2463f, 0, 0, 0);
    for (let k = 0; k < 3; k++) add(wheel, new THREE.BoxGeometry(1, 0.07, 0.07), 0xe2463f, 0, 0, 0, 0).rotation.z = (k * Math.PI) / 3;
    add(root, new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8).rotateX(Math.PI / 2), 0x8c8f96, 0, 1.1, 0.3, 0);
    moving = wheel;
    bulb(0.5, 1.6, 0);
  } else {
    // Boom barrier: a striped post with a lever box, the boom swinging up across towards `face`.
    add(root, new THREE.CylinderGeometry(0.22, 0.26, 1.3, 10), 0x5f6f7c, 0, 0.65, 0);
    add(root, new THREE.BoxGeometry(0.6, 0.5, 0.5), 0xffc93a, 0, 1.45, 0);
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.25, 0);
    root.add(pivot);
    for (let k = 0; k < 7; k++) {
      add(pivot, new THREE.BoxGeometry(0.16, 0.16, 1), k % 2 ? 0xffffff : 0xe2463f, 0, 0, 0.6 + k, 0);
    }
    moving = pivot;
    bulb(0, 1.8, 0);
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(DEVICE_RING - 0.16, DEVICE_RING, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x7affd8, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  ring.position.y = 0.1;
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x7affd8, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  fill.position.y = 0.08;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.7, 40, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x9ffff0,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  beam.position.y = 20;
  root.add(ring, fill, beam);
  return { root, moving, lamp, spray, ring, fill, beam, open: 0 };
}

/** The delivery cart: a wooden box on four wheels, loaded with teal cure barrels. Rolls along +Z. */
function buildCart(): { root: THREE.Group; wheels: THREE.Object3D[] } {
  const root = new THREE.Group();
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, outline = 1.05) => {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    if (outline) addOutline(m, outline);
    return m;
  };
  add(root, new THREE.BoxGeometry(1.5, 0.12, 2.6), 0x6b4423, 0, 0.5, 0);
  for (const side of [-1, 1]) {
    add(root, new THREE.BoxGeometry(0.1, 0.6, 2.6), 0x9a6a3a, side * 0.72, 0.85, 0);
    add(root, new THREE.BoxGeometry(1.5, 0.6, 0.1), 0x9a6a3a, 0, 0.85, side * 1.27);
  }
  // A green MegaSprout stripe that's been painted over in a hurry.
  add(root, new THREE.BoxGeometry(1.54, 0.16, 1.2), SPROUT, 0, 0.95, 0.2, 0);
  add(root, new THREE.BoxGeometry(1.56, 0.12, 0.5), 0xf4f1ea, 0, 0.95, 0.3, 0);
  for (const [x, z] of [
    [-0.35, -0.7],
    [0.35, -0.7],
    [0, 0.1],
    [-0.35, 0.8],
    [0.35, 0.8],
  ]) {
    add(root, new THREE.CylinderGeometry(0.3, 0.3, 0.8, 12), CURE, x, 1.0, z);
    add(root, new THREE.CylinderGeometry(0.31, 0.31, 0.08, 12), 0x2b1e1a, x, 1.2, z, 0);
  }
  // Push bar at the back.
  add(root, new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6).rotateZ(Math.PI / 2), 0x6b4423, 0, 1.15, -1.6);
  for (const side of [-1, 1]) add(root, new THREE.BoxGeometry(0.06, 0.06, 0.5), 0x6b4423, side * 0.6, 1.05, -1.4, 0);
  const wheels: THREE.Object3D[] = [];
  for (const [x, z] of [
    [-0.82, -0.85],
    [0.82, -0.85],
    [-0.82, 0.85],
    [0.82, 0.85],
  ]) {
    const w = new THREE.Group();
    w.position.set(x, WHEEL_R, z);
    root.add(w);
    add(w, new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.14, 14).rotateZ(Math.PI / 2), 0x4a2e18, 0, 0, 0);
    add(w, new THREE.BoxGeometry(0.16, WHEEL_R * 1.7, 0.08), 0xb07a45, 0, 0, 0, 0);
    wheels.push(w);
  }
  return { root, wheels };
}
