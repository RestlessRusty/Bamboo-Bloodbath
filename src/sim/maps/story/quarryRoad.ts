import type { MapLayout } from '../../mapLayout';

/**
 * Story chapter 7. A dusty quarry. The delivery road (with cart rails) winds from the loading spot in the
 * south-west, east and through the one wide pass in the ridge, then west to Bristle's depot in the
 * north-west. Two boom gates on the road: one before the pass, one before the depot.
 * The points here are shared with the chapter's escort paths (QUARRY_ROAD_POINTS).
 */
export const QUARRY_ROAD_POINTS: readonly { x: number; z: number }[] = [
  { x: -40, z: 52 },
  { x: -14, z: 34 },
  { x: 14, z: 30 },
  { x: 38, z: 20 },
  // First gate just past here.
  { x: 44, z: 6 },
  { x: 44, z: -16 },
  { x: 34, z: -34 },
  { x: 8, z: -44 },
  // Second gate just past here.
  { x: -16, z: -46 },
  { x: -38, z: -52 },
  { x: -52, z: -58 },
];

export const QUARRY_ROAD: MapLayout = {
  id: 'story-quarry',
  name: 'Quarry Road',
  blurb: 'A dusty road, two gates, and a ridge with one way through.',
  seed: 20261107,
  size: 180,
  renderSize: 236,
  start: { x: -74, z: 76, r: 10 },
  goal: { x: -50, z: -56, r: 8 },
  goalStyle: 'none',
  route: [
    { x: -40, z: 52 },
    { x: 14, z: 30 },
    { x: 44, z: 6 },
    { x: 44, z: -16 },
    { x: 8, z: -44 },
    { x: -38, z: -52 },
  ],
  hills: [
    { x: -10, z: 72, r: 14, h: 4 },
    { x: 70, z: 50, r: 16, h: 5 },
    { x: -62, z: 20, r: 14, h: 4 },
    { x: 70, z: -52, r: 16, h: 4.5 },
  ],
  ponds: [
    // Flooded quarry pits: deep.
    { x: 4, z: 60, r: 6, depth: 1 },
    { x: 56, z: -76, r: 6, depth: 1 },
    { x: -20, z: -72, r: 5, depth: 0.9 },
  ],
  rivers: [],
  ridges: [
    {
      points: [
        { x: -120, z: -2 },
        { x: -60, z: -10 },
        { x: -10, z: -4 },
        { x: 44, z: -8 },
        { x: 90, z: -2 },
        { x: 120, z: -6 },
      ],
      width: 16,
      height: 10,
      gaps: [
        // The road's pass.
        { x: 44, z: -8, width: 10 },
        // A crack only pandas would bother squeezing through.
        { x: -60, z: -10, width: 2.4 },
      ],
    },
  ],
  roads: [{ points: QUARRY_ROAD_POINTS, width: 5, rails: true }],
  landmarks: [{ kind: 'depot', x: -64, z: -68, r: 5.5, face: { x: -52, z: -58 } }],
  clear: [
    { x: 26, z: 6, r: 3 },
    { x: 62, z: 10, r: 3 },
    { x: 40.5, z: 2, r: 2 },
    { x: -20, z: -51, r: 2 },
    { x: -14, z: -45, r: 9 },
  ],
  racks: ['axe', 'javelin', 'knife', 'axe', 'javelin', 'javelin'],
  thickets: [
    // South of the ridge.
    { x: -60, z: 54, r: 5 },
    { x: -24, z: 60, r: 4.5 },
    { x: 0, z: 14, r: 5 },
    { x: 24, z: 46, r: 4.5 },
    { x: 60, z: 26, r: 4.5 },
    { x: -40, z: 16, r: 5 },
    // North of the ridge.
    { x: 16, z: -22, r: 4.5 },
    { x: 60, z: -30, r: 4.5 },
    { x: 20, z: -64, r: 5 },
    { x: -30, z: -30, r: 5 },
    { x: -76, z: -40, r: 4.5 },
  ],
  density: { trees: 90, rocks: 70, grass: 700, flowerPatches: 15 },
  theme: {
    // Dusty ochre quarry, pinkish rock.
    sky: 0xffe9c8,
    fogNear: 55,
    fogFar: 130,
    hemiSky: 0xfff3e0,
    hemiGround: 0x9a7a5a,
    hemiIntensity: 1.7,
    sun: 0xffdcaa,
    sunIntensity: 2.4,
    ground: {
      a: 0xd8b47a,
      b: 0xc9a068,
      high: 0xe8cc94,
      thicket: 0x9a9a4a,
      clearing: 0xcfae84,
      shore: 0xe0cfa0,
      mud: 0x8a7a5a,
      rim: 0xb08a5a,
      cliff: 0xb09a88,
    },
    water: 0x6fb8c8,
    waterOpacity: 0.8,
    trunk: 0x6e4630,
    roundLeaves: [0x9aac4a, 0x8a9c3f, 0xb0b85a],
    pineLeaves: [0x5a7a3a, 0x4d6d33],
    pineShare: 0.35,
    rocks: [0xb8a596, 0xc9b8a8, 0xa08f80],
    grass: [0xc8b46a, 0xb8a45a, 0xd8c47a],
    flowers: [0xffffff, 0xffd34d, 0xff9a6a],
    lilies: [],
    stalks: [0xa6b545, 0x98a83f, 0xb5c04b],
    stalkNode: 0x7a8a34,
    stalkLeaves: [0x9aac3f, 0xb0b84a, 0x8a9c3a],
  },
};
