import type { MapLayout } from './mapLayout';
import { generateProps, type MapProps } from './props';
import { buildTerrainGrid, Terrain, type TerrainGrid } from './terrain';

/** ~1.6 m terrain cells. */
const TERRAIN_SEGMENTS = 148;

/** Fully generated map, shared by the simulation and the renderer. */
export interface GameMap {
  layout: MapLayout;
  terrain: Terrain;
  props: MapProps;
  grid: TerrainGrid;
}

export function createGameMap(layout: MapLayout): GameMap {
  const terrain = new Terrain(layout);
  return {
    layout,
    terrain,
    props: generateProps(layout, terrain),
    grid: buildTerrainGrid(terrain, layout.renderSize, TERRAIN_SEGMENTS),
  };
}
