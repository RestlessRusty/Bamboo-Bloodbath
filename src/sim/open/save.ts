import { CRACKER, DIFFICULTIES, JAVELIN, MAX_PLAYERS, SURVIVOR, type Difficulty } from '../../config';
import { Rng } from '../../core/rng';
import { botName } from '../bots';
import type { GameMap } from '../gameMap';
import { PANDA_VARIANTS, WEAPON_TYPES, type PandaVariant, type PlayerSpec, type WeaponType } from '../types';
import { OPEN, PIECES } from './config';
import { packTotal } from './economy';
import { maxHp, tileKey } from './structures';
import {
  emptyResources,
  PIECE_KINDS,
  RESOURCE_KINDS,
  type HordeSave,
  type LootBag,
  type Piece,
  type PieceKind,
  type PlayerSave,
  type Resources,
  type Rot,
  type Tier,
  type WorldSave,
} from './types';

/** Making, checking and reading world saves. The rules turn a save into a running world and back (rules.ts). */

/** Most bot buddies a world can have (the host's panda takes the fourth seat). */
const MAX_BOTS = MAX_PLAYERS - 1;
const NAME_MAX = 24;
const BOT_SEAT = /^b\d+$/;

/**
 * A bot buddy's seat ('b1'…'bN'). Saves keep these by id, as the bot's panda, even while a guest who took one
 * over is playing it; everyone else is kept by nickname.
 */
export function isBotSeat(id: string): boolean {
  return BOT_SEAT.test(id);
}

/** A fresh world: the abandoned buildings as generated, nothing touched, a bright morning of day 1. */
export function newWorldSave(map: GameMap, slot: number, name: string, difficulty: Difficulty, bots: number, now: number): WorldSave {
  const open = map.open;
  if (!open) throw new Error('newWorldSave needs the open world');
  return {
    v: 1,
    slot,
    name: cleanName(name, `World ${slot + 1}`),
    seed: open.seed,
    difficulty,
    bots: Math.max(0, Math.min(MAX_BOTS, Math.floor(bots) || 0)),
    created: now,
    saved: now,
    played: 0,
    clock: OPEN.startTime * OPEN.dayLength,
    pieces: open.poiPieces.map((p) => ({ ...p })),
    nextPieceId: OPEN.firstPlayerPieceId,
    nodes: [],
    crates: [],
    bags: [],
    nextBagId: 1,
    stash: emptyResources(),
    players: {},
    hordes: [],
    nextSiege: 0,
    sieges: 0,
    kills: 0,
    bestDay: 1,
  };
}

/** A new world's seed: a positive 31-bit number (easy to read out and type in). */
export function randomWorldSeed(): number {
  return 1 + Math.floor(Math.random() * 2147483646);
}

/**
 * A save as loaded from storage, made safe to play: every field checked and clamped, anything that makes no
 * sense dropped (pieces off the grid or on a taken tile, unknown nodes and crates, broken bags and players).
 * Missing fields get a fresh world's values. The seed always becomes the map's own.
 */
export function sanitizeSave(raw: WorldSave, map: GameMap): WorldSave {
  const open = map.open;
  if (!open) throw new Error('sanitizeSave needs the open world');
  const r = (isObject(raw) ? raw : {}) as Partial<Record<keyof WorldSave, unknown>>;
  const slot = int(r.slot, 0, 0, OPEN.slots - 1);
  const now = Date.now();
  const fresh = newWorldSave(map, slot, str(r.name, ''), DIFFICULTIES.includes(r.difficulty as Difficulty) ? (r.difficulty as Difficulty) : 'normal', int(r.bots, 0, 0, MAX_BOTS), now);
  const half = open.size / 2;
  const tiles = Math.floor(half / OPEN.tile);

  // Pieces: on the grid, one per tile, one per id; hp within the tier's range.
  const pieces: Piece[] = [];
  const ids = new Set<number>();
  const taken = new Set<number>();
  let topPlayerId = OPEN.firstPlayerPieceId - 1;
  const rawPieces = Array.isArray(r.pieces) ? (r.pieces as unknown[]) : fresh.pieces;
  for (const it of rawPieces) {
    const p = piece(it, tiles);
    if (!p || ids.has(p.id) || taken.has(tileKey(p.gx, p.gz))) continue;
    ids.add(p.id);
    taken.add(tileKey(p.gx, p.gz));
    pieces.push(p);
    if (p.id >= OPEN.firstPlayerPieceId) topPlayerId = Math.max(topPlayerId, p.id);
  }

  // Nodes: known ids, not full; [id, left, regrow].
  const nodes: [number, number, number][] = [];
  const seenNodes = new Set<number>();
  if (Array.isArray(r.nodes)) {
    for (const it of r.nodes as unknown[]) {
      if (!Array.isArray(it)) continue;
      const id = int(it[0], -1, -1, open.nodes.length - 1);
      if (id < 0 || seenNodes.has(id)) continue;
      const full = open.nodes[id].amount;
      const left = int(it[1], full, 0, full);
      if (left >= full) continue;
      seenNodes.add(id);
      nodes.push([id, left, num(it[2], OPEN.nodeRegrow, 0, OPEN.nodeRegrow)]);
    }
  }

  const crates: number[] = [];
  if (Array.isArray(r.crates)) {
    const seen = new Set<number>();
    for (const it of r.crates as unknown[]) {
      const id = int(it, -1, -1, open.crates.length - 1);
      if (id >= 0 && !seen.has(id)) {
        seen.add(id);
        crates.push(id);
      }
    }
  }

  const bags: LootBag[] = [];
  let topBag = 0;
  if (Array.isArray(r.bags)) {
    const seen = new Set<number>();
    for (const it of r.bags as unknown[]) {
      const b = bag(it, half);
      if (!b || seen.has(b.id)) continue;
      seen.add(b.id);
      bags.push(b);
      topBag = Math.max(topBag, b.id);
    }
  }

  const players: Record<string, PlayerSave> = {};
  if (isObject(r.players)) {
    for (const [key, it] of Object.entries(r.players as Record<string, unknown>)) {
      const p = player(it, half);
      if (!p || !key) continue;
      // Only a bot seat's entry is a bot's (botSpecsFor reads those); one under a nickname is a human's.
      if (!isBotSeat(key)) p.bot = false;
      players[key] = p;
    }
  }

  const hordes: HordeSave[] = [];
  if (Array.isArray(r.hordes)) {
    for (const it of r.hordes as unknown[]) {
      const h = horde(it, half);
      if (h) hordes.push(h);
    }
  }

  const clock = num(r.clock, fresh.clock, 0, 1e9);
  const day = Math.floor(clock / OPEN.dayLength) + 1;
  return {
    v: 1,
    slot,
    name: cleanName(r.name, fresh.name),
    seed: open.seed,
    difficulty: fresh.difficulty,
    bots: fresh.bots,
    created: num(r.created, now, 0, 1e15),
    saved: num(r.saved, now, 0, 1e15),
    played: num(r.played, 0, 0, 1e9),
    clock,
    pieces,
    nextPieceId: Math.max(int(r.nextPieceId, OPEN.firstPlayerPieceId, OPEN.firstPlayerPieceId, 2e9), topPlayerId + 1),
    nodes,
    crates,
    bags,
    nextBagId: Math.max(int(r.nextBagId, 1, 1, 2e9), topBag + 1),
    stash: resources(r.stash, Infinity),
    players,
    hordes,
    nextSiege: num(r.nextSiege, 0, 0, 1e9),
    sieges: int(r.sieges, 0, 0, 1e6),
    kills: int(r.kills, 0, 0, 1e9),
    bestDay: Math.max(day, int(r.bestDay, 1, 1, 1e6)),
  };
}

/**
 * The world's bot buddies 'b1'…'bN': their saved name, look and weapon when the save has them,
 * else picked from the seed (so a world's bots are the same pandas every time).
 */
export function botSpecsFor(save: WorldSave): PlayerSpec[] {
  const count = Math.max(0, Math.min(MAX_BOTS, Math.floor(save.bots) || 0));
  const rng = new Rng((save.seed ^ 0x5bd1e995) >>> 0);
  const offset = Math.floor(rng.next() * 10);
  const used = new Set<string>();
  const specs: PlayerSpec[] = [];
  for (let i = 0; i < count; i++) {
    const id = `b${i + 1}`;
    const variant = PANDA_VARIANTS[Math.floor(rng.next() * PANDA_VARIANTS.length)];
    const weapon = WEAPON_TYPES[Math.floor(rng.next() * WEAPON_TYPES.length)];
    const saved = save.players[id];
    if (saved && saved.bot) {
      specs.push({ id, name: saved.name, variant: saved.variant, weapon: saved.weapon, bot: true });
      used.add(saved.name);
      continue;
    }
    let name = botName(offset + i);
    for (let k = 1; used.has(name) && k < 10; k++) name = botName(offset + i + k);
    used.add(name);
    specs.push({ id, name, variant, weapon, bot: true });
  }
  return specs;
}

// ---------------------------------------------------------------- field checks

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(v: unknown, def: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
}

function int(v: unknown, def: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : def;
}

function str(v: unknown, def: string): string {
  return typeof v === 'string' ? v : def;
}

function cleanName(v: unknown, def: string): string {
  const s = typeof v === 'string' ? v.trim().slice(0, NAME_MAX) : '';
  return s || def;
}

function resources(v: unknown, cap: number): Resources {
  const out = emptyResources();
  if (!isObject(v)) return out;
  for (const k of RESOURCE_KINDS) out[k] = int(v[k], 0, 0, Math.min(cap, 1e7));
  return out;
}

function piece(v: unknown, tiles: number): Piece | null {
  if (!isObject(v)) return null;
  const kind = v.kind as PieceKind;
  if (!PIECE_KINDS.includes(kind)) return null;
  const id = int(v.id, -1, -1, 2e9);
  if (id < 1) return null;
  if (!Number.isInteger(v.gx) || !Number.isInteger(v.gz)) return null;
  const gx = v.gx as number;
  const gz = v.gz as number;
  if (gx < -tiles || gx >= tiles || gz < -tiles || gz >= tiles) return null;
  const tier = int(v.tier, 0, 0, PIECES[kind].upgrades.length) as Tier;
  const max = maxHp(kind, tier);
  const hp = num(v.hp, max, 0, max);
  const ruined = v.ruined === true || hp <= 0;
  return {
    id,
    kind,
    tier,
    gx,
    gz,
    rot: int(v.rot, 0, 0, 3) as Rot,
    hp: ruined ? 0 : hp,
    ruined,
    poi: int(v.poi, -1, -1, 1e6),
    owner: str(v.owner, '').slice(0, NAME_MAX),
  };
}

function bag(v: unknown, half: number): LootBag | null {
  if (!isObject(v)) return null;
  const id = int(v.id, -1, -1, 2e9);
  const x = num(v.x, NaN, -half, half);
  const z = num(v.z, NaN, -half, half);
  if (id < 1 || Number.isNaN(x) || Number.isNaN(z)) return null;
  const res = resources(v.res, 1e6);
  const crackers = int(v.crackers, 0, 0, CRACKER.max * 4);
  if (packTotal(res) === 0 && crackers === 0) return null;
  return { id, x, z, res, crackers, owner: str(v.owner, '').slice(0, NAME_MAX) };
}

function player(v: unknown, half: number): PlayerSave | null {
  if (!isObject(v)) return null;
  const variant = v.variant as PandaVariant;
  const weapon = v.weapon as WeaponType;
  if (!PANDA_VARIANTS.includes(variant) || !WEAPON_TYPES.includes(weapon)) return null;
  const name = cleanName(v.name, '');
  if (!name) return null;
  let extra: WeaponType | null = WEAPON_TYPES.includes(v.extra as WeaponType) ? (v.extra as WeaponType) : null;
  if (extra === weapon) extra = null;
  const pack = resources(v.pack, OPEN.packMax);
  // An over-full pack (tampered with, or the limit went down) is trimmed from the end.
  let over = packTotal(pack) - OPEN.packMax;
  for (let i = RESOURCE_KINDS.length - 1; i >= 0 && over > 0; i--) {
    const k = RESOURCE_KINDS[i];
    const cut = Math.min(over, pack[k]);
    pack[k] -= cut;
    over -= cut;
  }
  const javelins = weapon === 'javelin' || extra === 'javelin';
  return {
    name,
    variant,
    weapon,
    bot: v.bot === true,
    x: num(v.x, 0, -half, half),
    z: num(v.z, 0, -half, half),
    hp: num(v.hp, SURVIVOR.maxHp, 1, SURVIVOR.maxHp),
    hunger: num(v.hunger, OPEN.hungerMax, 0, OPEN.hungerMax),
    pack,
    extra,
    hand: v.hand === 'extra' && extra ? 'extra' : 'main',
    ammo: javelins ? int(v.ammo, JAVELIN.ammo, 0, JAVELIN.ammo) : 0,
    crackers: int(v.crackers, CRACKER.start, 0, CRACKER.max),
    bed: int(v.bed, -1, -1, 2e9),
    kills: int(v.kills, 0, 0, 1e9),
  };
}

function horde(v: unknown, half: number): HordeSave | null {
  if (!isObject(v)) return null;
  const x = num(v.x, NaN, -half, half);
  const z = num(v.z, NaN, -half, half);
  const n = int(v.n, 0, 0, OPEN.siege.max);
  if (Number.isNaN(x) || Number.isNaN(z) || n < 1) return null;
  let hx = num(v.hx, 1, -1, 1);
  let hz = num(v.hz, 0, -1, 1);
  const l = Math.hypot(hx, hz);
  if (l < 1e-3) {
    hx = 1;
    hz = 0;
  } else {
    hx /= l;
    hz /= l;
  }
  return { x, z, n, hx, hz };
}
