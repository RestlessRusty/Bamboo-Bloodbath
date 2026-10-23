import type { LootBag, OpenSnap, Piece, PieceKind, RecipeId, ResourceKind } from './open/types';

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
  /** A story character (Doc): driven by the mission's own AI, not a teammate you play with. */
  npc?: boolean;
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
  /** Throw a firecracker (one-shot, like dash). Uses the aim if given, else the facing. */
  cracker: boolean;
  /** Switch to the weapon in the other slot (one-shot). */
  swap: boolean;
}

export const NO_INPUT: Readonly<PlayerInput> = { mx: 0, mz: 0, ax: 0, az: 0, attack: false, dash: false, cracker: false, swap: false };

export type SurvivorState = 'active' | 'downed' | 'rescued' | 'dead';
export type MatchPhase = 'playing' | 'won' | 'lost';
export type ZombieState = 'walk' | 'bite' | 'lunge' | 'stun' | 'dying' | 'sleep' | 'wake';

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
  /** Weapon in hand. */
  weapon: WeaponType;
  /** The other slot's weapon (switch to it), or null with just the starting weapon. */
  other: WeaponType | null;
  /** Javelins carried (when one of the slots holds javelins). */
  ammo: number;
  /** Seconds until a downed survivor turns. */
  bleed: number;
  /** Revive progress 0..1 while downed. */
  revive: number;
  /** Damage flash 0..1. */
  hurt: number;
  kills: number;
  /** Firecrackers carried. */
  crackers: number;
}

export interface ZombieSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  rot: number;
  speed: number;
  state: ZombieState;
  /** Progress 0..1 through the current bite / lunge / death / getting up. */
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

/** A thrown firecracker: in the air, or crackling on the ground. */
export interface CrackerSnap {
  id: number;
  x: number;
  y: number;
  z: number;
  flying: boolean;
}

/** A firecracker lying on the ground to be picked up. */
export interface CrackerDropSnap {
  id: number;
  x: number;
  y: number;
  z: number;
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
  /** Took a weapon from a rack (or refilled javelins there). */
  | { e: 'swap'; id: string; w: WeaponType }
  /** Switched to the weapon in the other slot. */
  | { e: 'draw'; id: string; w: WeaponType }
  | { e: 'grab'; id: string }
  | { e: 'splash'; x: number; z: number }
  | { e: 'thud'; x: number; y: number; z: number }
  | { e: 'snore'; x: number; z: number }
  | { e: 'wake'; x: number; z: number }
  | { e: 'toss'; id: string }
  | { e: 'pop'; x: number; y: number; z: number }
  | { e: 'bang'; x: number; y: number; z: number }
  | { e: 'loot'; id: string }
  // Story mode only (solo, so these never go over the network).
  | { e: 'say'; who: string; text: string }
  | { e: 'collect'; id: string; x: number; y: number; z: number }
  | { e: 'objective' }
  | { e: 'checkpoint' }
  | { e: 'heal'; id: string }
  // Infinite mode. The first six change the world itself: every client's WorldMirror applies them.
  /** A piece was placed, or changed (tier, hp band, ruined, repaired). */
  | { e: 'piece'; p: Piece }
  /** A piece was demolished. */
  | { e: 'unpiece'; id: number }
  /** A resource node now holds `left` units (0: depleted; full again when regrown). */
  | { e: 'node'; id: number; left: number }
  /** A crate was emptied by panda `by`. */
  | { e: 'crate'; id: number; by: string }
  /** A dead panda's pack was dropped… */
  | { e: 'bag'; b: LootBag }
  /** …and picked up by `by`. */
  | { e: 'unbag'; id: number; by: string }
  /** Panda `id` gathered `n` of resource `r` at (x, z). */
  | { e: 'gather'; id: string; r: ResourceKind; n: number; x: number; z: number }
  | { e: 'built'; id: string; kind: PieceKind; how: 'place' | 'upgrade' | 'repair' | 'demolish'; x: number; z: number }
  /** A piece broke down to rubble. */
  | { e: 'smash'; x: number; z: number }
  /** A zombie bit a piece. */
  | { e: 'chomp'; x: number; z: number }
  | { e: 'crafted'; id: string; recipe: RecipeId }
  /** A command from panda `id` was refused (shown to that player only). */
  | { e: 'deny'; id: string; why: string }
  | { e: 'deposit'; id: string }
  | { e: 'respawn'; id: string }
  /** A siege is coming from (x, z), where the horde comes out of the wild; it arrives in `eta` seconds (`base`: it goes for the base). */
  | { e: 'siege'; x: number; z: number; eta: number; base: boolean }
  /** The siege is over: beaten off (`won`) or it gave up. */
  | { e: 'siegeOver'; won: boolean }
  | { e: 'dawn'; day: number }
  | { e: 'dusk' }
  | { e: 'hungry'; id: string }
  /** Panda `id` claimed bed `bed` (they respawn there). */
  | { e: 'bed'; id: string; bed: number };

export type StoryItemKind = 'battery' | 'lotus' | 'glowcap' | 'sack' | 'keycard';

/** Story machinery on the map: switched on or off by "activate" stages ('gate' opens when its stage is done). */
export type StoryDeviceKind = 'lever' | 'pump' | 'valve' | 'gate';

/** Why a story chapter was lost. */
export type StoryFail = 'doc' | 'time' | 'wiped';

/** Story mode state for the HUD and renderer. */
export interface StorySnap {
  /** Index of the current stage (objective) in the chapter. */
  stage: number;
  /** Items picked up / needed in a "collect" stage; spots done / needed in an "activate" stage. */
  got: number;
  need: number;
  /**
   * Progress 0..1 of a "hold" stage, of the cart's way in an "escort" stage, or of the spot being worked
   * in an "activate" stage; and whether that's going on right now (someone in the zone / cart rolling / at a spot).
   */
  hold: number;
  holding: boolean;
  /** The chapter's machinery: `t` is how far along it is being switched (0..1), `live` while it's an objective. */
  devices: { kind: StoryDeviceKind; x: number; z: number; yaw: number; t: number; done: boolean; live: boolean }[];
  /** The cart in escort chapters. `jammed`: zombies on it; `idle`: nobody pushing. */
  cart: { x: number; z: number; yaw: number; state: 'rolling' | 'idle' | 'jammed'; left: number } | null;
  /** The player is at the target but Doc is lagging behind. */
  waitDoc: boolean;
  items: { id: number; kind: StoryItemKind; x: number; y: number; z: number }[];
  /** Area to defend in a "hold" stage. */
  zone: { x: number; z: number; r: number } | null;
  /** Where the current objective is (for the light beam), if it's one place. */
  target: { x: number; z: number } | null;
  /** Next point to walk to for the HUD arrow (a pass or bridge on the way), and the distance left. */
  arrow: { x: number; z: number } | null;
  dist: number;
  /** Stage a retry starts from, and the clock (-1: untimed) when it was reached. */
  checkpoint: number;
  checkpointTime: number;
  fail: StoryFail | null;
}

/** Everything a client needs to draw one simulation tick. */
export interface Snapshot {
  tick: number;
  /** Seconds left on the clock; -1 when the match has no time limit. */
  timeLeft: number;
  phase: MatchPhase;
  rescued: number;
  /** Quick play: bots still out once every human is done (someone made it), so the match can be ended early; else 0. */
  botsOut: number;
  survivors: SurvivorSnap[];
  zombies: ZombieSnap[];
  javelins: JavelinSnap[];
  crackers: CrackerSnap[];
  crackerDrops: CrackerDropSnap[];
  /** Which bamboo snack spots currently have food (same order as MapProps.bambooSpots). */
  bamboo: boolean[];
  /** Weapon on each rack, null while it's empty after someone took it (same order as MapProps.racks). */
  racks: (WeaponType | null)[];
  /** Things that happened since the previous snapshot (sounds, effects, messages). */
  events: GameEvent[];
  /** Story mode only. */
  story?: StorySnap;
  /** Infinite mode only. */
  open?: OpenSnap;
}
