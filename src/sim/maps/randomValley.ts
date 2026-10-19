import { Rng } from '../../core/rng';
import type { Circle, Hill, MapDensity, MapLayout, MapTheme, Pond, Ridge, River } from '../mapLayout';
import { CurveShape, type Pt } from '../river';
import { RIVER_CROSSING } from './riverCrossing';
import { SNOWY_PASS } from './snowyPass';
import { BAMBOO_VALLEY } from './valley';

export const RANDOM_VALLEY_ID = 'generated';
export const RANDOM_VALLEY_NAME = 'Random Valley';
export const RANDOM_VALLEY_BLURB = 'A new valley every match: river, ridge or open fields, any season.';

const AUTUMN: MapTheme = {
  sky: 0xf3e0c4,
  fogNear: 55,
  fogFar: 130,
  hemiSky: 0xfff1dc,
  hemiGround: 0x8a6a3a,
  hemiIntensity: 1.7,
  sun: 0xffe2b8,
  sunIntensity: 2.3,
  ground: {
    a: 0xc9c26a,
    b: 0xb3a457,
    high: 0xd8cf86,
    thicket: 0x7d8a3e,
    clearing: 0xd2b07c,
    shore: 0xe3cf9c,
    mud: 0x7c6a4a,
    rim: 0x8f7f45,
    cliff: 0x9c8f80,
  },
  water: 0x5fa9c9,
  waterOpacity: 0.82,
  trunk: 0x6e4630,
  roundLeaves: [0xe8892b, 0xd9562c, 0xf2b33d, 0xc8402a, 0xe9a23b],
  pineLeaves: [0x3f7a4a, 0x4a8752],
  pineShare: 0.3,
  rocks: [0x9ea3a8, 0xb3b6b0, 0x8f949a],
  grass: [0xb8b55a, 0xa39d4b, 0xcdc46a],
  flowers: [0xffd27a, 0xff9a5a, 0xffffff],
  lilies: [0x8a9a4a, 0x9aa852],
  stalks: [0x9fb84b, 0x8aa844, 0xb3c95a],
  stalkNode: 0x6f8a34,
  stalkLeaves: [0x8fae45, 0x9fbe52, 0x7f9e3e],
};

interface Look {
  theme: MapTheme;
  density: MapDensity;
  snowy: boolean;
}

const LOOKS: readonly Look[] = [
  { theme: BAMBOO_VALLEY.theme, density: BAMBOO_VALLEY.density, snowy: false },
  { theme: RIVER_CROSSING.theme, density: RIVER_CROSSING.density, snowy: false },
  { theme: AUTUMN, density: { trees: 140, rocks: 45, grass: 1000, flowerPatches: 30 }, snowy: false },
  { theme: SNOWY_PASS.theme, density: SNOWY_PASS.density, snowy: true },
];

/** Camp and hut sit this far from the centre, on opposite edges. */
const EDGE = 76;
/** Keep generated features inside this half-size. */
const INNER = 70;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

/** A wavy line across the whole map (and beyond its walls) around z = z0. */
function wavyLine(rng: Rng, z0: number, amp: number): Pt[] {
  const pts: Pt[] = [];
  for (let x = -120; x <= 120; x += 30) pts.push({ x, z: z0 + rng.range(-amp, amp) });
  return pts;
}

/**
 * Builds a whole map from a seed. Same seed, same map, on every device.
 *
 * Laid out with the camp in the south and the hut in the north, one main feature across the
 * middle (river, ridge or nothing), then hills, ponds and bamboo kept clear of it all.
 * Finally the whole map is turned and mirrored so the camp can be on any edge.
 */
export function generateValley(seed: number): MapLayout {
  const s = seed >>> 0;
  const rng = new Rng(s ^ 0x5eed);
  const look = rng.pick(LOOKS);

  const start: Circle = { x: rng.range(-66, 66), z: EDGE, r: 10 };
  const goal: Circle = { x: rng.range(-66, 66), z: -EDGE, r: 10 };
  const rivers: River[] = [];
  const ridges: Ridge[] = [];
  const route: Pt[] = [];
  let tip = '';

  /** How far a point must stay from the main feature's centre line (0 when there is none). */
  let blockerClear: (p: Pt, extra: number) => boolean = () => true;

  const feature = rng.next();
  if (feature < 0.4) {
    // A river: two or three crossings near where the straight route meets it.
    const z0 = rng.range(-10, 10);
    const points = wavyLine(rng, z0, 10);
    const width = rng.range(7, 10);
    const curve = new CurveShape(points, 1000);
    const fraction = (x: number) => curve.project(x, z0).s / curve.length;
    const crossX = start.x + (goal.x - start.x) * ((EDGE - z0) / (2 * EDGE));
    const c = Math.max(-55, Math.min(55, crossX));
    const fords: number[] = [];
    const bridgesX: number[] = [];
    if (rng.next() < 0.5) {
      fords.push(fraction(c));
      bridgesX.push(c - rng.range(30, 45), c + rng.range(30, 45));
    } else {
      bridgesX.push(c - rng.range(16, 28), c + rng.range(16, 28));
    }
    const bridges = bridgesX.map((x) => fraction(Math.max(-74, Math.min(74, x))));
    rivers.push({ points, width, depth: 0.75, bridges, fords });
    blockerClear = (p, extra) => curve.distance(p.x, p.z) > width / 2 + extra;
    tip = "Zombies can't swim! They cross at the bridges" + (fords.length ? ' and the shallow ford.' : '.');
  } else if (feature < 0.75) {
    // A ridge with one wide pass (the route goes through it) and maybe a narrow shortcut.
    const z0 = rng.range(-8, 8);
    const points = wavyLine(rng, z0, 8);
    const curve = new CurveShape(points, 1000);
    const onSpine = (x: number) => {
      const p = curve.at(curve.project(x, z0).s / curve.length);
      return { x: p.x, z: p.z };
    };
    const pass = onSpine(rng.range(-60, 60));
    const gaps = [{ ...pass, width: 12 }];
    for (let tries = 0; tries < 10 && rng.next() < 0.75; tries++) {
      const x = rng.range(-68, 68);
      if (Math.abs(x - pass.x) < 45) continue;
      gaps.push({ ...onSpine(x), width: 1.8 });
      break;
    }
    ridges.push({ points, width: 14, height: rng.range(8, 10), gaps });
    route.push({ x: pass.x, z: pass.z + 18 }, pass, { x: pass.x, z: pass.z - 18 });
    blockerClear = (p, extra) => curve.distance(p.x, p.z) > 7 + extra;
    tip = gaps.length > 1 ? 'The ridge is too steep to climb. Use the pass, or find the narrow shortcut.' : 'The ridge is too steep to climb. Follow the arrow to the pass.';
  }

  const inside = (p: Pt, margin: number) => Math.abs(p.x) <= INNER + 10 - margin && Math.abs(p.z) <= INNER + 10 - margin;
  const awayFromEnds = (p: Pt, gap: number) => dist(p, start) > start.r + gap && dist(p, goal) > goal.r + gap;
  const awayFromRoute = (p: Pt, gap: number) => route.every((w) => dist(p, w) > gap);

  const hills: Hill[] = [];
  const hillCount = 1 + Math.floor(rng.next() * 3);
  for (let tries = 0; tries < 200 && hills.length < hillCount; tries++) {
    const h: Hill = { x: rng.range(-INNER, INNER), z: rng.range(-INNER, INNER), r: rng.range(14, 24), h: rng.range(3, 6.5) };
    if (!awayFromEnds(h, h.r + 8) || !blockerClear(h, h.r + 6)) continue;
    if (hills.some((o) => dist(o, h) < o.r + h.r)) continue;
    hills.push(h);
  }

  const ponds: Pond[] = [];
  const pondCount = Math.floor(rng.next() * 3) + (look.snowy ? 1 : 0);
  for (let tries = 0; tries < 200 && ponds.length < pondCount; tries++) {
    const p: Pond = { x: rng.range(-72, 72), z: rng.range(-72, 72), r: rng.range(5, 9), depth: 0.8, frozen: look.snowy };
    if (!awayFromEnds(p, p.r + 16) || !blockerClear(p, p.r + 8) || !awayFromRoute(p, p.r + 8)) continue;
    if (hills.some((h) => dist(h, p) < h.r + p.r + 2) || ponds.some((o) => dist(o, p) < o.r + p.r + 10)) continue;
    ponds.push(p);
  }
  if (look.snowy && ponds.length) tip = tip ? `${tip} Ice is slippery!` : 'Frozen ponds are slippery for everyone!';

  const thickets: Circle[] = [];
  const thicketCount = 11 + Math.floor(rng.next() * 5);
  for (let tries = 0; tries < 600 && thickets.length < thicketCount; tries++) {
    const t: Circle = { x: rng.range(-80, 80), z: rng.range(-80, 80), r: rng.range(4, 6.5) };
    if (!inside(t, t.r) || !awayFromEnds(t, t.r + 12) || !blockerClear(t, t.r + 5) || !awayFromRoute(t, t.r + 4)) continue;
    if (ponds.some((p) => dist(p, t) < p.r + t.r + 4) || thickets.some((o) => dist(o, t) < o.r + t.r + 9)) continue;
    thickets.push(t);
  }

  // Turn (0–3 quarter turns) and maybe mirror everything, so the camp can be on any edge.
  const turns = Math.floor(rng.next() * 4);
  const mirror = rng.next() < 0.5;
  const tf = <T extends Pt>(p: T): T => {
    let x = mirror ? -p.x : p.x;
    let z = p.z;
    for (let i = 0; i < turns; i++) [x, z] = [-z, x];
    return { ...p, x, z };
  };

  return {
    id: RANDOM_VALLEY_ID,
    name: RANDOM_VALLEY_NAME,
    blurb: RANDOM_VALLEY_BLURB,
    tip: tip || undefined,
    seed: s,
    size: 180,
    renderSize: 236,
    start: tf(start),
    goal: tf(goal),
    route: route.map(tf),
    hills: hills.map(tf),
    ponds: ponds.map(tf),
    rivers: rivers.map((r) => ({ ...r, points: r.points.map(tf) })),
    ridges: ridges.map((r) => ({ ...r, points: r.points.map(tf), gaps: r.gaps.map(tf) })),
    thickets: thickets.map(tf),
    density: {
      trees: Math.round(look.density.trees * rng.range(0.85, 1.15)),
      rocks: Math.round(look.density.rocks * rng.range(0.85, 1.15)),
      grass: look.density.grass,
      flowerPatches: look.density.flowerPatches,
    },
    theme: look.theme,
  };
}
