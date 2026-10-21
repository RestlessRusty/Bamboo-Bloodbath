import type { MapLayout } from '../../mapLayout';

/**
 * Story chapter 9. Bristle's glasshouse estate. An irrigation canal runs north–south down the middle
 * (two bridges, one ford). Camp in the south-east; five glasshouses spread over both banks; Bristle Bio HQ
 * stands in the north-west, where the last stand happens.
 */
export const GLASSHOUSES: MapLayout = {
  id: 'story-glass',
  name: 'Glasshouses',
  blurb: 'Warm glass, a long canal, and Bristle’s HQ.',
  seed: 20261109,
  size: 180,
  renderSize: 236,
  start: { x: 72, z: 74, r: 10 },
  goal: { x: -46, z: -46, r: 8 },
  goalStyle: 'none',
  // Over the north bridge (about (9, 24)).
  route: [
    { x: 40, z: 50 },
    { x: 9, z: 24 },
    { x: -20, z: -12 },
  ],
  hills: [
    { x: 68, z: 0, r: 14, h: 3.5 },
    { x: -70, z: 30, r: 16, h: 4 },
    { x: -10, z: 76, r: 14, h: 3 },
  ],
  ponds: [
    // Ornamental fountains: deep.
    { x: 42, z: 62, r: 5, depth: 0.8 },
    { x: -52, z: 10, r: 6, depth: 0.8 },
  ],
  rivers: [
    {
      points: [
        { x: 6, z: -120 },
        { x: 10, z: -60 },
        { x: 2, z: -10 },
        { x: 12, z: 40 },
        { x: 4, z: 120 },
      ],
      width: 6,
      depth: 0.7,
      // Bridges at about (9, -48) and (9, 24); the ford at about (2, -12).
      bridges: [0.3, 0.6],
      fords: [0.45],
    },
  ],
  ridges: [],
  landmarks: [
    { kind: 'greenhouse', x: 44, z: 30, r: 4.5, face: { x: 64, z: 50 } },
    { kind: 'greenhouse', x: -22, z: 40, r: 4.5, face: { x: -2, z: 60 } },
    { kind: 'greenhouse', x: 32, z: -30, r: 4.5, face: { x: 52, z: -10 } },
    { kind: 'greenhouse', x: -32, z: -8, r: 4.5, face: { x: -12, z: 12 } },
    { kind: 'greenhouse', x: 62, z: -50, r: 4.5, face: { x: 42, z: -40 } },
    { kind: 'hq', x: -60, z: -62, r: 6, face: { x: -46, z: -46 } },
  ],
  clear: [
    { x: -14, z: 48, r: 2 },
    { x: 39, z: -22, r: 2 },
    { x: 53, z: -44, r: 2 },
    { x: -46, z: -46, r: 8 },
  ],
  racks: ['knife', 'javelin', 'axe', 'javelin', 'axe'],
  thickets: [
    // East bank.
    { x: 56, z: 56, r: 4.5 },
    { x: 26, z: 60, r: 4.5 },
    { x: 60, z: 10, r: 4.5 },
    { x: 30, z: 0, r: 5 },
    { x: 46, z: -70, r: 4.5 },
    { x: 78, z: -30, r: 4.5 },
    // West bank.
    { x: -40, z: 64, r: 5 },
    { x: -14, z: 18, r: 4.5 },
    { x: -60, z: -28, r: 5 },
    { x: -24, z: -40, r: 4.5 },
    { x: -78, z: -70, r: 4.5 },
  ],
  density: { trees: 120, rocks: 30, grass: 1300, flowerPatches: 60 },
  theme: {
    // Warm and humid: bright greens, pale gravel clearings.
    sky: 0xe6f6ff,
    fogNear: 60,
    fogFar: 135,
    hemiSky: 0xf6fff8,
    hemiGround: 0x6aa05a,
    hemiIntensity: 1.75,
    sun: 0xfff6e0,
    sunIntensity: 2.4,
    ground: {
      a: 0x9ad86a,
      b: 0x86c95a,
      high: 0xb8e67f,
      thicket: 0x5a9a42,
      clearing: 0xe0d6b8,
      shore: 0xe6ddb0,
      mud: 0x6f8058,
      rim: 0x6aa048,
      cliff: 0x9a9a8e,
    },
    water: 0x6fc8e0,
    waterOpacity: 0.8,
    trunk: 0x7a5238,
    roundLeaves: [0x9fd65a, 0x86c94f, 0x6fbf45, 0xb5e070],
    pineLeaves: [0x3f9a55, 0x4cab62],
    pineShare: 0.1,
    rocks: [0xb3b6b0, 0xc4c6c0, 0x9ea3a8],
    grass: [0x8fd860, 0x7fcb52, 0xa2e070],
    flowers: [0xff9fc8, 0xffe066, 0xffffff, 0xd99bff],
    lilies: [0x5fae48],
    stalks: [0x8fe03a, 0x7fd133, 0x9fe84a],
    stalkNode: 0x5ea82e,
    stalkLeaves: [0x6fc13a, 0x7fd147, 0x5fb033],
  },
};
