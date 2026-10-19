export interface Circle {
  x: number;
  z: number;
  r: number;
}

/**
 * Hand-authored layout of a map. Everything else (terrain, trees, decoration) is
 * generated from this plus the seed, so all players build the exact same world.
 * Screen "up" is -Z, screen "right" is +X.
 */
export interface MapLayout {
  id: string;
  name: string;
  seed: number;
  /** Side of the square play area. */
  size: number;
  /** Side of the rendered terrain (play area + decorative border forest). */
  renderSize: number;
  start: Circle;
  goal: Circle;
  hill: Circle & { h: number };
  pond: Circle & { depth: number };
  thickets: Circle[];
}

export const NATURE_MAP: MapLayout = {
  id: 'nature',
  name: 'Bamboo Valley',
  seed: 20261019,
  size: 180,
  renderSize: 236,
  start: { x: -76, z: 76, r: 10 },
  goal: { x: 76, z: -76, r: 10 },
  hill: { x: -14, z: -6, r: 28, h: 7.5 },
  pond: { x: 32, z: 26, r: 10, depth: 0.9 },
  thickets: [
    { x: -52, z: 50, r: 6 },
    { x: -30, z: 62, r: 5 },
    { x: -60, z: 18, r: 5.5 },
    { x: -38, z: 28, r: 4.5 },
    { x: 8, z: 46, r: 6.5 },
    { x: 52, z: 52, r: 5 },
    { x: 14, z: 10, r: 4.5 },
    { x: -46, z: -30, r: 6 },
    { x: 20, z: -30, r: 6 },
    { x: 56, z: -10, r: 5 },
    { x: 40, z: -52, r: 5.5 },
    { x: -8, z: -56, r: 6 },
    { x: 62, z: 20, r: 4.5 },
    { x: -70, z: -64, r: 6 },
  ],
};
