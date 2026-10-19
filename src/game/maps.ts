import { createGameMap, type GameMap } from '../sim/gameMap';
import type { MapLayout, MapRef } from '../sim/mapLayout';
import { layoutFor, MAP_IDS, mapInfo, newRef, previewRef } from '../sim/maps';

/** A map choice in the picker: a map id, or "random". */
export type MapPick = string;

export const RANDOM_PICK: MapPick = 'random';

export const MAP_PICKS: readonly MapPick[] = [...MAP_IDS, RANDOM_PICK];

export function isValidPick(pick: unknown): pick is MapPick {
  return typeof pick === 'string' && MAP_PICKS.includes(pick);
}

export function cyclePick(pick: MapPick, dir: number): MapPick {
  const n = MAP_PICKS.length;
  const i = Math.max(0, MAP_PICKS.indexOf(pick));
  return MAP_PICKS[(i + dir + n) % n];
}

export function pickInfo(pick: MapPick): { name: string; blurb: string } {
  if (pick === RANDOM_PICK) return { name: 'Random', blurb: 'A surprise map every match.' };
  return mapInfo(pick);
}

/** Turns a pick into a concrete map for one match ("random" rolls here, Random Valley gets a new seed). */
export function resolvePick(pick: MapPick): MapRef {
  if (pick === RANDOM_PICK) return newRef(MAP_IDS[Math.floor(Math.random() * MAP_IDS.length)]);
  return newRef(pick);
}

/** Map for previews: `null` for "random"; Random Valley shows a sample. */
export function previewMap(pick: MapPick): GameMap | null {
  return pick === RANDOM_PICK ? null : loadMap(previewRef(pick));
}

const cache = new Map<string, GameMap>();
const CACHE_SIZE = 4;

/** Builds (or reuses) the full map for a ref. Generating a map takes a moment, so keep a few. */
export function loadMap(ref: MapRef): GameMap {
  const layout: MapLayout = layoutFor(ref);
  const key = `${layout.id}:${layout.seed}`;
  let map = cache.get(key);
  if (map) {
    cache.delete(key); // re-insert as most recently used
  } else {
    map = createGameMap(layout);
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, map);
  return map;
}

export function isMapRef(raw: unknown): raw is MapRef {
  const r = raw as MapRef | null;
  return !!r && typeof r === 'object' && typeof r.id === 'string' && typeof r.seed === 'number' && Number.isFinite(r.seed);
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** "north-east" etc. from the camp to the hut (north is screen up, -Z). */
export function hutDirection(layout: MapLayout): string {
  const a = Math.atan2(layout.goal.x - layout.start.x, -(layout.goal.z - layout.start.z));
  const i = Math.round(a / (Math.PI / 4));
  return COMPASS[(i + 8) % 8];
}
