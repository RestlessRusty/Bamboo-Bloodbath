import type { MapLayout } from '../../mapLayout';

/**
 * Story chapter 10. The Bristle Bio works. A ridge walls off the factory yard in the north, with one wide
 * pass the cart road (with rails) runs through and a narrow crack in the west. Camp in the south-west;
 * the main tank and the factory with its blimp are in the yard. Points shared with the chapter's escort
 * paths (WORKS_ROAD_POINTS).
 */
export const WORKS_ROAD_POINTS: readonly { x: number; z: number }[] = [
  { x: -58, z: 62 },
  { x: -36, z: 50 },
  { x: -8, z: 40 },
  { x: 14, z: 24 },
  // At the foot of the pass.
  { x: 16, z: 6 },
  { x: 16, z: -14 },
  { x: 6, z: -28 },
  // By the tank's intake.
  { x: -4, z: -36 },
];

export const BRISTLE_WORKS: MapLayout = {
  id: 'story-works',
  name: 'Bristle Bio Works',
  blurb: 'Chimneys, a walled yard, and a fleet of blimps.',
  seed: 20261110,
  size: 180,
  renderSize: 236,
  start: { x: -70, z: 74, r: 10 },
  goal: { x: -2, z: -46, r: 9 },
  goalStyle: 'none',
  route: [
    { x: -36, z: 50 },
    { x: 14, z: 24 },
    { x: 16, z: -14 },
  ],
  hills: [
    { x: -30, z: 18, r: 14, h: 4 },
    { x: 52, z: 42, r: 16, h: 4 },
    { x: -62, z: -62, r: 16, h: 4 },
    { x: 72, z: -76, r: 12, h: 3 },
  ],
  ponds: [
    // Cooling ponds: deep, a bit green.
    { x: 62, z: -40, r: 7, depth: 1 },
    { x: -42, z: 74, r: 6, depth: 0.8 },
  ],
  rivers: [],
  ridges: [
    {
      points: [
        { x: -120, z: -4 },
        { x: -60, z: -12 },
        { x: -20, z: -2 },
        { x: 16, z: -6 },
        { x: 60, z: 0 },
        { x: 120, z: -8 },
      ],
      width: 14,
      height: 9,
      gaps: [
        { x: 16, z: -6, width: 10 },
        { x: -60, z: -12, width: 2.4 },
      ],
    },
  ],
  roads: [{ points: WORKS_ROAD_POINTS, width: 5, rails: true }],
  landmarks: [
    { kind: 'tank', x: -8, z: -50, r: 4, face: { x: -4, z: -36 } },
    { kind: 'factory', x: 36, z: -68, r: 8, face: { x: 16, z: -44 } },
  ],
  clear: [
    { x: -36, z: -34, r: 3 },
    { x: 44, z: -34, r: 3 },
    { x: 12, z: -62, r: 3 },
    { x: 0, z: -46, r: 10 },
  ],
  racks: ['javelin', 'axe', 'javelin', 'knife', 'axe', 'javelin'],
  thickets: [
    // South of the ridge.
    { x: -60, z: 40, r: 5 },
    { x: -14, z: 62, r: 4.5 },
    { x: 20, z: 52, r: 4.5 },
    { x: 40, z: 14, r: 4.5 },
    { x: -48, z: 12, r: 4.5 },
    { x: 70, z: 64, r: 4.5 },
    // The yard.
    { x: -40, z: -58, r: 4.5 },
    { x: 36, z: -22, r: 4.5 },
    { x: -22, z: -26, r: 4 },
    { x: 66, z: -16, r: 4.5 },
    { x: -76, z: -30, r: 4.5 },
  ],
  density: { trees: 90, rocks: 45, grass: 800, flowerPatches: 15 },
  theme: {
    // Smoggy sunset over the works.
    sky: 0xdcd6a8,
    fogNear: 45,
    fogFar: 120,
    hemiSky: 0xf2efd0,
    hemiGround: 0x6a6a4a,
    hemiIntensity: 1.6,
    sun: 0xffd89a,
    sunIntensity: 2.2,
    ground: {
      a: 0x9aa070,
      b: 0x8a9062,
      high: 0xb0b484,
      thicket: 0x6a7a45,
      clearing: 0xb0a68a,
      shore: 0xc8c0a0,
      mud: 0x5f6048,
      rim: 0x7a7a55,
      cliff: 0x8a8a84,
    },
    water: 0x7fb08a,
    waterOpacity: 0.8,
    trunk: 0x5f4434,
    roundLeaves: [0x8a9a4a, 0x7a8a3f, 0x9aa85a],
    pineLeaves: [0x4a6a3a, 0x55753f],
    pineShare: 0.3,
    rocks: [0x9a9690, 0xaaa69e, 0x8a8680],
    grass: [0x9aa060, 0x8a9055, 0xaab070],
    flowers: [0xffe066, 0xffffff],
    lilies: [],
    stalks: [0x8fe03a, 0x7fd133, 0x9fe84a],
    stalkNode: 0x5ea82e,
    stalkLeaves: [0x6fc13a, 0x7fd147, 0x5fb033],
  },
};
