import type { GameMap } from '../gameMap';
import type { Circle } from '../mapLayout';
import { chunkOf, OPEN, PIECES, tileCenter } from './config';
import { RESOURCE_KINDS, type Cost, type OpenHost, type Piece, type PieceKind, type Resources, type Tier } from './types';

/**
 * Building pieces: the store the rules keep them in (with their physics bodies and steering circles),
 * and the pure price / placement helpers the simulation and the build UI share.
 */

/** Steering circle of a standing solid piece: a little more than half a tile, so walls read as one line. */
const OBSTACLE_R = 1.15;
/** Pieces stay this far inside the world's edge (the rim rises steeply there). */
const EDGE_MARGIN = 6;
/** Nothing gets built right on the camp where new pandas appear. */
const CAMP_KEEP = 4;
/** Highest minus lowest corner of a tile before it counts as a slope. */
const MAX_STEP = 0.9;
/** Footprint of a crate and of a snack spot when checking what's in the way. */
const CRATE_R = 0.6;
const SNACK_R = 0.5;
/** The refusal when a tree, rock, crate, panda… stands on the tile (the rules use it too). */
export const IN_THE_WAY = "Something's in the way";
/** Beds and storage chests closer than this to each other belong to the same base. */
const BASE_LINK = 20;
/** A base reaches this far past its outermost bed or chest. */
const BASE_PAD = 6;

/** Map key of a tile (tiles run -256..255 on a 1024 m world; this stays unique well past that). */
export function tileKey(gx: number, gz: number): number {
  return (gz + 1024) * 2048 + (gx + 1024);
}

/** Standing and in the way of someone: has a body and a steering circle. */
export function isSolid(p: Piece): boolean {
  return !p.ruined && PIECES[p.kind].blocks !== 'none';
}

export function maxHp(kind: PieceKind, tier: Tier): number {
  const hp = PIECES[kind].hp;
  return hp[Math.min(tier, hp.length - 1)];
}

/** What a fresh tier-0 piece costs. */
export function placeCost(kind: PieceKind): Cost {
  return { ...PIECES[kind].cost };
}

/**
 * Built or taken over by a player (repairing or upgrading a world piece makes it the repairer's): only these
 * make up bases, lookouts and campfires, and only such beds can be claimed. The abandoned buildings don't count.
 */
export function isPlayers(p: Piece): boolean {
  return p.poi < 0 || p.owner !== '';
}

/** Everything paid for a piece up to its tier (repairs and demolishing are priced from it). */
export function totalPrice(kind: PieceKind, tier: Tier): Cost {
  const def = PIECES[kind];
  const sum: Cost = { ...def.cost };
  for (let t = 0; t < tier && t < def.upgrades.length; t++) addCost(sum, def.upgrades[t]);
  return sum;
}

/** Price of the next tier, or null at the top tier (or for pieces that don't upgrade). */
export function upgradeCost(p: Piece): Cost | null {
  const next = PIECES[p.kind].upgrades[p.tier];
  return next ? { ...next } : null;
}

/**
 * Repairs cost a share of everything the piece is worth up to its tier, scaled by the damage (rubble: the full
 * share); null when unhurt. Rounded up, while refunds round the same total down, so repair + demolish never pays.
 */
export function repairCost(p: Piece): Cost | null {
  const max = maxHp(p.kind, p.tier);
  if (!p.ruined && p.hp >= max) return null;
  const frac = p.ruined ? 1 : Math.min(1, 1 - p.hp / max);
  return scaleCost(totalPrice(p.kind, p.tier), OPEN.repairShare * frac, Math.ceil);
}

/** What demolishing gives back: rubble nothing, a standing piece a share of what it cost. */
export function refundFor(p: Piece): Cost {
  return p.ruined ? {} : scaleCost(totalPrice(p.kind, p.tier), OPEN.refundShare, Math.floor);
}

export function canAfford(have: Resources, cost: Cost): boolean {
  for (const k of RESOURCE_KINDS) if ((cost[k] ?? 0) > have[k]) return false;
  return true;
}

/** `cost` × `share`, rounded per kind (kinds that round to 0 are left out). */
export function scaleCost(cost: Cost, share: number, round: (v: number) => number): Cost {
  const out: Cost = {};
  for (const k of RESOURCE_KINDS) {
    const v = cost[k];
    if (!v) continue;
    const n = round(v * share);
    if (n > 0) out[k] = n;
  }
  return out;
}

/** Adds `add` into `into` (in place). */
export function addCost(into: Cost, add: Cost): void {
  for (const k of RESOURCE_KINDS) {
    const v = add[k];
    if (v) into[k] = (into[k] ?? 0) + v;
  }
}

/** Does a circle overlap the tile centred on (cx, cz)? */
function hitsTile(x: number, z: number, r: number, cx: number, cz: number): boolean {
  const half = OPEN.tile / 2;
  const dx = Math.max(0, Math.abs(x - cx) - half);
  const dz = Math.max(0, Math.abs(z - cz) - half);
  return dx * dx + dz * dz < r * r;
}

/**
 * Can `kind` go on tile (gx, gz)? Null when it can, else a short reason for the player. Looks at the ground
 * and the world's own things (trees, rocks, nodes, crates, snacks); pandas and zombies standing there, reach
 * and the price are the rules' business. `kind` is there for rules that may differ by piece later.
 */
export function canPlace(
  map: GameMap,
  pieceAt: (gx: number, gz: number) => Piece | undefined,
  kind: PieceKind,
  gx: number,
  gz: number,
): string | null {
  const open = map.open;
  if (!open || !PIECES[kind] || !Number.isInteger(gx) || !Number.isInteger(gz)) return 'Not here';
  const cx = tileCenter(gx);
  const cz = tileCenter(gz);
  const edge = open.size / 2 - EDGE_MARGIN;
  if (Math.abs(cx) > edge || Math.abs(cz) > edge) return 'Too close to the edge';
  if (pieceAt(gx, gz)) return 'Tile taken';
  if (Math.hypot(cx - open.spawn.x, cz - open.spawn.z) < CAMP_KEEP + OPEN.tile / 2) return 'Too close to the camp';

  // The middle and the four corners (just inside the tile): dry, off ridges and bridges, not too steep.
  const t = map.terrain;
  const h = OPEN.tile / 2 - 0.1;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 5; i++) {
    const x = i === 0 ? cx : cx + (i & 1 ? h : -h);
    const z = i === 0 ? cz : cz + (i & 2 ? h : -h);
    if (t.isWet(x, z)) return 'In the water';
    if (t.isWall(x, z)) return 'Too steep';
    if (t.onBridge(x, z)) return IN_THE_WAY;
    const y = t.heightAt(x, z);
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  if (hi - lo > MAX_STEP) return 'Too steep';

  // Things standing there: every chunk the tile (plus the biggest tree or rock) could reach into.
  const { props } = map;
  const reach = OPEN.tile / 2 + 2;
  const cx0 = chunkOf(cx - reach);
  const cx1 = chunkOf(cx + reach);
  const cz0 = chunkOf(cz - reach);
  const cz1 = chunkOf(cz + reach);
  for (let j = cz0; j <= cz1; j++) {
    for (let i = cx0; i <= cx1; i++) {
      const c = open.chunkContents(i, j);
      for (const k of c.trees) {
        const tr = props.trees[k];
        if (tr && tr.collide && hitsTile(tr.x, tr.z, tr.radius + 0.1, cx, cz)) return IN_THE_WAY;
      }
      for (const k of c.rocks) {
        const r = props.rocks[k];
        if (r && r.radius > 0 && hitsTile(r.x, r.z, r.radius + 0.1, cx, cz)) return IN_THE_WAY;
      }
      for (const k of c.nodes) {
        const n = open.nodes[k];
        if (n && hitsTile(n.x, n.z, n.r, cx, cz)) return IN_THE_WAY;
      }
      for (const k of c.crates) {
        const cr = open.crates[k];
        if (cr && hitsTile(cr.x, cr.z, CRATE_R, cx, cz)) return IN_THE_WAY;
      }
      for (const k of c.bamboo) {
        const b = props.bambooSpots[k];
        if (b && hitsTile(b.x, b.z, SNACK_R, cx, cz)) return IN_THE_WAY;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- bases

export interface BaseCluster {
  x: number;
  z: number;
  r: number;
  beds: number;
  /** Beds plus chests. */
  size: number;
}

/**
 * Groups beds and storage chests into bases (anything within BASE_LINK of another member joins it),
 * biggest first. Used by the rules (siege targets, bots) and the mirror (HUD arrow), so both agree.
 */
export function clusterBases(pts: readonly { x: number; z: number; bed: boolean }[]): BaseCluster[] {
  const n = pts.length;
  const out: BaseCluster[] = [];
  if (!n) return out;
  const label = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  const members: number[] = [];
  for (let i = 0; i < n; i++) {
    if (label[i] >= 0) continue;
    label[i] = i;
    stack.push(i);
    members.length = 0;
    while (stack.length) {
      const k = stack.pop() as number;
      members.push(k);
      const a = pts[k];
      for (let j = 0; j < n; j++) {
        if (label[j] >= 0) continue;
        const b = pts[j];
        if (Math.hypot(a.x - b.x, a.z - b.z) < BASE_LINK) {
          label[j] = i;
          stack.push(j);
        }
      }
    }
    let sx = 0;
    let sz = 0;
    let beds = 0;
    for (const k of members) {
      sx += pts[k].x;
      sz += pts[k].z;
      if (pts[k].bed) beds++;
    }
    const x = sx / members.length;
    const z = sz / members.length;
    let r = 0;
    for (const k of members) r = Math.max(r, Math.hypot(pts[k].x - x, pts[k].z - z));
    out.push({ x, z, r: r + BASE_PAD, beds, size: members.length });
  }
  out.sort((a, b) => b.size - a.size || b.beds - a.beds);
  return out;
}

// ---------------------------------------------------------------- store

/**
 * Every piece in the world, by id and by tile, plus a set per kind (beds, chests, fires… are few, so the
 * rules loop over those instead of the walls). Once attached to the simulation it keeps a physics body and a
 * steering circle exactly for the standing solid pieces. It doesn't emit events: the rules do.
 */
export class StructureStore {
  nextId: number;
  private readonly byId = new Map<number, Piece>();
  private readonly byTile = new Map<number, Piece>();
  private readonly kinds: Record<PieceKind, Set<Piece>> = {
    wall: new Set(),
    gate: new Set(),
    spikes: new Set(),
    campfire: new Set(),
    workbench: new Set(),
    bed: new Set(),
    storage: new Set(),
    lookout: new Set(),
  };
  /** Body handle and steering circle of each standing solid piece (only while attached). */
  private readonly solid = new Map<number, { handle: number; circle: Circle }>();
  private host: OpenHost | null = null;
  /** Bumped when a bed, chest, lookout or campfire appears, goes, breaks or is repaired. */
  private layoutRev = 0;
  private cacheRev = -1;
  private basesCache: BaseCluster[] = [];
  private lookoutsCache: { x: number; z: number }[] = [];
  private campfiresCache: { x: number; z: number }[] = [];
  private readonly basePts: { x: number; z: number; bed: boolean }[] = [];

  /** `pieces` are copied, so the save they came from stays as it was. */
  constructor(pieces: readonly Piece[], nextId: number) {
    let top = OPEN.firstPlayerPieceId - 1;
    for (const p of pieces) {
      if (this.byId.has(p.id) || this.byTile.has(tileKey(p.gx, p.gz))) continue;
      this.insert({ ...p });
      top = Math.max(top, p.id);
    }
    this.nextId = Math.max(nextId, top + 1);
  }

  get pieces(): ReadonlyMap<number, Piece> {
    return this.byId;
  }

  get size(): number {
    return this.byId.size;
  }

  /** The piece on a tile (an arrow function, so it can be handed to canPlace as it is). */
  readonly at = (gx: number, gz: number): Piece | undefined => this.byTile.get(tileKey(gx, gz));

  get(id: number): Piece | undefined {
    return this.byId.get(id);
  }

  ofKind(kind: PieceKind): ReadonlySet<Piece> {
    return this.kinds[kind];
  }

  /** Builds bodies and steering circles for every standing solid piece (once, from OpenRules.init). */
  attach(host: OpenHost): void {
    this.host = host;
    for (const p of this.byId.values()) this.sync(p);
  }

  takeId(): number {
    return this.nextId++;
  }

  /** A new piece (its tile must be free). */
  add(p: Piece): void {
    this.insert(p);
    this.sync(p);
    if (isLandmark(p.kind)) this.layoutRev++;
  }

  /** After a piece broke, was repaired or upgraded: bodies follow its new state. */
  changed(p: Piece): void {
    this.sync(p);
    if (isLandmark(p.kind)) this.layoutRev++;
  }

  remove(id: number): Piece | undefined {
    const p = this.byId.get(id);
    if (!p) return undefined;
    this.unsync(p);
    this.byId.delete(id);
    this.byTile.delete(tileKey(p.gx, p.gz));
    this.kinds[p.kind].delete(p);
    if (isLandmark(p.kind)) this.layoutRev++;
    return p;
  }

  /** Pieces whose centre is within `r` of (x, z): by tile for small circles, else a pass over all of them. */
  near(x: number, z: number, r: number, out: Piece[] = []): Piece[] {
    out.length = 0;
    const tiles = Math.ceil(r / OPEN.tile) * 2 + 1;
    if (tiles * tiles < this.byId.size) {
      const g0x = Math.floor((x - r) / OPEN.tile);
      const g1x = Math.floor((x + r) / OPEN.tile);
      const g0z = Math.floor((z - r) / OPEN.tile);
      const g1z = Math.floor((z + r) / OPEN.tile);
      for (let gz = g0z; gz <= g1z; gz++) {
        for (let gx = g0x; gx <= g1x; gx++) {
          const p = this.byTile.get(tileKey(gx, gz));
          if (p && Math.hypot(tileCenter(gx) - x, tileCenter(gz) - z) <= r) out.push(p);
        }
      }
    } else {
      for (const p of this.byId.values()) {
        if (Math.hypot(tileCenter(p.gx) - x, tileCenter(p.gz) - z) <= r) out.push(p);
      }
    }
    return out;
  }

  /** The closest standing piece of a kind whose centre is within `r` of (x, z) (and that passes `ok`, if given). */
  nearestStanding(kind: PieceKind, x: number, z: number, r: number, ok?: (p: Piece) => boolean): Piece | null {
    let best: Piece | null = null;
    let bestD = r;
    for (const p of this.kinds[kind]) {
      if (p.ruined || (ok && !ok(p))) continue;
      const d = Math.hypot(tileCenter(p.gx) - x, tileCenter(p.gz) - z);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /**
   * Bases (clusters of the players' standing beds and chests: see isPlayers), biggest first. Cached until one
   * of those changes: don't modify.
   */
  bases(): BaseCluster[] {
    this.refresh();
    return this.basesCache;
  }

  /** The players' standing lookout towers (cached like bases). */
  lookouts(): { x: number; z: number }[] {
    this.refresh();
    return this.lookoutsCache;
  }

  /** The players' standing campfires, as tile centres (cached like bases). */
  campfires(): { x: number; z: number }[] {
    this.refresh();
    return this.campfiresCache;
  }

  private refresh(): void {
    if (this.cacheRev === this.layoutRev) return;
    this.cacheRev = this.layoutRev;
    const pts = this.basePts;
    pts.length = 0;
    for (const p of this.kinds.bed) if (counts(p)) pts.push({ x: tileCenter(p.gx), z: tileCenter(p.gz), bed: true });
    for (const p of this.kinds.storage) if (counts(p)) pts.push({ x: tileCenter(p.gx), z: tileCenter(p.gz), bed: false });
    this.basesCache = clusterBases(pts);
    const looks: { x: number; z: number }[] = [];
    for (const p of this.kinds.lookout) if (counts(p)) looks.push({ x: tileCenter(p.gx), z: tileCenter(p.gz) });
    this.lookoutsCache = looks;
    const fires: { x: number; z: number }[] = [];
    for (const p of this.kinds.campfire) if (counts(p)) fires.push({ x: tileCenter(p.gx), z: tileCenter(p.gz) });
    this.campfiresCache = fires;
  }

  private insert(p: Piece): void {
    this.byId.set(p.id, p);
    this.byTile.set(tileKey(p.gx, p.gz), p);
    this.kinds[p.kind].add(p);
  }

  /** Body and circle exist exactly while the piece is standing and solid. */
  private sync(p: Piece): void {
    const host = this.host;
    if (!host) return;
    const have = this.solid.get(p.id);
    if (isSolid(p)) {
      if (have) return;
      const circle: Circle = { x: tileCenter(p.gx), z: tileCenter(p.gz), r: OBSTACLE_R };
      const handle = host.addPieceBody(p);
      host.addObstacle(circle);
      this.solid.set(p.id, { handle, circle });
    } else if (have) {
      this.unsync(p);
    }
  }

  private unsync(p: Piece): void {
    const have = this.solid.get(p.id);
    if (!have || !this.host) return;
    if (have.handle >= 0) this.host.removePieceBody(have.handle);
    this.host.removeObstacle(have.circle);
    this.solid.delete(p.id);
  }
}

/** Kinds that make up bases, lookouts and campfires (the threat director's view of the world). */
function isLandmark(kind: PieceKind): boolean {
  return kind === 'bed' || kind === 'storage' || kind === 'lookout' || kind === 'campfire';
}

/** A landmark the threat director sees: standing, and the players'. */
function counts(p: Piece): boolean {
  return !p.ruined && isPlayers(p);
}
