import * as THREE from 'three';
import type { GameMap } from '../sim/gameMap';
import type { Landmark } from '../sim/mapLayout';
import { addOutline, toon, toonGradient } from './toon';

/** Adds a toon box / cylinder / … to the building (local coordinates, door side +Z). */
export type PartFn = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, outline?: number) => THREE.Mesh;
/** Adds a glowing bulb; its material's opacity is blinked by the caller. */
export type LightFn = (color: number, r: number, x: number, y: number, z: number) => THREE.MeshBasicMaterial;

/** MegaSprout green: Bristle Bio's colour. */
const SPROUT = 0x8fe03a;
const BRISTLE_ORANGE = 0xd9662a;

/**
 * Act 2 buildings: Bristle Bio's farm, depot, pump house, glasshouses, HQ and factory.
 * Same conventions as the other landmarks: built facing +Z (door side) inside `b`; `movers` get the time each frame.
 */
export function buildStoryBuilding(
  kind: Landmark['kind'],
  b: THREE.Group,
  part: PartFn,
  light: LightFn,
  blinkers: THREE.MeshBasicMaterial[],
  movers: ((time: number) => void)[],
): void {
  /** A puff of smoke or steam rising from (x, y, z) in a loop. */
  const puffs = (color: number, x: number, y: number, z: number, n: number, size: number) => {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false });
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), mat);
      b.add(p);
      const phase = i / n;
      movers.push((time) => {
        const t = (time * 0.35 + phase) % 1;
        p.position.set(x + Math.sin(phase * 9 + time * 0.5) * 0.4 * t, y + t * 4, z + t * 1.2);
        p.scale.setScalar(0.6 + t * 1.4);
      });
    }
    movers.push((time) => (mat.opacity = 0.55 + 0.1 * Math.sin(time)));
  };
  const glass = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshToonMaterial({ color: 0xcff5ff, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    m.position.set(x, y, z);
    b.add(m);
    return m;
  };
  /** Bristle Bio's sign: an orange disc with a green sprout on a white board. */
  const sign = (x: number, y: number, z: number, scale: number) => {
    part(new THREE.BoxGeometry(2.4 * scale, 0.9 * scale, 0.1), 0xffffff, x, y, z, 1.04);
    part(new THREE.CylinderGeometry(0.34 * scale, 0.34 * scale, 0.06, 16).rotateX(Math.PI / 2), BRISTLE_ORANGE, x - 0.75 * scale, y, z + 0.07, 0);
    part(new THREE.ConeGeometry(0.16 * scale, 0.42 * scale, 5), SPROUT, x - 0.75 * scale, y + 0.05 * scale, z + 0.12, 0);
    part(new THREE.BoxGeometry(1.2 * scale, 0.16 * scale, 0.06), SPROUT, x + 0.35 * scale, y + 0.12 * scale, z + 0.07, 0);
    part(new THREE.BoxGeometry(1.2 * scale, 0.16 * scale, 0.06), 0x2b1e1a, x + 0.35 * scale, y - 0.14 * scale, z + 0.07, 0);
  };

  switch (kind) {
    case 'shed': {
      // Red farm barn with a pile of MegaSprout sacks and a couple of hay bales.
      part(new THREE.BoxGeometry(5, 3, 4.4), 0xb8402e, 0, 1.5, 0);
      part(new THREE.ConeGeometry(3.9, 1.9, 4), 0x6b3a2a, 0, 3.95, 0).rotation.y = Math.PI / 4;
      part(new THREE.BoxGeometry(1.8, 2.2, 0.08), 0x7a2a1e, 0, 1.1, 2.22, 0);
      part(new THREE.BoxGeometry(0.12, 2.6, 0.06), 0xffffff, 0, 1.1, 2.28, 0).rotation.z = 0.68;
      part(new THREE.BoxGeometry(0.12, 2.6, 0.06), 0xffffff, 0, 1.1, 2.28, 0).rotation.z = -0.68;
      for (const [x, z] of [
        [-1.9, 2.9],
        [-1.4, 3.3],
        [-2.3, 3.4],
      ]) {
        const s = part(new THREE.SphereGeometry(0.42, 10, 8), 0xd8c08a, x, 0.32, z);
        s.scale.set(1, 0.75, 0.8);
        part(new THREE.BoxGeometry(0.5, 0.14, 0.05), SPROUT, x, 0.36, z + 0.32, 0);
      }
      for (const x of [1.8, 2.6]) part(new THREE.CylinderGeometry(0.5, 0.5, 0.8, 12).rotateZ(Math.PI / 2), 0xe8cc6a, x, 0.5, 3, 1.05);
      sign(0, 3.4, 2.3, 0.6);
      break;
    }
    case 'silo': {
      part(new THREE.CylinderGeometry(2.2, 2.3, 9, 16), 0xc9d3dc, 0, 4.5, 0);
      part(new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0x9aa8b4, 0, 9, 0);
      part(new THREE.CylinderGeometry(2.26, 2.26, 1, 16), SPROUT, 0, 6.2, 0, 0);
      for (let y = 0.6; y < 9; y += 0.7) part(new THREE.BoxGeometry(0.6, 0.06, 0.06), 0x6f7a82, 0, y, 2.3, 0);
      blinkers.push(light(0xff3b30, 0.16, 0, 11.3, 0));
      break;
    }
    case 'depot': {
      // Warehouse with a loading dock, crates and a big roller door.
      part(new THREE.BoxGeometry(10, 4.5, 7), 0x8fa3b4, 0, 2.25, 0);
      part(new THREE.BoxGeometry(10.4, 0.3, 7.4), 0x5f6f7c, 0, 4.6, 0).rotation.x = 0.06;
      part(new THREE.BoxGeometry(3.4, 3, 0.08), 0x4f5a62, -1.8, 1.5, 3.52, 0);
      for (let y = 0.3; y < 3; y += 0.35) part(new THREE.BoxGeometry(3.4, 0.04, 0.04), 0x3b444b, -1.8, y, 3.58, 0);
      part(new THREE.BoxGeometry(9, 0.8, 2), 0xa89a86, 0, 0.4, 4.4);
      for (const [x, z, s] of [
        [2.6, 4.4, 0.9],
        [3.6, 4.6, 0.7],
        [3.1, 4.3, 0.6],
      ]) {
        part(new THREE.BoxGeometry(s, s, s), 0xb07a45, x, 0.8 + s / 2 + (s < 0.7 ? 0.9 : 0), z, 1.05);
      }
      sign(2.4, 3.6, 3.56, 0.9);
      blinkers.push(light(0xffb12a, 0.14, -4.6, 4.2, 3.6));
      break;
    }
    case 'pumphouse': {
      // Concrete pump house by the water: pipes out the back, a lamp post, warm windows.
      part(new THREE.BoxGeometry(6, 3.5, 5), 0xa7a9a3, 0, 1.75, 0);
      part(new THREE.BoxGeometry(6.4, 0.3, 5.4), 0x6f7270, 0, 3.65, 0);
      part(new THREE.BoxGeometry(1.2, 2.2, 0.08), 0x4a5560, 0, 1.1, 2.52, 0);
      for (const x of [-1.9, 1.9]) {
        part(new THREE.BoxGeometry(1.1, 0.8, 0.08), 0xffd27a, x, 2.1, 2.52, 0);
        part(new THREE.CylinderGeometry(0.4, 0.4, 4, 10).rotateX(Math.PI / 2), 0x6f8a6a, x, 0.7, -3.8);
      }
      part(new THREE.CylinderGeometry(0.08, 0.1, 5.5, 6), 0x4a4f55, 3.6, 2.75, 2.6, 0);
      part(new THREE.BoxGeometry(0.9, 0.12, 0.3), 0x4a4f55, 3.2, 5.5, 2.6, 0);
      blinkers.push(light(0xfff2b0, 0.22, 2.9, 5.35, 2.6));
      break;
    }
    case 'greenhouse': {
      // Glass house on a low brick wall; MegaSprout bamboo bursting out through the roof.
      part(new THREE.BoxGeometry(8, 0.6, 6), 0xb06a4a, 0, 0.3, 0);
      glass(7.8, 2.4, 5.8, 0, 1.8, 0);
      for (const side of [-1, 1]) {
        const roof = glass(8, 0.06, 3.4, 0, 3.6, side * 1.45);
        roof.rotation.x = side * 0.52;
      }
      for (let x = -3.9; x <= 3.95; x += 1.3) part(new THREE.BoxGeometry(0.08, 2.4, 0.08), 0xffffff, x, 1.8, 2.92, 0);
      for (let x = -3.9; x <= 3.95; x += 1.3) part(new THREE.BoxGeometry(0.08, 2.4, 0.08), 0xffffff, x, 1.8, -2.92, 0);
      part(new THREE.BoxGeometry(8, 0.1, 0.1), 0xffffff, 0, 4.42, 0, 0);
      part(new THREE.BoxGeometry(1.1, 2, 0.06), 0x6b8a5a, 0, 1.6, 2.95, 0);
      for (const [x, z, h] of [
        [-2.2, -0.8, 7],
        [-1.6, 0.6, 5.5],
        [1.4, -0.4, 8],
        [2.4, 1, 6],
      ]) {
        part(new THREE.CylinderGeometry(0.16, 0.2, h, 7), SPROUT, x, h / 2 + 0.6, z, 1.1);
        for (let k = 0; k < 3; k++) {
          const leaf = part(new THREE.ConeGeometry(0.22, 1.2, 4), 0x6fc13a, x, h * (0.55 + k * 0.15) + 0.6, z, 0);
          leaf.rotation.set(0.9, k * 2.1, 0);
        }
      }
      break;
    }
    case 'hq': {
      // Bristle Bio HQ: white block, dark glass band, a glass dome with a giant sprout on top.
      part(new THREE.BoxGeometry(11, 6, 7), 0xf1f3f2, 0, 3, 0);
      part(new THREE.BoxGeometry(11.1, 1.2, 7.1), 0x2f4a5a, 0, 4.1, 0, 0);
      part(new THREE.BoxGeometry(11.4, 0.3, 7.4), 0xb8c4cc, 0, 6.15, 0);
      part(new THREE.BoxGeometry(2, 2.6, 0.08), 0x2f4a5a, 0, 1.3, 3.52, 0);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshToonMaterial({ color: 0xcff5ff, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      dome.position.set(0, 6.3, 0);
      b.add(dome);
      part(new THREE.CylinderGeometry(0.3, 0.4, 5, 8), SPROUT, 0, 7.5, 0, 1.08);
      for (let k = 0; k < 4; k++) {
        const leaf = part(new THREE.ConeGeometry(0.5, 2.2, 4), 0x6fc13a, 0, 8.6 + k * 0.5, 0, 1.06);
        leaf.rotation.set(1.1, k * 1.6, 0);
      }
      sign(-3.4, 2.4, 3.56, 1.1);
      blinkers.push(light(SPROUT, 0.16, 4.8, 5.2, 3.6));
      break;
    }
    case 'factory': {
      // Big works with a saw-tooth roof, two smoking chimneys and a crop-duster blimp moored overhead.
      part(new THREE.BoxGeometry(14, 6, 9), 0x9a9f98, 0, 3, 0);
      for (const x of [-4.5, 0, 4.5]) {
        const tooth = part(new THREE.BoxGeometry(4.4, 0.3, 4.2), 0x5f6f7c, x, 7, 0);
        tooth.rotation.z = 0.45;
      }
      part(new THREE.BoxGeometry(3.6, 4, 0.08), 0x4f5a62, 0, 2, 4.52, 0);
      for (const [x, z] of [
        [-5, -2.5],
        [5.2, -3],
      ]) {
        part(new THREE.CylinderGeometry(0.7, 0.9, 7, 10), 0x8a6a5a, x, 9, z);
        part(new THREE.CylinderGeometry(0.75, 0.75, 0.5, 10), SPROUT, x, 11.4, z, 0);
        puffs(0xb9f27a, x, 12.6, z, 5, 0.7);
      }
      sign(-4, 4.6, 4.56, 1.2);
      // The blimp: tethered above the yard, bobbing in the wind.
      const blimp = new THREE.Group();
      b.add(blimp);
      const hull = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), toon(SPROUT));
      hull.scale.set(1, 0.85, 2.3);
      hull.castShadow = true;
      blimp.add(hull);
      addOutline(hull, 1.04);
      for (const [rx, rz] of [
        [0, 0],
        [Math.PI / 2, 0],
      ]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.2, 1.4), toon(BRISTLE_ORANGE));
        fin.position.set(0, 0, -4.6);
        fin.rotation.set(0, 0, rx + rz);
        blimp.add(fin);
        addOutline(fin, 1.06);
      }
      const gondola = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 1.8), toon(0x6f7a82));
      gondola.position.y = -2.1;
      blimp.add(gondola);
      addOutline(gondola, 1.06);
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 8, 4), toon(0x2b1e1a));
      rope.position.set(0, -6, 0);
      blimp.add(rope);
      movers.push((time) => {
        blimp.position.set(9, 16 + Math.sin(time * 0.6) * 0.5, 6);
        blimp.rotation.set(0, 0.4 + Math.sin(time * 0.3) * 0.15, Math.sin(time * 0.8) * 0.04);
      });
      blinkers.push(light(0xff3b30, 0.18, 6.8, 6.4, 4.6));
      break;
    }
    case 'tank': {
      // Round storage tank on legs, a ladder and an intake pipe at the front.
      for (const [x, z] of [
        [-2, -2],
        [2, -2],
        [-2, 2],
        [2, 2],
      ]) {
        part(new THREE.CylinderGeometry(0.16, 0.16, 1.6, 6), 0x5f6f7c, x, 0.8, z, 0);
      }
      part(new THREE.CylinderGeometry(3.2, 3.2, 5, 18), 0xd8dee2, 0, 4.1, 0);
      part(new THREE.SphereGeometry(3.2, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xb8c4cc, 0, 6.6, 0).scale.y = 0.4;
      part(new THREE.CylinderGeometry(3.26, 3.26, 0.7, 18), SPROUT, 0, 5.4, 0, 0);
      for (let y = 1.8; y < 6.6; y += 0.6) part(new THREE.BoxGeometry(0.6, 0.06, 0.06), 0x6f7a82, 1.2, y, 3.2, 0);
      part(new THREE.CylinderGeometry(0.35, 0.35, 2.6, 10).rotateX(Math.PI / 2), 0x6f8a6a, -1.2, 0.9, 3.8);
      part(new THREE.CylinderGeometry(0.5, 0.5, 0.3, 12).rotateX(Math.PI / 2), 0x4a5560, -1.2, 0.9, 5.1);
      blinkers.push(light(SPROUT, 0.14, 0, 7.6, 0));
      break;
    }
    default:
      break;
  }
}

/** Dirt tracks (and rails) along the map's roads. Drawn just above the flattened ground. */
export function buildRoads(map: GameMap): THREE.Group {
  const g = new THREE.Group();
  const roads = map.layout.roads ?? [];
  if (!roads.length) return g;
  const terrain = map.terrain;
  const dirt = new THREE.Color(map.layout.theme.ground.clearing).lerp(new THREE.Color(0x7a5a3a), 0.35);
  const mat = new THREE.MeshToonMaterial({
    color: dirt,
    gradientMap: toonGradient(),
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const positions: number[] = [];
  const indices: number[] = [];
  const quad = (ax: number, az: number, bx: number, bz: number, hw: number) => {
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    const steps = Math.max(1, Math.ceil(len / 1.5));
    const base = positions.length / 3;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      for (const s of [-1, 1]) {
        const px = x + nx * hw * s;
        const pz = z + nz * hw * s;
        positions.push(px, terrain.heightAt(px, pz) + 0.04, pz);
      }
    }
    for (let i = 0; i < steps; i++) {
      const a = base + i * 2;
      // Counter-clockwise seen from above, so normals point up.
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  const sleepers: THREE.Matrix4[] = [];
  const rails: THREE.Mesh[] = [];
  const railMat = toon(0x8a8f99);
  const tmp = new THREE.Object3D();
  for (const road of roads) {
    const hw = road.width / 2;
    const pts = road.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      quad(a.x, a.z, b.x, b.z, hw);
      if (!road.rails) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      for (const s of [-0.55, 0.55]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, len + 0.3), railMat);
        rail.position.set(mx + Math.cos(yaw) * s, terrain.heightAt(mx, mz) + 0.14, mz - Math.sin(yaw) * s);
        rail.rotation.y = yaw;
        rails.push(rail);
      }
      for (let d = 0.5; d < len; d += 1.1) {
        const x = a.x + ((b.x - a.x) * d) / len;
        const z = a.z + ((b.z - a.z) * d) / len;
        tmp.position.set(x, terrain.heightAt(x, z) + 0.07, z);
        tmp.rotation.set(0, yaw, 0);
        tmp.updateMatrix();
        sleepers.push(tmp.matrix.clone());
      }
    }
    // Round patches at the bends so the corners don't show gaps.
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const base = positions.length / 3;
      positions.push(p.x, terrain.heightAt(p.x, p.z) + 0.04, p.z);
      const n = 12;
      for (let k = 0; k <= n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const x = p.x + Math.cos(ang) * hw;
        const z = p.z + Math.sin(ang) * hw;
        positions.push(x, terrain.heightAt(x, z) + 0.04, z);
      }
      for (let k = 0; k < n; k++) indices.push(base, base + 2 + k, base + 1 + k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const ribbon = new THREE.Mesh(geo, mat);
  ribbon.receiveShadow = true;
  g.add(ribbon, ...rails);
  if (sleepers.length) {
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.08, 0.26), toon(0x7a5238), sleepers.length);
    sleepers.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.instanceMatrix.needsUpdate = true;
    inst.receiveShadow = true;
    g.add(inst);
  }
  return g;
}
