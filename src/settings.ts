import type { PandaVariant, WeaponType } from './sim/types';

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

const DEFAULTS: Settings = {
  nickname: '',
  variant: 'giant',
  weapon: 'knife',
  bots: 1,
  map: 'valley',
  controls: 'joystick',
  quality: 'high',
  sound: true,
  music: true,
  vibration: true,
  showFps: false,
  flipTilt: false,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
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
