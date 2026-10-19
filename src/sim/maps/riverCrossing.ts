import type { MapLayout } from '../mapLayout';

/**
 * A river winds west to east across the middle. Zombies can't swim, so they bunch up at the two
 * bridges and the shallow ford; pandas can swim across (slowly) to get away.
 * The straight line from camp to hut runs through the ford.
 */
export const RIVER_CROSSING: MapLayout = {
  id: 'river',
  name: 'River Crossing',
  blurb: 'Spring blossoms and a wide river. Zombies cross only at bridges and the ford.',
  tip: "Zombies can't swim! They cross at the bridges and the shallow ford. You can swim, slowly.",
  seed: 20261020,
  size: 180,
  renderSize: 236,
  start: { x: -44, z: 76, r: 10 },
  goal: { x: 52, z: -76, r: 10 },
  hills: [
    { x: -48, z: -46, r: 22, h: 6.5 },
    { x: 48, z: 44, r: 20, h: 5 },
  ],
  ponds: [{ x: -45, z: 32, r: 6.5, depth: 0.8 }],
  rivers: [
    {
      points: [
        { x: -120, z: -4 },
        { x: -86, z: 10 },
        { x: -56, z: -4 },
        { x: -28, z: 10 },
        { x: 0, z: -2 },
        { x: 28, z: -16 },
        { x: 58, z: -6 },
        { x: 86, z: 8 },
        { x: 120, z: -2 },
      ],
      width: 9,
      depth: 0.75,
      bridges: [0.31, 0.74],
      fords: [0.505],
    },
  ],
  ridges: [],
  thickets: [
    // South bank (camp side).
    { x: -72, z: 62, r: 5.5 },
    { x: -14, z: 58, r: 6 },
    { x: 18, z: 70, r: 5 },
    { x: 70, z: 66, r: 5 },
    { x: -74, z: 26, r: 4.5 },
    { x: -24, z: 34, r: 4.5 },
    { x: 26, z: 30, r: 5 },
    { x: 78, z: 30, r: 4.5 },
    // North bank (hut side).
    { x: -16, z: -40, r: 5.5 },
    { x: 18, z: -48, r: 6 },
    { x: 72, z: -38, r: 5 },
    { x: -74, z: -70, r: 5.5 },
    { x: -34, z: -74, r: 5 },
    { x: 14, z: -76, r: 4.5 },
    { x: -80, z: -30, r: 4.5 },
  ],
  density: { trees: 130, rocks: 40, grass: 1300, flowerPatches: 65 },
  theme: {
    sky: 0xc6ecff,
    fogNear: 60,
    fogFar: 140,
    hemiSky: 0xf0f9ff,
    hemiGround: 0x7a9a50,
    hemiIntensity: 1.7,
    sun: 0xfff4dc,
    sunIntensity: 2.4,
    ground: {
      a: 0xa5db68,
      b: 0x7cc256,
      high: 0xcbe68a,
      thicket: 0x5c9a3e,
      clearing: 0xd4bb82,
      shore: 0xe8d7a0,
      mud: 0x7f8a5a,
      rim: 0x5f9a45,
      cliff: 0x9a9a8e,
    },
    water: 0x4fb6e6,
    waterOpacity: 0.82,
    trunk: 0x8b5a3c,
    // Cherry blossoms mixed with green trees.
    roundLeaves: [0xffb3cf, 0xf79ec0, 0x7ccf55, 0xffc6dc, 0x8ad65e, 0x6cc24a],
    pineLeaves: [0x3f9a55, 0x4cab62, 0x378c4e],
    pineShare: 0.25,
    rocks: [0x9ea3a8, 0xb3b6b0, 0x8f949a],
    grass: [0x86d05c, 0x72c04e, 0x9ddd6a],
    flowers: [0xff8fb1, 0xffe066, 0xffffff, 0xc39bff, 0x7fc8ff],
    lilies: [0x5fae48, 0x6dbd52],
    stalks: [0x8cc84b, 0x7dbb45, 0x9bd257],
    stalkNode: 0x5e9a34,
    stalkLeaves: [0x5fb347, 0x6fc152, 0x4fa23e],
  },
};
