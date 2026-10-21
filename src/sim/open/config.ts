import type { WeaponType } from '../types';
import type { Cost, NodeKind, PieceKind, RecipeId, ResourceKind } from './types';

/** Infinite mode tuning in one place. Distances in metres, times in seconds. */

/** MapRef id of the open world (its seed picks the world). */
export const OPEN_MAP_ID = 'open';

export const OPEN = {
  /** Side of the square world, centred on (0, 0). */
  worldSize: 1024,
  /** Streaming chunk side (render and physics). 16 × 16 chunks. */
  chunk: 64,
  /** Building grid cell. */
  tile: 2,

  /** One day and night, in seconds of play. */
  dayLength: 1200,
  /** Night is this part of the day (time of day 0..1, 0 = dawn). */
  nightStart: 0.72,
  nightEnd: 0.97,
  /** A new world starts this far into day 1 (a bright morning). */
  startTime: 0.04,

  /** Downed: seconds to respawn at your bed; a friend can revive you before that (DOWNED.reviveTime). */
  bleedTime: 30,
  /** …when nobody is left standing who could come. */
  aloneBleedTime: 8,
  respawnHp: 70,
  respawnHunger: 60,

  hungerMax: 100,
  /** Hunger lost per second: a full belly lasts 12 minutes. */
  hungerDrain: 100 / 720,
  /** Below this you walk slower (slowWhenHungry) and the HUD nags. */
  hungryAt: 25,
  slowWhenHungry: 0.85,
  /** At 0 hunger you lose this much HP per second, but never below starveFloor. */
  starveDamage: 1,
  starveFloor: 15,
  /** A bamboo snack fills this much (and still heals PICKUP.bambooHeal). */
  bambooFood: 30,

  /** Backpack holds this many resource units in total. */
  packMax: 60,
  /** Walk this close to a storage chest to empty your pack into the team stash. */
  depositRadius: 2.6,
  /** Building and crafting can use the stash when a storage chest is this close to you. */
  stashReach: 30,
  /** Furthest you can place / upgrade / repair / demolish from (to the tile centre). */
  buildReach: 9,
  /** Stand this close to a workbench or campfire to craft there. */
  craftReach: 4,
  /** Repairing costs this share of the piece's price at its tier (ruined: the full share; damaged: scaled by damage). */
  repairShare: 0.5,
  /** Demolishing your own piece gives back this share of what it cost. */
  refundShare: 0.5,
  /** Player-built piece ids start here; abandoned buildings use 1..firstPlayerPieceId-1. */
  firstPlayerPieceId: 100000,

  /** Units per successful hit, by node; the right tool gets gatherBonus more. */
  gatherPerHit: { tree: 2, rock: 2, grove: 3, scrap: 1 } satisfies Record<NodeKind, number>,
  gatherBonus: 2,
  /** Tool that's good for each node. */
  goodTool: { tree: 'axe', rock: 'axe', grove: 'knife', scrap: 'knife' } satisfies Record<NodeKind, WeaponType>,
  /** A depleted node grows back after this long. */
  nodeRegrow: 600,
  /** Chopping and mining are loud: sleepers within this wake, hordes may hear it. */
  gatherNoise: 9,
  /** Walk over a crate or bag this close to take it. */
  lootRadius: 1.4,

  /** Multiplayer: nobody gets further than this from the nearest other player… */
  leash: 250,
  /** …with a warning from here on. */
  leashWarn: 220,

  /** Most real zombies at once (phones can't draw many more). */
  zombiesMax: 60,
  /** Lone zombies around the pandas. */
  ambient: {
    day: 5,
    night: 11,
    perPlayer: 2,
    /** Share of ambient zombies placed asleep. */
    sleepShare: 0.5,
    spawnMin: 36,
    spawnMax: 54,
    /** Ambient zombies further than this from every panda wander off (despawn). */
    despawn: 80,
  },
  /** Roaming hordes: abstract groups moving over the world, turned into real zombies near pandas. */
  hordes: {
    count: 7,
    perDay: 1,
    max: 16,
    sizeMin: 6,
    sizeMax: 14,
    /** Become real zombies when a panda is this close… */
    materialize: 90,
    /** …and go back to being a marker once every panda is this far. */
    dematerialize: 150,
    /** m/s while roaming (×nightSpeed at night). */
    roamSpeed: 0.7,
    nightSpeed: 1.4,
    /** They come to look at loud noises this far away (scaled by the noise's radius / OPEN.gatherNoise). */
    hearRange: 140,
  },
  siege: {
    /** First siege between these fractions of day 1 and 2 (in days of world clock). */
    firstMin: 0.6,
    firstMax: 1.1,
    /** Then every gapMin..gapMax days, at any time of day. */
    gapMin: 1.0,
    gapMax: 2.2,
    /** Seconds of warning before it arrives (+lookoutWarn with a lookout tower standing). */
    warn: 75,
    lookoutWarn: 45,
    /** The siege goes for the base when any panda is this close to it, else for the nearest group of pandas. */
    baseRange: 150,
    /** Size = (base + perDay·day + perPlayer·players) × difficulty horde, at most max (sent in waves within zombiesMax). */
    base: 12,
    perDay: 5,
    perPlayer: 5,
    max: 90,
    /** Spawns this far from what it's going for. */
    spawnDist: 110,
    /** Gives up and wanders off after this long. */
    giveUp: 300,
    /** Scrap dropped per siege zombie killed (chance). */
    scrapChance: 0.3,
  },
  /** A zombie bite on a piece does ZOMBIE.biteDamage × this. */
  pieceBite: 1.5,
  spikes: { damage: 12, every: 0.8, wear: 4 },
  /** Lookouts reveal hordes on the map this far away. */
  lookoutRange: 220,
  /** Campfires light up the night this far (renderer) and keep ambient zombies from spawning this close. */
  campfireLight: 9,

  /** Autosave interval of the host's world. */
  autosave: 60,
  /** Saved worlds on a device. */
  slots: 3,
};

/** Chunk index (0..chunks-1, clamped) of a world coordinate. */
export function chunkOf(v: number): number {
  const n = OPEN.worldSize / OPEN.chunk;
  return Math.max(0, Math.min(n - 1, Math.floor((v + OPEN.worldSize / 2) / OPEN.chunk)));
}

/** Tile index of a world coordinate, and the centre of a tile. */
export function tileOf(v: number): number {
  return Math.floor(v / OPEN.tile);
}
export function tileCenter(g: number): number {
  return (g + 0.5) * OPEN.tile;
}

export const TIER_NAMES = ['Bamboo', 'Wood', 'Stone'] as const;

export interface PieceDef {
  kind: PieceKind;
  label: string;
  /** One line for the build palette. */
  blurb: string;
  /** Price at tier 0. */
  cost: Cost;
  /** Price of going from tier i to i+1 (walls and gates only). */
  upgrades: readonly Cost[];
  /** Hit points per tier. */
  hp: readonly number[];
  /** Who it stops: everyone, only zombies (pandas walk through gates), or nobody. */
  blocks: 'all' | 'zombies' | 'none';
  /** Model / collider height. */
  height: number;
}

export const PIECES: Record<PieceKind, PieceDef> = {
  wall: {
    kind: 'wall',
    label: 'Wall',
    blurb: 'Keeps zombies out. Upgrade to wood and stone.',
    cost: { bamboo: 4 },
    upgrades: [{ wood: 4 }, { stone: 5 }],
    hp: [120, 300, 700],
    blocks: 'all',
    height: 2.4,
  },
  gate: {
    kind: 'gate',
    label: 'Gate',
    blurb: 'Pandas walk through, zombies don’t.',
    cost: { bamboo: 6 },
    upgrades: [{ wood: 5 }, { stone: 5, scrap: 1 }],
    hp: [100, 250, 600],
    blocks: 'zombies',
    height: 2.4,
  },
  spikes: {
    kind: 'spikes',
    label: 'Spikes',
    blurb: 'Hurts zombies that walk over it. Wears out.',
    cost: { bamboo: 5, wood: 2 },
    upgrades: [],
    hp: [60],
    blocks: 'none',
    height: 0.6,
  },
  campfire: {
    kind: 'campfire',
    label: 'Campfire',
    blurb: 'Cook meals. Lights up the night.',
    cost: { wood: 4, stone: 3 },
    upgrades: [],
    hp: [80],
    blocks: 'all',
    height: 0.8,
  },
  workbench: {
    kind: 'workbench',
    label: 'Workbench',
    blurb: 'Craft weapons, firecrackers and bandages.',
    cost: { wood: 8, stone: 2 },
    upgrades: [],
    hp: [150],
    blocks: 'all',
    height: 1.1,
  },
  bed: {
    kind: 'bed',
    label: 'Bed',
    blurb: 'You respawn here. Walk up to one to make it yours.',
    cost: { bamboo: 4, wood: 4 },
    upgrades: [],
    hp: [80],
    blocks: 'all',
    height: 0.7,
  },
  storage: {
    kind: 'storage',
    label: 'Storage',
    blurb: 'Team stash: walk up to it to empty your pack.',
    cost: { wood: 10 },
    upgrades: [],
    hp: [150],
    blocks: 'all',
    height: 1.2,
  },
  lookout: {
    kind: 'lookout',
    label: 'Lookout',
    blurb: 'Spots hordes from afar and warns of sieges sooner.',
    cost: { wood: 12, stone: 4 },
    upgrades: [],
    hp: [250],
    blocks: 'all',
    height: 6,
  },
};

export interface RecipeDef {
  id: RecipeId;
  label: string;
  blurb: string;
  station: 'workbench' | 'campfire';
  cost: Cost;
  /** A weapon into the extra slot. */
  weapon?: WeaponType;
  /** Firecrackers (up to CRACKER.max). */
  crackers?: number;
  /** Hunger points. */
  food?: number;
  /** HP. */
  heal?: number;
}

export const RECIPES: Record<RecipeId, RecipeDef> = {
  knife: { id: 'knife', label: 'Knife', blurb: 'Fast and quiet.', station: 'workbench', cost: { wood: 2, scrap: 1 }, weapon: 'knife' },
  axe: { id: 'axe', label: 'Axe', blurb: 'One-hit kills, chops trees fast.', station: 'workbench', cost: { wood: 4, stone: 3, scrap: 2 }, weapon: 'axe' },
  javelin: { id: 'javelin', label: 'Javelins', blurb: 'A full bundle to throw.', station: 'workbench', cost: { bamboo: 6, scrap: 1 }, weapon: 'javelin' },
  crackers: { id: 'crackers', label: 'Firecrackers', blurb: 'Two firecrackers.', station: 'workbench', cost: { bamboo: 3, scrap: 2 }, crackers: 2 },
  bandage: { id: 'bandage', label: 'Bandage', blurb: 'Heals 40 HP right away.', station: 'workbench', cost: { bamboo: 2, scrap: 1 }, heal: 40 },
  meal: { id: 'meal', label: 'Bamboo stew', blurb: 'Fills you up (+60 food).', station: 'campfire', cost: { bamboo: 4 }, food: 60 },
};

export const RESOURCE_LABELS: Record<ResourceKind, string> = { bamboo: 'Bamboo', wood: 'Wood', stone: 'Stone', scrap: 'Scrap' };
