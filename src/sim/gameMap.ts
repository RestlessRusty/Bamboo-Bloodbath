import type { MapLayout } from './mapLayout';
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
  grid: TerrainGrid;
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
