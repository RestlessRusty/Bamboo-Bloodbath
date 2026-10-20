import type { WeaponType } from './types';

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** A building on the map (story locations). Solid, with flat ground around it. */
export interface Landmark extends Circle {
  kind: 'radio' | 'clinic' | 'lab';
  /** The door faces this point. */
  face: { x: number; z: number };
}

export interface Hill extends Circle {
  /** Height of the summit. */
  h: number;
}

export interface Pond extends Circle {
  /** How far the centre sits below the water surface. */
  depth: number;
  /** Frozen solid: anyone can walk on it, but it's slippery. */
  frozen?: boolean;
}

/** A steep rocky ridge nobody can climb, with passes cut through it. */
export interface Ridge {
  /** Spine of the ridge, smoothed into a curve. Extend it past the play area to seal it off. */
  points: readonly { x: number; z: number }[];
  /** Full width at the foot. */
  width: number;
  /** Height of the crest. */
  height: number;
  /** Passes through the ridge at the point closest to (x, z); `width` is the flat floor. */
  gaps: readonly { x: number; z: number; width: number }[];
}

export interface River {
  /** Centre line, smoothed into a curve. Extend it past the play area so it flows off the map. */
  points: readonly { x: number; z: number }[];
  /** Full width of the water. */
  width: number;
  /** How far the middle sits below the water surface. */
  depth: number;
  /** Bridges, as fractions (0–1) of the way along the river. */
  bridges: readonly number[];
  /** Shallow fords that anyone can wade through (zombies too), as fractions along the river. */
  fords: readonly number[];
}

/** Colours and look of a map. Pure data (hex colours), so the simulation can import it too. */
export interface MapTheme {
  sky: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  ground: {
    /** Two base colours blended by noise. */
    a: number;
    b: number;
    /** Hilltops. */
    high: number;
    /** Ground under bamboo thickets. */
    thicket: number;
    /** Start camp and rescue hut clearings. */
    clearing: number;
    /** Pond shores. */
    shore: number;
    /** Ground below the water line. */
    mud: number;
    /** Slopes at the map edge. */
    rim: number;
    /** Bare rock on ridge sides. */
    cliff: number;
  };
  /** Ice on frozen ponds. */
  ice?: number;
  /** How hiding thickets look: bamboo stalks (default) or round snowy shrubs. */
  thicketStyle?: 'bamboo' | 'shrub';
  /** Snow on top of the pine trees. */
  snowCaps?: boolean;
  /** Falling snow around the camera. */
  snowfall?: boolean;
  water: number;
  waterOpacity: number;
  trunk: number;
  roundLeaves: readonly number[];
  pineLeaves: readonly number[];
  /** Fraction of play-area trees that are pines (border forest: halfway to 1). */
  pineShare: number;
  rocks: readonly number[];
  grass: readonly number[];
  flowers: readonly number[];
  /** Lily-pad colours; empty for no lilies. */
  lilies: readonly number[];
  /** Hiding thickets: stalks, stalk rings and leaf tufts. */
  stalks: readonly number[];
  stalkNode: number;
  stalkLeaves: readonly number[];
}

/** How much stuff gets scattered over the map. */
export interface MapDensity {
  trees: number;
  rocks: number;
  grass: number;
  flowerPatches: number;
}

/**
 * Hand-authored layout of a map. Everything else (terrain, trees, decoration) is
 * generated from this plus the seed, so all players build the exact same world.
 * Screen "up" (north) is -Z, screen "right" (east) is +X.
 */
export interface MapLayout {
  id: string;
  name: string;
  /** One line for the map picker. */
  blurb: string;
  /** Optional hint shown shortly after the match starts. */
  tip?: string;
  seed: number;
  /** Side of the square play area. */
  size: number;
  /** Side of the rendered terrain (play area + decorative border forest). */
  renderSize: number;
  start: Circle;
  goal: Circle;
  /**
   * Waypoints between the camp and the hut when the way isn't straight (e.g. passes through ridges).
   * The HUD arrow, bots, horde spawning and weapon racks follow it.
   */
  route?: readonly { x: number; z: number }[];
  hills: readonly Hill[];
  ponds: readonly Pond[];
  rivers: readonly River[];
  ridges: readonly Ridge[];
  thickets: readonly Circle[];
  /** Buildings; `r` is the solid footprint. */
  landmarks?: readonly Landmark[];
  /** 'none': no rescue hut at the goal (story chapters that end somewhere else). Default 'hut'. */
  goalStyle?: 'hut' | 'none';
  /** Weapons on the racks along the route, in order (default: a mix of all three). */
  racks?: readonly WeaponType[];
  density: MapDensity;
  theme: MapTheme;
}

/** Which map to play. Hand-made maps carry their own fixed seed; generated maps are built from it. */
export interface MapRef {
  id: string;
  seed: number;
}
