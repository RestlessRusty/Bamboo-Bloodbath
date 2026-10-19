import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GOAL_RADIUS } from '../config';
import { smoothstep, valueNoise } from '../core/math';
import type { GameMap } from '../sim/gameMap';
import type { DecorProp, RockProp, StalkProp, TreeProp } from '../sim/props';
import type { RiverShape } from '../sim/river';
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
  group.add(terrain, buildWater(map), buildCrossings(map), ...buildTrees(map), buildRocks(map), ...buildBamboo(map), ...buildDecor(map));
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

/** Ground colours of a map, ready for blending. */
export class GroundPalette {
  readonly a: THREE.Color;
  readonly b: THREE.Color;
  readonly high: THREE.Color;
  readonly thicket: THREE.Color;
  readonly clearing: THREE.Color;
  readonly shore: THREE.Color;
  readonly mud: THREE.Color;
  readonly rim: THREE.Color;
  readonly cliff: THREE.Color;
  /** Height where hilltop colouring is complete. */
  readonly peak: number;

  constructor(map: GameMap) {
    const g = map.layout.theme.ground;
    this.a = new THREE.Color(g.a);
    this.b = new THREE.Color(g.b);
    this.high = new THREE.Color(g.high);
    this.thicket = new THREE.Color(g.thicket);
    this.clearing = new THREE.Color(g.clearing);
    this.shore = new THREE.Color(g.shore);
    this.mud = new THREE.Color(g.mud);
    this.rim = new THREE.Color(g.rim);
    this.cliff = new THREE.Color(g.cliff);
    this.peak = Math.max(3.5, map.terrain.peak());
  }
}

export function terrainColor(map: GameMap, pal: GroundPalette, x: number, y: number, z: number, out: THREE.Color): void {
  const { layout, terrain } = map;
  out.copy(pal.a).lerp(pal.b, valueNoise(x / 9, z / 9, layout.seed + 3));
  out.lerp(pal.high, smoothstep(2.5, pal.peak, y));
  if (terrain.ridges.length) {
    // Bare rock up the ridge sides, a cap of hilltop colour (snow) along the crest.
    const ra = terrain.ridgeAmount(x, z);
    if (ra > 0) {
      out.lerp(pal.cliff, smoothstep(0.08, 0.4, ra));
      out.lerp(pal.high, smoothstep(0.82, 0.97, ra) * 0.9);
    }
  }
  for (const t of layout.thickets) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < t.r + 2) out.lerp(pal.thicket, 1 - smoothstep(t.r - 1, t.r + 2, d));
  }
  for (const c of [layout.start, layout.goal]) {
    const d = Math.hypot(x - c.x, z - c.z);
    out.lerp(pal.clearing, (1 - smoothstep(c.r * 0.4, c.r, d)) * 0.55);
  }
  for (const p of layout.ponds) {
    const dp = Math.hypot(x - p.x, z - p.z);
    if (dp < p.r + 1.5) out.lerp(pal.shore, 1 - smoothstep(p.r - 1.5, p.r + 1.5, dp));
  }
  for (const r of terrain.rivers) {
    const d = r.distance(x, z);
    if (d < r.halfWidth + 1.5) out.lerp(pal.shore, 1 - smoothstep(r.halfWidth - 1.5, r.halfWidth + 1.5, d));
  }
  // Muddier the deeper it gets, so shallow fords stay sandy.
  if (y < terrain.waterLevel) out.lerp(pal.mud, 0.8 * smoothstep(0, 0.3, terrain.waterLevel - y));
  const edge = Math.max(Math.abs(x), Math.abs(z));
  out.lerp(pal.rim, smoothstep(layout.size / 2 - 2, layout.size / 2 + 12, edge));
}

function buildTerrain(map: GameMap): THREE.Mesh {
  const { positions, indices } = map.grid;
  const pal = new GroundPalette(map);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    terrainColor(map, pal, positions[i], positions[i + 1], positions[i + 2], tmpColor);
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
  const { ponds, theme } = map.layout;
  const g = new THREE.Group();
  const waterMat = new THREE.MeshLambertMaterial({
    color: theme.water,
    transparent: true,
    opacity: theme.waterOpacity,
    side: THREE.DoubleSide,
  });
  for (const pond of ponds) {
    if (pond.frozen) continue;
    const water = new THREE.Mesh(new THREE.CircleGeometry(pond.r, 48), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(pond.x, map.terrain.waterLevel, pond.z);
    water.receiveShadow = true;
    g.add(water);
  }

  // Frozen ponds: a sheet of ice with a frosty rim, flush with the ground.
  const frozen = ponds.filter((p) => p.frozen);
  if (frozen.length) {
    const iceMat = new THREE.MeshLambertMaterial({ color: theme.ice ?? 0xd3ecf6, transparent: true, opacity: 0.92 });
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
    for (const pond of frozen) {
      const y = map.terrain.heightAt(pond.x, pond.z) + 0.03;
      const ice = new THREE.Mesh(new THREE.CircleGeometry(pond.r, 48).rotateX(-Math.PI / 2), iceMat);
      ice.position.set(pond.x, y, pond.z);
      ice.receiveShadow = true;
      const rim = new THREE.Mesh(new THREE.RingGeometry(pond.r * 0.82, pond.r * 0.9, 48).rotateX(-Math.PI / 2), rimMat);
      rim.position.set(pond.x, y + 0.01, pond.z);
      g.add(ice, rim);
    }
  }
  for (const river of map.terrain.rivers) {
    const water = new THREE.Mesh(riverGeometry(river, map.terrain.waterLevel), waterMat);
    water.receiveShadow = true;
    g.add(water);
  }
  if (!map.props.lilies.length) return g;

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
      (l, c) => c.setHex(pickHex(theme.lilies, l.tint)),
      false,
    ),
  );
  return g;
}

/** Flat ribbon along the river's centre line, a little wider than the channel (the banks hide the edges). */
function riverGeometry(river: RiverShape, y: number): THREE.BufferGeometry {
  const pts = river.pts;
  const hw = river.halfWidth + 0.8;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    normals.push(0, 1, 0, 0, 1, 0);
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / tl;
    const nz = (b.x - a.x) / tl;
    positions.push(pts[i].x + nx * hw, y, pts[i].z + nz * hw, pts[i].x - nx * hw, y, pts[i].z - nz * hw);
    if (i > 0) {
      const k = i * 2;
      // Both windings work: the material is double-sided.
      indices.push(k - 2, k - 1, k, k, k - 1, k + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

// ---------------------------------------------------------------- bridges & fords

function buildCrossings(map: GameMap): THREE.Group {
  const g = new THREE.Group();
  const terrain = map.terrain;

  for (const b of terrain.bridges) {
    const bridge = new THREE.Group();
    bridge.position.set(b.x, b.top, b.z);
    bridge.rotation.y = Math.atan2(-b.dirZ, b.dirX); // local +X runs along the deck
    const len = b.halfLength * 2;
    const wid = b.halfWidth * 2;

    // Planks across the deck, with small gaps.
    const planks: THREE.BufferGeometry[] = [];
    const count = Math.round(len / 0.55);
    for (let i = 0; i < count; i++) {
      const x = -b.halfLength + (i + 0.5) * (len / count);
      planks.push(new THREE.BoxGeometry(len / count - 0.06, 0.14, wid - ((i * 7) % 3) * 0.08).translate(x, -0.07, 0));
    }
    const deck = new THREE.Mesh(mergeGeometries(planks)!, toon(0xb07a45));
    deck.castShadow = true;
    deck.receiveShadow = true;
    addOutline(deck, 1.02);

    // Railings: posts and a top rail on each side, plus stilts down into the water.
    const rails: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const zOff = side * (b.halfWidth - 0.08);
      rails.push(new THREE.BoxGeometry(len, 0.1, 0.12).translate(0, 0.78, zOff));
      const posts = Math.max(2, Math.round(len / 2.2));
      for (let i = 0; i <= posts; i++) {
        const x = -b.halfLength + (i / posts) * len;
        rails.push(new THREE.BoxGeometry(0.12, 0.8, 0.12).translate(x, 0.4, zOff));
      }
      for (const x of [-b.halfLength * 0.45, b.halfLength * 0.45]) {
        rails.push(new THREE.CylinderGeometry(0.12, 0.14, 1.4, 6).translate(x, -0.8, zOff));
      }
    }
    // No outline: inverted hulls scale about the bridge centre and would sit off the thin rails.
    const railing = new THREE.Mesh(mergeGeometries(rails)!, toon(0x8b5a3c));
    railing.castShadow = true;
    bridge.add(deck, railing);
    g.add(bridge);
  }

  // Stepping stones mark the fords: wade here.
  const stones: THREE.BufferGeometry[] = [];
  for (const c of terrain.crossings) {
    if (c.kind !== 'ford') continue;
    const n = Math.round(c.length / 1.3);
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const side = i % 2 ? 0.9 : -0.9;
      const ux = (c.b.x - c.a.x) / c.length;
      const uz = (c.b.z - c.a.z) / c.length;
      const x = c.a.x + (c.b.x - c.a.x) * f - uz * side;
      const z = c.a.z + (c.b.z - c.a.z) * f + ux * side;
      stones.push(
        new THREE.DodecahedronGeometry(0.38, 0)
          .scale(1, 0.4, 0.85)
          .rotateY(i * 1.7)
          .translate(x, terrain.heightAt(x, z) + 0.05, z),
      );
    }
  }
  if (stones.length) {
    const mesh = new THREE.Mesh(mergeGeometries(stones)!, toon(0xa4a9ae));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
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

function buildTrees(map: GameMap): THREE.Object3D[] {
  const all = map.props.trees;
  const { theme } = map.layout;
  const place = (t: TreeProp, o: THREE.Object3D) => {
    o.position.set(t.x, t.y - 0.1, t.z);
    o.rotation.y = t.rot;
    o.scale.setScalar(t.scale);
  };
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.6, 7).translate(0, 1.3, 0);
  const pines = all.filter((t) => t.kind === 'pine');
  const meshes = [
    instanced(trunkGeo, all, place, (_t, c) => c.setHex(theme.trunk)),
    instanced(roundFoliageGeo(), all.filter((t) => t.kind === 'round'), place, (t, c) => c.setHex(pickHex(theme.roundLeaves, t.tint))),
    instanced(pineFoliageGeo(), pines, place, (t, c) => c.setHex(pickHex(theme.pineLeaves, t.tint))),
  ];
  if (theme.snowCaps && pines.length) {
    meshes.push(instanced(pineSnowGeo(), pines, place, (_t, c) => c.setHex(0xffffff)));
  }
  return meshes;
}

/** White tips over the upper part of each pine tier. */
function pineSnowGeo(): THREE.BufferGeometry {
  // [radius, height, centre y]: each a bit wider than its tier at that height (see pineFoliageGeo).
  const caps: [number, number, number][] = [
    [0.95, 0.75, 2.775],
    [0.71, 0.7, 3.65],
    [0.48, 0.62, 4.49],
  ];
  return mergeGeometries(caps.map(([r, h, y]) => new THREE.ConeGeometry(r, h, 7).translate(0, y + 0.04, 0)))!;
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
    (r, c) => c.setHex(pickHex(map.layout.theme.rocks, r.tint)),
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

/** Snowy-map thickets: round bushes with a cap of snow, one per stalk spot. */
function buildShrubs(map: GameMap): THREE.Object3D[] {
  const { theme } = map.layout;
  const size = (s: StalkProp) => 0.45 + s.height * 0.12;
  return [
    instanced(
      new THREE.IcosahedronGeometry(1, 1),
      map.props.stalks,
      (s, o) => {
        const r = size(s);
        o.position.set(s.x, s.y + r * 0.55, s.z);
        o.rotation.set(s.leanX, s.tint * 6.28, s.leanZ);
        o.scale.set(r, r * 0.75, r);
      },
      (s, c) => c.setHex(pickHex(theme.stalks, s.tint)),
    ),
    instanced(
      new THREE.IcosahedronGeometry(1, 1),
      map.props.stalks,
      (s, o) => {
        const r = size(s);
        o.position.set(s.x, s.y + r * 0.95, s.z);
        o.rotation.set(0, s.tint * 4.1, 0);
        o.scale.set(r * 0.78, r * 0.4, r * 0.78);
      },
      (_s, c) => c.setHex(theme.stalkNode),
      false,
    ),
  ];
}

function buildBamboo(map: GameMap): THREE.Object3D[] {
  const stalks = map.props.stalks;
  const { theme } = map.layout;
  if (theme.thicketStyle === 'shrub') return buildShrubs(map);
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
      (s, c) => c.setHex(pickHex(theme.stalks, s.tint)),
    ),
    instanced(
      new THREE.CylinderGeometry(0.1, 0.1, 0.06, 6),
      nodes,
      (n, o) => {
        base(n.s, o);
        o.translateY(n.s.height * n.f);
      },
      (_n, c) => c.setHex(theme.stalkNode),
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
      (t, c) => c.setHex(pickHex(theme.stalkLeaves, (t.s.tint * 7.3) % 1)),
    ),
  ];
}

// ---------------------------------------------------------------- grass & flowers

function buildDecor(map: GameMap): THREE.Object3D[] {
  const { theme } = map.layout;
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
      (g, c) => c.setHex(pickHex(theme.grass, g.tint)),
      false,
    ),
    instanced<DecorProp>(
      flowerHead,
      map.props.flowers,
      (f, o) => {
        o.position.set(f.x, f.y, f.z);
        o.scale.setScalar(f.scale);
      },
      (f, c) => c.setHex(pickHex(theme.flowers, f.tint)),
      false,
    ),
  ];
}

// ---------------------------------------------------------------- start camp

function buildCamp(map: GameMap): { group: THREE.Group; update(time: number): void } {
  const { start } = map.layout;
  const goal = map.route.pts[1]; // the way out of camp: first waypoint, or the hut
  const g = new THREE.Group();
  // Offsets below are laid out for a way out to the north-east (+X, -Z); turn them towards the real one.
  const turn = Math.atan2(goal.z - start.z, goal.x - start.x) - Math.atan2(-1, 1);
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const at = (ox: number, oz: number) => {
    const x = start.x + ox * cos - oz * sin;
    const z = start.z + ox * sin + oz * cos;
    return new THREE.Vector3(x, map.terrain.heightAt(x, z), z);
  };
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
  const { goal } = map.layout;
  const pts = map.route.pts;
  const from = pts[pts.length - 2]; // where you arrive from: last waypoint, or the camp
  const g = new THREE.Group();
  g.position.set(goal.x, map.terrain.heightAt(goal.x, goal.z), goal.z);

  const hut = new THREE.Group();
  hut.rotation.y = Math.atan2(from.x - goal.x, from.z - goal.z); // door faces the way in
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
