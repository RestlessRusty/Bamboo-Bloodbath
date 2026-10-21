import type { Rng } from '../../core/rng';
import type { WeaponType } from '../types';
import { OPEN, PIECES } from './config';
import type { BiomeId, Cost, Loot, Piece, PieceKind, PoiKind, Rot, Tier } from './types';

/**
 * Abandoned buildings (POIs): their floor plans, names, what they're built of, how ruined they are and
 * what's in their crates. Everything is ordinary building pieces on the OPEN.tile grid, so players can
 * repair, upgrade or tear them down like their own.
 */

/**
 * Floor plans, north up, door on the south side (turned as a whole later). One character per tile:
 * W wall, G gate, D doorway (left open), L lookout, F campfire, . floor (room for beds, benches,
 * crates), and a space for nothing (open corners).
 */
interface Blueprint {
  rows: readonly string[];
  /** Tiers the walls and gates can be (one is picked per building). */
  tiers: readonly Tier[];
  beds: readonly [number, number];
  /** Chances of a workbench, a storage chest and a campfire (outside the door, or inside the big ones). */
  workbench: number;
  storage: number;
  campfire: number;
  crates: readonly [number, number];
  /** Chance of a weapon in each crate. */
  weapon: number;
  /** Chance of food in each crate. */
  food: number;
  names: readonly string[];
}

const BLUEPRINTS: Record<PoiKind, Blueprint> = {
  cabin: {
    rows: ['WWWWWW', 'W....W', 'W....W', 'W....W', 'WWDWWW'],
    tiers: [1, 1, 0],
    beds: [1, 2],
    workbench: 0.4,
    storage: 0.35,
    campfire: 0.4,
    crates: [1, 2],
    weapon: 0.15,
    food: 0.55,
    names: ["Trapper's Cabin", "Woodcutter's Cabin", "Hermit's Hut", 'Hunting Lodge', "Fisher's Cabin", 'Mossy Cabin', "Grandpa Bo's Cabin", 'Pinecone Lodge', 'Summer Cabin'],
  },
  shed: {
    rows: ['WWWW', 'W..W', 'W..W', 'WDWW'],
    tiers: [0, 0, 1],
    beds: [1, 1],
    workbench: 0.5,
    storage: 0.2,
    campfire: 0.2,
    crates: [1, 1],
    weapon: 0.2,
    food: 0.3,
    names: ['Tool Shed', 'Woodshed', 'Pump House', 'Garden Shed', 'Boat Shed', 'Storage Shed', 'Potting Shed'],
  },
  barn: {
    rows: ['WWWWWWWW', 'W......W', 'W......W', 'W......W', 'W......W', 'W......W', 'W......W', 'W......W', 'W......W', 'WWWGGWWW'],
    tiers: [1],
    beds: [1, 2],
    workbench: 0.4,
    storage: 0.6,
    campfire: 0.25,
    crates: [2, 3],
    weapon: 0.12,
    food: 0.6,
    names: ['Red Barn', 'Old Hay Barn', "Miller's Barn", 'Leaning Barn', 'Big Barn', 'Cow Barn'],
  },
  farmhouse: {
    rows: ['WWWWWWW', 'W..W..W', 'W..W..W', 'W.....W', 'W.....W', 'WWWDWWW'],
    tiers: [1, 1, 2],
    beds: [2, 2],
    workbench: 0.45,
    storage: 0.5,
    campfire: 0.35,
    crates: [2, 3],
    weapon: 0.12,
    food: 0.7,
    names: ['Miller Farmhouse', 'Sunny Farmhouse', 'Bramble Farm', 'Old Homestead', 'Turnip Farm', 'Willow Farm'],
  },
  watchtower: {
    rows: [' WWW ', 'W...W', 'W.L.W', 'W...W', ' WDW '],
    tiers: [1],
    beds: [1, 1],
    workbench: 0.2,
    storage: 0.2,
    campfire: 0.5,
    crates: [1, 2],
    weapon: 0.35,
    food: 0.3,
    names: ['Fire Lookout', 'Old Watchtower', "Ranger's Tower", 'Crow Tower', 'Signal Tower'],
  },
  outpost: {
    rows: ['WWWWWWWWW', 'WL......W', 'W.......W', 'W.......W', 'W.......W', 'W.......W', 'W.......W', 'W.......W', 'WWWWGWWWW'],
    tiers: [1, 2],
    beds: [2, 2],
    workbench: 0.7,
    storage: 0.6,
    campfire: 0.7,
    crates: [2, 3],
    weapon: 0.35,
    food: 0.35,
    names: ['Ranger Outpost', 'Supply Depot', 'Old Checkpoint', 'Survey Camp', 'Quarry Office', 'Last Stand'],
  },
  chapel: {
    rows: [' WWWW ', 'WW..WW', 'W....W', 'W....W', 'W....W', 'W....W', 'W....W', 'W....W', 'WWDDWW'],
    tiers: [2, 2, 1],
    beds: [1, 2],
    workbench: 0.15,
    storage: 0.4,
    campfire: 0.3,
    crates: [1, 2],
    weapon: 0.15,
    food: 0.6,
    names: ['Little Chapel', 'Hillside Chapel', 'Stone Chapel', 'Old Chapel', 'Bell Chapel'],
  },
};

/** The camp's own cabin. */
export const CAMP_CABIN_NAME = 'Old Ranger Cabin';

/** Building kinds by biome, with how likely each is. */
export const POI_KINDS: Readonly<Record<BiomeId, readonly (readonly [PoiKind, number])[]>> = {
  meadow: [['cabin', 3], ['farmhouse', 2], ['shed', 2], ['chapel', 1], ['watchtower', 1]],
  bamboo: [['cabin', 3], ['shed', 2], ['watchtower', 1], ['outpost', 1]],
  pine: [['cabin', 4], ['watchtower', 2], ['shed', 1], ['outpost', 1]],
  snow: [['cabin', 3], ['outpost', 2], ['chapel', 1], ['watchtower', 1]],
  fen: [['cabin', 2], ['shed', 2], ['chapel', 2], ['watchtower', 1]],
  quarry: [['outpost', 3], ['shed', 3], ['watchtower', 2]],
  farm: [['barn', 4], ['farmhouse', 4], ['shed', 2]],
};

export function pickPoiKind(biome: BiomeId, rng: Rng): PoiKind {
  const options = POI_KINDS[biome];
  let total = 0;
  for (const [, w] of options) total += w;
  let roll = rng.next() * total;
  for (const [kind, w] of options) {
    roll -= w;
    if (roll < 0) return kind;
  }
  return options[0][0];
}

/** Room around the walls that still belongs to the yard (flat, no trees or rocks). */
const YARD = 3.5;

/** Where a building goes and how it's turned. */
export interface PoiPlan {
  kind: PoiKind;
  /** Middle of the building and the yard radius (Poi.x, z, r). */
  x: number;
  z: number;
  r: number;
  /** North-west tile of the building and its size in tiles, after turning. */
  gx: number;
  gz: number;
  w: number;
  d: number;
  /** Quarter turns clockwise: the door faces south (0), west (1), north (2) or east (3). */
  turn: Rot;
  /** The floor plan after turning, north up. */
  rows: string[];
}

/** A building of `kind` centred near (x, z), snapped to the tile grid. */
export function planPoi(kind: PoiKind, x: number, z: number, turn: Rot): PoiPlan {
  let rows = BLUEPRINTS[kind].rows.slice();
  for (let i = 0; i < turn; i++) rows = turnRows(rows);
  const d = rows.length;
  const w = rows[0].length;
  const t = OPEN.tile;
  const gx = Math.round(x / t - w / 2);
  const gz = Math.round(z / t - d / 2);
  return { kind, x: (gx + w / 2) * t, z: (gz + d / 2) * t, r: (Math.hypot(w, d) * t) / 2 + YARD, gx, gz, w, d, turn, rows };
}

/** A floor plan turned a quarter clockwise (seen from above, north up): its west side becomes the north. */
function turnRows(rows: readonly string[]): string[] {
  const d = rows.length;
  const w = rows[0].length;
  const out: string[] = [];
  for (let r = 0; r < w; r++) {
    let line = '';
    for (let c = 0; c < d; c++) line += rows[d - 1 - c][r];
    out.push(line);
  }
  return out;
}

const COMPASS = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];

/** A name for a building that isn't taken yet (`used` collects them). */
export function poiName(kind: PoiKind, x: number, z: number, rng: Rng, used: Set<string>): string {
  const names = BLUEPRINTS[kind].names;
  const first = Math.floor(rng.next() * names.length);
  for (let i = 0; i < names.length; i++) {
    const name = names[(first + i) % names.length];
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Every name of this kind is taken: tell them apart by where they stand (north is -Z).
  const side = COMPASS[Math.round(((Math.atan2(x, -z) / (Math.PI * 2)) * 8 + 8)) % 8];
  let name = `${side} ${names[first]}`;
  for (let k = 2; used.has(name); k++) name = `${side} ${names[first]} ${k}`;
  used.add(name);
  return name;
}

/** What turns up inside a building: its pieces (ids from `nextId` on) and its crates. */
export interface PoiContents {
  pieces: Piece[];
  crates: { x: number; z: number; loot: Loot }[];
}

const WALLISH = 'WGD';

/**
 * Builds a planned building out of pieces: walls and gates on the plan (some collapsed altogether), 1–2
 * beds and maybe a workbench, storage or campfire on the floor, and 1–3 crates. Most of it is ruined
 * (rubble, repairable) or damaged: `decay` from about 0.45 to 0.95 per building.
 */
export function buildPoi(plan: PoiPlan, poi: number, nextId: number, rng: Rng): PoiContents {
  const bp = BLUEPRINTS[plan.kind];
  const { rows, w, d } = plan;
  const decay = rng.range(0.45, 0.95);
  const tier = bp.tiers[Math.floor(rng.next() * bp.tiers.length)];
  const pieces: Piece[] = [];
  const at = (r: number, c: number) => (r >= 0 && r < d && c >= 0 && c < w ? rows[r][c] : ' ');
  const taken = new Set<number>();
  const key = (r: number, c: number) => r * w + c;

  const add = (kind: PieceKind, t: Tier, r: number, c: number, rot: Rot, structural: boolean) => {
    const max = PIECES[kind].hp[t] ?? PIECES[kind].hp[0];
    const roll = rng.next();
    // Walls and gates: mostly rubble; furniture lasts a little better.
    const ruinedShare = structural ? decay * 0.75 : decay * 0.5;
    const ruined = roll < ruinedShare;
    const damaged = !ruined && roll < ruinedShare + (1 - ruinedShare) * 0.7;
    pieces.push({
      id: nextId + pieces.length,
      kind,
      tier: t,
      gx: plan.gx + c,
      gz: plan.gz + r,
      rot,
      hp: ruined ? 0 : damaged ? Math.max(1, Math.round(max * rng.range(0.2, 0.75))) : max,
      ruined,
      poi,
      owner: '',
    });
    taken.add(key(r, c));
  };

  // The outline: rot follows the side a piece is on (0 faces south, then clockwise: west, north, east).
  for (let r = 0; r < d; r++) {
    for (let c = 0; c < w; c++) {
      const ch = rows[r][c];
      if (ch === 'W' || ch === 'G') {
        // A few wall tiles have collapsed altogether: holes to climb through.
        if (ch === 'W' && rng.next() < decay * 0.12) continue;
        add(ch === 'W' ? 'wall' : 'gate', tier, r, c, sideRot(r, c, w, d, WALLISH.includes(at(r, c - 1)) || WALLISH.includes(at(r, c + 1))), true);
      } else if (ch === 'L') {
        add('lookout', 0, r, c, plan.turn, false);
      } else if (ch === 'F') {
        add('campfire', 0, r, c, 0, false);
      }
    }
  }

  // Floor tiles, keeping the way in clear: nothing right inside a doorway or a gate.
  const nearDoor = (r: number, c: number) => {
    for (const [dr, dc] of NEIGHBOURS) {
      const ch = at(r + dr, c + dc);
      if (ch === 'D' || ch === 'G') return true;
    }
    return false;
  };
  const floor: [number, number][] = [];
  for (let r = 0; r < d; r++) {
    for (let c = 0; c < w; c++) if (rows[r][c] === '.' && !nearDoor(r, c)) floor.push([r, c]);
  }
  shuffle(floor, rng);
  // Furniture stands against the walls, crates anywhere.
  const againstWall = (r: number, c: number) => NEIGHBOURS.some(([dr, dc]) => at(r + dr, c + dc) === 'W');
  const furnitureSpots = [...floor.filter(([r, c]) => againstWall(r, c)), ...floor.filter(([r, c]) => !againstWall(r, c))];
  const place = (kind: PieceKind) => {
    const spot = furnitureSpots.find(([r, c]) => !taken.has(key(r, c)));
    if (spot) add(kind, 0, spot[0], spot[1], Math.floor(rng.next() * 4) as Rot, false);
  };
  const beds = bp.beds[0] + Math.floor(rng.next() * (bp.beds[1] - bp.beds[0] + 1));
  for (let i = 0; i < beds; i++) place('bed');
  if (rng.next() < bp.workbench) place('workbench');
  if (rng.next() < bp.storage) place('storage');
  if (rng.next() < bp.campfire) {
    // Big buildings have their fire inside; small ones out in front of the door.
    if (w * d >= 60) place('campfire');
    else {
      const door = doorTile(rows);
      if (door) {
        // Two tiles out: a step in front of the door stays free.
        const [or, oc] = OUTWARD[plan.turn];
        add('campfire', 0, door[0] + or * 2, door[1] + oc * 2, 0, false);
      }
    }
  }

  const crates: PoiContents['crates'] = [];
  const crateCount = bp.crates[0] + Math.floor(rng.next() * (bp.crates[1] - bp.crates[0] + 1));
  for (const [r, c] of floor) {
    if (crates.length >= crateCount) break;
    if (taken.has(key(r, c))) continue;
    taken.add(key(r, c));
    crates.push({ x: (plan.gx + c + 0.5) * OPEN.tile, z: (plan.gz + r + 0.5) * OPEN.tile, loot: rollLoot(plan.kind, bp, rng) });
  }
  return { pieces, crates };
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** One step out of the door, as [row, column], by turn (the door faces south, west, north, east). */
const OUTWARD: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
];

function doorTile(rows: readonly string[]): [number, number] | null {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].search(/[DG]/);
    if (c >= 0) return [r, c];
  }
  return null;
}

/** Facing of an outline piece: outwards on the building's sides; inner walls by the way they run. */
function sideRot(r: number, c: number, w: number, d: number, runsEastWest: boolean): Rot {
  if (r === d - 1) return 0;
  if (r === 0) return 2;
  if (c === 0) return 1;
  if (c === w - 1) return 3;
  return runsEastWest ? 0 : 1;
}

function shuffle<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const k = Math.floor(rng.next() * (i + 1));
    [items[i], items[k]] = [items[k], items[i]];
  }
}

/** Weapons by kind of building: towers keep javelins, outposts axes. */
const WEAPONS: Record<PoiKind, readonly WeaponType[]> = {
  cabin: ['axe', 'knife', 'javelin'],
  shed: ['axe', 'knife', 'knife'],
  barn: ['axe', 'knife', 'javelin'],
  farmhouse: ['knife', 'axe', 'javelin'],
  watchtower: ['javelin', 'javelin', 'knife'],
  outpost: ['axe', 'javelin', 'axe', 'knife'],
  chapel: ['knife', 'javelin', 'axe'],
};

/** A crate's contents: always some scrap, often building stuff or food, now and then firecrackers or a weapon. */
function rollLoot(kind: PoiKind, bp: Blueprint, rng: Rng): Loot {
  const res: Cost = { scrap: 1 + Math.floor(rng.next() * 3) };
  const amount = (min: number, max: number) => min + Math.floor(rng.next() * (max - min + 1));
  switch (kind) {
    case 'barn':
    case 'farmhouse':
      if (rng.next() < 0.6) res.bamboo = amount(3, 7);
      else res.wood = amount(3, 6);
      break;
    case 'outpost':
    case 'watchtower':
      res.scrap = (res.scrap ?? 0) + 2;
      if (rng.next() < 0.4) res.stone = amount(2, 5);
      break;
    case 'shed':
      if (rng.next() < 0.5) res.wood = amount(2, 5);
      else res.bamboo = amount(2, 5);
      break;
    case 'cabin':
      if (rng.next() < 0.5) res.wood = amount(2, 4);
      break;
    case 'chapel':
      break;
  }
  const loot: Loot = { res };
  if (rng.next() < bp.food) loot.food = amount(20, 40);
  if (rng.next() < 0.3) loot.crackers = rng.next() < 0.35 ? 2 : 1;
  if (rng.next() < bp.weapon) loot.weapon = rng.pick(WEAPONS[kind]);
  return loot;
}
