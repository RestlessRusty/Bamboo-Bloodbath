import { DIFFICULTIES, type Difficulty } from '../config';
import { clamp } from '../core/math';
import type { MapRef } from '../sim/mapLayout';
import { PANDA_VARIANTS, WEAPON_TYPES, type PandaVariant, type PlayerInput, type PlayerSpec, type WeaponType } from '../sim/types';
import type { EncodedSnapshot } from './codec';

/** Bump when messages change so old and new versions refuse to mix. */
export const PROTOCOL_VERSION = 6;

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
  | { t: 'end' };

export type HostMsg =
  | { t: 'welcome'; id: string }
  | { t: 'reject'; reason: string }
  /** `map` is the host's pick (a map id or "random"); `playing`: a match is on, you're in the next one. */
  | { t: 'lobby'; players: LobbyPlayer[]; bots: number; map: string; difficulty: Difficulty; playing?: boolean }
  /**
   * `map` is the concrete map everyone builds for this match. `you`: joining a match already running,
   * the panda you play (your own when you're back, or a bot's you take over).
   */
  | { t: 'start'; specs: PlayerSpec[]; map: MapRef; difficulty: Difficulty; you?: string }
  /** Mid-match: pandas changed hands (names and bot flags). */
  | { t: 'specs'; specs: PlayerSpec[] }
  | { t: 'snap'; s: EncodedSnapshot }
  | { t: 'bye'; reason: string };

const r2 = (v: number) => Math.round(v * 100) / 100;

export function encodeInput(i: PlayerInput): number[] {
  return [r2(i.mx), r2(i.mz), r2(i.ax), r2(i.az), (i.attack ? 1 : 0) | (i.dash ? 2 : 0) | (i.cracker ? 4 : 0)];
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
