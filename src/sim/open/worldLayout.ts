import type { Rng } from '../../core/rng';
import type { Circle, Hill, Pond, Ridge, River, Road } from '../mapLayout';
import { CurveShape, type Pt } from '../river';
import { roadDistance } from '../terrain';
import { biomeTable, type BiomeField } from './biomes';
import { OPEN } from './config';
import { CAMP_CABIN_NAME, pickPoiKind, planPoi, type PoiPlan } from './pois';
import { BIOME_IDS, type Rot } from './types';
import { pondShoreWidth, riverBankWidth, type GroundField } from './worldTerrain';

/**
 * The open world's big features, laid out from the seed before any terrain exists: rivers (with bridges
 * and fords), ridges (with passes), the abandoned buildings, dirt tracks between them, hills and ponds.
 * Each is checked against what was placed before it, so nothing ends up in a river or on a ridge.
 */

const HALF = OPEN.worldSize / 2;
/** Rivers start and end this far beyond the edge, so they flow off the world. */
const BEYOND = 70;
/** Dirt tracks between buildings. */
export const ROAD_WIDTH = 4;
/** Longest track between two buildings (edge to edge). */
const ROAD_MAX = 280;
/** Ridge tips taper away inside a "pass" this wide, instead of ending in a sheer wall. */
const TIP_GAP = 12;

const MEADOW = BIOME_IDS.indexOf('meadow');
const PINE = BIOME_IDS.indexOf('pine');
const SNOW = BIOME_IDS.indexOf('snow');
const FEN = BIOME_IDS.indexOf('fen');
const QUARRY = BIOME_IDS.indexOf('quarry');

export interface PlannedPoi extends PoiPlan {
  /** Set for the camp's own cabin; the rest are named later. */
  name: string | null;
}

export interface WorldPlan {
  rivers: River[];
  ridges: Ridge[];
  pois: PlannedPoi[];
  roads: Road[];
  hills: Hill[];
  ponds: Pond[];
}

/** A river being planned, with the curve the terrain will build from it (the same smoothing, so the same fractions). */
interface RiverDraft {
  def: River;
  curve: CurveShape;
  bridges: number[];
  fords: number[];
  /** Where a tributary flows into this river. */
  junction: Pt | null;
  /** The river this one flows into (its end lies in that one's water). */
  into: RiverDraft | null;
}

interface RidgeDraft {
  def: Ridge;
  curve: CurveShape;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * A spot for the camp: in the meadow, between 50 and 170 m from the middle of the world, as close to
 * `guess` as that allows.
 */
export function campSpot(biomes: BiomeField, guess: Pt): Pt {
  for (let ring = 0; ring <= 12; ring++) {
    const steps = Math.max(1, ring * 6);
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const p = { x: guess.x + Math.cos(a) * ring * 14, z: guess.z + Math.sin(a) * ring * 14 };
      const fromMiddle = Math.hypot(p.x, p.z);
      if (fromMiddle >= 50 && fromMiddle <= 170 && biomes.weight(p.x, p.z, MEADOW) >= 0.9) return p;
    }
  }
  return guess;
}

/** Lays out the world around the camp `spawn`. `rng` is the layout's own stream. */
export function planWorld(rng: Rng, biomes: BiomeField, ground: GroundField, spawn: Circle): WorldPlan {
  const rivers = planRivers(rng, spawn);
  const ridges = planRidges(rng, biomes, spawn, rivers);
  const pois = planPois(rng, biomes, ground, spawn, rivers, ridges);
  const roads = planRoads(rng, spawn, pois, rivers, ridges);
  // Regular crossings fill in between the bridges the roads asked for.
  for (const r of rivers) addCrossings(rng, r);

  // Spots the hills and ponds keep away from: every bridge, ford and pass.
  const crossings: Circle[] = [];
  for (const r of rivers) {
    for (const f of [...r.bridges, ...r.fords]) {
      const p = r.curve.at(f);
      crossings.push({ x: p.x, z: p.z, r: r.def.width / 2 + 4 });
    }
  }
  for (const r of ridges) {
    for (const g of r.def.gaps) crossings.push({ x: g.x, z: g.z, r: g.width / 2 + r.def.width / 2 });
  }

  const hills = planHills(rng, biomes, spawn, pois, roads, rivers, ridges, crossings);
  const ponds = planPonds(rng, biomes, ground, spawn, pois, roads, rivers, ridges, crossings, hills);
  return {
    rivers: rivers.map((r) => ({ ...r.def, bridges: r.bridges.slice().sort((a, b) => a - b), fords: r.fords.slice().sort((a, b) => a - b) })),
    ridges: ridges.map((r) => r.def),
    pois,
    roads,
    hills,
    ponds,
  };
}

// ---------------------------------------------------------------- rivers

/** (u, v) to world coordinates: u runs along the main river, v across it. */
const toWorld = (u: number, v: number, alongX: boolean): Pt => (alongX ? { x: u, z: v } : { x: v, z: u });

/**
 * A main river from one edge to the opposite one, meandering, well away from the camp; most worlds also
 * get a tributary from a third edge that flows into it.
 */
function planRivers(rng: Rng, spawn: Circle): RiverDraft[] {
  const alongX = rng.next() < 0.5;
  const spawnV = alongX ? spawn.z : spawn.x;
  let main: RiverDraft | null = null;
  let mainV = 0;
  for (let tries = 0; tries < 40 && !main; tries++) {
    const v0 = rng.range(-300, 300);
    if (Math.abs(v0 - spawnV) < 130) continue;
    const points: Pt[] = [];
    let off = 0;
    for (let u = -HALF - BEYOND; u <= HALF + BEYOND + 1; u += 64) {
      off = Math.max(-60, Math.min(60, off + rng.range(-28, 28)));
      points.push(toWorld(u, v0 + off, alongX));
    }
    const width = rng.range(9, 12);
    const curve = new CurveShape(points, 4000);
    if (curve.distance(spawn.x, spawn.z) < width / 2 + 90) continue;
    main = { def: { points, width, depth: 0.85, bridges: [], fords: [] }, curve, bridges: [], fords: [], junction: null, into: null };
    mainV = v0;
  }
  if (!main) return [];
  if (rng.next() > 0.8) return [main];

  // The tributary comes from the edge on the far side of the main river, so it's a long one.
  const side = mainV > 0 ? -1 : 1;
  const vStart = side * (HALF + BEYOND);
  for (let tries = 0; tries < 30; tries++) {
    const u1 = rng.range(-300, 300);
    const near = toWorld(u1, mainV, alongX);
    const j = main.curve.at(main.curve.project(near.x, near.z).s / main.curve.length);
    const junction = { x: j.x, z: j.z };
    const jU = alongX ? junction.x : junction.z;
    const jV = alongX ? junction.z : junction.x;
    const steps = Math.max(2, Math.ceil(Math.abs(jV - vStart) / 64));
    const points: Pt[] = [];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const wobble = k > 0 && k < steps - 1 ? rng.range(-22, 22) : 0;
      points.push(toWorld(u1 + (jU - u1) * t + wobble, vStart + (jV - vStart) * t, alongX));
    }
    points.push(junction);
    const width = rng.range(6, 8);
    const curve = new CurveShape(points, 4000);
    if (curve.distance(spawn.x, spawn.z) < width / 2 + 80) continue;
    main.junction = junction;
    return [main, { def: { points, width, depth: 0.7, bridges: [], fords: [] }, curve, bridges: [], fords: [], junction: null, into: main }];
  }
  return [main];
}

/** The stretch of a river inside the world (arc lengths), leaving `margin` at the edges; [-1, -1] if none. */
function insideStretch(r: RiverDraft, margin: number): [number, number] {
  let a = -1;
  let b = -1;
  for (let s = 0; s <= r.curve.length; s += 4) {
    const p = r.curve.at(s / r.curve.length);
    if (Math.abs(p.x) < HALF - margin && Math.abs(p.z) < HALF - margin) {
      if (a < 0) a = s;
      b = s;
    }
  }
  if (r.into && b >= 0) b = Math.min(b, r.curve.length - (r.into.def.width / 2 + 25));
  return [a, b];
}

/**
 * Bridges and fords every 100–145 m along the part of the river inside the world, about three bridges to
 * two fords, clear of the bridges the roads put in and of where a tributary joins.
 */
function addCrossings(rng: Rng, r: RiverDraft): void {
  const [a, b] = insideStretch(r, 36);
  if (a < 0) return;
  const roadBridges = r.bridges.map((f) => f * r.curve.length);
  const added: { s: number; bridge: boolean }[] = [];
  for (let s = a + rng.range(30, 70); s < b - 20; s += rng.range(100, 145)) {
    if (roadBridges.some((t) => Math.abs(t - s) < 55)) continue;
    if (r.junction && dist(r.curve.at(s / r.curve.length), r.junction) < 45) continue;
    added.push({ s, bridge: rng.next() < 0.6 });
  }
  // Every river gets at least one proper bridge.
  if (!roadBridges.length && added.length && !added.some((c) => c.bridge)) added[0].bridge = true;
  for (const c of added) (c.bridge ? r.bridges : r.fords).push(c.s / r.curve.length);
}

// ---------------------------------------------------------------- ridges

/**
 * 3–5 rock ridges in the quarry, the highlands and now and then the pine woods. Each has a wide pass and
 * maybe a narrow crack, and tapers off at both tips (so you can also walk round).
 */
function planRidges(rng: Rng, biomes: BiomeField, spawn: Circle, rivers: RiverDraft[]): RidgeDraft[] {
  const out: RidgeDraft[] = [];
  const want = 3 + Math.floor(rng.next() * 3);
  for (let tries = 0; tries < 400 && out.length < want; tries++) {
    const c = { x: rng.range(-HALF + 120, HALF - 120), z: rng.range(-HALF + 120, HALF - 120) };
    const b = biomes.indexAt(c.x, c.z);
    if (b !== QUARRY && b !== SNOW && !(b === PINE && rng.next() < 0.4)) continue;
    if (dist(c, spawn) < 170) continue;
    const length = rng.range(110, 230);
    const a = rng.range(0, Math.PI);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const n = Math.ceil(length / 32) + 1;
    const points: Pt[] = [];
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1) - 0.5;
      const side = k > 0 && k < n - 1 ? rng.range(-9, 9) : 0;
      points.push({ x: c.x + dx * t * length - dz * side, z: c.z + dz * t * length + dx * side });
    }
    const width = rng.range(14, 18);
    // Reach covers the biggest gap anything keeps from a ridge (beyond it, distance() is Infinity: clear).
    const curve = new CurveShape(points, width / 2 + 100);
    const ok = curve.pts.every(
      (p) =>
        Math.abs(p.x) < HALF - 70 &&
        Math.abs(p.z) < HALF - 70 &&
        dist(p, spawn) > spawn.r + width / 2 + 60 &&
        rivers.every((r) => r.curve.distance(p.x, p.z) > r.def.width / 2 + width / 2 + 40) &&
        out.every((o) => o.curve.distance(p.x, p.z) > o.def.width / 2 + width / 2 + 70),
    );
    if (!ok) continue;
    const on = (f: number) => {
      const p = curve.at(f);
      return { x: p.x, z: p.z };
    };
    const gaps = [
      { ...points[0], width: TIP_GAP },
      { ...points[points.length - 1], width: TIP_GAP },
      { ...on(rng.range(0.38, 0.62)), width: rng.range(10, 14) },
    ];
    if (rng.next() < 0.55) gaps.push({ ...on(rng.next() < 0.5 ? rng.range(0.16, 0.26) : rng.range(0.74, 0.84)), width: rng.range(1.8, 2.4) });
    out.push({ def: { points, width, height: rng.range(8, 11), gaps }, curve });
  }
  return out;
}

/** Further than `gap` beyond the foot of every ridge. */
const ridgeClear = (ridges: readonly RidgeDraft[], p: Pt, gap: number) => ridges.every((r) => r.curve.distance(p.x, p.z) > r.def.width / 2 + gap);

// ---------------------------------------------------------------- buildings

/** The turn whose door (south, west, north, east for turns 0..3) faces (fx, fz) from (x, z). */
function turnToward(x: number, z: number, fx: number, fz: number): Rot {
  const dx = fx - x;
  const dz = fz - z;
  if (Math.abs(dz) >= Math.abs(dx)) return dz > 0 ? 0 : 2;
  return dx < 0 ? 1 : 3;
}

/**
 * The camp's cabin first (30–45 m from the camp, door towards it), then 29–35 more buildings of the kinds
 * their biome likes, well apart, away from rivers (beyond their banks) and ridges.
 */
function planPois(rng: Rng, biomes: BiomeField, ground: GroundField, spawn: Circle, rivers: RiverDraft[], ridges: RidgeDraft[]): PlannedPoi[] {
  const out: PlannedPoi[] = [];
  const fits = (p: PoiPlan) => {
    if (Math.abs(p.x) > HALF - 70 - p.r || Math.abs(p.z) > HALF - 70 - p.r) return false;
    const bank = riverBankWidth(ground.levelAt(p.x, p.z) + 1);
    if (!rivers.every((r) => r.curve.distance(p.x, p.z) > r.def.width / 2 + 3 + bank + p.r + 6)) return false;
    return ridgeClear(ridges, p, p.r + 12);
  };

  for (let tries = 0; tries < 60; tries++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(30, 45);
    const x = spawn.x + Math.cos(a) * d;
    const z = spawn.z + Math.sin(a) * d;
    const plan = planPoi('cabin', x, z, turnToward(x, z, spawn.x, spawn.z));
    if (dist(plan, spawn) < spawn.r + plan.r + 4 || !fits(plan)) continue;
    out.push({ ...plan, name: CAMP_CABIN_NAME });
    break;
  }

  const want = 30 + Math.floor(rng.next() * 7);
  for (let tries = 0; tries < 6000 && out.length < want; tries++) {
    const x = rng.range(-HALF + 80, HALF - 80);
    const z = rng.range(-HALF + 80, HALF - 80);
    if (dist({ x, z }, spawn) < 75) continue;
    const kind = pickPoiKind(biomes.biomeAt(x, z), rng);
    const plan = planPoi(kind, x, z, Math.floor(rng.next() * 4) as Rot);
    if (!fits(plan) || out.some((o) => dist(o, plan) < o.r + plan.r + 60)) continue;
    out.push({ ...plan, name: null });
  }
  return out;
}

// ---------------------------------------------------------------- roads

/** A track that passed tryRoad: its points, length, and where it crosses a river (if it does). */
interface RoadDraft {
  from: number;
  to: number;
  points: Pt[];
  length: number;
  cross: { river: number; s: number; d: number } | null;
}

/**
 * Tries the track from place `i` to place `j` (edge to edge, bent `bend` m sideways in the middle): null
 * when it would run into a ridge, through another place, cross a river at a slant or twice, or is too long.
 */
function tryRoad(places: readonly Circle[], i: number, j: number, rivers: RiverDraft[], ridges: RidgeDraft[], bend: number): RoadDraft | null {
  const a = places[i];
  const b = places[j];
  const len = dist(a, b);
  if (len > ROAD_MAX + a.r + b.r) return null;
  const ux = (b.x - a.x) / len;
  const uz = (b.z - a.z) / len;
  const start = { x: a.x + ux * (a.r - 1), z: a.z + uz * (a.r - 1) };
  const end = { x: b.x - ux * (b.r - 1), z: b.z - uz * (b.r - 1) };
  const mid = { x: (start.x + end.x) / 2 - uz * bend, z: (start.z + end.z) / 2 + ux * bend };
  const points = Math.abs(bend) > 0.5 ? [start, mid, end] : [start, end];
  let cross: RoadDraft['cross'] = null;
  let length = 0;
  // How far each river's water still is at least: distance changes no faster than we walk, so a river
  // 100 m off needn't be measured again for 100 m.
  const slack = rivers.map(() => 0);
  for (let k = 1; k < points.length; k++) {
    const p0 = points[k - 1];
    const p1 = points[k];
    const seg = dist(p0, p1) || 1;
    length += seg;
    const sx = (p1.x - p0.x) / seg;
    const sz = (p1.z - p0.z) / seg;
    const steps = Math.max(1, Math.ceil(seg / 4));
    for (let m = 0; m <= steps; m++) {
      const p = { x: p0.x + (p1.x - p0.x) * (m / steps), z: p0.z + (p1.z - p0.z) * (m / steps) };
      if (!ridgeClear(ridges, p, ROAD_WIDTH / 2 + 5)) return null;
      for (let o = 0; o < places.length; o++) {
        if (o !== i && o !== j && dist(places[o], p) < places[o].r + 3) return null;
      }
      for (let ri = 0; ri < rivers.length; ri++) {
        slack[ri] -= seg / steps;
        if (slack[ri] > 0) continue;
        const r = rivers[ri];
        const q = r.curve.project(p.x, p.z);
        slack[ri] = q.d - (r.def.width / 2 + 1);
        if (slack[ri] > 0) continue;
        if (cross && (cross.river !== ri || Math.abs(cross.s - q.s) > 12)) return null;
        // Square-ish to the water, so the bridge (across the river) lines up with the track.
        const t = r.curve.at(q.s / r.curve.length);
        if (Math.abs(t.tx * sx + t.tz * sz) > 0.55) return null;
        if (!cross || q.d < cross.d) cross = { river: ri, s: q.s, d: q.d };
      }
    }
  }
  return length > ROAD_MAX ? null : { from: i, to: j, points, length, cross };
}

/**
 * Dirt tracks: the shortest network joining the camp and the buildings (a spanning tree over the tracks
 * that pass every test), bent a little. Where a track crosses a river it gets a bridge.
 */
function planRoads(rng: Rng, spawn: Circle, pois: readonly PoiPlan[], rivers: RiverDraft[], ridges: RidgeDraft[]): Road[] {
  const places: Circle[] = [spawn, ...pois.map((p) => ({ x: p.x, z: p.z, r: p.r }))];
  const n = places.length;
  // River crossings cost extra, so tracks prefer staying on one side.
  const cost = (d: RoadDraft) => d.length + (d.cross ? 90 : 0);

  // Prim's algorithm from the camp.
  const inTree = new Array<boolean>(n).fill(false);
  const best = new Array<number>(n).fill(Infinity);
  const via = new Array<RoadDraft | null>(n).fill(null);
  const grow = (i: number) => {
    inTree[i] = true;
    for (let j = 0; j < n; j++) {
      if (inTree[j] || dist(places[i], places[j]) > ROAD_MAX + places[i].r + places[j].r) continue;
      const d = tryRoad(places, i, j, rivers, ridges, 0);
      if (d && cost(d) < best[j]) {
        best[j] = cost(d);
        via[j] = d;
      }
    }
  };
  grow(0);
  const chosen: RoadDraft[] = [];
  for (;;) {
    let next = -1;
    for (let j = 0; j < n; j++) if (!inTree[j] && best[j] < Infinity && (next < 0 || best[j] < best[next])) next = j;
    if (next < 0) break;
    const d = via[next];
    if (d) chosen.push(d);
    grow(next);
  }

  const roads: Road[] = [];
  for (const d of chosen) {
    // Bent, if the bent track still passes and crosses the same rivers.
    const bent = tryRoad(places, d.from, d.to, rivers, ridges, rng.range(-14, 14));
    const draft = bent && (bent.cross?.river ?? -1) === (d.cross?.river ?? -1) ? bent : d;
    if (draft.cross) {
      const r = rivers[draft.cross.river];
      const f = draft.cross.s / r.curve.length;
      const [lo, hi] = insideStretch(r, 40);
      // Off the inside stretch, by the tributary's mouth, or right beside another track's bridge: no track.
      if (draft.cross.s < lo || draft.cross.s > hi) continue;
      if (r.junction && dist(r.curve.at(f), r.junction) < 45) continue;
      if (r.bridges.some((g) => Math.abs(g - f) * r.curve.length < 40)) continue;
      r.bridges.push(f);
    }
    roads.push({ points: draft.points, width: ROAD_WIDTH });
  }
  return roads;
}

// ---------------------------------------------------------------- hills and ponds

/** 50–65 hills, up to 10 m, lower in the fen and the fields; never on a building, a track or a crossing. */
function planHills(
  rng: Rng,
  biomes: BiomeField,
  spawn: Circle,
  pois: readonly PoiPlan[],
  roads: readonly Road[],
  rivers: RiverDraft[],
  ridges: RidgeDraft[],
  crossings: readonly Circle[],
): Hill[] {
  const scaleOf = biomeTable((g) => g.hills);
  const out: Hill[] = [];
  const want = 50 + Math.floor(rng.next() * 16);
  for (let tries = 0; tries < 3000 && out.length < want; tries++) {
    const r = rng.range(18, 45);
    const x = rng.range(-HALF + 50, HALF - 50);
    const z = rng.range(-HALF + 50, HALF - 50);
    const h = Math.min(10, rng.range(3, 10) * biomes.mix(x, z, scaleOf));
    const p = { x, z };
    if (h < 2 || dist(p, spawn) < spawn.r + r + 12) continue;
    if (pois.some((o) => dist(o, p) < o.r + r * 0.9 + 4)) continue;
    if (roads.some((o) => roadDistance(o.points, x, z) < r * 0.85 + 4)) continue;
    if (!rivers.every((o) => o.curve.distance(x, z) > o.def.width / 2 + 3 + r + 10)) continue;
    if (!ridgeClear(ridges, p, r + 4)) continue;
    if (crossings.some((c) => dist(c, p) < c.r + r + 14)) continue;
    if (out.some((o) => dist(o, p) < (o.r + r) * 0.75)) continue;
    out.push({ x, z, r, h });
  }
  return out;
}

/**
 * Ponds: plenty in the fen, frozen ones in the highlands, the odd one elsewhere; only on lowish ground,
 * with room for their shores.
 */
function planPonds(
  rng: Rng,
  biomes: BiomeField,
  ground: GroundField,
  spawn: Circle,
  pois: readonly PoiPlan[],
  roads: readonly Road[],
  rivers: RiverDraft[],
  ridges: RidgeDraft[],
  crossings: readonly Circle[],
  hills: readonly Hill[],
): Pond[] {
  const keepOf = biomeTable((g) => g.ponds);
  const out: Pond[] = [];
  const want = 40 + Math.floor(rng.next() * 12);
  for (let tries = 0; tries < 5000 && out.length < want; tries++) {
    const x = rng.range(-HALF + 70, HALF - 70);
    const z = rng.range(-HALF + 70, HALF - 70);
    if (rng.next() > biomes.mix(x, z, keepOf)) continue;
    const level = ground.levelAt(x, z);
    if (level > 5) continue;
    const frozen = biomes.weight(x, z, SNOW) > 0.5;
    const r = biomes.weight(x, z, FEN) > 0.5 ? rng.range(6, 13) : rng.range(5, 10);
    const shore = pondShoreWidth(level + 1);
    const p = { x, z };
    if (dist(p, spawn) < spawn.r + r + shore + 8) continue;
    if (pois.some((o) => dist(o, p) < o.r + r + shore + 2)) continue;
    if (roads.some((o) => roadDistance(o.points, x, z) < r + shore + 3)) continue;
    if (!rivers.every((o) => o.curve.distance(x, z) > o.def.width / 2 + 3 + r + shore + 6)) continue;
    if (!ridgeClear(ridges, p, r + shore)) continue;
    if (crossings.some((c) => dist(c, p) < c.r + r + shore + 10)) continue;
    if (hills.some((h) => dist(h, p) < h.r + r + 2)) continue;
    if (out.some((o) => dist(o, p) < o.r + r + 12)) continue;
    out.push({ x, z, r, depth: frozen ? 0 : rng.range(0.8, 1), frozen });
  }
  return out;
}
