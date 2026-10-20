import * as THREE from 'three';
import type { GameMap } from '../sim/gameMap';
import type { StoryItemKind, StorySnap } from '../sim/types';
import { addOutline, disposeObject, toon } from './toon';

const ITEM_GLOW: Record<StoryItemKind, number> = { battery: 0xffe066, lotus: 0xff9fd0, glowcap: 0x7affd8 };

/** Story mode extras: items to collect, the zone to defend, and a light beam over the objective. */
export class StoryView {
  readonly group = new THREE.Group();
  private readonly items = new Map<number, THREE.Group>();
  private readonly zone: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private zoneR = 0;
  private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;

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
