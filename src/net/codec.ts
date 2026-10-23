import type { OpenSnap, Resources } from '../sim/open/types';
import {
  WEAPON_TYPES,
  type CrackerDropSnap,
  type CrackerSnap,
  type GameEvent,
  type JavelinSnap,
  type MatchPhase,
  type Snapshot,
  type SurvivorSnap,
  type SurvivorState,
  type ZombieSnap,
  type ZombieState,
} from '../sim/types';

/**
 * Compact wire format for snapshots: arrays instead of objects, numbers rounded.
 * About 2–3 KB per snapshot with a full horde, sent 20 times a second.
 */
export interface EncodedSnapshot {
  k: number;
  tl: number;
  ph: number;
  r: number;
  /** Bots still out when the match can be ended early. */
  bo: number;
  s: (string | number)[][];
  z: (string | number)[][];
  j: number[][];
  /** Thrown firecrackers: [id, x, y, z, flying]. */
  c: number[][];
  /** Firecrackers lying around: [id, x, y, z]. */
  d: number[][];
  /** Bamboo snacks as "1"/"0" per spot (any number of spots). Empty when `bn` is sent instead. */
  b: string;
  /**
   * Infinite mode (encoded around a guest's panda): only the snack spots within INTEREST_RANGE, as
   * spot index + 1 when it has food and -(index + 1) when eaten. The guest keeps the last known state
   * of every other spot (see decodeSnapshot).
   */
  bn?: number[];
  rk: number[];
  e: GameEvent[];
  /** Infinite mode only. */
  o?: EncodedOpen;
}

/** Snapshot.open on the wire. Resources are [bamboo, wood, stone, scrap]. */
export interface EncodedOpen {
  dy: number;
  /** Time of day 0..1. */
  t: number;
  /** 1 at night. */
  n: number;
  /** Per panda: [id, hunger, bamboo, wood, stone, scrap, respawn, bed]. */
  s: (string | number)[][];
  st: number[];
  /** Siege: [x, z, tx, tz, eta, size, base 1/0], or empty with none. */
  sg: number[];
  /** Visible hordes: [x, z, n]. */
  h: number[][];
  l: string[];
}

const PHASES: readonly MatchPhase[] = ['playing', 'won', 'lost'];
const SURVIVOR_STATES: readonly SurvivorState[] = ['active', 'downed', 'rescued', 'dead'];
const ZOMBIE_STATES: readonly ZombieState[] = ['walk', 'bite', 'lunge', 'stun', 'dying', 'sleep', 'wake'];

/** Infinite mode: a guest only gets the zombies, javelins and firecrackers this close to their panda. */
export const INTEREST_RANGE = 110;
const INTEREST_R2 = INTEREST_RANGE * INTEREST_RANGE;
/** Defensive cap on snack spot indices from the wire (the open world has a few hundred). */
const MAX_SPOTS = 4096;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const n = (v: unknown) => (typeof v === 'number' ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

const encodeRes = (r: Resources): number[] => [r1(r.bamboo), r1(r.wood), r1(r.stone), r1(r.scrap)];
const decodeRes = (a: readonly unknown[], i: number): Resources => ({ bamboo: n(a[i]), wood: n(a[i + 1]), stone: n(a[i + 2]), scrap: n(a[i + 3]) });

function encodeOpen(o: OpenSnap): EncodedOpen {
  const g = o.siege;
  return {
    dy: o.day,
    t: Math.round(o.time * 10000) / 10000,
    n: o.night ? 1 : 0,
    s: o.survivors.map((v) => [v.id, r1(v.hunger), ...encodeRes(v.pack), r1(v.respawn), v.bed]),
    st: encodeRes(o.stash),
    sg: g ? [r1(g.x), r1(g.z), r1(g.tx), r1(g.tz), r1(g.eta), g.size, g.base ? 1 : 0] : [],
    h: o.hordes.map((v) => [Math.round(v.x), Math.round(v.z), v.n]),
    l: o.leash,
  };
}

function decodeOpen(o: EncodedOpen): OpenSnap {
  const g = Array.isArray(o.sg) && o.sg.length >= 7 ? o.sg : null;
  return {
    day: Math.max(1, n(o.dy)),
    time: n(o.t),
    night: o.n === 1,
    survivors: (Array.isArray(o.s) ? o.s : []).map((a) => ({
      id: str(a[0]),
      hunger: n(a[1]),
      pack: decodeRes(a, 2),
      respawn: n(a[6]),
      bed: typeof a[7] === 'number' ? n(a[7]) : -1,
    })),
    stash: decodeRes(Array.isArray(o.st) ? o.st : [], 0),
    siege: g ? { x: n(g[0]), z: n(g[1]), tx: n(g[2]), tz: n(g[3]), eta: n(g[4]), size: n(g[5]), base: g[6] === 1 } : null,
    hordes: (Array.isArray(o.h) ? o.h : []).map((a) => ({ x: n(a[0]), z: n(a[1]), n: n(a[2]) })),
    leash: Array.isArray(o.l) ? o.l.filter((v): v is string => typeof v === 'string') : [],
  };
}

/**
 * `near`: only zombies, javelins and firecrackers within INTEREST_RANGE of this point go in (infinite
 * mode encodes once per guest, around their panda: the world is too big to send everything to everyone).
 * Survivors always go in full. With `spots` too (the map's bamboo snack spots, same order as
 * Snapshot.bamboo), only the snack spots in range go in, as `bn`.
 */
export function encodeSnapshot(
  s: Snapshot,
  near: { x: number; z: number } | null = null,
  spots: readonly { x: number; z: number }[] | null = null,
): EncodedSnapshot {
  const p = near;
  const close: (v: { x: number; z: number }) => boolean = p
    ? (v) => (v.x - p.x) * (v.x - p.x) + (v.z - p.z) * (v.z - p.z) <= INTEREST_R2
    : () => true;
  let bamboo = '';
  let bambooNear: number[] | undefined;
  if (p && spots && spots.length === s.bamboo.length) {
    bambooNear = [];
    for (let i = 0; i < spots.length; i++) if (close(spots[i])) bambooNear.push(s.bamboo[i] ? i + 1 : -(i + 1));
  } else {
    bamboo = s.bamboo.map((on) => (on ? '1' : '0')).join('');
  }
  const zombies = p ? s.zombies.filter(close) : s.zombies;
  const javelins = p ? s.javelins.filter(close) : s.javelins;
  const crackers = p ? s.crackers.filter(close) : s.crackers;
  const crackerDrops = p ? s.crackerDrops.filter(close) : s.crackerDrops;
  return {
    k: s.tick,
    tl: r2(s.timeLeft),
    ph: PHASES.indexOf(s.phase),
    r: s.rescued,
    bo: s.botsOut,
    s: s.survivors.map((v) => [
      v.id,
      r3(v.x),
      r3(v.y),
      r3(v.z),
      r3(v.rot),
      r2(v.speed),
      r2(v.attackT),
      (v.dashing ? 1 : 0) | (v.inWater ? 2 : 0) | (v.hidden ? 4 : 0),
      v.hp,
      SURVIVOR_STATES.indexOf(v.state),
      WEAPON_TYPES.indexOf(v.weapon),
      v.ammo,
      r2(v.bleed),
      r2(v.revive),
      r2(v.hurt),
      v.kills,
      v.crackers,
      v.other ? WEAPON_TYPES.indexOf(v.other) : -1,
    ]),
    z: zombies.map((v) => [
      v.id,
      r2(v.x),
      r2(v.y),
      r2(v.z),
      r2(v.rot),
      r2(v.speed),
      ZOMBIE_STATES.indexOf(v.state),
      r2(v.t),
      v.look,
      r2(v.hurt),
      v.from ?? '',
    ]),
    j: javelins.map((v) => [v.id, r2(v.x), r2(v.y), r2(v.z), r2(v.yaw), r2(v.pitch), v.flying ? 1 : 0]),
    c: crackers.map((v) => [v.id, r2(v.x), r2(v.y), r2(v.z), v.flying ? 1 : 0]),
    d: crackerDrops.map((v) => [v.id, r2(v.x), r2(v.y), r2(v.z)]),
    b: bamboo,
    bn: bambooNear,
    rk: s.racks.map((w) => (w ? WEAPON_TYPES.indexOf(w) : -1)),
    e: s.events,
    o: s.open ? encodeOpen(s.open) : undefined,
  };
}

/** Snapshot.bamboo from `b` (every spot) or `bn` (spots near us, merged into `known`). Defensive. */
function decodeBamboo(e: EncodedSnapshot, known: boolean[] | null): boolean[] {
  if (!Array.isArray(e.bn)) {
    const full = Array.from(str(e.b), (c) => c === '1');
    if (known) {
      known.length = 0;
      for (const on of full) known.push(on);
    }
    return full;
  }
  const into = known ?? [];
  for (const v of e.bn as unknown[]) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v === 0) continue;
    const i = Math.abs(v) - 1;
    if (i >= MAX_SPOTS) continue;
    while (into.length < i) into.push(true);
    into[i] = v > 0;
  }
  return into.slice();
}

/**
 * `known` (a guest's own, kept across snapshots and emptied for each new match): the last known state of
 * every bamboo snack spot. Infinite-mode snapshots only carry the spots near our panda (`bn`); those update
 * `known` and the rest keep what we last heard (spots never heard of count as having food). Full-length
 * snapshots replace it. The result's bamboo is a copy of `known` then, as long as the highest spot heard of:
 * RemoteGame pads it to the map's spot count.
 */
export function decodeSnapshot(e: EncodedSnapshot, known: boolean[] | null = null): Snapshot {
  const survivors: SurvivorSnap[] = (e.s ?? []).map((a) => ({
    id: str(a[0]),
    x: n(a[1]),
    y: n(a[2]),
    z: n(a[3]),
    rot: n(a[4]),
    speed: n(a[5]),
    attackT: n(a[6]),
    dashing: (n(a[7]) & 1) !== 0,
    inWater: (n(a[7]) & 2) !== 0,
    hidden: (n(a[7]) & 4) !== 0,
    hp: n(a[8]),
    state: SURVIVOR_STATES[n(a[9])] ?? 'active',
    weapon: WEAPON_TYPES[n(a[10])] ?? 'knife',
    ammo: n(a[11]),
    bleed: n(a[12]),
    revive: n(a[13]),
    hurt: n(a[14]),
    kills: n(a[15]),
    crackers: n(a[16]),
    other: WEAPON_TYPES[n(a[17])] ?? null,
  }));
  const zombies: ZombieSnap[] = (e.z ?? []).map((a) => ({
    id: n(a[0]),
    x: n(a[1]),
    y: n(a[2]),
    z: n(a[3]),
    rot: n(a[4]),
    speed: n(a[5]),
    state: ZOMBIE_STATES[n(a[6])] ?? 'walk',
    t: n(a[7]),
    look: n(a[8]),
    hurt: n(a[9]),
    from: str(a[10]) || null,
  }));
  const javelins: JavelinSnap[] = (e.j ?? []).map((a) => ({
    id: n(a[0]),
    x: n(a[1]),
    y: n(a[2]),
    z: n(a[3]),
    yaw: n(a[4]),
    pitch: n(a[5]),
    flying: a[6] === 1,
  }));
  const crackers: CrackerSnap[] = (e.c ?? []).map((a) => ({ id: n(a[0]), x: n(a[1]), y: n(a[2]), z: n(a[3]), flying: a[4] === 1 }));
  const crackerDrops: CrackerDropSnap[] = (e.d ?? []).map((a) => ({ id: n(a[0]), x: n(a[1]), y: n(a[2]), z: n(a[3]) }));
  const bamboo = decodeBamboo(e, known);
  return {
    tick: n(e.k),
    timeLeft: n(e.tl),
    phase: PHASES[n(e.ph)] ?? 'playing',
    rescued: n(e.r),
    botsOut: n(e.bo),
    survivors,
    zombies,
    javelins,
    crackers,
    crackerDrops,
    bamboo,
    racks: (e.rk ?? []).map((w) => WEAPON_TYPES[w] ?? null),
    events: Array.isArray(e.e) ? e.e : [],
    open: e.o && typeof e.o === 'object' ? decodeOpen(e.o) : undefined,
  };
}
