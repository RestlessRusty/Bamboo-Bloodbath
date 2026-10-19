import * as THREE from 'three';
import type { Terrain } from '../sim/terrain';

const MAX_PARTICLES = 280;
const MAX_DECALS = 140;
const DECAL_LIFE = 30;

/** Pooled blood bursts, dust puffs, splashes, sparkles and blood splats on the ground. */
export class Effects {
  readonly group = new THREE.Group();

  private readonly particles: THREE.InstancedMesh;
  private readonly pPos = new Float32Array(MAX_PARTICLES * 3);
  private readonly pVel = new Float32Array(MAX_PARTICLES * 3);
  private readonly pLife = new Float32Array(MAX_PARTICLES);
  private readonly pMax = new Float32Array(MAX_PARTICLES);
  private readonly pSize = new Float32Array(MAX_PARTICLES);
  private readonly pGrav = new Float32Array(MAX_PARTICLES);
  private pNext = 0;

  private readonly decals: THREE.InstancedMesh;
  private readonly dPos = new Float32Array(MAX_DECALS * 3);
  private readonly dSize = new Float32Array(MAX_DECALS);
  private readonly dRot = new Float32Array(MAX_DECALS);
  private readonly dAge = new Float32Array(MAX_DECALS).fill(DECAL_LIFE);
  private dNext = 0;

  private readonly o = new THREE.Object3D();
  private readonly c = new THREE.Color();

  constructor(private terrain: Terrain) {
    this.particles = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      MAX_PARTICLES,
    );
    this.particles.frustumCulled = false;
    this.particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.decals = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
      MAX_DECALS,
    );
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 1;

    this.o.scale.setScalar(0);
    this.o.updateMatrix();
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.setMatrixAt(i, this.o.matrix);
      this.particles.setColorAt(i, this.c.set(0xffffff));
    }
    for (let i = 0; i < MAX_DECALS; i++) {
      this.decals.setMatrixAt(i, this.o.matrix);
      this.decals.setColorAt(i, this.c.set(0x8c1016));
    }
    this.group.add(this.particles, this.decals);
  }

  /** New map: drop all particles and splats and follow the new ground. */
  reset(terrain: Terrain): void {
    this.terrain = terrain;
    this.o.position.set(0, 0, 0);
    this.o.rotation.set(0, 0, 0);
    this.o.scale.setScalar(0);
    this.o.updateMatrix();
    this.pLife.fill(0);
    this.dAge.fill(DECAL_LIFE);
    for (let i = 0; i < MAX_PARTICLES; i++) this.particles.setMatrixAt(i, this.o.matrix);
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, this.o.matrix);
    this.particles.instanceMatrix.needsUpdate = true;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  blood(x: number, y: number, z: number, big: boolean): void {
    this.burst(x, y, z, big ? 18 : 9, [0xc4161c, 0x9e0f14, 0xe8343a], big ? 4.5 : 3.2, 0.07, 14);
    this.decal(x, z, big ? 0.9 : 0.5);
  }

  dust(x: number, y: number, z: number): void {
    this.burst(x, y + 0.1, z, 7, [0xe9dcc0, 0xd8c9a6, 0xffffff], 1.6, 0.09, 2);
  }

  splash(x: number, y: number, z: number): void {
    this.burst(x, y + 0.1, z, 12, [0x9be3ff, 0xffffff, 0x55c4e8], 3, 0.07, 12);
  }

  sparkle(x: number, y: number, z: number, color = 0xffe066): void {
    this.burst(x, y + 1, z, 14, [color, 0xffffff], 2.6, 0.06, -1);
  }

  update(dt: number): void {
    const o = this.o;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const k = i * 3;
      if (this.pLife[i] <= 0) {
        o.scale.setScalar(0);
      } else {
        this.pVel[k + 1] -= this.pGrav[i] * dt;
        this.pPos[k] += this.pVel[k] * dt;
        this.pPos[k + 1] += this.pVel[k + 1] * dt;
        this.pPos[k + 2] += this.pVel[k + 2] * dt;
        const ground = this.terrain.groundAt(this.pPos[k], this.pPos[k + 2]) + 0.03;
        if (this.pPos[k + 1] < ground) {
          this.pPos[k + 1] = ground;
          this.pVel[k] *= 0.5;
          this.pVel[k + 1] = 0;
          this.pVel[k + 2] *= 0.5;
        }
        o.position.set(this.pPos[k], this.pPos[k + 1], this.pPos[k + 2]);
        o.scale.setScalar(this.pSize[i] * Math.sqrt(this.pLife[i] / this.pMax[i]));
      }
      o.rotation.set(0, 0, 0);
      o.updateMatrix();
      this.particles.setMatrixAt(i, o.matrix);
    }
    this.particles.instanceMatrix.needsUpdate = true;

    let decalsChanged = false;
    for (let i = 0; i < MAX_DECALS; i++) {
      if (this.dAge[i] >= DECAL_LIFE) continue;
      this.dAge[i] += dt;
      const fade = Math.min(1, (DECAL_LIFE - this.dAge[i]) / 3);
      const grow = Math.min(1, this.dAge[i] * 8);
      o.position.set(this.dPos[i * 3], this.dPos[i * 3 + 1], this.dPos[i * 3 + 2]);
      o.rotation.set(0, this.dRot[i], 0);
      o.scale.setScalar(Math.max(0, this.dSize[i] * fade * grow));
      o.updateMatrix();
      this.decals.setMatrixAt(i, o.matrix);
      decalsChanged = true;
    }
    if (decalsChanged) this.decals.instanceMatrix.needsUpdate = true;
  }

  private burst(
    x: number,
    y: number,
    z: number,
    count: number,
    colors: readonly number[],
    speed: number,
    size: number,
    gravity: number,
  ): void {
    for (let n = 0; n < count; n++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.pPos.set([x, y, z], i * 3);
      this.pVel.set([Math.cos(a) * sp * (1 - up * 0.5), sp * (0.4 + up), Math.sin(a) * sp * (1 - up * 0.5)], i * 3);
      this.pMax[i] = this.pLife[i] = 0.45 + Math.random() * 0.35;
      this.pSize[i] = size * (0.6 + Math.random() * 0.8);
      this.pGrav[i] = gravity;
      this.particles.setColorAt(i, this.c.set(colors[n % colors.length]));
    }
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }

  private decal(x: number, z: number, size: number): void {
    const i = this.dNext;
    this.dNext = (this.dNext + 1) % MAX_DECALS;
    const ox = x + (Math.random() - 0.5) * 0.6;
    const oz = z + (Math.random() - 0.5) * 0.6;
    this.dPos.set([ox, this.terrain.groundAt(ox, oz) + 0.04, oz], i * 3);
    this.dSize[i] = size * (0.7 + Math.random() * 0.6);
    this.dRot[i] = Math.random() * Math.PI;
    this.dAge[i] = 0;
    this.decals.setColorAt(i, this.c.set(Math.random() < 0.5 ? 0x8c1016 : 0xa3161c));
    if (this.decals.instanceColor) this.decals.instanceColor.needsUpdate = true;
  }
}
