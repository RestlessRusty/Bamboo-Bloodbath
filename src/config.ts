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
  /** Distance you must walk away from a rack before it can swap with you again. */
  rackLeave: 2.2,
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
  damage: 35,
  knockback: 6,
  stun: 0.4,
};

export const CAMERA = {
  fov: 40,
  distance: 24,
  pitchDeg: 56,
  /** Extra zoom-out (fraction of distance) when standing on top of the hill. */
  hillZoom: 0.45,
  follow: 6,
};
