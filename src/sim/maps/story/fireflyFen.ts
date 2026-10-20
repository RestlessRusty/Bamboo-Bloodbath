import type { MapLayout } from '../../mapLayout';

/**
 * Story chapter 4. A flat fen at dusk, dotted with deep ponds (zombies can't swim), corner to corner
 * from the north-west to the south-east. A big bamboo thicket in the middle is Doc's hideout;
 * glowcaps grow on the shores of the four big ponds around it.
 */
export const FIREFLY_FEN: MapLayout = {
  id: 'story-fen',
  name: 'Firefly Fen',
  blurb: 'Dusk, deep ponds, and glowing mushrooms.',
  seed: 20261104,
  size: 180,
  renderSize: 236,
  start: { x: -74, z: -72, r: 10 },
  goal: { x: 74, z: 72, r: 10 },
  hills: [
    { x: 55, z: -64, r: 16, h: 3 },
    { x: -66, z: 68, r: 14, h: 2.5 },
  ],
  // All off the camp–hut diagonal, so the straight way stays dry.
  ponds: [
    { x: -20, z: -52, r: 11, depth: 0.9 },
    { x: 40, z: -36, r: 10, depth: 0.9 },
    { x: -44, z: 22, r: 11, depth: 0.9 },
    { x: 20, z: 44, r: 12, depth: 1 },
    { x: 70, z: 0, r: 8, depth: 0.8 },
    { x: -76, z: -22, r: 6, depth: 0.8 },
  ],
  rivers: [],
  ridges: [],
  thickets: [
    // Doc's hideout.
    { x: 0, z: 0, r: 6.5 },
    { x: -50, z: -62, r: 5 },
    { x: 20, z: -62, r: 5 },
    { x: 62, z: -40, r: 5 },
    { x: -60, z: 55, r: 5 },
    { x: -20, z: 70, r: 5 },
    { x: 60, z: 30, r: 4.5 },
    { x: 78, z: 45, r: 4.5 },
    { x: -24, z: -20, r: 4.5 },
    { x: 20, z: -10, r: 4.5 },
    { x: -12, z: 30, r: 4.5 },
  ],
  density: { trees: 120, rocks: 35, grass: 1200, flowerPatches: 60 },
  theme: {
    // Dusk: lavender sky, cool greens.
    sky: 0x7d6fa6,
    fogNear: 40,
    fogFar: 115,
    hemiSky: 0xd8ccff,
    hemiGround: 0x3f5a4a,
    hemiIntensity: 1.6,
    sun: 0xffc89a,
    sunIntensity: 1.8,
    ground: {
      a: 0x5f9a63,
      b: 0x4c8556,
      high: 0x7fae6a,
      thicket: 0x3d6e45,
      clearing: 0xa8936e,
      shore: 0x9fae86,
      mud: 0x4b5a48,
      rim: 0x3f6d48,
      cliff: 0x7a7a86,
    },
    water: 0x3f7fa6,
    waterOpacity: 0.85,
    trunk: 0x4f3a2e,
    roundLeaves: [0x3f7f5a, 0x4f8f62, 0x5a9a6a, 0x36704f],
    pineLeaves: [0x2f5f48, 0x386a50],
    pineShare: 0.3,
    rocks: [0x7e8290, 0x8f93a0, 0x6f7380],
    grass: [0x5f9a5f, 0x4f8a55, 0x6faa66],
    // Pale yellow and violet: like fireflies in the grass.
    flowers: [0xfff27a, 0xc9b0ff, 0x9fe8ff],
    lilies: [0x4f8a48, 0x5a9a52],
    stalks: [0x6f9a45, 0x5f8a3f, 0x7faa4f],
    stalkNode: 0x4a6a2e,
    stalkLeaves: [0x4f8a3e, 0x5f9a48, 0x3f7a35],
  },
};
