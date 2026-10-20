import type { MapLayout } from '../../mapLayout';

/**
 * Story chapter 5. The old research station sits in a walled-off yard in the north: a ridge runs
 * west–east across the map with a wide gate in the middle and two narrow cracks near the edges.
 * Camp in the south; the "goal" is the station yard (no rescue hut), where the last stand happens.
 */
export const RESEARCH_STATION: MapLayout = {
  id: 'story-lab',
  name: 'Old Research Station',
  blurb: 'Through the gate to the station, then hold the yard.',
  seed: 20261105,
  size: 180,
  renderSize: 236,
  start: { x: 0, z: 76, r: 10 },
  goal: { x: 0, z: -50, r: 9 },
  goalStyle: 'none',
  hills: [
    { x: -45, z: 30, r: 22, h: 5 },
    { x: 48, z: 40, r: 20, h: 4.5 },
  ],
  ponds: [
    { x: 25, z: 10, r: 7, depth: 0.8 },
    { x: -30, z: 66, r: 6, depth: 0.7 },
  ],
  rivers: [],
  ridges: [
    {
      points: [
        { x: -120, z: -14 },
        { x: -60, z: -24 },
        { x: -20, z: -16 },
        { x: 20, z: -24 },
        { x: 60, z: -14 },
        { x: 120, z: -22 },
      ],
      width: 14,
      height: 9,
      gaps: [
        { x: 0, z: -20, width: 12 },
        { x: -60, z: -24, width: 2 },
        { x: 60, z: -14, width: 2 },
      ],
    },
  ],
  landmarks: [{ kind: 'lab', x: 0, z: -66, r: 5, face: { x: 0, z: -50 } }],
  racks: ['javelin', 'axe', 'javelin', 'knife', 'axe', 'javelin'],
  thickets: [
    // South of the ridge.
    { x: -20, z: 55, r: 5 },
    { x: 25, z: 60, r: 5 },
    { x: -62, z: 60, r: 5 },
    { x: 62, z: 72, r: 4.5 },
    { x: -15, z: 20, r: 4.5 },
    { x: 12, z: 34, r: 4.5 },
    { x: -72, z: 5, r: 4.5 },
    { x: 72, z: 10, r: 4.5 },
    // Station yard.
    { x: -35, z: -50, r: 4.5 },
    { x: 35, z: -55, r: 4.5 },
    { x: -62, z: -70, r: 5 },
    { x: 62, z: -70, r: 5 },
  ],
  density: { trees: 130, rocks: 50, grass: 1100, flowerPatches: 40 },
  theme: {
    // Late-summer sunset over an overgrown compound.
    sky: 0xf6d8b8,
    fogNear: 55,
    fogFar: 130,
    hemiSky: 0xfff0e0,
    hemiGround: 0x6a7a4a,
    hemiIntensity: 1.7,
    sun: 0xffc890,
    sunIntensity: 2.3,
    ground: {
      a: 0x9cc05e,
      b: 0x84a84e,
      high: 0xc0d07a,
      thicket: 0x5c8a3e,
      clearing: 0xbfae8a,
      shore: 0xe2d3a2,
      mud: 0x7a7a58,
      rim: 0x6a8a45,
      cliff: 0x8f8a84,
    },
    water: 0x5aa8c8,
    waterOpacity: 0.8,
    trunk: 0x7a5238,
    roundLeaves: [0x7cb84a, 0x8fc456, 0x6aa840, 0xa8c85a],
    pineLeaves: [0x3f8a50, 0x4a9a5a],
    pineShare: 0.3,
    rocks: [0x9e9a94, 0xb0aaa2, 0x8a8680],
    grass: [0x8fbf55, 0x7aaf4a, 0xa2cc62],
    flowers: [0xff8f6a, 0xffe066, 0xffffff, 0xd99bff],
    lilies: [0x6aa848],
    stalks: [0x8cc84b, 0x7dbb45, 0x9bd257],
    stalkNode: 0x5e9a34,
    stalkLeaves: [0x5fb347, 0x6fc152, 0x4fa23e],
  },
};
