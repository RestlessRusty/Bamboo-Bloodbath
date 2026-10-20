import type { MapLayout } from '../../mapLayout';

/**
 * Story chapter 2. A river meanders west–east across the map. You start south-east; Doc's clinic
 * is on the north bank in the west, near the ford; the trail hut is in the north-west corner.
 * The bridge is near the camp, so the quick way to the clinic is bridge → along the north bank.
 */
export const WILLOW_RIVER: MapLayout = {
  id: 'story-river',
  name: 'Willow River',
  blurb: 'A lazy river, one bridge, one ford, and the riverside clinic.',
  seed: 20261102,
  size: 180,
  renderSize: 236,
  start: { x: 66, z: 74, r: 10 },
  goal: { x: -72, z: -72, r: 10 },
  route: [
    { x: 38, z: 52 },
    { x: 34, z: 12 },
    { x: -30, z: 2 },
  ],
  hills: [
    { x: 60, z: -40, r: 22, h: 6 },
    { x: -10, z: 64, r: 18, h: 4 },
    { x: -70, z: -20, r: 14, h: 3.5 },
  ],
  ponds: [
    { x: 0, z: -50, r: 9, depth: 0.8 },
    { x: 76, z: 50, r: 6, depth: 0.7 },
  ],
  rivers: [
    {
      points: [
        { x: -120, z: 30 },
        { x: -80, z: 18 },
        { x: -40, z: 34 },
        { x: 0, z: 22 },
        { x: 30, z: 36 },
        { x: 60, z: 14 },
        { x: 90, z: 28 },
        { x: 120, z: 20 },
      ],
      width: 10,
      depth: 0.8,
      // Bridge at about (36, 32), ford at about (-46, 32), just south of the clinic.
      bridges: [0.64],
      fords: [0.3],
    },
  ],
  ridges: [],
  landmarks: [{ kind: 'clinic', x: -40, z: -8, r: 3, face: { x: -40, z: 20 } }],
  racks: ['axe', 'javelin', 'knife', 'axe', 'javelin'],
  thickets: [
    // South bank (camp side).
    { x: 40, z: 66, r: 5 },
    { x: 10, z: 50, r: 5 },
    { x: -30, z: 62, r: 5 },
    { x: -70, z: 56, r: 5 },
    // North bank.
    { x: 10, z: 0, r: 5 },
    { x: -15, z: -26, r: 5.5 },
    { x: -62, z: 8, r: 4.5 },
    { x: 22, z: -30, r: 5 },
    { x: -46, z: -46, r: 5.5 },
    { x: -82, z: -42, r: 4.5 },
    { x: 42, z: -8, r: 4.5 },
  ],
  density: { trees: 140, rocks: 35, grass: 1300, flowerPatches: 55 },
  theme: {
    sky: 0xcdeefc,
    fogNear: 60,
    fogFar: 140,
    hemiSky: 0xf2fbff,
    hemiGround: 0x6f9a5a,
    hemiIntensity: 1.7,
    sun: 0xfff6e0,
    sunIntensity: 2.4,
    ground: {
      a: 0x8fd46a,
      b: 0x6dbb55,
      high: 0xb7e07f,
      thicket: 0x4f9a42,
      clearing: 0xd8c08a,
      shore: 0xe6d8a6,
      mud: 0x6f8058,
      rim: 0x5c9a48,
      cliff: 0x9a9a8e,
    },
    water: 0x47aee0,
    waterOpacity: 0.82,
    trunk: 0x7a5238,
    // Willow greens.
    roundLeaves: [0x9fd65a, 0x86c94f, 0xb5e070, 0x74b947],
    pineLeaves: [0x3f9a55, 0x4cab62],
    pineShare: 0.15,
    rocks: [0x9ea3a8, 0xb3b6b0, 0x8f949a],
    grass: [0x7fcb58, 0x6bbd4d, 0x95d968],
    flowers: [0xffffff, 0xffe066, 0x9fd0ff, 0xff9fc8],
    lilies: [0x5fae48, 0x6dbd52],
    stalks: [0x8cc84b, 0x7dbb45, 0x9bd257],
    stalkNode: 0x5e9a34,
    stalkLeaves: [0x5fb347, 0x6fc152, 0x4fa23e],
  },
};
