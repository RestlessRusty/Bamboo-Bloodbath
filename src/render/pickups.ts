import * as THREE from 'three';
import { lerp } from '../core/math';
import type { GameMap } from '../sim/gameMap';
import type { SpotProp } from '../sim/props';
import type { CrackerDropSnap, CrackerSnap, JavelinSnap, Snapshot, WeaponType } from '../sim/types';
import { bake, part, type Part } from './open/bake';
import { addOutline, outlineMaterial, toon, toonGradient } from './toon';
import { buildWeapon } from './weaponModels';

/** With more snack spots than this (the open world has hundreds), they're drawn instanced instead. */
const MANY_SNACKS = 40;
/** Instanced snacks are only drawn this close to the camera's focus… */
const SNACK_RANGE = 70;
/** …and at most this many at once. */
const SNACK_DRAWN = 64;

interface RackView {
  holder: THREE.Group;
  glow: THREE.Mesh;
  weapon: WeaponType | null;
}

/** Firecracker bundle parts, shared by every firecracker on this map (freed with the map). */
interface CrackerGeos {
  stick: THREE.BufferGeometry;
  band: THREE.BufferGeometry;
  fuse: THREE.BufferGeometry;
}

/** Bamboo snacks, weapon racks, javelins and firecrackers lying around or flying. */
export class PickupsView {
  readonly group = new THREE.Group();
  private readonly snacks: THREE.Group[] = [];
  private readonly snackBatch: SnackBatch | null = null;
  private readonly racks: RackView[] = [];
  private readonly javelins = new Map<number, THREE.Group>();
  private readonly thrown = new Map<number, THREE.Group>();
  private readonly drops = new Map<number, THREE.Group>();
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: 0x9cff7a, transparent: true, opacity: 0.5, depthWrite: false });
  private readonly rackGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.5, depthWrite: false });
  private readonly dropGlowMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.5, depthWrite: false });
  private readonly ring: THREE.BufferGeometry;
  private readonly crackerGeos: CrackerGeos = {
    stick: new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8),
    band: new THREE.CylinderGeometry(0.064, 0.064, 0.06, 8),
    fuse: new THREE.CylinderGeometry(0.012, 0.012, 0.14, 4),
  };

  constructor(map: GameMap) {
    const ring = new THREE.RingGeometry(0.45, 0.62, 24).rotateX(-Math.PI / 2);
    this.ring = ring;

    if (map.props.bambooSpots.length > MANY_SNACKS) {
      this.snackBatch = new SnackBatch(map.props.bambooSpots, ring, this.glowMat);
      this.group.add(...this.snackBatch.meshes);
    }
    // One group of meshes per snack: fine for the dozen or two of a normal map.
    const spots = this.snackBatch ? [] : map.props.bambooSpots;
    for (const spot of spots) {
      const g = new THREE.Group();
      g.position.set(spot.x, spot.y, spot.z);
      const glow = new THREE.Mesh(ring, this.glowMat);
      glow.position.y = 0.05;
      g.add(glow);
      const snack = buildSnack();
      snack.name = 'snack';
      g.add(snack);
      this.group.add(g);
      this.snacks.push(g);
    }

    for (const rack of map.props.racks) {
      const g = new THREE.Group();
      g.position.set(rack.x, rack.y, rack.z);
      g.rotation.y = Math.atan2(map.layout.goal.x - rack.x, map.layout.goal.z - rack.z);
      g.add(buildRackFrame());
      const glow = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32).rotateX(-Math.PI / 2), this.rackGlowMat);
      glow.position.y = 0.05;
      g.add(glow);
      const holder = new THREE.Group();
      holder.position.set(0, 1.45, 0);
      g.add(holder);
      this.group.add(g);
      this.racks.push({ holder, glow, weapon: null });
    }
  }

  /** `focus`: where the camera looks (only needed with many snack spots: the near ones get drawn). */
  update(time: number, prev: Snapshot, curr: Snapshot, alpha: number, focus?: { x: number; z: number }): void {
    this.snackBatch?.update(time, curr.bamboo, focus);
    this.snacks.forEach((g, i) => {
      const active = curr.bamboo[i] ?? true;
      g.visible = active;
      const snack = g.getObjectByName('snack');
      if (snack) {
        snack.position.y = 0.35 + Math.sin(time * 2.4 + i) * 0.08;
        snack.rotation.y = time * 1.2 + i;
      }
    });
    this.glowMat.opacity = 0.35 + 0.2 * Math.sin(time * 3);
    this.rackGlowMat.opacity = 0.3 + 0.2 * Math.sin(time * 2.2);

    // An empty rack (someone just took from it) shows just its frame until it's stocked again.
    this.racks.forEach((r, i) => {
      const w = curr.racks[i] ?? null;
      if (w && w !== r.weapon) {
        r.holder.clear();
        r.holder.add(buildWeapon(w));
        r.weapon = w;
      }
      r.holder.visible = w !== null;
      r.glow.visible = w !== null;
      r.holder.rotation.y = Math.sin(time * 1.5 + i) * 0.5;
    });

    const prevById = new Map<number, JavelinSnap>();
    for (const j of prev.javelins) prevById.set(j.id, j);
    const seen = new Set<number>();
    for (const j of curr.javelins) {
      seen.add(j.id);
      let view = this.javelins.get(j.id);
      if (!view) {
        view = buildFlyingJavelin();
        this.javelins.set(j.id, view);
        this.group.add(view);
      }
      const p = prevById.get(j.id);
      const a = p && p.flying === j.flying ? alpha : 1;
      const from = p ?? j;
      view.position.set(lerp(from.x, j.x, a), lerp(from.y, j.y, a), lerp(from.z, j.z, a));
      view.rotation.set(-j.pitch, j.yaw, 0);
    }
    for (const [id, view] of this.javelins) {
      if (seen.has(id)) continue;
      this.group.remove(view);
      this.javelins.delete(id);
    }

    this.updateThrown(time, prev.crackers, curr.crackers, alpha);
    this.updateDrops(time, curr.crackerDrops);
  }

  /** Firecrackers in the air (tumbling) or crackling on the ground (jittering). */
  private updateThrown(time: number, prev: readonly CrackerSnap[], curr: readonly CrackerSnap[], alpha: number): void {
    const seen = new Set<number>();
    for (const c of curr) {
      seen.add(c.id);
      let view = this.thrown.get(c.id);
      if (!view) {
        view = buildCracker(this.crackerGeos);
        this.thrown.set(c.id, view);
        this.group.add(view);
      }
      const p = prev.find((o) => o.id === c.id);
      const a = p && p.flying === c.flying ? alpha : 1;
      const from = p ?? c;
      view.position.set(lerp(from.x, c.x, a), lerp(from.y, c.y, a), lerp(from.z, c.z, a));
      if (c.flying) {
        view.rotation.set(time * 9 + c.id, 0, time * 7);
      } else {
        // Lying on its side, hopping about as it pops.
        view.position.y += Math.abs(Math.sin(time * 37 + c.id)) * 0.05;
        view.rotation.set(Math.sin(time * 29) * 0.15, c.id, Math.PI / 2 - 0.15 + Math.sin(time * 23) * 0.2);
      }
    }
    for (const [id, view] of this.thrown) {
      if (seen.has(id)) continue;
      this.group.remove(view);
      this.thrown.delete(id);
    }
  }

  /** Firecrackers dropped by zombies: bobbing, with an orange glow, like the bamboo snacks. */
  private updateDrops(time: number, curr: readonly CrackerDropSnap[]): void {
    const seen = new Set<number>();
    for (const d of curr) {
      seen.add(d.id);
      let view = this.drops.get(d.id);
      if (!view) {
        view = new THREE.Group();
        const glow = new THREE.Mesh(this.ring, this.dropGlowMat);
        glow.position.y = 0.05;
        view.add(glow);
        const bundle = buildCracker(this.crackerGeos);
        bundle.name = 'bundle';
        view.add(bundle);
        this.drops.set(d.id, view);
        this.group.add(view);
      }
      view.position.set(d.x, d.y, d.z);
      const bundle = view.getObjectByName('bundle');
      if (bundle) {
        bundle.position.y = 0.3 + Math.sin(time * 2.6 + d.id) * 0.08;
        bundle.rotation.y = time * 1.4 + d.id;
      }
    }
    this.dropGlowMat.opacity = 0.35 + 0.2 * Math.sin(time * 3.4);
    for (const [id, view] of this.drops) {
      if (seen.has(id)) continue;
      this.group.remove(view);
      this.drops.delete(id);
    }
  }
}

/** Three red sticks with gold bands and a fuse, standing upright (y from 0 to ~0.4). */
function buildCracker(geos: CrackerGeos): THREE.Group {
  const g = new THREE.Group();
  const offsets: readonly [number, number][] = [
    [-0.065, -0.035],
    [0.065, -0.035],
    [0, 0.07],
  ];
  for (const [x, z] of offsets) {
    const stick = new THREE.Mesh(geos.stick, toon(0xd8312b));
    stick.position.set(x, 0.15, z);
    stick.castShadow = true;
    g.add(stick);
    addOutline(stick, 1.14);
    const band = new THREE.Mesh(geos.band, toon(0xffd34d));
    band.position.set(x, 0.15, z);
    g.add(band);
  }
  const fuse = new THREE.Mesh(geos.fuse, toon(0x3b2a20));
  fuse.position.set(0.02, 0.36, 0.02);
  fuse.rotation.z = -0.4;
  g.add(fuse);
  return g;
}

/**
 * Hundreds of bamboo snacks (the open world): the snack baked into one vertex-coloured geometry, drawn
 * as three instanced meshes (snack, ink, glow ring) holding only the ones near the camera.
 */
class SnackBatch {
  readonly meshes: THREE.InstancedMesh[];
  private readonly body: THREE.InstancedMesh;
  private readonly ink: THREE.InstancedMesh;
  private readonly glow: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();

  constructor(
    private readonly spots: readonly SpotProp[],
    ring: THREE.BufferGeometry,
    glowMat: THREE.Material,
  ) {
    const { body, ink } = bakeSnack();
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonGradient() });
    this.body = new THREE.InstancedMesh(body, mat, SNACK_DRAWN);
    this.body.castShadow = true;
    this.ink = new THREE.InstancedMesh(ink, outlineMaterial(), SNACK_DRAWN);
    this.glow = new THREE.InstancedMesh(ring, glowMat, SNACK_DRAWN);
    this.meshes = [this.glow, this.body, this.ink];
    for (const mesh of this.meshes) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
  }

  /** Bobbing and turning like the single snacks; eaten ones (`bamboo[i]` false) are left out. */
  update(time: number, bamboo: readonly boolean[], focus?: { x: number; z: number }): void {
    const m = this.m;
    let n = 0;
    for (let i = 0; i < this.spots.length && n < SNACK_DRAWN; i++) {
      if (!(bamboo[i] ?? true)) continue;
      const s = this.spots[i];
      if (focus && (Math.abs(s.x - focus.x) > SNACK_RANGE || Math.abs(s.z - focus.z) > SNACK_RANGE)) continue;
      m.makeRotationY(time * 1.2 + i).setPosition(s.x, s.y + 0.35 + Math.sin(time * 2.4 + i) * 0.08, s.z);
      this.body.setMatrixAt(n, m);
      this.ink.setMatrixAt(n, m);
      this.glow.setMatrixAt(n, m.makeTranslation(s.x, s.y + 0.05, s.z));
      n++;
    }
    for (const mesh of this.meshes) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

/** The same snack as buildSnack(), as one geometry coloured per vertex plus the stalks' ink hulls. */
function bakeSnack(): { body: THREE.BufferGeometry; ink: THREE.BufferGeometry } {
  const parts: Part[] = [];
  const stalk = (h: number, x: number, z: number, tilt: number) =>
    parts.push(part(new THREE.CylinderGeometry(0.06, 0.07, h, 6), 0x8cc84b, x, h / 2, z, { rz: tilt, ink: 1.15 }));
  stalk(0.5, 0, 0, 0);
  stalk(0.42, 0.1, 0.04, -0.2);
  stalk(0.36, -0.08, 0.06, 0.25);
  parts.push(part(new THREE.TorusGeometry(0.13, 0.025, 6, 16).rotateX(Math.PI / 2), 0xe2463f, 0, 0.18, 0));
  for (const s of [1, -1]) parts.push(part(new THREE.ConeGeometry(0.06, 0.32, 3), 0x5fb347, 0.1 * s, 0.5, 0, { rz: -0.9 * s, sz: 0.3 }));
  const { body, ink } = bake(parts);
  return { body, ink: ink! };
}

function buildSnack(): THREE.Group {
  const g = new THREE.Group();
  const stalk = (h: number, x: number, z: number, tilt: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, h, 6), toon(0x8cc84b));
    m.position.set(x, h / 2, z);
    m.rotation.z = tilt;
    m.castShadow = true;
    g.add(m);
    addOutline(m, 1.15);
  };
  stalk(0.5, 0, 0, 0);
  stalk(0.42, 0.1, 0.04, -0.2);
  stalk(0.36, -0.08, 0.06, 0.25);
  const ribbon = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 16).rotateX(Math.PI / 2), toon(0xe2463f));
  ribbon.position.y = 0.18;
  g.add(ribbon);
  for (const s of [1, -1]) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 3), toon(0x5fb347));
    leaf.position.set(0.1 * s, 0.5, 0);
    leaf.rotation.z = -0.9 * s;
    leaf.scale.z = 0.3;
    g.add(leaf);
  }
  return g;
}

function buildRackFrame(): THREE.Group {
  const g = new THREE.Group();
  const wood = toon(0x9a6a3a);
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, wood);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    addOutline(m, 1.08);
  };
  add(new THREE.CylinderGeometry(0.07, 0.08, 1.7, 6), -0.55, 0.85, 0);
  add(new THREE.CylinderGeometry(0.07, 0.08, 1.7, 6), 0.55, 0.85, 0);
  add(new THREE.BoxGeometry(1.35, 0.12, 0.12), 0, 1.62, 0);
  add(new THREE.BoxGeometry(1.4, 0.12, 0.5), 0, 0.06, 0);
  return g;
}

/** Javelin oriented so its tip points along +Z of the group. */
function buildFlyingJavelin(): THREE.Group {
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const inner = buildWeapon('javelin');
  inner.rotation.x = -Math.PI / 2;
  inner.position.z = 0.25;
  g.add(inner);
  return g;
}
