import type { MapLayout } from '../../mapLayout';
import { EMBER_WOODS } from './emberWoods';
import { FIREFLY_FEN } from './fireflyFen';
import { FROSTBITE_RIDGE } from './frostbiteRidge';
import { RESEARCH_STATION } from './researchStation';
import { WILLOW_RIVER } from './willowRiver';

export { EMBER_WOODS, FIREFLY_FEN, FROSTBITE_RIDGE, RESEARCH_STATION, WILLOW_RIVER };

/** Maps used only by story chapters (not in the map picker). */
export const STORY_MAPS: readonly MapLayout[] = [EMBER_WOODS, WILLOW_RIVER, FROSTBITE_RIDGE, FIREFLY_FEN, RESEARCH_STATION];
