import type { MapLayout } from '../../mapLayout';
import { BRISTLE_WORKS } from './bristleWorks';
import { EMBER_WOODS } from './emberWoods';
import { FIREFLY_FEN } from './fireflyFen';
import { FROSTBITE_RIDGE } from './frostbiteRidge';
import { GLASSHOUSES } from './glasshouses';
import { MOONLIT_RESERVOIR } from './moonlitReservoir';
import { QUARRY_ROAD } from './quarryRoad';
import { RESEARCH_STATION } from './researchStation';
import { SPROUT_FARM } from './sproutFarm';
import { WILLOW_RIVER } from './willowRiver';

export {
  BRISTLE_WORKS,
  EMBER_WOODS,
  FIREFLY_FEN,
  FROSTBITE_RIDGE,
  GLASSHOUSES,
  MOONLIT_RESERVOIR,
  QUARRY_ROAD,
  RESEARCH_STATION,
  SPROUT_FARM,
  WILLOW_RIVER,
};
export { QUARRY_ROAD_POINTS } from './quarryRoad';
export { WORKS_ROAD_POINTS } from './bristleWorks';

/** Maps used only by story chapters (not in the map picker). */
export const STORY_MAPS: readonly MapLayout[] = [
  EMBER_WOODS,
  WILLOW_RIVER,
  FROSTBITE_RIDGE,
  FIREFLY_FEN,
  RESEARCH_STATION,
  SPROUT_FARM,
  QUARRY_ROAD,
  MOONLIT_RESERVOIR,
  GLASSHOUSES,
  BRISTLE_WORKS,
];
