import type { Difficulty } from '../../config';
import type { Survivor, Zombie } from '../entities';
import type { GameMap } from '../gameMap';
import type { Circle, MapTheme } from '../mapLayout';
import type { DecorProp } from '../props';
import type { GameEvent, PandaVariant, PlayerSpec, WeaponType } from '../types';

/**
 * Infinite mode (open world): the types shared by the world generator, the rules, the simulation,
 * the renderer, the UI and the network. See docs/infinite-mode.md for how the pieces fit together.
 * Coordinates are metres like everywhere else: north (screen up) is -Z, east is +X, the world is
 * centred on (0, 0).
 */

// ---------------------------------------------------------------- resources

export type ResourceKind = 'bamboo' | 'wood' | 'stone' | 'scrap';
export const RESOURCE_KINDS: readonly ResourceKind[] = ['bamboo', 'wood', 'stone', 'scrap'];
export type Resources = Record<ResourceKind, number>;
/** A price or a handful of loot: only the kinds that matter. */
export type Cost = Partial<Resources>;

export function emptyResources(): Resources {
  return { bamboo: 0, wood: 0, stone: 0, scrap: 0 };
}

// ---------------------------------------------------------------- world

export type BiomeId = 'meadow' | 'bamboo' | 'pine' | 'snow' | 'fen' | 'quarry' | 'farm';
export const BIOME_IDS: readonly BiomeId[] = ['meadow', 'bamboo', 'pine', 'snow', 'fen', 'quarry', 'farm'];

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** Colours, fog, sky and decoration style of this part of the world. */
  theme: MapTheme;
}

export type PoiKind = 'cabin' | 'barn' | 'farmhouse' | 'watchtower' | 'outpost' | 'shed' | 'chapel';

/** An abandoned building: its walls, gates, beds… are ordinary pieces (mostly ruined) in `poiPieces`. */
export interface Poi {
  id: number;
  kind: PoiKind;
  /** "Old Ranger Cabin". */
  name: string;
  x: number;
  z: number;
  /** Footprint radius (kept free of trees and rocks, flattened). */
  r: number;
}

export type NodeKind = 'tree' | 'rock' | 'grove' | 'scrap';

/** Something you hit to gather resources. Depleted nodes regrow after OPEN.nodeRegrow seconds. */
export interface ResourceNode {
  /** Index in OpenWorldData.nodes. */
  id: number;
  kind: NodeKind;
  x: number;
  z: number;
  /** Solid radius; a swing reaches it within the weapon's range of this edge. */
  r: number;
  gives: ResourceKind;
  /** Units it holds when full. */
  amount: number;
  /** The prop it is drawn as: index into map.props.trees ('tree') or map.props.rocks ('rock'), else -1. */
  prop: number;
}

/** What a crate or a dropped bag holds. */
export interface Loot {
  res: Cost;
  crackers?: number;
  /** A weapon for the extra slot. */
  weapon?: WeaponType;
  /** Hunger points. */
  food?: number;
}

/** A supply crate in an abandoned building: walk up to it to take everything (once per world). */
export interface Crate {
  /** Index in OpenWorldData.crates. */
  id: number;
  x: number;
  z: number;
  /** The building it's in (-1: out in the wild). */
  poi: number;
  loot: Loot;
}

/** A dead panda's backpack, lying where they fell until someone walks over it. */
export interface LootBag {
  id: number;
  x: number;
  z: number;
  res: Resources;
  crackers: number;
  /** Name of the panda it belonged to. */
  owner: string;
}

/** What lies in one streaming chunk: indices into map.props arrays and OpenWorldData lists. */
export interface ChunkContents {
  trees: readonly number[];
  rocks: readonly number[];
  stones: readonly number[];
  stalks: readonly number[];
  bamboo: readonly number[];
  nodes: readonly number[];
  crates: readonly number[];
  pois: readonly number[];
}

/**
 * The generated world, hung on GameMap.open. Everything is derived from the seed, so the host and the
 * guests build the same world; what players change (pieces, nodes, crates, bags) travels as events.
 */
export interface OpenWorldData {
  seed: number;
  /** Side of the square world (OPEN.worldSize). */
  size: number;
  /** Where new pandas appear (and pandas without a bed respawn): a flat camp clearing. */
  spawn: { x: number; z: number };
  biomes: Readonly<Record<BiomeId, BiomeDef>>;
  /** The biome at a point (the strongest one). */
  biomeAt(x: number, z: number): BiomeId;
  /** Weight of every biome at a point, summing to 1, smooth across borders (ground colours, sky, fog). Fills and returns `out`. */
  biomeWeights(x: number, z: number, out: Record<BiomeId, number>): Record<BiomeId, number>;
  pois: readonly Poi[];
  /** The abandoned buildings' pieces in a fresh world. Ids 1..n, all below OPEN.firstPlayerPieceId. */
  poiPieces: readonly Piece[];
  nodes: readonly ResourceNode[];
  crates: readonly Crate[];
  /** Chunks per side (OPEN.worldSize / OPEN.chunk). Chunk (0, 0) is the north-west corner; see chunkOf(). */
  chunks: number;
  chunkContents(cx: number, cz: number): ChunkContents;
  /** Render-only scatter for a chunk, generated on demand from the seed (same every call). */
  chunkDecor(cx: number, cz: number): { grass: DecorProp[]; flowers: DecorProp[]; lilies: DecorProp[] };
}

// ---------------------------------------------------------------- building

export type PieceKind = 'wall' | 'gate' | 'spikes' | 'campfire' | 'workbench' | 'bed' | 'storage' | 'lookout';
export const PIECE_KINDS: readonly PieceKind[] = ['wall', 'gate', 'spikes', 'campfire', 'workbench', 'bed', 'storage', 'lookout'];

/** 0 bamboo, 1 wood, 2 stone. Only walls and gates go past 0. */
export type Tier = 0 | 1 | 2;
/** Quarter turns clockwise seen from above; 0 faces +Z (south). */
export type Rot = 0 | 1 | 2 | 3;

/**
 * One building piece on the OPEN.tile grid: tile (gx, gz) covers x in [gx·tile, (gx+1)·tile), likewise z,
 * so its centre is ((gx + 0.5)·tile, (gz + 0.5)·tile). One piece per tile.
 */
export interface Piece {
  id: number;
  kind: PieceKind;
  tier: Tier;
  gx: number;
  gz: number;
  rot: Rot;
  hp: number;
  /** Broken down to rubble: passable, does nothing, can be repaired (or demolished). */
  ruined: boolean;
  /** Abandoned building it belongs to, or -1 when a player built it. */
  poi: number;
  /** Name of the panda who built it ('' for the world's own). */
  owner: string;
}

export type RecipeId = 'knife' | 'axe' | 'javelin' | 'crackers' | 'meal' | 'bandage';
export const RECIPE_IDS: readonly RecipeId[] = ['knife', 'axe', 'javelin', 'crackers', 'meal', 'bandage'];

/** Player actions besides moving and fighting. Sent reliably (not in the 30 Hz input) and validated by the rules. */
export type OpenCommand =
  | { c: 'place'; kind: PieceKind; gx: number; gz: number; rot: Rot }
  | { c: 'upgrade'; id: number }
  | { c: 'repair'; id: number }
  | { c: 'demolish'; id: number }
  | { c: 'craft'; recipe: RecipeId };

/** The build-mode preview the renderer draws. */
export interface GhostSpec {
  kind: PieceKind;
  tier: Tier;
  gx: number;
  gz: number;
  rot: Rot;
  /** Green when it can go there (and you can pay), red otherwise. */
  valid: boolean;
}

// ---------------------------------------------------------------- snapshot

export interface OpenSurvivorSnap {
  id: string;
  /** 0..OPEN.hungerMax. */
  hunger: number;
  /** Backpack. */
  pack: Resources;
  /** While downed: seconds until respawning at the bed (0 otherwise). */
  respawn: number;
  /** Bed piece this panda respawns at, or -1 (the world's camp). */
  bed: number;
}

export interface SiegeSnap {
  /** Where the siege horde is now (its middle). */
  x: number;
  z: number;
  /** What it's going for: the base, or the pandas it's hunting. */
  tx: number;
  tz: number;
  /** Seconds until it gets there (0 once it's attacking). */
  eta: number;
  /** Zombies of the siege still standing (including the ones not spawned in yet). */
  size: number;
  /** Going for the base (true) or for the pandas out in the wild (false). */
  base: boolean;
}

export interface HordeSnap {
  x: number;
  z: number;
  n: number;
}

/** Infinite-mode part of a Snapshot. */
export interface OpenSnap {
  /** Day 1 is the first day. */
  day: number;
  /** Time of day 0..1; 0 is dawn (06:00), 0.5 is evening (18:00 with OPEN.dayLength split evenly). */
  time: number;
  night: boolean;
  /** Same pandas as Snapshot.survivors. */
  survivors: OpenSurvivorSnap[];
  /** The team's shared store (in storage chests). */
  stash: Resources;
  siege: SiegeSnap | null;
  /** Roaming hordes someone can see (near a panda, or within range of a lookout). */
  hordes: HordeSnap[];
  /** Pandas beyond OPEN.leashWarn of the nearest other player (multiplayer). */
  leash: string[];
}

// ---------------------------------------------------------------- saving and joining

export interface PlayerSave {
  name: string;
  variant: PandaVariant;
  /** The starting (main) weapon. */
  weapon: WeaponType;
  bot: boolean;
  x: number;
  z: number;
  hp: number;
  hunger: number;
  pack: Resources;
  extra: WeaponType | null;
  /** Weapon in hand: 'main' or 'extra'. */
  hand: 'main' | 'extra';
  ammo: number;
  crackers: number;
  bed: number;
  kills: number;
}

export interface HordeSave {
  x: number;
  z: number;
  n: number;
  /** Heading (unit vector). */
  hx: number;
  hz: number;
}

/** Everything about a world that isn't derived from its seed. Stored as JSON (openSaves.ts). */
export interface WorldSave {
  v: 1;
  slot: number;
  name: string;
  seed: number;
  difficulty: Difficulty;
  /** Bot buddies chosen when the world was made. */
  bots: number;
  /** Epoch ms. */
  created: number;
  saved: number;
  /** Seconds of play. */
  played: number;
  /** World clock: seconds since the world began (day and time of day come from it). */
  clock: number;
  /** Every piece: the buildings' (as they are now) and the players'. */
  pieces: Piece[];
  nextPieceId: number;
  /** Nodes not full: [node id, units left, seconds until it regrows]. */
  nodes: [number, number, number][];
  /** Crates already emptied. */
  crates: number[];
  bags: LootBag[];
  nextBagId: number;
  stash: Resources;
  /** Humans by nickname, bots by id ('b1'…). */
  players: Record<string, PlayerSave>;
  hordes: HordeSave[];
  /** World clock of the next siege. */
  nextSiege: number;
  sieges: number;
  kills: number;
  /** Highest day reached. */
  bestDay: number;
}

/** What a guest needs to mirror the world when joining (the rest comes from the seed). */
export interface WorldJoin {
  seed: number;
  clock: number;
  pieces: Piece[];
  /** [node id, units left]. */
  nodes: [number, number][];
  crates: number[];
  bags: LootBag[];
}

/** One saved world, as listed in the Infinite menu. */
export interface WorldSlotInfo {
  slot: number;
  name: string;
  day: number;
  difficulty: Difficulty;
  bots: number;
  /** Epoch ms of the last save. */
  saved: number;
  /** Seconds played. */
  played: number;
}

/** What a multiplayer room plays. */
export type RoomMode = 'quick' | 'open';

// ---------------------------------------------------------------- simulation hooks

/**
 * What the infinite-mode rules may do inside the simulation. Implemented by Simulation
 * (like MissionHost for story mode).
 */
export interface OpenHost {
  readonly map: GameMap;
  readonly survivors: readonly Survivor[];
  readonly zombies: readonly Zombie[];
  readonly difficulty: Difficulty;
  /** Simulation ticks so far (60 per second). */
  readonly ticks: number;
  emit(ev: GameEvent): void;
  /**
   * Puts a zombie on the map (awake unless `asleep`). Null when (x, z) isn't a fair spot (see validSpawn) or
   * OPEN.zombiesMax are already out. `horde`: id of the horde it belongs to (-1 none); `siege`: part of a
   * siege; `goal`: where it walks while it has nobody to chase.
   */
  spawnZombie(x: number, z: number, opts?: { asleep?: boolean; horde?: number; siege?: boolean; goal?: { x: number; z: number } | null }): Zombie | null;
  /** Takes a zombie off the map without a death (it wandered off into the wild). */
  despawnZombie(z: Zombie): void;
  /** Solid body for a piece (who it stops: PIECES[kind].blocks). Returns a handle for removePieceBody. */
  addPieceBody(p: Piece): number;
  removePieceBody(handle: number): void;
  /** Round thing zombies and bots steer around. */
  addObstacle(c: Circle): void;
  removeObstacle(c: Circle): void;
  /** Puts a downed (or fallen) survivor back on their feet at (x, z) with `hp`. */
  respawnSurvivor(s: Survivor, x: number, z: number, hp: number): void;
  /** A weapon into the survivor's extra slot, like a weapon rack (javelins come full). */
  giveWeapon(s: Survivor, w: WeaponType): void;
  /** Wakes sleeping zombies within `radius`; the rules hear it too (OpenRulesApi.onNoise). */
  noise(x: number, z: number, radius: number): void;
  /** Damage from spikes: knockback-free, no stun. */
  hurtZombie(z: Zombie, damage: number): void;
  /** Same test as normal spawns: dry, not on a ridge or an obstacle, not right next to a panda. */
  validSpawn(x: number, z: number): boolean;
}

/** Read-only view of the open world for bots (BotWorld.open). */
export interface OpenView {
  readonly world: OpenWorldData;
  readonly night: boolean;
  readonly siege: SiegeSnap | null;
  readonly stash: Readonly<Resources>;
  pieceAt(gx: number, gz: number): Piece | undefined;
  /** Pieces whose centre is within r of (x, z). */
  piecesNear(x: number, z: number, r: number): Piece[];
  nodeLeft(id: number): number;
  /** The team's main base (the biggest cluster of beds and storage), or null before there is one. */
  base(): { x: number; z: number; r: number } | null;
  pack(id: string): Readonly<Resources>;
  hunger(id: string): number;
}

/**
 * The infinite-mode rules, called by Simulation at fixed points of its tick (implemented by OpenRules
 * in sim/open/rules.ts). Simulation never decides infinite-mode matters itself.
 */
export interface OpenRulesApi {
  readonly view: OpenView;
  /** Once, after the static world is built and before any survivor spawns: piece bodies, nodes, clock. */
  init(host: OpenHost): void;
  /** Where a survivor appears when they (re)join the world: their saved spot, else the camp. */
  spawnPoint(spec: PlayerSpec): { x: number; z: number };
  /** Right after a survivor is placed: restore their saved hp, weapons, ammo, firecrackers, kills. */
  initSurvivor(s: Survivor): void;
  /** A survivor leaves the world (guest disconnected): keep their state for the save. */
  forgetSurvivor(s: Survivor): void;
  /** Every tick before anyone moves: clock, hunger, hordes and sieges, ambient zombies, spikes, regrowth. */
  preStep(host: OpenHost): void;
  /** Every tick after physics: crates, bags, stash deposits, beds, leash list. */
  postStep(host: OpenHost): void;
  /** A player's command, from panda `id`. Refusals are told with a 'deny' event. */
  command(host: OpenHost, id: string, cmd: OpenCommand): void;
  /** Walking speed multiplier (hunger). */
  speedMul(s: Survivor): number;
  /** Multiplayer leash: the move (mx, mz) a survivor is allowed to make. */
  leash(s: Survivor, mx: number, mz: number): { mx: number; mz: number };
  /** Seconds a newly downed survivor bleeds before respawning. */
  bleedTime(s: Survivor, someoneElseActive: boolean): number;
  /** The bleed ran out: the rules respawn them at their bed and drop their pack. (Simulation does not turn them.) */
  bledOut(host: OpenHost, s: Survivor): void;
  /** A melee swing that hit no zombie: gather from a resource node in reach, if any. */
  swing(host: OpenHost, s: Survivor, range: number, arc: number): void;
  /** Wants a bamboo snack (hungry), even at full health. */
  wantsFood(s: Survivor): boolean;
  /** Ate a bamboo snack. */
  ate(s: Survivor): void;
  /** A zombie walking (dirX, dirZ) with a solid piece right in its way: the piece to bite, else null. */
  blockingPiece(z: Zombie, dirX: number, dirZ: number): Piece | null;
  /** A zombie's bite landed on piece `id`. */
  damagePiece(host: OpenHost, id: number, damage: number): void;
  /** Something loud happened at (x, z): hordes in earshot may come and look. */
  onNoise(x: number, z: number, radius: number): void;
  onZombieDeath(z: Zombie): void;
  /** The rules manage this zombie (horde, siege, ambient): the simulation must not recycle it. */
  ownsZombie(z: Zombie): boolean;
  snapshot(): OpenSnap;
  /** The whole world for the save file (`now`: epoch ms). */
  save(host: OpenHost, now: number): WorldSave;
  /** For a guest joining now. */
  join(): WorldJoin;
}

/** Inputs the horde director gets from the rules each tick (sim/open/hordes.ts). */
export interface ThreatContext {
  /** World clock (s since the world began), day number, time of day 0..1, and whether it's night. */
  readonly clock: number;
  readonly day: number;
  readonly time: number;
  readonly night: boolean;
  /** Bases: clusters of standing beds and storage chests, biggest first. */
  bases(): { x: number; z: number; r: number; beds: number }[];
  /** Standing lookout towers. */
  lookouts(): { x: number; z: number }[];
}

/** Roaming hordes, ambient zombies and sieges (implemented in sim/open/hordes.ts, owned by the rules). */
export interface HordeDirectorApi {
  step(host: OpenHost, ctx: ThreatContext): void;
  onNoise(x: number, z: number, radius: number): void;
  onZombieDeath(z: Zombie): void;
  owns(z: Zombie): boolean;
  readonly siege: SiegeSnap | null;
  /** Hordes a panda (or a lookout) can see. */
  visibleHordes(host: OpenHost, ctx: ThreatContext): HordeSnap[];
  save(): { hordes: HordeSave[]; nextSiege: number; sieges: number };
}
