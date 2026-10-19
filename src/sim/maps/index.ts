import type { MapLayout, MapRef } from '../mapLayout';
import { generateValley, RANDOM_VALLEY_BLURB, RANDOM_VALLEY_ID, RANDOM_VALLEY_NAME } from './randomValley';
import { RIVER_CROSSING } from './riverCrossing';
import { SNOWY_PASS } from './snowyPass';
import { BAMBOO_VALLEY } from './valley';

/** Every hand-made map, in picker order. */
export const MAPS: readonly MapLayout[] = [BAMBOO_VALLEY, RIVER_CROSSING, SNOWY_PASS];

export const DEFAULT_MAP = BAMBOO_VALLEY;

/** Every playable map id, in picker order: the hand-made maps, then Random Valley. */
export const MAP_IDS: readonly string[] = [...MAPS.map((m) => m.id), RANDOM_VALLEY_ID];

/** Seed used to show Random Valley in the map picker (each match gets its own). */
const PREVIEW_SEED = 20261022;

export function refOf(layout: MapLayout): MapRef {
  return { id: layout.id, seed: layout.seed };
}

export function mapInfo(id: string): { name: string; blurb: string } {
  if (id === RANDOM_VALLEY_ID) return { name: RANDOM_VALLEY_NAME, blurb: RANDOM_VALLEY_BLURB };
  const layout = MAPS.find((m) => m.id === id) ?? DEFAULT_MAP;
  return { name: layout.name, blurb: layout.blurb };
}

/** A ref for a new match on map `id`: Random Valley rolls a fresh seed. */
export function newRef(id: string): MapRef {
  if (id === RANDOM_VALLEY_ID) return { id, seed: Math.floor(Math.random() * 4294967296) };
  return refOf(MAPS.find((m) => m.id === id) ?? DEFAULT_MAP);
}

/** A stable ref for showing map `id` in menus. */
export function previewRef(id: string): MapRef {
  return id === RANDOM_VALLEY_ID ? { id, seed: PREVIEW_SEED } : newRef(id);
}

/** The layout a ref points to. Unknown ids fall back to the default map. */
export function layoutFor(ref: MapRef): MapLayout {
  if (ref.id === RANDOM_VALLEY_ID) return generateValley(ref.seed);
  return MAPS.find((m) => m.id === ref.id) ?? DEFAULT_MAP;
}
