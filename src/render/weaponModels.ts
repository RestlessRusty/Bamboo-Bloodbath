import * as THREE from 'three';
import type { WeaponType } from '../sim/types';
import { addOutline, toon } from './toon';

/** How each weapon is tilted in the paw (rotation about X of the holder). */
export const HOLD_ANGLE: Record<WeaponType, number> = { knife: -0.6, axe: -0.2, javelin: -1.3 };

/** Weapons extend along -Y from the grip at the origin, like a continuation of the arm. */
export function buildWeapon(type: WeaponType): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, outline = true) => {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    if (outline) addOutline(m, 1.12);
    return m;
  };

  if (type === 'knife') {
    add(new THREE.CylinderGeometry(0.032, 0.032, 0.14, 8), 0x6b3e1e, 0, -0.03, 0);
    add(new THREE.BoxGeometry(0.11, 0.025, 0.045), 0x8d939c, 0, -0.105, 0, false);
    add(new THREE.BoxGeometry(0.07, 0.24, 0.018), 0xe3e9f0, 0, -0.235, 0);
    const tip = add(new THREE.ConeGeometry(0.035, 0.1, 4), 0xe3e9f0, 0, -0.405, 0);
    tip.rotation.z = Math.PI;
    tip.scale.z = 0.25;
  } else if (type === 'axe') {
    add(new THREE.CylinderGeometry(0.03, 0.036, 0.66, 8), 0x8a5a2b, 0, -0.2, 0);
    add(new THREE.BoxGeometry(0.06, 0.17, 0.16), 0x8f98a3, 0, -0.44, -0.07);
    add(new THREE.BoxGeometry(0.035, 0.26, 0.06), 0xe8eef4, 0, -0.44, -0.17);
  } else {
    add(new THREE.CylinderGeometry(0.022, 0.022, 1.5, 6), 0xb98a4e, 0, -0.2, 0);
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 6), 0xd94a4a, 0, 0, 0, false);
    const tip = add(new THREE.ConeGeometry(0.055, 0.2, 6), 0xd8dee6, 0, -1.04, 0);
    tip.rotation.z = Math.PI;
  }
  return g;
}
