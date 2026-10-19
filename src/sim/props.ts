import { Rng } from '../core/rng';
import type { Circle, MapLayout } from './mapLayout';
import type { Route } from './route';
import type { Terrain } from './terrain';
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
  scale: number;
  rot: number;
  tint: number;
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
  rocks: RockProp[];
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

const dist = (x: number, z: number, c: { x: number; z: number }) => Math.hypot(x - c.x, z - c.z);

/** Deterministically scatters everything that lives on the map. */
export function generateProps(layout: MapLayout, terrain: Terrain, route: Route): MapProps {
  const rng = new Rng(layout.seed);
  const half = layout.size / 2;
  const { start, goal, ponds, hills, thickets, density, theme } = layout;
  const solids: Circle[] = [];

  const nearPond = (x: number, z: number, gap: number) => ponds.some((p) => dist(x, z, p) < p.r + gap);
  const nearHilltop = (x: number, z: number, gap: number) => hills.some((h) => dist(x, z, h) < gap);
  const nearCrossing = (x: number, z: number, gap: number) =>
    terrain.crossings.some((c) => dist(x, z, c.a) < gap || dist(x, z, c.b) < gap);
  const keepClear = (x: number, z: number) =>
    dist(x, z, start) < start.r + 4 ||
    dist(x, z, goal) < goal.r + 4 ||
    nearPond(x, z, 2.5) ||
    terrain.nearRiver(x, z, 2.5) ||
    nearCrossing(x, z, 5) ||
    terrain.ridgeAmount(x, z) > 0.02 ||
    nearHilltop(x, z, 6) ||
    thickets.some((t) => dist(x, z, t) < t.r + 1.5);
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
    terrain.ridgeAmount(x, z) < 0.02 &&
    !terrain.isWet(x, z);

  // Weapon racks spread along the route, alternating sides of it.
  const racks: RackProp[] = [];
  RACK_WEAPONS.forEach((weapon, i) => {
    const p = route.at(0.15 + (i / (RACK_WEAPONS.length - 1)) * 0.7);
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

  const rocks: RockProp[] = [];
  for (let i = 0; i < density.rocks * 45 && rocks.length < density.rocks; i++) {
    const { x, z } = randomPoint(3);
    if (keepClear(x, z) || !spaced(x, z, 3)) continue;
    const scale = rng.range(0.5, 1.4);
    const radius = 0.85 * scale;
    rocks.push({ x, y: terrain.heightAt(x, z), z, scale, rot: rng.range(0, Math.PI * 2), tint: rng.next(), radius });
    solids.push({ x, z, r: radius });
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

  return { trees, rocks, stalks, grass, flowers, lilies, bambooSpots, racks };
}
