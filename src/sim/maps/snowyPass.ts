import type { MapLayout } from '../mapLayout';

/**
 * Two rock ridges cut the map into three west–east legs. Wide passes at alternating ends make a
 * zig-zag route (camp bottom-left → pass east → pass west → hut top-right); each ridge also has a
 * narrow shortcut in the middle. Frozen ponds on the way are slippery for everyone.
 */
export const SNOWY_PASS: MapLayout = {
  id: 'snowy',
  name: 'Snowy Pass',
  blurb: 'Switchbacks between rock ridges. Take the passes, or squeeze through a shortcut.',
  tip: 'Ridges are too steep to climb. Follow the arrow through the passes, or find the narrow shortcuts. Ice is slippery!',
  seed: 20261021,
  size: 180,
  renderSize: 236,
  start: { x: -62, z: 76, r: 10 },
  goal: { x: 62, z: -76, r: 10 },
  // Along the middle of each leg, through the two wide passes.
  route: [
    { x: 40, z: 56 },
    { x: 62, z: 31 },
    { x: 40, z: 6 },
    { x: -40, z: 4 },
    { x: -62, z: -29 },
    { x: -40, z: -52 },
  ],
  hills: [
    { x: -5, z: 66, r: 14, h: 3.5 },
    { x: 10, z: -70, r: 14, h: 3.5 },
  ],
  ponds: [
    { x: 28, z: 62, r: 7, depth: 0, frozen: true },
    { x: 0, z: -2, r: 9, depth: 0, frozen: true },
    { x: 48, z: -4, r: 6, depth: 0, frozen: true },
  ],
  rivers: [],
  ridges: [
    {
      points: [
        { x: -120, z: 34 },
        { x: -80, z: 26 },
        { x: -40, z: 36 },
        { x: 0, z: 28 },
        { x: 40, z: 36 },
        { x: 80, z: 26 },
        { x: 120, z: 32 },
      ],
      width: 14,
      height: 9,
      gaps: [
        { x: 62, z: 31, width: 12 },
        { x: -15, z: 33, width: 1.8 },
      ],
    },
    {
      points: [
        { x: -120, z: -26 },
        { x: -80, z: -34 },
        { x: -40, z: -24 },
        { x: 0, z: -32 },
        { x: 40, z: -24 },
        { x: 80, z: -34 },
        { x: 120, z: -28 },
      ],
      width: 14,
      height: 9,
      gaps: [
        { x: -62, z: -29, width: 12 },
        { x: 15, z: -29, width: 1.8 },
      ],
    },
  ],
  thickets: [
    // First leg (camp side).
    { x: -30, z: 58, r: 5 },
    { x: 45, z: 78, r: 4.5 },
    { x: 78, z: 56, r: 4.5 },
    // Middle leg.
    { x: -30, z: 6, r: 5 },
    { x: 25, z: 10, r: 4.5 },
    { x: 75, z: -6, r: 4.5 },
    { x: -75, z: 8, r: 4.5 },
    // Last leg (hut side).
    { x: -40, z: -60, r: 5 },
    { x: 25, z: -62, r: 4.5 },
    { x: -76, z: -52, r: 4.5 },
    { x: 40, z: -52, r: 4.5 },
  ],
  density: { trees: 140, rocks: 50, grass: 700, flowerPatches: 8 },
  theme: {
    sky: 0xdbe9f2,
    fogNear: 40,
    fogFar: 115,
    hemiSky: 0xf4f8ff,
    hemiGround: 0x9aa7b8,
    hemiIntensity: 1.8,
    sun: 0xfff6ea,
    sunIntensity: 2.1,
    ground: {
      a: 0xf4f8fb,
      b: 0xe2ebf3,
      high: 0xffffff,
      thicket: 0xc9d6c4,
      clearing: 0xd8c7a8,
      shore: 0xdfeaf2,
      mud: 0x7d8a99,
      rim: 0xcfdbe6,
      cliff: 0x8d8f99,
    },
    water: 0x9fd3ea,
    waterOpacity: 0.85,
    ice: 0xcbe8f5,
    trunk: 0x6b4a36,
    roundLeaves: [0x5c7f63, 0x6a8f70],
    pineLeaves: [0x2f6b4f, 0x3a7a5a, 0x275e45],
    pineShare: 1,
    rocks: [0x8d8f99, 0xa3a6ae, 0x7c7f88],
    grass: [0xd7e3d0, 0xc4d6c0, 0xe6eee2],
    flowers: [0xffffff, 0xd9ecff],
    lilies: [],
    // Snowy shrubs: dark green bushes with white caps (stalkNode).
    stalks: [0x2f5d45, 0x3a6b50, 0x2a5440],
    stalkNode: 0xffffff,
    stalkLeaves: [0x2f5d45],
    thicketStyle: 'shrub',
    snowCaps: true,
    snowfall: true,
  },
};
