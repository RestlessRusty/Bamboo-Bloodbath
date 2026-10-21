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
  /** Bamboo snacks as "1"/"0" per spot (any number of spots). */
  b: string;
  rk: number[];
  e: GameEvent[];
}

const PHASES: readonly MatchPhase[] = ['playing', 'won', 'lost'];
const SURVIVOR_STATES: readonly SurvivorState[] = ['active', 'downed', 'rescued', 'dead'];
const ZOMBIE_STATES: readonly ZombieState[] = ['walk', 'bite', 'lunge', 'stun', 'dying', 'sleep', 'wake'];

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const n = (v: unknown) => (typeof v === 'number' ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function encodeSnapshot(s: Snapshot): EncodedSnapshot {
  const bamboo = s.bamboo.map((on) => (on ? '1' : '0')).join('');
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
    ]),
    z: s.zombies.map((v) => [
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
    j: s.javelins.map((v) => [v.id, r2(v.x), r2(v.y), r2(v.z), r2(v.yaw), r2(v.pitch), v.flying ? 1 : 0]),
    c: s.crackers.map((v) => [v.id, r2(v.x), r2(v.y), r2(v.z), v.flying ? 1 : 0]),
    d: s.crackerDrops.map((v) => [v.id, r2(v.x), r2(v.y), r2(v.z)]),
    b: bamboo,
    rk: s.racks.map((w) => WEAPON_TYPES.indexOf(w)),
    e: s.events,
  };
}

export function decodeSnapshot(e: EncodedSnapshot): Snapshot {
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
  const bamboo = Array.from(str(e.b), (c) => c === '1');
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
    racks: (e.rk ?? []).map((w) => WEAPON_TYPES[w] ?? 'knife'),
    events: Array.isArray(e.e) ? e.e : [],
  };
}
