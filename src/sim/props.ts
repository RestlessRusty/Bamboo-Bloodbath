import { SURVIVOR } from '../config';
import { Rng } from '../core/rng';
import type { Circle, MapLayout } from './mapLayout';
import type { Route } from './route';
import { roadDistance, type Terrain } from './terrain';
import type { WeaponType } from './types';

export interface TreeProp {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  kind: 'round' | 'pine';
  tint: number;
  /** Trunk collider radius. */
  radius: number;
  /** Border-forest trees are decoration only. */
  collide: boolean;
}

export interface RockProp {
  x: number;
  y: number;
  z: number;
  /** Radius of the boulder as seen from above (its widest part). */
  scale: number;
  /** How far it sticks out of the ground. */
  height: number;
  rot: number;
  tint: number;
  /** Collider radius (0 for decoration), a little inside the visible edge. */
  radius: number;
}

export interface StalkProp {
  x: number;
  y: number;
  z: number;
  height: number;
  leanX: number;
  leanZ: number;
  tint: number;
}

export interface DecorProp {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
  tint: number;
}

export interface SpotProp {
  x: number;
  y: number;
  z: number;
}

export interface RackProp extends SpotProp {
  /** Weapon on the rack at the start of a match. */
  weapon: WeaponType;
}

export interface MapProps {
  trees: TreeProp[];
  /** Solid boulders. */
  rocks: RockProp[];
  /** Boulders nobody can bump into: pebbles round the solid ones and scree up the ridge flanks. */
  stones: RockProp[];
  stalks: StalkProp[];
  grass: DecorProp[];
  flowers: DecorProp[];
  lilies: DecorProp[];
  /** Where healing bamboo snacks appear. */
  bambooSpots: SpotProp[];
  /** Weapon racks: walk into one to swap weapons. */
  racks: RackProp[];
}

const RACK_WEAPONS: readonly WeaponType[] = ['axe', 'javelin', 'knife', 'axe', 'javelin', 'axe'];

/** How far before and after each bridge, ford or pass its walkway is kept free of trees and rocks. */
const PASSAGE_APPROACH = 6;
/** Room beside a walkway: the biggest rock (radius ~1.2) plus a panda still can't narrow it. */
const PASSAGE_PAD = 2.5;
/** Solid boulders are at least knee-high on a panda, so it's obvious why they stop you. */
const ROCK_MIN_HEIGHT = 0.55;
/** Collider radius as a share of a boulder's visible radius: you touch the stone, then it stops you. */
const ROCK_HIT = 0.9;
/** Scree up a ridge flank stays inside the ridge wall, plus this (a panda's radius, the closest anyone gets). */
const WALL_STANDOFF = SURVIVOR.radius;

const dist = (x: number, z: number, c: { x: number; z: number }) => Math.hypot(x - c.x, z - c.z);

function distToSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / len2));
  return Math.hypot(ax + abx * t - x, az + abz * t - z);
}

/** Deterministically scatters everything that lives on the map. */
export function generateProps(layout: MapLayout, terrain: Terrain, route: Route): MapProps {
  const rng = new Rng(layout.seed);
  const half = layout.size / 2;
  const { start, goal, ponds, hills, thickets, density, theme } = layout;
  const landmarks = layout.landmarks ?? [];
  const solids: Circle[] = [];
  const nearLandmark = (x: number, z: number, gap: number) => landmarks.some((l) => dist(x, z, l) < l.r + gap);
  // Story roads (carts roll there) and objective spots, placed by hand.
  const roads = layout.roads ?? [];
  const clearSpots = layout.clear ?? [];
  const onStoryWay = (x: number, z: number, gap: number) =>
    roads.some((r) => roadDistance(r.points, x, z) < r.width / 2 + gap) || clearSpots.some((c) => dist(x, z, c) < c.r + gap);

  const nearPond = (x: number, z: number, gap: number) => ponds.some((p) => dist(x, z, p) < p.r + gap);
  const nearHilltop = (x: number, z: number, gap: number) => hills.some((h) => dist(x, z, h) < gap);
  const nearCrossing = (x: number, z: number, gap: number) =>
    terrain.crossings.some((c) => dist(x, z, c.a) < gap || dist(x, z, c.b) < gap);
  // The whole walkway through each bridge, ford and pass, plus a run-up on both sides. Inside a pass the
  // ground is open (ridgeAmount 0), so without this a tree or rock could land in the middle of it.
  const inPassage = (x: number, z: number, pad: number) =>
    terrain.crossings.some((c) => {
      const len = c.length || 1;
      const ux = ((c.b.x - c.a.x) / len) * PASSAGE_APPROACH;
      const uz = ((c.b.z - c.a.z) / len) * PASSAGE_APPROACH;
      return distToSegment(x, z, c.a.x - ux, c.a.z - uz, c.b.x + ux, c.b.z + uz) < c.halfWidth + pad;
    });
  // Story buildings are placed by hand (and are solid): flag any that would block a crossing.
  if (import.meta.env.DEV) {
    for (const l of landmarks) {
      if (inPassage(l.x, l.z, l.r)) console.warn(`[map ${layout.id}] landmark at (${l.x}, ${l.z}) blocks a bridge, ford or pass`);
    }
  }
  // Everything that must stay free of props, except the ridges themselves (boulders sit at their foot).
  const nearFeature = (x: number, z: number) =>
    dist(x, z, start) < start.r + 4 ||
    dist(x, z, goal) < goal.r + 4 ||
    nearPond(x, z, 2.5) ||
    terrain.nearRiver(x, z, 2.5) ||
    nearCrossing(x, z, 5) ||
    inPassage(x, z, PASSAGE_PAD) ||
    nearHilltop(x, z, 6) ||
    nearLandmark(x, z, 5) ||
    onStoryWay(x, z, 2.5) ||
    thickets.some((t) => dist(x, z, t) < t.r + 1.5);
  const keepClear = (x: number, z: number) => terrain.ridgeAmount(x, z) > 0.02 || nearFeature(x, z);
  const spaced = (x: number, z: number, gap: number) => solids.every((s) => dist(x, z, s) >= s.r + gap);
  const randomPoint = (margin: number) => ({
    x: rng.range(-half + margin, half - margin),
    z: rng.range(-half + margin, half - margin),
  });
  const pickupSpotOk = (x: number, z: number) =>
    Math.abs(x) < half - 4 &&
    Math.abs(z) < half - 4 &&
    !nearPond(x, z, 1.5) &&
    !terrain.nearRiver(x, z, 1.5) &&
    !nearCrossing(x, z, 3) &&
    !inPassage(x, z, 0.5) &&
    terrain.ridgeAmount(x, z) < 0.02 &&
    !nearLandmark(x, z, 2) &&
    !onStoryWay(x, z, 0.5) &&
    !terrain.isWet(x, z);

  // Weapon racks spread along the route, alternating sides of it.
  const racks: RackProp[] = [];
  const rackWeapons = layout.racks ?? RACK_WEAPONS;
  rackWeapons.forEach((weapon, i) => {
    const p = route.at(0.15 + (i / Math.max(1, rackWeapons.length - 1)) * 0.7);
    for (let tries = 0; tries < 40; tries++) {
      const side = (i % 2 ? 1 : -1) * rng.range(6, 16);
      const x = p.x - side * p.dz + rng.range(-3, 3);
      const z = p.z + side * p.dx + rng.range(-3, 3);
      if (!pickupSpotOk(x, z) || nearHilltop(x, z, 5) || thickets.some((t) => dist(x, z, t) < t.r + 1)) continue;
      racks.push({ x, y: terrain.heightAt(x, z), z, weapon });
      solids.push({ x, z, r: 1.4 });
      break;
    }
  });

  // Bamboo snacks: one beside each thicket, plus a few in the open.
  const bambooSpots: SpotProp[] = [];
  for (const t of thickets) {
    const a = rng.range(0, Math.PI * 2);
    const x = t.x + Math.cos(a) * (t.r + 0.8);
    const z = t.z + Math.sin(a) * (t.r + 0.8);
    if (!pickupSpotOk(x, z)) continue;
    bambooSpots.push({ x, y: terrain.heightAt(x, z), z });
    solids.push({ x, z, r: 0.9 });
  }
  for (let i = 0; i < 300 && bambooSpots.length < thickets.length + 5; i++) {
    const { x, z } = randomPoint(6);
    if (!pickupSpotOk(x, z) || dist(x, z, start) < start.r + 6 || !spaced(x, z, 3)) continue;
    bambooSpots.push({ x, y: terrain.heightAt(x, z), z });
    solids.push({ x, z, r: 0.9 });
  }

  const trees: TreeProp[] = [];
  for (let i = 0; i < density.trees * 27 && trees.length < density.trees; i++) {
    const { x, z } = randomPoint(3);
    if (keepClear(x, z) || !spaced(x, z, 4.2)) continue;
    const scale = rng.range(0.8, 1.3);
    const radius = 0.38 * scale;
    trees.push({
      x,
      y: terrain.heightAt(x, z),
      z,
      scale,
      rot: rng.range(0, Math.PI * 2),
      kind: rng.next() < theme.pineShare ? 'pine' : 'round',
      tint: rng.next(),
      radius,
      collide: true,
    });
    solids.push({ x, z, r: radius });
  }

  // Heights, partner boulders, pebbles and scree draw from their own stream, so they don't shift the rest of the map.
  const rockRng = new Rng(layout.seed ^ 0x2b0c);
  const boulder = (x: number, z: number, scale: number, rot: number, tint: number, solid: boolean): RockProp => ({
    x,
    y: terrain.heightAt(x, z),
    z,
    scale,
    height: Math.max(solid ? ROCK_MIN_HEIGHT : 0, scale * rockRng.range(0.7, 1.05)),
    rot,
    tint,
    radius: solid ? scale * ROCK_HIT : 0,
  });

  const rocks: RockProp[] = [];
  const mains: RockProp[] = [];
  for (let i = 0; i < density.rocks * 45 && mains.length < density.rocks; i++) {
    const { x, z } = randomPoint(3);
    if (keepClear(x, z) || !spaced(x, z, 3)) continue;
    const rock = boulder(x, z, rng.range(0.55, 1.3), rng.range(0, Math.PI * 2), rng.next(), true);
    mains.push(rock);
    solids.push({ x, z, r: rock.radius });
  }

  // Some big boulders get a smaller one leaning on them (solid too), and most get pebbles round the base.
  const stones: RockProp[] = [];
  for (const main of mains) {
    rocks.push(main);
    if (main.scale > 0.85 && rockRng.next() < 0.55) {
      const a = rockRng.range(0, Math.PI * 2);
      const scale = main.scale * rockRng.range(0.45, 0.65);
      const d = (main.scale + scale) * 0.72;
      const x = main.x + Math.cos(a) * d;
      const z = main.z + Math.sin(a) * d;
      const room = solids.every((s) => (s.x === main.x && s.z === main.z) || dist(x, z, s) >= s.r + scale + 1.6);
      const partner = boulder(x, z, scale, rockRng.range(0, Math.PI * 2), rockRng.next(), true);
      if (room && !keepClear(x, z)) {
        rocks.push(partner);
        solids.push({ x, z, r: partner.radius });
      }
    }
    const pebbles = Math.floor(rockRng.range(0, 4));
    for (let k = 0; k < pebbles; k++) {
      const a = rockRng.range(0, Math.PI * 2);
      const d = main.scale + rockRng.range(0.15, 0.9);
      const x = main.x + Math.cos(a) * d;
      const z = main.z + Math.sin(a) * d;
      const pebble = boulder(x, z, rockRng.range(0.12, 0.28), rockRng.range(0, Math.PI * 2), rockRng.next(), false);
      if (pebble.y > terrain.waterLevel + 0.05) stones.push(pebble);
    }
  }

  // Ridges: loose boulders along the crest (out of reach, so no colliders) and solid ones half buried at
  // the foot of the flanks, so the walls look like rock that's been falling down for ages. The flanks
  // in between are too steep for anything to sit on.
  const slope = (x: number, z: number) => {
    const e = 0.6;
    return Math.hypot(terrain.heightAt(x + e, z) - terrain.heightAt(x - e, z), terrain.heightAt(x, z + e) - terrain.heightAt(x, z - e)) / (2 * e);
  };
  const screeEdge = layout.renderSize / 2 - 2;
  for (const ridge of terrain.ridges) {
    for (let s = 0; s < ridge.length; s += 4.5) {
      const p = ridge.at(ridge.fractionOf(s));
      for (const side of [-1, 1]) {
        const roll = rockRng.next();
        const scale = rockRng.range(0.5, 1.2);
        const foot = roll < 0.3;
        const d = foot ? ridge.wallHalf + WALL_STANDOFF + rockRng.range(-0.2, 0.5) : rockRng.range(0, ridge.crest * 0.9);
        const x = p.x - p.tz * side * d;
        const z = p.z + p.tx * side * d;
        const rock = boulder(x, z, scale, rockRng.range(0, Math.PI * 2), rockRng.next(), foot);
        if (roll > 0.6) continue;
        if (foot) {
          if (Math.max(Math.abs(x), Math.abs(z)) > half - 2 || nearFeature(x, z)) continue;
          if (!solids.every((c) => dist(x, z, c) >= c.r + scale + 1.6)) continue;
          rocks.push(rock);
          solids.push({ x, z, r: rock.radius });
        } else {
          if (Math.max(Math.abs(x), Math.abs(z)) > screeEdge || !terrain.isWall(x, z)) continue;
          if (inPassage(x, z, scale + 4) || slope(x, z) > 0.9) continue;
          stones.push(rock);
        }
      }
    }
  }

  // Decorative forest ring outside the walls.
  const outer = layout.renderSize / 2 - 4;
  for (let gx = -outer; gx <= outer; gx += 5) {
    for (let gz = -outer; gz <= outer; gz += 5) {
      const x = gx + rng.range(-1.8, 1.8);
      const z = gz + rng.range(-1.8, 1.8);
      const edge = Math.max(Math.abs(x), Math.abs(z));
      if (edge < half + 1.5 || edge > half + 22 || terrain.nearRiver(x, z, 2) || terrain.ridgeAmount(x, z) > 0.1) continue;
      const scale = rng.range(1, 1.5);
      trees.push({
        x,
        y: terrain.heightAt(x, z),
        z,
        scale,
        rot: rng.range(0, Math.PI * 2),
        kind: rng.next() < (1 + theme.pineShare) / 2 ? 'pine' : 'round',
        tint: rng.next(),
        radius: 0.38 * scale,
        collide: false,
      });
    }
  }

  const stalks: StalkProp[] = [];
  for (const t of thickets) {
    const n = Math.round(t.r * t.r * 1.5);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = Math.sqrt(rng.next()) * t.r;
      const x = t.x + Math.cos(a) * d;
      const z = t.z + Math.sin(a) * d;
      stalks.push({
        x,
        y: terrain.heightAt(x, z),
        z,
        height: rng.range(3.4, 5.8) * (1 - 0.35 * (d / t.r)),
        leanX: rng.range(-0.08, 0.08),
        leanZ: rng.range(-0.08, 0.08),
        tint: rng.next(),
      });
    }
  }

  // Grass and flowers: not in water, on ice or up the rock faces.
  const plantable = (x: number, z: number, y: number) =>
    y > terrain.waterLevel + 0.05 && terrain.ridgeAmount(x, z) < 0.3 && !terrain.isIce(x, z);

  const grass: DecorProp[] = [];
  for (let i = 0; i < density.grass; i++) {
    const { x, z } = randomPoint(1);
    const y = terrain.heightAt(x, z);
    if (!plantable(x, z, y)) continue;
    grass.push({ x, y, z, scale: rng.range(0.7, 1.4), rot: rng.range(0, Math.PI * 2), tint: rng.next() });
  }

  const flowers: DecorProp[] = [];
  for (let c = 0; c < density.flowerPatches; c++) {
    const center = randomPoint(4);
    const tint = rng.next();
    for (let i = 0; i < 9; i++) {
      const x = center.x + rng.range(-2.5, 2.5);
      const z = center.z + rng.range(-2.5, 2.5);
      const y = terrain.heightAt(x, z);
      if (!plantable(x, z, y)) continue;
      flowers.push({ x, y, z, scale: rng.range(0.8, 1.2), rot: 0, tint });
    }
  }

  const lilies: DecorProp[] = [];
  if (theme.lilies.length) {
    for (const pond of ponds) {
      if (pond.frozen) continue;
      const count = Math.round(pond.r * 0.9);
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * pond.r * 0.65;
        lilies.push({
          x: pond.x + Math.cos(a) * d,
          y: terrain.waterLevel,
          z: pond.z + Math.sin(a) * d,
          scale: rng.range(0.7, 1.2),
          rot: rng.range(0, Math.PI * 2),
          tint: rng.next(),
        });
      }
    }
  }

  return { trees, rocks, stones, stalks, grass, flowers, lilies, bambooSpots, racks };
}
