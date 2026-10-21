import type { MapLayout } from '../../mapLayout';

/**
 * Story chapter 6. Professor Bristle's bamboo farm: an irrigation canal runs west–east across the middle
 * (two bridges and a ford), the red barn and the silo stand north of it, plantation rows fill the north-west.
 * Camp in the south-west, the trail hut in the north-east.
 */
export const SPROUT_FARM: MapLayout = {
  id: 'story-farm',
  name: 'Sprout Farm',
  blurb: 'A canal, a barn, and bamboo that grows a little too well.',
  seed: 20261106,
  size: 180,
  renderSize: 236,
  start: { x: -72, z: 72, r: 10 },
  goal: { x: 72, z: -72, r: 10 },
  // Over the west bridge (about (-40, 9)), past the barn.
  route: [
    { x: -40, z: 26 },
    { x: -38, z: -8 },
    { x: 20, z: -14 },
    { x: 50, z: -50 },
  ],
  hills: [
    { x: -62, z: -72, r: 16, h: 4 },
    { x: 72, z: 0, r: 14, h: 3 },
    { x: -10, z: 74, r: 14, h: 3 },
  ],
  ponds: [
    { x: 40, z: 54, r: 7, depth: 0.8 },
    { x: -20, z: 40, r: 5, depth: 0.7 },
  ],
  rivers: [
    {
      points: [
        { x: -120, z: 8 },
        { x: -60, z: 14 },
        { x: -20, z: 4 },
        { x: 20, z: 12 },
        { x: 60, z: 2 },
        { x: 120, z: 8 },
      ],
      width: 5,
      depth: 0.6,
      // Bridges at about (-40, 9) and (40, 7); the ford at about (0, 8).
      bridges: [0.33, 0.67],
      fords: [0.5],
    },
  ],
  ridges: [],
  landmarks: [
    { kind: 'shed', x: 20, z: -24, r: 3.5, face: { x: 20, z: 0 } },
    { kind: 'silo', x: 36, z: -32, r: 2.6, face: { x: 20, z: -24 } },
  ],
  clear: [
    { x: 20, z: -14, r: 8 },
    { x: -36, z: -46, r: 2 },
    { x: 52, z: -52, r: 2 },
    { x: 56, z: 42, r: 2 },
  ],
  racks: ['knife', 'axe', 'javelin', 'axe', 'javelin'],
  thickets: [
    // Plantation rows (north-west).
    { x: -60, z: -30, r: 3.2 },
    { x: -50, z: -30, r: 3.2 },
    { x: -40, z: -30, r: 3.2 },
    { x: -30, z: -30, r: 3.2 },
    { x: -20, z: -30, r: 3.2 },
    { x: -55, z: -40, r: 3.2 },
    { x: -45, z: -40, r: 3.2 },
    { x: -25, z: -40, r: 3.2 },
    { x: -15, z: -40, r: 3.2 },
    { x: -50, z: -54, r: 3.2 },
    { x: -40, z: -54, r: 3.2 },
    { x: -30, z: -54, r: 3.2 },
    { x: -20, z: -54, r: 3.2 },
    // Rows south of the canal (east).
    { x: 12, z: 30, r: 3.2 },
    { x: 22, z: 30, r: 3.2 },
    { x: 32, z: 30, r: 3.2 },
    { x: 62, z: 24, r: 3.2 },
    // Odd patches.
    { x: -50, z: 50, r: 5 },
    { x: -70, z: 30, r: 4.5 },
    { x: 60, z: 70, r: 4.5 },
    { x: 0, z: -66, r: 5 },
    { x: 50, z: -22, r: 4.5 },
    { x: 76, z: -40, r: 4.5 },
  ],
  density: { trees: 110, rocks: 30, grass: 1400, flowerPatches: 45 },
  theme: {
    // Bright, lush, a bit too green.
    sky: 0xd8f0ff,
    fogNear: 60,
    fogFar: 140,
    hemiSky: 0xf4fbff,
    hemiGround: 0x6f9a3a,
    hemiIntensity: 1.7,
    sun: 0xfff2d0,
    sunIntensity: 2.4,
    ground: {
      a: 0x86d443,
      b: 0x6fc23a,
      high: 0xa8e05a,
      thicket: 0x4f9a32,
      clearing: 0xd8c08a,
      shore: 0xe6d8a6,
      mud: 0x6f7a4a,
      rim: 0x5a9a3a,
      cliff: 0x9a9a8e,
    },
    water: 0x5fb0d0,
    waterOpacity: 0.82,
    trunk: 0x7a5238,
    roundLeaves: [0x8fd04a, 0x7cc23f, 0xa6dc5a],
    pineLeaves: [0x3f9a4a, 0x4cab55],
    pineShare: 0.1,
    rocks: [0xa8a39a, 0xbab4aa, 0x958f86],
    grass: [0x8fd855, 0x7fcb4a, 0xa6e066],
    flowers: [0xffe066, 0xffffff, 0xff9a3a],
    lilies: [0x6fae48],
    // MegaSprout bamboo: neon green.
    stalks: [0x8fe03a, 0x7fd133, 0x9fe84a],
    stalkNode: 0x5ea82e,
    stalkLeaves: [0x6fc13a, 0x7fd147, 0x5fb033],
  },
};
