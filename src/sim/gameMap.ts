import type { MapLayout } from './mapLayout';
import type { OpenWorldData } from './open/types';
import { generateProps, type MapProps } from './props';
import { Route } from './route';
import { buildTerrainGrid, Terrain, type TerrainGrid } from './terrain';

/** ~1.6 m terrain cells. */
const TERRAIN_SEGMENTS = 148;

/** Fully generated map, shared by the simulation and the renderer. */
export interface GameMap {
  layout: MapLayout;
  terrain: Terrain;
  route: Route;
  props: MapProps;
  /** Whole-map terrain grid. The open world's is a tiny placeholder: it streams chunks instead. */
  grid: TerrainGrid;
  /** Infinite mode's generated world (sim/open/worldgen.ts); absent on normal maps. */
  open?: OpenWorldData;
}

export function createGameMap(layout: MapLayout): GameMap {
  const terrain = new Terrain(layout);
  const route = new Route(layout);
  return {
    layout,
    terrain,
    route,
    props: generateProps(layout, terrain, route),
    grid: buildTerrainGrid(terrain, layout.renderSize, TERRAIN_SEGMENTS),
  };
}
