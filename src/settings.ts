import { MAX_PLAYERS } from './config';
import { PANDA_VARIANTS, WEAPON_TYPES, type PandaVariant, type WeaponType } from './sim/types';

export type ControlScheme = 'joystick' | 'tilt' | 'tap';
export type Quality = 'low' | 'high';

export interface Settings {
  nickname: string;
  variant: PandaVariant;
  weapon: WeaponType;
  /** Bot buddies in single player (0–3). */
  bots: number;
  /** Map choice for solo and for rooms you host: a map id or "random". */
  map: string;
  controls: ControlScheme;
  quality: Quality;
  sound: boolean;
  music: boolean;
  vibration: boolean;
  showFps: boolean;
  flipTilt: boolean;
}

const KEY = 'bamboo-bloodbath/settings/v1';

const CONTROL_SCHEMES: readonly ControlScheme[] = ['joystick', 'tilt', 'tap'];
const QUALITIES: readonly Quality[] = ['low', 'high'];

/** Phones start on low quality; most can't hold 60 fps with shadows and antialiasing. */
function isTouchDevice(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

const DEFAULTS: Settings = {
  nickname: '',
  variant: 'giant',
  weapon: 'knife',
  bots: 1,
  map: 'valley',
  controls: 'joystick',
  quality: isTouchDevice() ? 'low' : 'high',
  sound: true,
  music: true,
  vibration: true,
  showFps: false,
  flipTilt: false,
};

function oneOf<T>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Stored settings may come from an older build (renamed variants, weapons, maps…) or be
 * tampered with; anything unknown falls back to its default instead of crashing the menu.
 */
function sanitize(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof Settings, unknown>>) : {};
  const bots = typeof r.bots === 'number' && Number.isFinite(r.bots) ? Math.round(r.bots) : DEFAULTS.bots;
  return {
    nickname: typeof r.nickname === 'string' ? r.nickname.slice(0, 14) : DEFAULTS.nickname,
    variant: oneOf(PANDA_VARIANTS, r.variant, DEFAULTS.variant),
    weapon: oneOf(WEAPON_TYPES, r.weapon, DEFAULTS.weapon),
    bots: Math.max(0, Math.min(MAX_PLAYERS - 1, bots)),
    // Checked against the map list in main.ts.
    map: typeof r.map === 'string' ? r.map : DEFAULTS.map,
    controls: oneOf(CONTROL_SCHEMES, r.controls, DEFAULTS.controls),
    quality: oneOf(QUALITIES, r.quality, DEFAULTS.quality),
    sound: bool(r.sound, DEFAULTS.sound),
    music: bool(r.music, DEFAULTS.music),
    vibration: bool(r.vibration, DEFAULTS.vibration),
    showFps: bool(r.showFps, DEFAULTS.showFps),
    flipTilt: bool(r.flipTilt, DEFAULTS.flipTilt),
  };
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    // Storage blocked or corrupt: fall back to defaults.
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not fatal; settings just won't persist.
  }
}
