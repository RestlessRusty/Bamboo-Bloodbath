import * as THREE from 'three';

let gradient: THREE.DataTexture | null = null;

/** Three-step lighting ramp that gives the cartoon look. */
export function toonGradient(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const cache = new Map<number, THREE.MeshToonMaterial>();

/** Shared toon material per colour. */
export function toon(color: number): THREE.MeshToonMaterial {
  let m = cache.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    cache.set(color, m);
  }
  return m;
}

/** White toon material for instanced meshes, which get their colour per instance. */
export function toonInstanced(): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient() });
}

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x2b1e1a, side: THREE.BackSide });

/** Inverted-hull outline: a slightly bigger back-face copy drawn in dark ink. */
export function addOutline(mesh: THREE.Mesh, scale = 1.07): THREE.Mesh {
  const o = new THREE.Mesh(mesh.geometry, OUTLINE);
  o.scale.setScalar(scale);
  mesh.add(o);
  return o;
}
