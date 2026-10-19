import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GOAL_RADIUS } from '../config';
import { smoothstep, valueNoise } from '../core/math';
import type { GameMap } from '../sim/gameMap';
import type { DecorProp, RockProp, StalkProp, TreeProp } from '../sim/props';
import { addOutline, toon, toonInstanced } from './toon';

export interface WorldView {
  group: THREE.Group;
  terrain: THREE.Mesh;
  update(dt: number, time: number): void;
}

export function buildWorld(map: GameMap): WorldView {
  const group = new THREE.Group();
  const terrain = buildTerrain(map);
  const goal = buildGoal(map);
  const camp = buildCamp(map);
  group.add(terrain, buildWater(map), ...buildTrees(map), buildRocks(map), ...buildBamboo(map), ...buildDecor(map));
  group.add(camp.group, goal.group);
  return {
    group,
    terrain,
    update: (_dt, time) => {
      goal.update(time);
      camp.update(time);
    },
  };
}

// ---------------------------------------------------------------- helpers

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

function instanced<T>(
  geo: THREE.BufferGeometry,
  items: readonly T[],
  place: (item: T, o: THREE.Object3D) => void,
  color: (item: T, c: THREE.Color) => void,
  shadows = true,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, toonInstanced(), Math.max(1, items.length));
  mesh.count = items.length;
  items.forEach((item, i) => {
    tmpObj.position.set(0, 0, 0);
    tmpObj.rotation.set(0, 0, 0);
    tmpObj.scale.set(1, 1, 1);
    place(item, tmpObj);
    tmpObj.updateMatrix();
    mesh.setMatrixAt(i, tmpObj.matrix);
    color(item, tmpColor);
    mesh.setColorAt(i, tmpColor);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

const pickHex = (palette: readonly number[], t: number) => palette[Math.min(palette.length - 1, Math.floor(t * palette.length))];

// ---------------------------------------------------------------- terrain

const GRASS_A = new THREE.Color(0x9ad660);
const GRASS_B = new THREE.Color(0x6fb84c);
const HILLTOP = new THREE.Color(0xc1e27a);
const THICKET = new THREE.Color(0x5c9a3e);
const CLEARING = new THREE.Color(0xcdb47c);
const SAND = new THREE.Color(0xead9a2);
const MUD = new THREE.Color(0x8e8a5c);
const RIM = new THREE.Color(0x578f40);

function terrainColor(map: GameMap, x: number, y: number, z: number, out: THREE.Color): void {
  const { layout, terrain } = map;
  out.copy(GRASS_A).lerp(GRASS_B, valueNoise(x / 9, z / 9, layout.seed + 3));
  out.lerp(HILLTOP, smoothstep(2.5, layout.hill.h, y));
  for (const t of layout.thickets) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < t.r + 2) out.lerp(THICKET, 1 - smoothstep(t.r - 1, t.r + 2, d));
  }
  for (const c of [layout.start, layout.goal]) {
    const d = Math.hypot(x - c.x, z - c.z);
    out.lerp(CLEARING, (1 - smoothstep(c.r * 0.4, c.r, d)) * 0.55);
  }
  const dp = Math.hypot(x - layout.pond.x, z - layout.pond.z);
  out.lerp(SAND, 1 - smoothstep(layout.pond.r - 1.5, layout.pond.r + 1.5, dp));
  if (y < terrain.waterLevel) out.lerp(MUD, 0.8);
  const edge = Math.max(Math.abs(x), Math.abs(z));
  out.lerp(RIM, smoothstep(layout.size / 2 - 2, layout.size / 2 + 12, edge));
}

function buildTerrain(map: GameMap): THREE.Mesh {
  const { positions, indices } = map.grid;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    terrainColor(map, positions[i], positions[i + 1], positions[i + 2], tmpColor);
    colors[i] = tmpColor.r;
    colors[i + 1] = tmpColor.g;
    colors[i + 2] = tmpColor.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

// ---------------------------------------------------------------- water

function buildWater(map: GameMap): THREE.Group {
  const { pond } = map.layout;
  const g = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(pond.r, 48),
    new THREE.MeshLambertMaterial({ color: 0x55c4e8, transparent: true, opacity: 0.8 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(pond.x, map.terrain.waterLevel, pond.z);
  water.receiveShadow = true;
  g.add(water);

  const padGeo = new THREE.CircleGeometry(0.55, 12, 0.5, Math.PI * 2 - 0.9).rotateX(-Math.PI / 2);
  g.add(
    instanced<DecorProp>(
      padGeo,
      map.props.lilies,
      (l, o) => {
        o.position.set(l.x, map.terrain.waterLevel + 0.02, l.z);
        o.rotation.y = l.rot;
        o.scale.setScalar(l.scale);
      },
      (l, c) => c.setHex(l.tint > 0.5 ? 0x5fae48 : 0x6dbd52),
      false,
    ),
  );
  return g;
}

// ---------------------------------------------------------------- trees & rocks

function roundFoliageGeo(): THREE.BufferGeometry {
  const blobs: [number, number, number, number][] = [
    [0, 3.2, 0, 1.55],
    [0.85, 2.7, 0.35, 1.1],
    [-0.75, 2.8, -0.25, 1.15],
    [0.1, 4.05, 0.05, 0.95],
  ];
  return mergeGeometries(blobs.map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 0).translate(x, y, z)))!;
}

function pineFoliageGeo(): THREE.BufferGeometry {
  const tiers: [number, number, number][] = [
    [2.0, 1.7, 2.3],
    [1.5, 1.6, 3.2],
    [1.0, 1.4, 4.1],
  ];
  return mergeGeometries(tiers.map(([r, h, y]) => new THREE.ConeGeometry(r, h, 7).translate(0, y, 0)))!;
}

const ROUND_GREENS = [0x6cc24a, 0x82d05a, 0x5db34a, 0x9fd65c, 0x76c84f];
const PINE_GREENS = [0x3f9a55, 0x4cab62, 0x378c4e];

function buildTrees(map: GameMap): THREE.Object3D[] {
  const all = map.props.trees;
  const place = (t: TreeProp, o: THREE.Object3D) => {
    o.position.set(t.x, t.y - 0.1, t.z);
    o.rotation.y = t.rot;
    o.scale.setScalar(t.scale);
  };
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.6, 7).translate(0, 1.3, 0);
  return [
    instanced(trunkGeo, all, place, (_t, c) => c.setHex(0x8b5a3c)),
    instanced(roundFoliageGeo(), all.filter((t) => t.kind === 'round'), place, (t, c) => c.setHex(pickHex(ROUND_GREENS, t.tint))),
    instanced(pineFoliageGeo(), all.filter((t) => t.kind === 'pine'), place, (t, c) => c.setHex(pickHex(PINE_GREENS, t.tint))),
  ];
}

function buildRocks(map: GameMap): THREE.InstancedMesh {
  return instanced<RockProp>(
    new THREE.DodecahedronGeometry(1, 0),
    map.props.rocks,
    (r, o) => {
      o.position.set(r.x, r.y - 0.25 * r.scale, r.z);
      o.rotation.set(0.3, r.rot, 0.2);
      o.scale.set(r.scale, r.scale * 0.7, r.scale * 0.9);
    },
    (r, c) => c.setHex(pickHex([0x9ea3a8, 0xb3b6b0, 0x8f949a], r.tint)),
  );
}

// ---------------------------------------------------------------- bamboo

function leafTuftGeo(): THREE.BufferGeometry {
  const leaves: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 5; k++) {
    leaves.push(
      new THREE.ConeGeometry(0.14, 0.9, 3)
        .rotateZ(-(Math.PI / 2 + 0.35))
        .translate(0.42, -0.15, 0)
        .rotateY((k * Math.PI * 2) / 5 + k * 0.3),
    );
  }
  return mergeGeometries(leaves)!;
}

function buildBamboo(map: GameMap): THREE.Object3D[] {
  const stalks = map.props.stalks;
  const base = (s: StalkProp, o: THREE.Object3D) => {
    o.position.set(s.x, s.y - 0.05, s.z);
    o.rotation.set(s.leanX, 0, s.leanZ);
  };

  const nodes: { s: StalkProp; f: number }[] = [];
  const tufts: { s: StalkProp; f: number; scale: number }[] = [];
  for (const s of stalks) {
    for (const f of [0.22, 0.45, 0.68, 0.88]) nodes.push({ s, f });
    tufts.push({ s, f: 1, scale: 1 }, { s, f: 0.7, scale: 0.7 });
  }

  return [
    instanced(
      new THREE.CylinderGeometry(0.07, 0.09, 1, 6).translate(0, 0.5, 0),
      stalks,
      (s, o) => {
        base(s, o);
        o.scale.set(1, s.height, 1);
      },
      (s, c) => c.setHex(pickHex([0x8cc84b, 0x7dbb45, 0x9bd257], s.tint)),
    ),
    instanced(
      new THREE.CylinderGeometry(0.1, 0.1, 0.06, 6),
      nodes,
      (n, o) => {
        base(n.s, o);
        o.translateY(n.s.height * n.f);
      },
      (_n, c) => c.setHex(0x5e9a34),
      false,
    ),
    instanced(
      leafTuftGeo(),
      tufts,
      (t, o) => {
        base(t.s, o);
        o.translateY(t.s.height * t.f);
        o.rotateY(t.s.tint * 6.28 + t.f);
        o.scale.setScalar(t.scale);
      },
      (t, c) => c.setHex(pickHex([0x5fb347, 0x6fc152, 0x4fa23e], (t.s.tint * 7.3) % 1)),
    ),
  ];
}

// ---------------------------------------------------------------- grass & flowers

function buildDecor(map: GameMap): THREE.Object3D[] {
  const blades = [-0.35, 0, 0.35].map((tilt, i) =>
    new THREE.ConeGeometry(0.07, 0.5, 3)
      .translate(0, 0.25, 0)
      .rotateZ(tilt)
      .translate((i - 1) * 0.06, 0, (i % 2) * 0.05),
  );
  const flowerHead = new THREE.SphereGeometry(0.11, 6, 4).scale(1, 0.6, 1).translate(0, 0.12, 0);
  return [
    instanced<DecorProp>(
      mergeGeometries(blades)!,
      map.props.grass,
      (g, o) => {
        o.position.set(g.x, g.y - 0.02, g.z);
        o.rotation.y = g.rot;
        o.scale.setScalar(g.scale);
      },
      (g, c) => c.setHex(pickHex([0x7cc855, 0x6ab84a, 0x93d862], g.tint)),
      false,
    ),
    instanced<DecorProp>(
      flowerHead,
      map.props.flowers,
      (f, o) => {
        o.position.set(f.x, f.y, f.z);
        o.scale.setScalar(f.scale);
      },
      (f, c) => c.setHex(pickHex([0xff8fb1, 0xffe066, 0xffffff, 0xc39bff, 0xff9f5a], f.tint)),
      false,
    ),
  ];
}

// ---------------------------------------------------------------- start camp

function buildCamp(map: GameMap): { group: THREE.Group; update(time: number): void } {
  const { start, goal } = map.layout;
  const g = new THREE.Group();
  const at = (dx: number, dz: number) => new THREE.Vector3(start.x + dx, map.terrain.heightAt(start.x + dx, start.z + dz), start.z + dz);
  const mesh = (geo: THREE.BufferGeometry, color: number, outline = 1.05) => {
    const m = new THREE.Mesh(geo, toon(color));
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    if (outline) addOutline(m, outline);
    return m;
  };

  const tent = mesh(new THREE.ConeGeometry(1.7, 2.1, 4), 0xf28c48, 1.04);
  tent.position.copy(at(-5, -2)).y += 1.05;
  tent.rotation.y = Math.PI / 4 + 0.3;

  const crates: [number, number, number][] = [
    [-2.5, -5, 0.8],
    [-1.6, -5.3, 0.6],
    [-2.2, -4.2, 0.55],
  ];
  for (const [dx, dz, s] of crates) {
    const crate = mesh(new THREE.BoxGeometry(s, s, s), 0xb07a45, 1.06);
    crate.position.copy(at(dx, dz)).y += s / 2;
    crate.rotation.y = dx;
  }

  // Signpost pointing at the rescue hut.
  const postPos = at(3, -3);
  const post = mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.7, 6), 0x8b5a3c, 1.1);
  post.position.copy(postPos).y += 0.85;
  const sign = new THREE.Group();
  sign.position.copy(postPos).y += 1.45;
  sign.rotation.y = Math.atan2(-(goal.z - postPos.z), goal.x - postPos.x);
  g.add(sign);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.32, 0.06), toon(0xe0b46a));
  board.position.x = 0.4;
  board.castShadow = true;
  sign.add(board);
  addOutline(board, 1.06);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.36, 3), toon(0xe2463f));
  arrow.rotation.z = -Math.PI / 2;
  arrow.position.x = 1.05;
  sign.add(arrow);
  addOutline(arrow, 1.08);

  // Campfire.
  const firePos = at(-2.2, 0.6);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const stone = mesh(new THREE.DodecahedronGeometry(0.16, 0), 0x9ea3a8, 0);
    stone.position.set(firePos.x + Math.cos(a) * 0.45, firePos.y + 0.06, firePos.z + Math.sin(a) * 0.45);
  }
  const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.75, 6), new THREE.MeshBasicMaterial({ color: 0xff8a2b }));
  const flameInner = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.45, 6), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  flameOuter.position.copy(firePos).y += 0.37;
  flameInner.position.copy(firePos).y += 0.25;
  g.add(flameOuter, flameInner);

  return {
    group: g,
    update(time) {
      const f = 1 + Math.sin(time * 17) * 0.08 + Math.sin(time * 23) * 0.06;
      flameOuter.scale.set(1, f, 1);
      flameInner.scale.set(1, 2 - f, 1);
    },
  };
}

// ---------------------------------------------------------------- rescue hut

function buildGoal(map: GameMap): { group: THREE.Group; update(time: number): void } {
  const { goal, start } = map.layout;
  const g = new THREE.Group();
  g.position.set(goal.x, map.terrain.heightAt(goal.x, goal.z), goal.z);

  const hut = new THREE.Group();
  hut.rotation.y = Math.atan2(start.x - goal.x, start.z - goal.z); // door faces the start
  g.add(hut);
  const part = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, outline = 1.04) => {
    const m = new THREE.Mesh(geo, toon(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    hut.add(m);
    if (outline) addOutline(m, outline);
    return m;
  };
  part(new THREE.CylinderGeometry(2.6, 2.8, 0.3, 8), 0xa8743f, 0, 0.15, 0);
  part(new THREE.BoxGeometry(3, 2.2, 3), 0xe0c072, 0, 1.4, 0);
  part(new THREE.BoxGeometry(0.9, 1.5, 0.08), 0x6b4423, 0, 1.05, 1.52, 0);
  part(new THREE.ConeGeometry(2.9, 1.8, 4), 0xc98d4a, 0, 3.4, 0).rotation.y = Math.PI / 4;
  part(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), 0xeeeeee, 1.9, 1.7, -1.9, 0);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.65).translate(0.55, 0, 0),
    new THREE.MeshToonMaterial({ color: 0xff5a5a, side: THREE.DoubleSide }),
  );
  flag.position.set(1.9, 3.05, -1.9);
  hut.add(flag);

  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.8, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(GOAL_RADIUS - 0.3, GOAL_RADIUS, 64).rotateX(-Math.PI / 2), ringMat);
  ring.position.y = 0.08;
  g.add(ring);

  // Tall soft beam so the goal can be spotted from far away.
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff1a0,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 60, 20, 1, true), beamMat);
  beam.position.y = 30;
  g.add(beam);

  return {
    group: g,
    update(time) {
      flag.rotation.y = Math.sin(time * 3) * 0.3;
      ringMat.opacity = 0.55 + 0.35 * Math.sin(time * 3);
      beamMat.opacity = 0.16 + 0.08 * Math.sin(time * 1.7);
    },
  };
}
