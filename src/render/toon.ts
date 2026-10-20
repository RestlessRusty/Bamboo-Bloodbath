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
/** Materials reused across objects: never disposed. */
const shared = new WeakSet<THREE.Material>();

/** Shared toon material per colour. */
export function toon(color: number): THREE.MeshToonMaterial {
  let m = cache.get(color);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonGradient() });
    cache.set(color, m);
    shared.add(m);
  }
  return m;
}

/** Geometries reused across objects: never disposed. */
const sharedGeos = new WeakSet<THREE.BufferGeometry>();

/** Marks a cached geometry as shared so `disposeObject` leaves it alone. */
export function sharedGeometry<T extends THREE.BufferGeometry>(geo: T): T {
  sharedGeos.add(geo);
  return geo;
}

/** Frees the GPU resources of everything under `root` (except shared materials and geometries). */
export function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry && !sharedGeos.has(mesh.geometry)) geometries.add(mesh.geometry);
    const m = mesh.material;
    if (m) for (const mat of Array.isArray(m) ? m : [m]) if (!shared.has(mat)) materials.add(mat);
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

/** White toon material for instanced meshes, which get their colour per instance. */
export function toonInstanced(): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient() });
}

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x2b1e1a, side: THREE.BackSide });
shared.add(OUTLINE);

/** Inverted-hull outline: a slightly bigger back-face copy drawn in dark ink. */
export function addOutline(mesh: THREE.Mesh, scale = 1.07): THREE.Mesh {
  const o = new THREE.Mesh(mesh.geometry, OUTLINE);
  o.scale.setScalar(scale);
  mesh.add(o);
  return o;
}
