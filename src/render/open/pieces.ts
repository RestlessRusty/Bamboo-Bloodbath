import * as THREE from 'three';
import { damp } from '../../core/math';
import { Rng } from '../../core/rng';
import { PIECES, tileCenter } from '../../sim/open/config';
import type { GhostSpec, Piece, PieceKind, Tier } from '../../sim/open/types';
import type { Terrain } from '../../sim/terrain';
import { bake, Batch, part, type Baked, type Part } from './bake';

/** Gate doors swing open when a panda is this close to the gate. */
const GATE_OPEN_NEAR = 2.4;
/** Hinge of a gate door, from the tile centre (the door spans to the other post). */
const HINGE = 0.7;

const BAMBOO = [0x9cc45a, 0x8ab04a, 0xa8cf68];
const LASHING = 0x6b4423;
const WOOD = [0xa8743f, 0x96643a];
const DARK_WOOD = 0x6b4423;
const STONE = [0x9ea3a8, 0x8c9196, 0xaab0b5, 0x7f858b];

type LookId = `wall${Tier}` | `gate${Tier}` | `rubble${Tier}` | Exclude<PieceKind, 'wall' | 'gate'>;

/** Ruins look like their main material: tier of the rubble heap per kind (walls and gates use their own). */
const RUBBLE_OF: Record<PieceKind, Tier | null> = {
  wall: null,
  gate: null,
  spikes: 0,
  campfire: 2,
  workbench: 1,
  bed: 1,
  storage: 1,
  lookout: 1,
};
const RUBBLE_SCALE: Record<PieceKind, number> = {
  wall: 1,
  gate: 1,
  spikes: 0.7,
  campfire: 0.55,
  workbench: 0.8,
  bed: 0.8,
  storage: 0.75,
  lookout: 1.3,
};

/** Quarter turns clockwise seen from above, 0 facing +Z. */
export const pieceYaw = (rot: number) => -rot * (Math.PI / 2);

/** What a piece is drawn as right now. */
function lookOf(p: Piece): LookId {
  if (p.ruined) return `rubble${RUBBLE_OF[p.kind] ?? p.tier}` as LookId;
  return standingLook(p.kind, p.tier);
}

function standingLook(kind: PieceKind, tier: Tier): LookId {
  if (kind === 'wall' || kind === 'gate') return `${kind}${tier}` as LookId;
  return kind;
}

/**
 * Every piece's model (one baked geometry each, built on first use), shared by all chunks of a world.
 * Models stand on y = 0 at the tile centre and reach a bit below it, so slopes don't show daylight.
 */
export class PieceKit {
  private readonly looks = new Map<LookId, Baked>();
  private readonly doors: (Baked | null)[] = [null, null, null];

  constructor(
    /** Vertex colours × instance colour (the world's shared material). */
    readonly material: THREE.Material,
    readonly ink: THREE.Material,
  ) {}

  look(id: LookId): Baked {
    let b = this.looks.get(id);
    if (!b) {
      b = bake(buildLook(id));
      this.looks.set(id, b);
    }
    return b;
  }

  /** A gate's door, hinged at the origin and reaching along +X. */
  door(tier: Tier): Baked {
    let b = this.doors[tier];
    if (!b) {
      b = bake(doorParts(tier));
      this.doors[tier] = b;
    }
    return b;
  }

  /** The model of a piece kind as it would be built (for the ghost). */
  standing(kind: PieceKind, tier: Tier): Baked {
    return this.look(standingLook(kind, tier));
  }

  dispose(): void {
    for (const b of [...this.looks.values(), ...this.doors]) {
      b?.body.dispose();
      b?.ink?.dispose();
    }
    this.looks.clear();
    this.doors.fill(null);
  }
}

interface Gate {
  batch: Batch;
  index: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  open: number;
}

const tmpM = new THREE.Matrix4();
const tmpHinge = new THREE.Matrix4();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();
const SOOT = new THREE.Color(0x4a3a30);

/** Damage darkens a piece towards soot; rubble is a little darker still. */
function shade(p: Piece, out: THREE.Color): THREE.Color {
  const def = PIECES[p.kind];
  const max = def.hp[Math.min(p.tier, def.hp.length - 1)] || 1;
  const hurt = p.ruined ? 0.35 : 1 - Math.max(0, Math.min(1, p.hp / max));
  return out.setRGB(1, 1, 1).lerp(SOOT, hurt * 0.6);
}

/** Where a piece stands: tile centre, on the ground. */
function pieceMatrix(terrain: Terrain, p: Piece, yaw: number, scale: number, out: THREE.Matrix4): THREE.Matrix4 {
  const x = tileCenter(p.gx);
  const z = tileCenter(p.gz);
  out.makeRotationY(yaw);
  if (scale !== 1) out.scale(tmpS.set(scale, scale, scale));
  return out.setPosition(x, terrain.heightAt(x, z), z);
}

/** A gate door at `open` (0 shut, 1 swung wide). */
function doorMatrix(g: Gate, out: THREE.Matrix4): THREE.Matrix4 {
  out.makeRotationY(g.yaw).setPosition(g.x, g.y, g.z);
  tmpHinge.makeRotationY(g.open * 1.45).setPosition(-HINGE, 0, 0);
  return out.multiply(tmpHinge);
}

/**
 * The pieces standing in one chunk: one instanced batch (plus its ink) per model, rebuilt whenever the
 * chunk's pieces change. Gate doors are their own batch so they can swing open for pandas.
 */
export class ChunkPieces {
  readonly group = new THREE.Group();
  private meshes: THREE.Object3D[] = [];
  private gates: Gate[] = [];

  constructor(
    private readonly kit: PieceKit,
    private readonly terrain: Terrain,
  ) {}

  set(pieces: readonly Piece[]): void {
    this.clear();
    if (!pieces.length) return;
    const byLook = new Map<LookId, Piece[]>();
    for (const p of pieces) {
      const id = lookOf(p);
      const list = byLook.get(id);
      if (list) list.push(p);
      else byLook.set(id, [p]);
    }
    const out: THREE.Object3D[] = [];
    const doors: (Batch | null)[] = [null, null, null];
    const gates: Gate[] = [];
    for (const [id, list] of byLook) {
      const look = this.kit.look(id);
      const body = new Batch(look.body, this.kit.material);
      const ink = look.ink ? new Batch(look.ink, this.kit.ink, false) : null;
      for (const p of list) {
        const yaw = p.ruined ? pieceYaw(p.rot) + (p.id % 7) * 0.9 : pieceYaw(p.rot);
        const m = pieceMatrix(this.terrain, p, yaw, p.ruined ? RUBBLE_SCALE[p.kind] : 1, tmpM);
        body.add(m, shade(p, tmpC));
        ink?.add(m);
        if (p.kind !== 'gate' || p.ruined) continue;
        const door = (doors[p.tier] ??= new Batch(this.kit.door(p.tier).body, this.kit.material));
        const g: Gate = { batch: door, index: 0, x: m.elements[12], y: m.elements[13], z: m.elements[14], yaw, open: 0 };
        g.index = door.add(doorMatrix(g, tmpM), shade(p, tmpC));
        gates.push(g);
      }
      body.finish(out, true, true);
      ink?.finish(out, false, false);
    }
    for (const d of doors) {
      // Swinging doors leave the bounding sphere they were built with: never cull them.
      const mesh = d?.finish(out, true, true);
      if (mesh) mesh.frustumCulled = false;
    }
    this.meshes = out;
    this.gates = gates;
    if (out.length) this.group.add(...out);
  }

  /** Swings gate doors open for pandas (`xz`: their positions, `n` of them). */
  animate(dt: number, xz: ArrayLike<number>, n: number): void {
    if (!this.gates.length) return;
    const k = damp(5, dt);
    for (const g of this.gates) {
      let want = 0;
      for (let i = 0; i < n; i++) {
        if (Math.hypot(xz[i * 2] - g.x, xz[i * 2 + 1] - g.z) < GATE_OPEN_NEAR) want = 1;
      }
      const next = g.open + (want - g.open) * k;
      if (Math.abs(next - g.open) < 0.002) continue;
      g.open = Math.abs(want - next) < 0.002 ? want : next;
      const mesh = g.batch.mesh;
      if (!mesh) continue;
      mesh.setMatrixAt(g.index, doorMatrix(g, tmpM));
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.clear();
  }

  private clear(): void {
    for (const m of this.meshes) {
      this.group.remove(m);
      if (m instanceof THREE.InstancedMesh) m.dispose();
    }
    this.meshes = [];
    this.gates = [];
  }
}

/**
 * The build-mode preview: the piece in see-through green (fits, and you can pay) or red, on its tile,
 * with the tile marked on the ground.
 */
export class Ghost {
  readonly group = new THREE.Group();
  private readonly mat = new THREE.MeshBasicMaterial({ color: 0x7cff5a, transparent: true, opacity: 0.45, depthWrite: false });
  private readonly tileMat = new THREE.MeshBasicMaterial({ color: 0x7cff5a, transparent: true, opacity: 0.3, depthWrite: false });
  private readonly body = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
  private readonly door = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
  private readonly tile: THREE.Mesh;
  private key = '';

  constructor(
    private readonly kit: PieceKit,
    private readonly terrain: Terrain,
  ) {
    this.tile = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2), this.tileMat);
    this.tile.renderOrder = 2;
    this.body.renderOrder = 3;
    this.door.renderOrder = 3;
    this.group.add(this.body, this.door, this.tile);
    this.group.visible = false;
  }

  set(g: GhostSpec | null): void {
    this.group.visible = !!g;
    if (!g) return;
    const key = `${g.kind}${g.tier}`;
    if (key !== this.key) {
      this.key = key;
      this.body.geometry = this.kit.standing(g.kind, g.tier).body;
      this.door.visible = g.kind === 'gate';
      if (g.kind === 'gate') this.door.geometry = this.kit.door(g.tier).body;
    }
    const color = g.valid ? 0x7cff5a : 0xff5a4a;
    this.mat.color.setHex(color);
    this.tileMat.color.setHex(color);
    const x = tileCenter(g.gx);
    const z = tileCenter(g.gz);
    const y = this.terrain.heightAt(x, z);
    const yaw = pieceYaw(g.rot);
    this.body.position.set(x, y, z);
    this.body.rotation.y = yaw;
    // The door hangs on its hinge, shut.
    this.door.position.set(x - Math.cos(yaw) * HINGE, y, z + Math.sin(yaw) * HINGE);
    this.door.rotation.y = yaw;
    this.tile.position.set(x, y + 0.06, z);
  }

  update(time: number): void {
    if (!this.group.visible) return;
    this.mat.opacity = 0.38 + 0.12 * Math.sin(time * 5);
    this.tileMat.opacity = 0.22 + 0.1 * Math.sin(time * 5);
  }

  dispose(): void {
    // The piece geometries belong to the kit.
    this.tile.geometry.dispose();
    this.mat.dispose();
    this.tileMat.dispose();
  }
}

// ---------------------------------------------------------------- models

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);

function buildLook(id: LookId): Part[] {
  switch (id) {
    case 'wall0':
      return bambooWall();
    case 'wall1':
      return woodWall();
    case 'wall2':
      return stoneWall();
    case 'gate0':
    case 'gate1':
    case 'gate2':
      return gateFrame(Number(id[4]) as Tier);
    case 'rubble0':
    case 'rubble1':
    case 'rubble2':
      return rubble(Number(id[6]) as Tier);
    case 'spikes':
      return spikes();
    case 'campfire':
      return campfire();
    case 'workbench':
      return workbench();
    case 'bed':
      return bed();
    case 'storage':
      return storage();
    case 'lookout':
      return lookout();
  }
}

/**
 * Walls fill their whole tile (that's what stops you), so a line of them reads as one rampart whichever
 * way it runs. Bamboo: a ring of lashed poles with pointed tops.
 */
function bambooWall(): Part[] {
  const parts: Part[] = [part(box(1.75, 2.6, 1.75), 0x6f8f3f, 0, 0.8, 0, { ink: 1.03 })];
  const posts = 6;
  let k = 0;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < posts; i++) {
      const t = -0.83 + (i / (posts - 1)) * 1.66;
      // Corners belong to one side only.
      if (i === posts - 1) continue;
      const [x, z] = side === 0 ? [t, 0.86] : side === 1 ? [0.86, -t] : side === 2 ? [-t, -0.86] : [-0.86, t];
      const h = 2.2 + ((k * 37) % 5) * 0.08;
      const c = BAMBOO[k % BAMBOO.length];
      parts.push(part(cyl(0.13, 0.14, h + 0.5, 5), c, x, h / 2 - 0.25, z));
      parts.push(part(new THREE.ConeGeometry(0.13, 0.32, 5), c, x, h + 0.16, z));
      k++;
    }
  }
  for (const y of [0.65, 1.7]) parts.push(part(box(1.98, 0.12, 1.98), LASHING, 0, y, 0));
  return parts;
}

/** Wood: a log-cabin block, logs crossing at the corners, a plank cap. */
function woodWall(): Part[] {
  const parts: Part[] = [part(box(1.8, 2.8, 1.8), 0x8b5a3c, 0, 0.9, 0, { ink: 1.03 })];
  for (let c = 0; c < 5; c++) {
    const y = 0.18 + c * 0.46;
    const color = WOOD[c % 2];
    for (const s of [-1, 1]) {
      parts.push(part(cyl(0.2, 0.2, 2.02, 6), color, 0, y, s * 0.84, { rz: Math.PI / 2 }));
      parts.push(part(cyl(0.2, 0.2, 2.02, 6), WOOD[(c + 1) % 2], s * 0.84, y + 0.23, 0, { rx: Math.PI / 2 }));
    }
  }
  parts.push(part(box(2.0, 0.14, 2.0), DARK_WOOD, 0, 2.4, 0, { ink: 1.03 }));
  return parts;
}

/** Stone: dressed blocks in staggered courses round a core, a flat coping on top. */
function stoneWall(): Part[] {
  const rng = new Rng(9161);
  const parts: Part[] = [part(box(1.88, 2.9, 1.88), 0x7f858b, 0, 0.95, 0, { ink: 1.03 })];
  const courses = 4;
  const ch = 2.3 / courses;
  for (let c = 0; c < courses; c++) {
    const y = ch * (c + 0.5);
    // Joints alternate course by course.
    const cuts = c % 2 ? [-0.98, -0.33, 0.33, 0.98] : [-0.98, -0.6, 0.05, 0.98];
    for (let side = 0; side < 4; side++) {
      for (let i = 1; i < cuts.length; i++) {
        const a = cuts[i - 1];
        const b = cuts[i];
        const w = b - a - 0.05;
        const t = (a + b) / 2;
        const color = STONE[Math.floor(rng.next() * STONE.length)];
        const out = 0.95 + rng.range(-0.02, 0.02);
        const geo = side % 2 === 0 ? box(w, ch - 0.05, 0.12) : box(0.12, ch - 0.05, w);
        const [x, z] = side === 0 ? [t, out] : side === 1 ? [out, -t] : side === 2 ? [-t, -out] : [-out, t];
        parts.push(part(geo, color, x, y, z));
      }
    }
  }
  parts.push(part(box(2.04, 0.2, 2.04), 0x6f7479, 0, 2.4, 0, { ink: 1.03 }));
  return parts;
}

const GATE_POST = [0x8ab04a, 0x8b5a3c, 0x8c9196];
const GATE_TOP = [LASHING, DARK_WOOD, 0x6f7479];

/** Two posts and a lintel the full depth of the tile, so it lines up with the walls beside it. */
function gateFrame(tier: Tier): Part[] {
  const parts: Part[] = [];
  for (const s of [-1, 1]) {
    parts.push(part(box(0.3, 3.0, 1.9), GATE_POST[tier], s * 0.85, 0.9, 0, { ink: 1.04 }));
    if (tier === 0) for (const y of [0.6, 1.6]) parts.push(part(box(0.34, 0.1, 1.94), LASHING, s * 0.85, y, 0));
  }
  parts.push(part(box(2.0, 0.34, 1.9), GATE_TOP[tier], 0, 2.4, 0, { ink: 1.04 }));
  if (tier === 2) parts.push(part(box(2.04, 0.12, 1.94), 0x55595e, 0, 2.2, 0));
  return parts;
}

/** The door of a gate (hinge at the origin, reaching along +X): slats, planks, or an iron-banded door. */
function doorParts(tier: Tier): Part[] {
  const w = HINGE * 2 - 0.02;
  const parts: Part[] = [];
  if (tier === 0) {
    for (let i = 0; i < 6; i++) {
      const x = 0.12 + (i / 5) * (w - 0.24);
      parts.push(part(cyl(0.11, 0.11, 2.1, 5), BAMBOO[i % BAMBOO.length], x, 1.05, 0));
    }
    for (const y of [0.5, 1.6]) parts.push(part(box(w, 0.1, 0.26), LASHING, w / 2, y, 0));
  } else if (tier === 1) {
    parts.push(part(box(w, 2.1, 0.1), 0x9a6a3a, w / 2, 1.05, 0, { ink: 1.03 }));
    for (const y of [0.35, 1.05, 1.75]) parts.push(part(box(w, 0.14, 0.16), DARK_WOOD, w / 2, y, 0));
    parts.push(part(box(0.12, 1.5, 0.15), DARK_WOOD, w / 2, 1.05, 0, { rz: 0.7 }));
  } else {
    parts.push(part(box(w, 2.1, 0.14), 0x5a4636, w / 2, 1.05, 0, { ink: 1.03 }));
    for (const y of [0.3, 1.05, 1.8]) parts.push(part(box(w + 0.02, 0.12, 0.18), 0x55595e, w / 2, y, 0));
    parts.push(part(new THREE.TorusGeometry(0.1, 0.025, 5, 10), 0xffd34d, w - 0.25, 1.05, 0.1));
  }
  return parts;
}

/** Sharpened stakes leaning out over two logs. */
function spikes(): Part[] {
  const parts: Part[] = [];
  for (const z of [-0.55, 0.55]) parts.push(part(cyl(0.1, 0.1, 1.9, 6), DARK_WOOD, 0, 0.08, z, { rz: Math.PI / 2 }));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const x = (i - 1) * 0.6;
      const z = (j - 1) * 0.6;
      parts.push(part(new THREE.ConeGeometry(0.07, 0.75, 5), 0xd8c58a, x, 0.3, z, { rx: (j - 1) * 0.35, rz: -(i - 1) * 0.35 }));
    }
  }
  return parts;
}

/** Ring of stones, a teepee of logs and ash (the flames are drawn by the world, they flicker). */
function campfire(): Part[] {
  const parts: Part[] = [part(cyl(0.42, 0.46, 0.06, 10), 0x3b3330, 0, 0.02, 0)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(part(new THREE.DodecahedronGeometry(0.17, 0), 0x9ea3a8, Math.cos(a) * 0.55, 0.07, Math.sin(a) * 0.55, { ry: i }));
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.push(part(cyl(0.06, 0.08, 0.8, 6), DARK_WOOD, Math.cos(a) * 0.15, 0.3, Math.sin(a) * 0.15, { ry: -a, rz: 0.6 }));
  }
  return parts;
}

function workbench(): Part[] {
  const parts: Part[] = [part(box(1.7, 0.12, 0.85), 0xb07a45, 0, 0.9, 0, { ink: 1.05 })];
  for (const x of [-0.72, 0.72]) {
    for (const z of [-0.32, 0.32]) parts.push(part(box(0.12, 1.3, 0.12), 0x8b5a3c, x, 0.2, z, { ink: 1.1 }));
  }
  parts.push(part(box(1.5, 0.06, 0.65), 0x8b5a3c, 0, 0.32, 0));
  // Vise, saw and hammer.
  parts.push(part(box(0.22, 0.2, 0.26), 0x6f7479, 0.65, 1.06, 0.1));
  parts.push(part(box(0.6, 0.02, 0.16), 0xc9ced3, -0.2, 0.97, 0.15, { ry: 0.3 }));
  parts.push(part(box(0.16, 0.05, 0.1), 0x8b5a3c, -0.55, 0.98, 0.05, { ry: 0.3 }));
  parts.push(part(box(0.06, 0.05, 0.4), 0x8b5a3c, 0.2, 0.98, -0.15, { ry: -0.5 }));
  parts.push(part(box(0.16, 0.09, 0.08), 0x55595e, 0.31, 0.99, -0.31, { ry: -0.5 }));
  // A few planks leaning on the shelf.
  parts.push(part(box(0.9, 0.05, 0.2), 0xd8b27a, -0.3, 0.38, 0.05));
  return parts;
}

function bed(): Part[] {
  return [
    part(box(1.05, 0.5, 1.9), 0x8b5a3c, 0, 0.1, 0, { ink: 1.04 }),
    part(box(0.92, 0.18, 1.75), 0xf1e6cf, 0, 0.43, 0.02),
    part(box(0.95, 0.07, 1.05), 0x4f8fd8, 0, 0.53, 0.38),
    part(box(0.62, 0.13, 0.34), 0xffffff, 0, 0.56, -0.62),
    part(box(1.05, 0.8, 0.1), 0x6b4423, 0, 0.35, -0.95, { ink: 1.05 }),
  ];
}

function storage(): Part[] {
  return [
    part(box(1.4, 0.9, 0.9), 0x9a6a3a, 0, 0.35, 0, { ink: 1.05 }),
    part(box(1.46, 0.24, 0.96), 0x8b5a3c, 0, 0.9, 0, { ink: 1.05 }),
    part(box(0.1, 1.16, 0.98), 0x55595e, -0.45, 0.48, 0),
    part(box(0.1, 1.16, 0.98), 0x55595e, 0.45, 0.48, 0),
    part(box(0.18, 0.22, 0.06), 0xffd34d, 0, 0.75, 0.48),
  ];
}

/** A wooden tower: legs, braces, a railed platform and a little roof; a ladder up the front. */
function lookout(): Part[] {
  const parts: Part[] = [];
  for (const x of [-0.8, 0.8]) {
    for (const z of [-0.8, 0.8]) parts.push(part(cyl(0.11, 0.14, 5.0, 6), 0x8b5a3c, x, 2.1, z, { ink: 1.1 }));
  }
  for (const s of [-1, 1]) {
    parts.push(part(box(2.3, 0.1, 0.1), 0x9a6a3a, 0, 2.0, s * 0.8, { rz: 0.95 }));
    parts.push(part(box(2.3, 0.1, 0.1), 0x9a6a3a, 0, 2.0, s * 0.8, { rz: -0.95 }));
    parts.push(part(box(0.1, 0.1, 2.3), 0x9a6a3a, s * 0.8, 2.0, 0, { rx: 0.95 }));
  }
  parts.push(part(box(2.1, 0.16, 2.1), 0xa8743f, 0, 4.6, 0, { ink: 1.04 }));
  for (const s of [-1, 1]) {
    parts.push(part(box(2.1, 0.08, 0.08), 0x9a6a3a, 0, 5.45, s * 1.0));
    parts.push(part(box(0.08, 0.08, 2.1), 0x9a6a3a, s * 1.0, 5.45, 0));
  }
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) parts.push(part(box(0.08, 1.7, 0.08), 0x8b5a3c, x, 5.5, z));
  }
  parts.push(part(new THREE.ConeGeometry(1.75, 0.9, 4), 0xc98d4a, 0, 6.8, 0, { ry: Math.PI / 4, ink: 1.04 }));
  for (const s of [-0.25, 0.25]) parts.push(part(box(0.06, 4.6, 0.06), 0x9a6a3a, s, 2.3, 1.0));
  for (let y = 0.4; y < 4.5; y += 0.45) parts.push(part(box(0.5, 0.05, 0.05), 0x9a6a3a, 0, y, 1.0));
  return parts;
}

/** What's left when a piece is smashed: fallen poles, broken planks or tumbled blocks. */
function rubble(tier: Tier): Part[] {
  const rng = new Rng(7001 + tier * 31);
  const parts: Part[] = [part(box(1.8, 0.06, 1.8), 0x6b5a4a, 0, 0.0, 0)];
  if (tier === 0) {
    for (let i = 0; i < 6; i++) {
      const c = i % 2 ? 0xb9b46a : BAMBOO[i % BAMBOO.length];
      parts.push(part(cyl(0.12, 0.13, rng.range(1.2, 1.9), 5), c, rng.range(-0.5, 0.5), 0.12 + (i % 3) * 0.16, rng.range(-0.5, 0.5), {
        rz: Math.PI / 2,
        ry: rng.range(0, Math.PI),
      }));
    }
    for (let i = 0; i < 4; i++) {
      const h = rng.range(0.4, 0.9);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      parts.push(part(cyl(0.13, 0.14, h, 5), BAMBOO[i % BAMBOO.length], Math.cos(a) * 0.8, h / 2 - 0.1, Math.sin(a) * 0.8));
    }
  } else if (tier === 1) {
    for (let i = 0; i < 7; i++) {
      parts.push(part(box(rng.range(0.9, 1.5), 0.08, 0.24), WOOD[i % 2], rng.range(-0.45, 0.45), 0.08 + (i % 3) * 0.1, rng.range(-0.45, 0.45), {
        ry: rng.range(0, Math.PI),
        rz: rng.range(-0.25, 0.25),
      }));
    }
    for (let i = 0; i < 3; i++) {
      const h = rng.range(0.4, 0.8);
      const a = (i / 3) * Math.PI * 2;
      parts.push(part(box(0.2, h, 0.2), DARK_WOOD, Math.cos(a) * 0.75, h / 2 - 0.1, Math.sin(a) * 0.75, { rz: rng.range(-0.3, 0.3) }));
    }
  } else {
    for (let i = 0; i < 10; i++) {
      const r = rng.range(0.2, 0.38);
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, 0.75);
      parts.push(part(new THREE.DodecahedronGeometry(r, 0), STONE[i % STONE.length], Math.cos(a) * d, r * 0.6 + (d < 0.35 ? 0.25 : 0), Math.sin(a) * d, {
        ry: rng.range(0, 3),
        sy: 0.75,
        ink: i < 4 ? 1.08 : undefined,
      }));
    }
  }
  return parts;
}
