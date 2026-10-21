import * as THREE from 'three';

const COUNT = 700;
/** Size of the box of flakes that follows the camera's focus. */
const W = 64;
const H = 24;
const D = 52;

/** Gently falling snow around the point the camera looks at. One draw call. */
export class Snowfall {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly pos = new Float32Array(COUNT * 3);
  private readonly speed = new Float32Array(COUNT);

  constructor() {
    for (let i = 0; i < COUNT; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * W;
      this.pos[i * 3 + 1] = Math.random() * H;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * D;
      this.speed[i] = 1 + Math.random() * 0.8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.points.frustumCulled = false;
  }

  /** 0..1: thins the flakes out (the open world fades snowfall in and out at the snow biome's edge). */
  setStrength(k: number): void {
    this.points.material.opacity = 0.9 * k;
    this.points.visible = k > 0.01;
  }

  update(dt: number, time: number, cx: number, cy: number, cz: number): void {
    const p = this.pos;
    for (let i = 0; i < COUNT; i++) {
      const k = i * 3;
      p[k] += Math.sin(time * 0.8 + i) * 0.4 * dt;
      p[k + 1] -= this.speed[i] * dt;
      // Keep every flake inside the box around the focus, wrapping at the edges.
      p[k] = cx + wrap(p[k] - cx, W);
      p[k + 2] = cz + wrap(p[k + 2] - cz, D);
      if (p[k + 1] < cy - 2) p[k + 1] += H;
      else if (p[k + 1] > cy - 2 + H) p[k + 1] -= H;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

function wrap(v: number, size: number): number {
  const h = size / 2;
  return ((((v + h) % size) + size) % size) - h;
}
