export type PandaVariant = 'giant' | 'red' | 'brown' | 'ink';
export const PANDA_VARIANTS: readonly PandaVariant[] = ['giant', 'red', 'brown', 'ink'];

export type WeaponType = 'knife' | 'axe' | 'javelin';
export const WEAPON_TYPES: readonly WeaponType[] = ['knife', 'axe', 'javelin'];

export interface PlayerSpec {
  id: string;
  name: string;
  variant: PandaVariant;
  weapon: WeaponType;
  bot: boolean;
}

/**
 * One tick of player intent. Movement (mx, mz) and aim (ax, az) are world-space XZ
 * vectors with length <= 1. Aim is optional (0, 0) and only used to direct an attack.
 */
export interface PlayerInput {
  mx: number;
  mz: number;
  ax: number;
  az: number;
  attack: boolean;
  dash: boolean;
}

export const NO_INPUT: Readonly<PlayerInput> = { mx: 0, mz: 0, ax: 0, az: 0, attack: false, dash: false };

export type SurvivorState = 'active' | 'downed' | 'rescued' | 'dead';
export type MatchPhase = 'playing' | 'won' | 'lost';
export type ZombieState = 'walk' | 'bite' | 'lunge' | 'stun' | 'dying';

export interface SurvivorSnap {
  id: string;
  /** Feet position. */
  x: number;
  y: number;
  z: number;
  /** Facing angle around Y; 0 faces +Z. */
  rot: number;
  speed: number;
  /** Attack progress 0..1, or -1 when not attacking. */
  attackT: number;
  dashing: boolean;
  inWater: boolean;
  hidden: boolean;
  hp: number;
  state: SurvivorState;
  weapon: WeaponType;
  ammo: number;
  /** Seconds until a downed survivor turns. */
  bleed: number;
  /** Revive progress 0..1 while downed. */
  revive: number;
  /** Damage flash 0..1. */
  hurt: number;
  kills: number;
}

export interface ZombieSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  speed: number;
  state: ZombieState;
  /** Progress 0..1 through the current bite / lunge / death. */
  t: number;
  /** Cosmetic tint index. */
  look: number;
  hurt: number;
  /** Player id if this zombie used to be a survivor. */
  from: string | null;
}

export interface JavelinSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
}

export type GameEvent =
  | { e: 'swing'; id: string; w: WeaponType }
  | { e: 'throw'; id: string }
  | { e: 'dash'; id: string }
  | { e: 'hit'; x: number; y: number; z: number; kill: boolean }
  | { e: 'bite'; id: string }
  | { e: 'groan'; x: number; z: number }
  | { e: 'downed'; id: string }
  | { e: 'revived'; id: string }
  | { e: 'turned'; id: string }
  | { e: 'rescued'; id: string }
  | { e: 'eat'; id: string }
  | { e: 'swap'; id: string; w: WeaponType }
  | { e: 'grab'; id: string }
  | { e: 'splash'; x: number; z: number }
  | { e: 'thud'; x: number; y: number; z: number };

/** Everything a client needs to draw one simulation tick. */
export interface Snapshot {
  tick: number;
  timeLeft: number;
  phase: MatchPhase;
  rescued: number;
  survivors: SurvivorSnap[];
  zombies: ZombieSnap[];
  javelins: JavelinSnap[];
  /** Which bamboo snack spots currently have food (same order as MapProps.bambooSpots). */
  bamboo: boolean[];
  /** Weapon currently on each rack (same order as MapProps.racks). */
  racks: WeaponType[];
  /** Things that happened since the previous snapshot (sounds, effects, messages). */
  events: GameEvent[];
}
