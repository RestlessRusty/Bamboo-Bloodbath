import * as THREE from 'three';
import { Rng } from '../../core/rng';
import type { GameMap } from '../../sim/gameMap';
import { OPEN } from '../../sim/open/config';
import type { BiomeId } from '../../sim/open/types';
import { outlineMaterial, toonInstanced } from '../toon';
import {
  BOULDER_SHAPES,
  boulderGeometry,
  flowerGeo,
  grassGeo,
  leafTuftGeo,
  lilyPadGeo,
  pineFoliageGeo,
  pineSnowGeo,
  roundFoliageGeo,
  stalkGeo,
  stalkRingGeo,
  trunkGeo,
  type BoulderGeo,
} from '../world';
import { bake, part, type Baked, type Part } from './bake';

const RUST = 0x8a5a3a;
const METAL = 0x7d8288;
const TYRE = 0x2b2b2b;
const CRATE = 0xb07a45;
const CRATE_BAND = 0x6b4423;

/**
 * Geometry and materials every open-world chunk shares. Built once per world and freed with it, never
 * per chunk (chunks only free their own terrain and instance buffers).
 */
export class OpenAssets {
  readonly trunk = trunkGeo();
  readonly roundLeaves = roundFoliageGeo();
  readonly pineLeaves = pineFoliageGeo();
  readonly pineSnow = pineSnowGeo();
  readonly boulders: BoulderGeo[];
  readonly stalk = stalkGeo();
  readonly stalkRing = stalkRingGeo();
  readonly leafTuft = leafTuftGeo();
  readonly shrub = new THREE.IcosahedronGeometry(1, 1);
  readonly grass = grassGeo();
  readonly flower = flowerGeo();
  readonly lily = lilyPadGeo();
  /** What's left of a depleted node: tree stump, a few pebbles, cut bamboo, a flattened scrap heap. */
  readonly stump: Baked;
  readonly pebbles: Baked;
  readonly groveStubs: Baked;
  readonly scrap: Baked;
  readonly scrapSpent: Baked;
  readonly crate: Baked;
  readonly crateOpen: Baked;
  readonly bag: Baked;
  readonly ring = new THREE.RingGeometry(0.45, 0.62, 24).rotateX(-Math.PI / 2);
  readonly waterPlane = new THREE.PlaneGeometry(OPEN.chunk, OPEN.chunk).rotateX(-Math.PI / 2);
  /** Unit disc and rim for frozen ponds (scaled to the pond). */
  readonly disc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  readonly discRim = new THREE.RingGeometry(0.82, 0.9, 48).rotateX(-Math.PI / 2);

  /** White toon, coloured per instance. */
  readonly plain = toonInstanced();
  /** Vertex colours (baked models, boulders) times the instance colour. */
  readonly painted = toonInstanced();
  /** Moss and snow caps on boulders, drawn over the same facets. */
  readonly cap = toonInstanced();
  readonly ink = outlineMaterial();
  /** Smooth ground and faceted rock faces, like the normal maps' terrain. */
  readonly ground: THREE.MeshLambertMaterial[] = [
    new THREE.MeshLambertMaterial({ vertexColors: true }),
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  ];
  readonly ice: THREE.MeshLambertMaterial;
  readonly iceRim = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  readonly bagGlow = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.5, depthWrite: false });
  private readonly waters = new Map<BiomeId, THREE.MeshLambertMaterial>();

  constructor(private readonly map: GameMap) {
    const world = map.open!;
    this.boulders = Array.from({ length: BOULDER_SHAPES }, (_, i) => boulderGeometry(world.seed + 101 + i * 7919));
    this.painted.vertexColors = true;
    this.cap.polygonOffset = true;
    this.cap.polygonOffsetFactor = -1;
    this.cap.polygonOffsetUnits = -2;
    this.ice = new THREE.MeshLambertMaterial({ color: world.biomes.snow.theme.ice ?? 0xd3ecf6, transparent: true, opacity: 0.92 });
    this.stump = stumpModel();
    this.pebbles = pebblesModel();
    this.groveStubs = groveStubsModel();
    this.scrap = scrapModel(false);
    this.scrapSpent = scrapModel(true);
    this.crate = crateModel(false);
    this.crateOpen = crateModel(true);
    this.bag = bagModel();
  }

  /** Water of a biome (fen water is murkier than a mountain pond): one material per biome, shared by chunks. */
  water(biome: BiomeId): THREE.MeshLambertMaterial {
    let m = this.waters.get(biome);
    if (!m) {
      const theme = this.map.open!.biomes[biome].theme;
      m = new THREE.MeshLambertMaterial({ color: theme.water, transparent: true, opacity: theme.waterOpacity, side: THREE.DoubleSide });
      this.waters.set(biome, m);
    }
    return m;
  }

  dispose(): void {
    const geos: (THREE.BufferGeometry | null)[] = [
      this.trunk,
      this.roundLeaves,
      this.pineLeaves,
      this.pineSnow,
      this.stalk,
      this.stalkRing,
      this.leafTuft,
      this.shrub,
      this.grass,
      this.flower,
      this.lily,
      this.ring,
      this.waterPlane,
      this.disc,
      this.discRim,
    ];
    for (const b of this.boulders) geos.push(b.body, b.cap, b.outline);
    for (const b of [this.stump, this.pebbles, this.groveStubs, this.scrap, this.scrapSpent, this.crate, this.crateOpen, this.bag]) {
      geos.push(b.body, b.ink);
    }
    for (const g of geos) g?.dispose();
    // The ink material is shared by the whole game: not ours to free.
    for (const m of [this.plain, this.painted, this.cap, ...this.ground, this.ice, this.iceRim, this.bagGlow, ...this.waters.values()]) m.dispose();
    this.waters.clear();
  }
}

// ---------------------------------------------------------------- models

/** A cut trunk with a pale top, for a tree of scale 1. */
function stumpModel(): Baked {
  return bake([
    part(new THREE.CylinderGeometry(0.28, 0.36, 0.55, 7), 0x6b4a36, 0, 0.17, 0, { ink: 1.08 }),
    part(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 7), 0xe0c08a, 0, 0.45, 0),
    part(new THREE.CylinderGeometry(0.09, 0.12, 0.5, 5), 0x6b4a36, 0.3, 0.02, 0.05, { rz: -1.1 }),
    part(new THREE.CylinderGeometry(0.08, 0.11, 0.45, 5), 0x6b4a36, -0.22, 0.02, -0.22, { rx: -1.0, ry: 0.6 }),
    // Chips of wood scattered around.
    part(new THREE.BoxGeometry(0.18, 0.04, 0.08), 0xd8b27a, 0.55, 0.02, -0.3, { ry: 0.7 }),
    part(new THREE.BoxGeometry(0.14, 0.04, 0.07), 0xd8b27a, -0.45, 0.02, 0.4, { ry: -0.4 }),
  ]);
}

/** A few broken-off stones where a boulder was, for a rock of scale 1 (tinted per instance). */
function pebblesModel(): Baked {
  const stones: [number, number, number][] = [
    [0, 0, 0.32],
    [0.42, 0.25, 0.22],
    [-0.35, 0.3, 0.2],
    [0.1, -0.45, 0.18],
    [-0.3, -0.3, 0.14],
  ];
  return bake(
    stones.map(([x, z, r], i) =>
      part(new THREE.DodecahedronGeometry(r, 0), 0xdadde0, x, r * 0.45, z, { sy: 0.6, ry: i * 1.3, ink: i === 0 ? 1.1 : undefined }),
    ),
  );
}

/** Bamboo cut down to stubs, a couple of stalks lying about: a harvested grove of radius ~1.2. */
function groveStubsModel(): Baked {
  const rng = new Rng(4127);
  const parts: Part[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const d = rng.range(0.3, 0.95);
    const h = rng.range(0.22, 0.5);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    parts.push(part(new THREE.CylinderGeometry(0.075, 0.09, h, 6), 0x8cb34a, x, h / 2 - 0.05, z, { ink: 1.15 }));
    parts.push(part(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 6), 0xe3edb0, x, h - 0.04, z));
  }
  parts.push(part(new THREE.CylinderGeometry(0.07, 0.08, 1.8, 6), 0xb5b96a, 0.1, 0.07, 0.2, { rz: Math.PI / 2, ry: 0.5 }));
  parts.push(part(new THREE.CylinderGeometry(0.07, 0.08, 1.5, 6), 0xa8b062, -0.2, 0.07, -0.35, { rz: Math.PI / 2, ry: -0.9 }));
  return bake(parts);
}

/** A heap of junk (radius ~1): rusty box, a sheet of tin, a tyre, a pipe, cans. `spent`: picked over, flat. */
function scrapModel(spent: boolean): Baked {
  if (spent) {
    return bake([
      part(new THREE.BoxGeometry(0.9, 0.04, 0.6), METAL, 0.1, 0.02, 0, { ry: 0.5 }),
      part(new THREE.TorusGeometry(0.3, 0.1, 6, 12), TYRE, -0.5, 0.06, 0.35, { rx: Math.PI / 2, ink: 1.06 }),
      part(new THREE.BoxGeometry(0.16, 0.08, 0.1), RUST, 0.55, 0.04, -0.4, { ry: 1.1 }),
      part(new THREE.BoxGeometry(0.12, 0.06, 0.2), 0x9aa0a6, -0.1, 0.03, -0.55, { ry: -0.3 }),
    ]);
  }
  return bake([
    part(new THREE.BoxGeometry(0.8, 0.45, 0.6), RUST, 0, 0.18, 0, { ry: 0.4, ink: 1.06 }),
    part(new THREE.BoxGeometry(1.0, 0.05, 0.7), METAL, 0.15, 0.45, 0.1, { rz: 0.25, ry: -0.3 }),
    part(new THREE.TorusGeometry(0.32, 0.12, 6, 12), TYRE, -0.6, 0.12, 0.35, { rx: Math.PI / 2 - 0.2, ink: 1.06 }),
    part(new THREE.CylinderGeometry(0.08, 0.08, 1.3, 8), 0x9aa0a6, 0.05, 0.6, -0.25, { rz: Math.PI / 2, ry: 0.7 }),
    part(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 8), 0xb8402e, 0.62, 0.2, -0.45, { ink: 1.08 }),
    part(new THREE.CylinderGeometry(0.15, 0.15, 0.35, 8), 0x5f8a6a, 0.55, 0.12, 0.5, { rz: Math.PI / 2, ry: 0.4 }),
    part(new THREE.BoxGeometry(0.35, 0.3, 0.35), 0x5f6f7c, -0.3, 0.55, -0.3, { ry: 0.8, rz: 0.2 }),
  ]);
}

/** A supply crate (closed: banded lid on; open: lid thrown back, empty inside). */
function crateModel(open: boolean): Baked {
  const parts = [
    part(new THREE.BoxGeometry(0.8, 0.55, 0.6), CRATE, 0, 0.27, 0, { ink: 1.06 }),
    part(new THREE.BoxGeometry(0.84, 0.08, 0.64), CRATE_BAND, 0, 0.1, 0),
    part(new THREE.BoxGeometry(0.84, 0.08, 0.64), CRATE_BAND, 0, 0.45, 0),
    // A painted stripe so it reads as a supply crate from afar.
    part(new THREE.BoxGeometry(0.3, 0.2, 0.02), 0xe2463f, 0, 0.27, 0.31),
  ];
  if (open) {
    parts.push(part(new THREE.BoxGeometry(0.72, 0.02, 0.52), 0x3b2a20, 0, 0.53, 0));
    parts.push(part(new THREE.BoxGeometry(0.84, 0.06, 0.64), 0x8b5a3c, 0, 0.72, -0.5, { rx: -1.2, ink: 1.05 }));
  } else {
    parts.push(part(new THREE.BoxGeometry(0.86, 0.08, 0.66), 0x8b5a3c, 0, 0.58, 0, { ink: 1.05 }));
  }
  return bake(parts);
}

/** A dropped backpack. */
function bagModel(): Baked {
  return bake([
    part(new THREE.BoxGeometry(0.46, 0.5, 0.3), 0xd8463f, 0, 0.25, 0, { ink: 1.08 }),
    part(new THREE.BoxGeometry(0.48, 0.2, 0.33), 0xb83a33, 0, 0.45, 0.01),
    part(new THREE.BoxGeometry(0.3, 0.18, 0.06), 0xb83a33, 0, 0.18, 0.17),
    part(new THREE.BoxGeometry(0.06, 0.46, 0.04), 0x6b4423, -0.13, 0.27, -0.17),
    part(new THREE.BoxGeometry(0.06, 0.46, 0.04), 0x6b4423, 0.13, 0.27, -0.17),
    part(new THREE.BoxGeometry(0.1, 0.06, 0.04), 0xffd34d, 0, 0.36, 0.18),
  ]);
}
