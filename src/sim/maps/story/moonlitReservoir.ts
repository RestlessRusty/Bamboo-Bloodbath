import type { MapLayout } from '../../mapLayout';

/**
 * Story chapter 8. Night. A big reservoir fills the middle of the map (deep: zombies can't swim, pandas
 * can, slowly); Bristle's three pumps stand on its south, west and east shores. The pump house is on the
 * north shore, where the last stand happens. Camp in the south.
 */
export const MOONLIT_RESERVOIR: MapLayout = {
  id: 'story-reservoir',
  name: 'Moonlit Reservoir',
  blurb: 'Night, deep water, and three humming pumps.',
  seed: 20261108,
  size: 180,
  renderSize: 236,
  start: { x: 0, z: 76, r: 10 },
  goal: { x: 0, z: -50, r: 8 },
  goalStyle: 'none',
  // Round the west shore (the straight way is a long swim).
  route: [
    { x: -38, z: 30 },
    { x: -38, z: -30 },
  ],
  hills: [
    { x: -56, z: 46, r: 18, h: 4.5 },
    { x: 56, z: 46, r: 16, h: 4 },
    { x: -62, z: -52, r: 16, h: 4 },
    { x: 62, z: -56, r: 16, h: 4 },
  ],
  ponds: [
    // The reservoir.
    { x: 0, z: -6, r: 24, depth: 1.3 },
    { x: -72, z: 6, r: 6, depth: 0.8 },
    { x: 70, z: 14, r: 5, depth: 0.8 },
  ],
  rivers: [],
  ridges: [],
  landmarks: [{ kind: 'pumphouse', x: 0, z: -66, r: 4, face: { x: 0, z: -50 } }],
  clear: [
    { x: 4, z: 23, r: 4 },
    { x: -30, z: -2, r: 4 },
    { x: 30, z: -14, r: 4 },
    { x: 0, z: -50, r: 8 },
  ],
  racks: ['javelin', 'axe', 'knife', 'javelin', 'axe'],
  thickets: [
    { x: -24, z: 52, r: 5 },
    { x: 24, z: 56, r: 5 },
    { x: -40, z: 14, r: 4.5 },
    { x: 40, z: 22, r: 4.5 },
    { x: -48, z: -20, r: 5 },
    { x: 46, z: -30, r: 5 },
    { x: -28, z: -48, r: 4.5 },
    { x: 28, z: -46, r: 4.5 },
    { x: -74, z: -74, r: 5 },
    { x: 74, z: -10, r: 4.5 },
    { x: 0, z: 46, r: 4.5 },
  ],
  density: { trees: 130, rocks: 40, grass: 1000, flowerPatches: 25 },
  theme: {
    // Moonlight: deep blue sky, cool greens, pale light.
    sky: 0x1f2a4f,
    fogNear: 35,
    fogFar: 105,
    hemiSky: 0x8fa8ff,
    hemiGround: 0x2a3a3a,
    hemiIntensity: 1.5,
    sun: 0xc8d8ff,
    sunIntensity: 1.6,
    ground: {
      a: 0x3f6a5a,
      b: 0x355e50,
      high: 0x557f6a,
      thicket: 0x2a4f3f,
      clearing: 0x6f6a5a,
      shore: 0x6a7a6a,
      mud: 0x334038,
      rim: 0x2f5045,
      cliff: 0x5a6070,
    },
    water: 0x2f5f8f,
    waterOpacity: 0.85,
    trunk: 0x3f3028,
    roundLeaves: [0x2f5f4a, 0x3a6a52, 0x28553f],
    pineLeaves: [0x22493a, 0x2a5544],
    pineShare: 0.5,
    rocks: [0x5f6575, 0x6f7585, 0x555a68],
    grass: [0x3f6a55, 0x355f4a, 0x4a7a60],
    flowers: [0xc9d8ff, 0xfff27a],
    lilies: [0x3a6a48],
    stalks: [0x4f7a45, 0x456f3f, 0x5a854f],
    stalkNode: 0x33502a,
    stalkLeaves: [0x3f6a3a, 0x4a7a45, 0x355f33],
  },
};
