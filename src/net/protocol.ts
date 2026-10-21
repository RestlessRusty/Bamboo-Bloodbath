import { DIFFICULTIES, type Difficulty } from '../config';
import { clamp } from '../core/math';
import type { MapRef } from '../sim/mapLayout';
import {
  PIECE_KINDS,
  RECIPE_IDS,
  RESOURCE_KINDS,
  emptyResources,
  type LootBag,
  type OpenCommand,
  type Piece,
  type PieceKind,
  type RecipeId,
  type Resources,
  type RoomMode,
  type Rot,
  type Tier,
  type WorldJoin,
} from '../sim/open/types';
import { PANDA_VARIANTS, WEAPON_TYPES, type PandaVariant, type PlayerInput, type PlayerSpec, type WeaponType } from '../sim/types';
import type { EncodedSnapshot } from './codec';

/** Bump when messages change so old and new versions refuse to mix. */
export const PROTOCOL_VERSION = 8;

/** Room code "K7QX" becomes PeerJS id "bamboo-bloodbath-v1-K7QX" for the host. */
export const PEER_PREFIX = 'bamboo-bloodbath-v1-';

/** No 0/O, 1/I/L, to avoid typos when reading codes aloud. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

export function makeRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return code;
}

export function isRoomCode(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length === CODE_LENGTH && [...raw].every((c) => ALPHABET.includes(c));
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

export interface LobbyPlayer {
  id: string;
  name: string;
  variant: PandaVariant;
  weapon: WeaponType;
}

export type ClientMsg =
  /** `seat`: this device's ticket for the room, so a guest who drops out gets their panda back. */
  | { t: 'hello'; v: number; name: string; variant: PandaVariant; weapon: WeaponType; seat: string }
  | { t: 'input'; i: number[] }
  /** "End match": every human is done, stop waiting for the bots (the host checks). */
  | { t: 'end' }
  /** Infinite mode: build, upgrade, repair, demolish or craft (sent reliably, checked by the host's rules). */
  | { t: 'cmd'; c: OpenCommand };

/** The world an infinite-mode room plays, as shown in the lobby. */
export interface RoomWorld {
  name: string;
  day: number;
}

export type HostMsg =
  | { t: 'welcome'; id: string }
  /** Also sent right after 'welcome' when an infinite-mode world turns out to be full. */
  | { t: 'reject'; reason: string }
  /**
   * `map` is the host's pick (a map id or "random"); `playing`: a match is on, you're in the next one.
   * `mode` 'open': the room plays the saved world `world` (map and bots come from it).
   */
  | { t: 'lobby'; players: LobbyPlayer[]; bots: number; map: string; difficulty: Difficulty; playing?: boolean; mode: RoomMode; world?: RoomWorld }
  /**
   * `map` is the concrete map everyone builds for this match. `you`: joining a match already running,
   * the panda you play (your own when you're back, or a bot's you take over).
   * Infinite mode: `open` is the world as it is right now (always with `you` mid-world), `world` its name.
   */
  | { t: 'start'; specs: PlayerSpec[]; map: MapRef; difficulty: Difficulty; you?: string; open?: WorldJoin; world?: RoomWorld }
  /** Mid-match: pandas changed hands (names and bot flags). */
  | { t: 'specs'; specs: PlayerSpec[] }
  | { t: 'snap'; s: EncodedSnapshot }
  | { t: 'bye'; reason: string };

const r2 = (v: number) => Math.round(v * 100) / 100;

export function encodeInput(i: PlayerInput): number[] {
  return [r2(i.mx), r2(i.mz), r2(i.ax), r2(i.az), (i.attack ? 1 : 0) | (i.dash ? 2 : 0) | (i.cracker ? 4 : 0) | (i.swap ? 8 : 0)];
}

/** Defensive: never trust numbers coming over the wire. */
export function decodeInput(raw: unknown): PlayerInput {
  const a = Array.isArray(raw) ? raw : [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, -1, 1) : 0);
  const flags = typeof a[4] === 'number' ? a[4] : 0;
  return {
    mx: num(a[0]),
    mz: num(a[1]),
    ax: num(a[2]),
    az: num(a[3]),
    attack: (flags & 1) !== 0,
    dash: (flags & 2) !== 0,
    cracker: (flags & 4) !== 0,
    swap: (flags & 8) !== 0,
  };
}

export function sanitizeName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 14) : '';
  return s || 'Panda';
}

export function sanitizeVariant(raw: unknown): PandaVariant {
  return PANDA_VARIANTS.includes(raw as PandaVariant) ? (raw as PandaVariant) : 'giant';
}

export function sanitizeDifficulty(raw: unknown): Difficulty {
  return DIFFICULTIES.includes(raw as Difficulty) ? (raw as Difficulty) : 'normal';
}

export function sanitizeWeapon(raw: unknown): WeaponType {
  return WEAPON_TYPES.includes(raw as WeaponType) ? (raw as WeaponType) : 'knife';
}

// ------------------------------------------------------------------ infinite mode

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
/** Piece, node, crate and bag ids. */
const isId = (v: unknown): v is number => isInt(v) && v >= 0 && v <= 1e9;
/** Building-grid tiles: the world is OPEN.worldSize / OPEN.tile = 512 tiles across, so this is generous. */
const isTile = (v: unknown): v is number => isInt(v) && Math.abs(v) <= 4096;
const isRot = (v: unknown): v is Rot => v === 0 || v === 1 || v === 2 || v === 3;
const num = (v: unknown): number => (isNum(v) ? v : 0);
const cleanText = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');

export function sanitizeMode(raw: unknown): RoomMode {
  return raw === 'open' ? 'open' : 'quick';
}

export function sanitizeRoomWorld(raw: unknown): RoomWorld | null {
  if (!raw || typeof raw !== 'object') return null;
  const { name, day } = raw as Record<string, unknown>;
  if (typeof name !== 'string') return null;
  return { name: cleanText(name, 24) || 'World', day: isInt(day) && day >= 1 ? day : 1 };
}

/** A guest's build / craft request. Null for anything malformed; the rules still check it's allowed. */
export function sanitizeCommand(raw: unknown): OpenCommand | null {
  if (!raw || typeof raw !== 'object') return null;
  const { c, kind, gx, gz, rot, id, recipe } = raw as Record<string, unknown>;
  switch (c) {
    case 'place':
      if (!PIECE_KINDS.includes(kind as PieceKind) || !isTile(gx) || !isTile(gz) || !isRot(rot)) return null;
      return { c: 'place', kind: kind as PieceKind, gx, gz, rot };
    case 'upgrade':
      return isId(id) ? { c: 'upgrade', id } : null;
    case 'repair':
      return isId(id) ? { c: 'repair', id } : null;
    case 'demolish':
      return isId(id) ? { c: 'demolish', id } : null;
    case 'craft':
      return RECIPE_IDS.includes(recipe as RecipeId) ? { c: 'craft', recipe: recipe as RecipeId } : null;
    default:
      return null;
  }
}

function sanitizeResources(raw: unknown): Resources {
  const out = emptyResources();
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    for (const k of RESOURCE_KINDS) out[k] = Math.max(0, num(r[k]));
  }
  return out;
}

function sanitizePiece(raw: unknown): Piece | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, kind, tier, gx, gz, rot, hp, ruined, poi, owner } = raw as Record<string, unknown>;
  if (!isId(id) || !PIECE_KINDS.includes(kind as PieceKind) || !isTile(gx) || !isTile(gz)) return null;
  const t: Tier = tier === 1 ? 1 : tier === 2 ? 2 : 0;
  return {
    id,
    kind: kind as PieceKind,
    tier: t,
    gx,
    gz,
    rot: isRot(rot) ? rot : 0,
    hp: Math.max(0, num(hp)),
    ruined: ruined === true,
    poi: isInt(poi) ? poi : -1,
    owner: cleanText(owner, 14),
  };
}

function sanitizeBag(raw: unknown): LootBag | null {
  if (!raw || typeof raw !== 'object') return null;
  const { id, x, z, res, crackers, owner } = raw as Record<string, unknown>;
  if (!isId(id) || !isNum(x) || !isNum(z)) return null;
  return { id, x, z, res: sanitizeResources(res), crackers: Math.max(0, Math.floor(num(crackers))), owner: cleanText(owner, 14) };
}

/** The world as the host sent it when we joined (defensive: it seeds the guest's WorldMirror). */
export function sanitizeJoin(raw: unknown): WorldJoin | null {
  if (!raw || typeof raw !== 'object') return null;
  const { seed, clock, pieces, nodes, crates, bags } = raw as Record<string, unknown>;
  if (!isNum(seed)) return null;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    seed,
    clock: Math.max(0, num(clock)),
    pieces: list(pieces)
      .map(sanitizePiece)
      .filter((p): p is Piece => p !== null),
    nodes: list(nodes)
      .filter((n): n is [number, number] => Array.isArray(n) && isId(n[0]) && isNum(n[1]))
      .map(([nodeId, left]): [number, number] => [nodeId, Math.max(0, left)]),
    crates: list(crates).filter(isId),
    bags: list(bags)
      .map(sanitizeBag)
      .filter((b): b is LootBag => b !== null),
  };
}
