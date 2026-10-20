import type { MapLayout } from '../../mapLayout';

/**
 * Story chapter 3. One long rock ridge splits the map into a south half (camp, south-east) and a
 * north half (mountain hut, north-west). A wide pass in the middle, a narrow shortcut in the west.
 * Snow lotuses grow on both sides.
 */
export const FROSTBITE_RIDGE: MapLayout = {
  id: 'story-frost',
  name: 'Frostbite Ridge',
  blurb: 'One ridge, one pass, a blizzard on the way.',
  seed: 20261103,
  size: 180,
  renderSize: 236,
  start: { x: 70, z: 74, r: 10 },
  goal: { x: -72, z: -72, r: 10 },
  // Through the wide pass at (30, 12).
  route: [
    { x: 34, z: 34 },
    { x: 27, z: -10 },
  ],
  hills: [
    { x: -55, z: 62, r: 18, h: 4 },
    { x: -30, z: -48, r: 20, h: 4.5 },
    { x: 70, z: -60, r: 14, h: 3.5 },
  ],
  ponds: [
    { x: -20, z: 52, r: 9, depth: 0, frozen: true },
    { x: 40, z: -48, r: 8, depth: 0, frozen: true },
    { x: 62, z: 44, r: 6, depth: 0, frozen: true },
  ],
  rivers: [],
  ridges: [
    {
      points: [
        { x: -120, z: 14 },
        { x: -70, z: 20 },
        { x: -20, z: 2 },
        { x: 30, z: 12 },
        { x: 80, z: -4 },
        { x: 120, z: 2 },
      ],
      width: 16,
      height: 10,
      gaps: [
        { x: 30, z: 12, width: 10 },
        { x: -70, z: 20, width: 2.2 },
      ],
    },
  ],
  thickets: [
    // South half.
    { x: 48, z: 58, r: 4.5 },
    { x: -5, z: 38, r: 5 },
    { x: -72, z: 46, r: 4.5 },
    { x: 20, z: 76, r: 4 },
    { x: -40, z: 76, r: 4.5 },
    // North half.
    { x: -50, z: -20, r: 5 },
    { x: 15, z: -32, r: 4.5 },
    { x: 45, z: -20, r: 4.5 },
    { x: -10, z: -62, r: 5 },
    { x: 30, z: -72, r: 4.5 },
    { x: -78, z: -45, r: 4.5 },
  ],
  density: { trees: 150, rocks: 55, grass: 600, flowerPatches: 6 },
  theme: {
    sky: 0xcfe0ee,
    // Thick air: the blizzard is coming.
    fogNear: 35,
    fogFar: 105,
    hemiSky: 0xeef5ff,
    hemiGround: 0x93a2b8,
    hemiIntensity: 1.8,
    sun: 0xf2f6ff,
    sunIntensity: 1.9,
    ground: {
      a: 0xf2f7fb,
      b: 0xdde7f0,
      high: 0xffffff,
      thicket: 0xc5d3c2,
      clearing: 0xd4c3a3,
      shore: 0xdce8f1,
      mud: 0x7a8797,
      rim: 0xcad8e4,
      cliff: 0x858996,
    },
    water: 0x9fd3ea,
    waterOpacity: 0.85,
    ice: 0xc4e4f3,
    trunk: 0x5f4434,
    roundLeaves: [0x58795f],
    pineLeaves: [0x2b6248, 0x356f53, 0x24573f],
    pineShare: 1,
    rocks: [0x868a95, 0x9da1aa, 0x777b85],
    grass: [0xd4e0cf, 0xc0d2bd, 0xe4ece0],
    flowers: [0xffffff, 0xd9ecff],
    lilies: [],
    stalks: [0x2d5a43, 0x37684e, 0x28523e],
    stalkNode: 0xffffff,
    stalkLeaves: [0x2d5a43],
    thicketStyle: 'shrub',
    snowCaps: true,
    snowfall: true,
  },
};
