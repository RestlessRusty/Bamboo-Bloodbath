/** Gameplay tuning in one place. Distances in metres, times in seconds. */

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

/** The host sends a snapshot every N ticks (60 / 3 = 20 per second). */
export const NET_SEND_EVERY = 3;
/** Clients draw this many ticks behind the newest snapshot so they can interpolate. */
export const NET_INTERP_TICKS = 7;

export const MAX_PLAYERS = 4;
export const MATCH_TIME = 390; // 6:30
export const GRAVITY = -24;
export const GOAL_RADIUS = 4.5;
/** Fraction of normal acceleration on ice (frozen ponds): everyone slides. */
export const ICE_GRIP = 0.2;

export const SURVIVOR = {
  radius: 0.4,
  halfHeight: 0.25,
  speed: 3.8,
  accel: 28,
  turnSpeed: 14,
  dashSpeed: 10.5,
  dashTime: 0.18,
  dashCooldown: 1.1,
  waterSpeedMul: 0.5,
  attackMoveMul: 0.55,
  maxHp: 100,
};

export const ZOMBIE = {
  radius: 0.4,
  halfHeight: 0.25,
  hp: 40,
  speed: 2.9,
  wanderSpeed: 0.9,
  /** Speed multiplier while wading through shallow water (fords). Deep water stops zombies. */
  wadeSpeedMul: 0.6,
  accel: 18,
  turnSpeed: 8,
  /** How far zombies notice a survivor, and how close when the survivor hides in bamboo. */
  sense: 16,
  hiddenSense: 3.5,
  biteRange: 1.15,
  biteReach: 1.5,
  biteWindup: 0.35,
  biteTime: 0.6,
  biteDamage: 12,
  biteCooldown: 1.0,
  lungeMin: 2,
  lungeMax: 4,
  lungeChance: 0.03,
  lungeSpeed: 7.5,
  lungeTime: 0.3,
  lungeDamage: 15,
  dyingTime: 1.4,
  /** Horde size = (base + perSurvivor * survivors) * (1 + progressBonus * progress). */
  base: 10,
  perSurvivor: 8,
  progressBonus: 0.6,
  max: 60,
  spawnInterval: 0.35,
  spawnMin: 24,
  spawnMax: 34,
  safeRadius: 18,
  despawnRadius: 55,
};

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

/**
 * Multipliers on top of the normal rules (story chapters' own rules included). In multiplayer the host's
 * choice counts. Hard never raises the horde cap above ZOMBIE.max: phones can't draw many more.
 */
export const DIFFICULTY: Record<
  Difficulty,
  { label: string; horde: number; damage: number; zombieSpeed: number; sleepShare: number }
> = {
  easy: { label: 'Easy', horde: 0.65, damage: 0.6, zombieSpeed: 0.9, sleepShare: 1.25 },
  normal: { label: 'Normal', horde: 1, damage: 1, zombieSpeed: 1, sleepShare: 1 },
  hard: { label: 'Hard', horde: 1.35, damage: 1.35, zombieSpeed: 1.1, sleepShare: 0.75 },
};

/** Most of the starting horde is asleep until something noisy happens nearby. */
export const SLEEP = {
  /** Share of the zombies placed at match start that are asleep. */
  share: 0.6,
  /** Seconds to get up once woken (a window to sneak away or strike first). */
  wakeTime: 0.9,
  /** Damage multiplier against a sleeping zombie: any weapon finishes it in one hit. */
  sneakAttackMul: 2.5,
  /** Snores are only sent when a survivor is this close. */
  snoreRange: 14,
  snoreMin: 2.5,
  snoreMax: 5,
};

/** How far (m) each action wakes sleeping zombies. */
export const NOISE = {
  /** Footsteps when walking slowly (less than knife reach, so you can sneak up for a stab)… */
  sneak: 0.9,
  /** …growing to this at full speed. */
  run: 7,
  /** Moving slower than this fraction of full speed counts as sneaking. */
  sneakFrac: 0.55,
  /** Footsteps inside a bamboo thicket are muffled by this factor. */
  thicketMul: 0.6,
  dash: 7,
  splash: 9,
  /** Melee swings, by weapon (javelin = the empty-handed slap). */
  swing: { knife: 2.5, axe: 6, javelin: 3 },
  /** A javelin landing or hitting something. */
  thud: 5,
  /** A zombie getting up groans, which can rouse its neighbours. */
  groan: 5,
};

export const CRACKER = {
  /** Firecrackers each survivor starts with, and the most you can carry. */
  start: 2,
  max: 3,
  /** Chance that a killed zombie drops one. */
  dropChance: 0.12,
  /** Most dropped firecrackers lying around at once (oldest go first). */
  maxDrops: 10,
  dropLife: 60,
  pickupRadius: 1.1,
  cooldown: 0.6,
  speed: 9,
  lift: 6.5,
  gravity: 15,
  /** Seconds the string crackles after landing, pulling zombies in, before the final bang. */
  popTime: 4,
  /** Zombies this close come to it (and sleepers wake). */
  lure: 20,
  /** …unless they're already this close to a survivor. */
  ignoreNear: 2.2,
  bangRadius: 2.6,
  bangStun: 1.2,
  bangKnockback: 6,
};

export const DOWNED = {
  bleedTime: 10,
  /** Bleed-out time when nobody is left who could revive you. */
  aloneBleedTime: 2.5,
  reviveTime: 2.5,
  reviveRadius: 1.6,
  reviveHp: 40,
};

export const PICKUP = {
  bambooHeal: 35,
  bambooRespawn: 40,
  bambooRadius: 1.1,
  rackRadius: 1.2,
  /** Distance you must walk away from a rack before it can hand you something again. */
  rackLeave: 2.2,
  /** Seconds a rack stays empty after someone took from it. */
  rackRefill: 30,
};

export const JAVELIN = {
  ammo: 2,
  speed: 19,
  lift: 2.2,
  gravity: 9,
  maxAge: 1.6,
  hitRadius: 0.6,
  pickupRadius: 1.1,
  groundLife: 90,
  /** One throw kills a zombie (ZOMBIE.hp 40). */
  damage: 45,
  knockback: 6,
  stun: 0.4,
  /** Zombies one throw can hit: it goes through the first. */
  pierce: 2,
  /** Seconds to carve a new javelin while some are missing. */
  carve: 8,
};

export const CAMERA = {
  fov: 40,
  distance: 24,
  pitchDeg: 56,
  /** Extra zoom-out (fraction of distance) when standing on top of the hill. */
  hillZoom: 0.45,
  follow: 6,
};
