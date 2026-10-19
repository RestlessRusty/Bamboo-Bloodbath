import * as THREE from 'three';
import { lerp } from '../core/math';
import type { GameMap } from '../sim/gameMap';
import type { JavelinSnap, Snapshot, WeaponType } from '../sim/types';
import { addOutline, toon } from './toon';
import { buildWeapon } from './weaponModels';

interface RackView {
  holder: THREE.Group;
  weapon: WeaponType | null;
}

/** Bamboo snacks, weapon racks and javelins lying around or flying. */
export class PickupsView {
  readonly group = new THREE.Group();
  private readonly snacks: THREE.Group[] = [];
  private readonly racks: RackView[] = [];
  private readonly javelins = new Map<number, THREE.Group>();
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: 0x9cff7a, transparent: true, opacity: 0.5, depthWrite: false });
  private readonly rackGlowMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.5, depthWrite: false });

  constructor(map: GameMap) {
    const ring = new THREE.RingGeometry(0.45, 0.62, 24).rotateX(-Math.PI / 2);

    for (const spot of map.props.bambooSpots) {
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
      this.racks.push({ holder, weapon: null });
    }
  }

  update(time: number, prev: Snapshot, curr: Snapshot, alpha: number): void {
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

    this.racks.forEach((r, i) => {
      const w = curr.racks[i];
      if (w && w !== r.weapon) {
        r.holder.clear();
        r.holder.add(buildWeapon(w));
        r.weapon = w;
      }
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
  }
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
