import { CRACKER, JAVELIN, SIM_DT, SIM_HZ, SURVIVOR } from '../../config';
import type { Survivor, Zombie } from '../entities';
import type { GameMap } from '../gameMap';
import type { PlayerSpec } from '../types';
import { hasJavelins } from '../weapons';
import { WorldClock } from './clock';
import { chunkOf, OPEN, PIECES, RECIPES, tileCenter, tileOf } from './config';
import {
  addResources,
  bagResources,
  copyResources,
  drainHunger,
  feed,
  fillPack,
  gatherPerHit,
  moveAll,
  packRoom,
  packTotal,
  pay,
  recipeBlocked,
} from './economy';
import { createHordeDirector } from './hordes';
import { isBotSeat } from './save';
import {
  canPlace,
  IN_THE_WAY,
  isPlayers,
  isSolid,
  maxHp,
  placeCost,
  refundFor,
  repairCost,
  StructureStore,
  upgradeCost,
  type BaseCluster,
} from './structures';
import {
  emptyResources,
  RESOURCE_KINDS,
  type Cost,
  type HordeDirectorApi,
  type HordeSnap,
  type LootBag,
  type OpenCommand,
  type OpenHost,
  type OpenRulesApi,
  type OpenSnap,
  type OpenSurvivorSnap,
  type OpenView,
  type OpenWorldData,
  type Piece,
  type PieceKind,
  type PlayerSave,
  type RecipeId,
  type ResourceNode,
  type Resources,
  type Rot,
  type ThreatContext,
  type Tier,
  type WorldJoin,
  type WorldSave,
} from './types';

/** Walk this close to a bed (its middle) to make it yours. */
const BED_CLAIM = 1.6;
/** Bots only claim beds this far past the edge of the main base (so following a player around doesn't move theirs). */
const BOT_BED_PAD = 2;
/** "Your pack is full" over a bag that won't go in: at most this often per panda (ticks). */
const PACK_FULL_EVERY = 2 * SIM_HZ;
/** Where pandas appear at the camp, in turn (metres east, south of its middle). */
const CAMP_SPOTS: readonly [number, number][] = [
  [0, 0],
  [1.4, 1.2],
  [-1.4, 1.2],
  [1.4, -1.2],
  [-1.4, -1.2],
  [2.8, 0],
  [-2.8, 0],
];
/** Points ahead of a walking zombie checked for a piece in its way. */
const AHEAD: readonly number[] = [0.6, 0.95, 1.3];
/** Biggest node radius, so a swing looks into every chunk a node in reach could be listed in. */
const NODE_R_MAX = 3;
/** Siege scrap lands in a world bag already lying this close instead of a new one. */
const SCRAP_MERGE = 3;
/** World bags (siege scrap, crate spill) beyond this many: the oldest goes. Pandas' own bags always stay. */
const MAX_BAGS = 150;
/** Pickups, deposits and beds are checked every this many ticks (15 per second is plenty for walking). */
const LOOT_EVERY = 4;
/** The leash warning list and the visible hordes are refreshed this often (ticks). */
const LEASH_EVERY = 15;
const HORDES_EVERY = 10;
/** Regrowth is counted in steps this long (s). */
const REGROW_STEP = 0.5;
/** Hunger has to climb this far back above OPEN.hungryAt before the next 'hungry' nag. */
const HUNGRY_RESET = 5;

/** Network and save numbers: 10 cm / 0.1 s is plenty. */
const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/**
 * Saves keep bot seats by id (whoever plays one right now: a guest may have taken it over) and humans by
 * nickname (they come back under it). A nickname that looks like a seat id gets a '~', so it can't take a bot's entry.
 */
const keyOf = (spec: PlayerSpec) => (isBotSeat(spec.id) ? spec.id : isBotSeat(spec.name) ? `~${spec.name}` : spec.name);
/** Tenths of full health, so a piece event goes out when a bite crosses one, not on every bite. */
const hpBand = (hp: number, max: number) => Math.ceil((hp / max) * 10);
const copyBag = (b: LootBag): LootBag => ({ ...b, res: copyResources(b.res) });
const isHuman = (s: Survivor) => !s.spec.bot && !s.npc && (s.state === 'active' || s.state === 'downed');
const NO_RESOURCES: Readonly<Resources> = Object.freeze(emptyResources());

/** What the rules keep about each panda in the world (by survivor id). */
interface PandaState {
  hunger: number;
  pack: Resources;
  /** Bed piece they respawn at, or -1. */
  bed: number;
  /** Told they're hungry (until they've eaten again). */
  warned: boolean;
  /** Tick they were last told their pack is too full for a bag. */
  fullAt: number;
  /** A bot seat's own bot name (kept for the save while a guest plays it under theirs); null for everyone else. */
  botName: string | null;
}

interface NodeState {
  left: number;
  /** Seconds until it's full again. */
  regrow: number;
}

/** The horde director's window on the world: the clock and the bases, read live. */
class Threats implements ThreatContext {
  constructor(
    private readonly clk: WorldClock,
    private readonly store: StructureStore,
  ) {}

  get clock(): number {
    return this.clk.total;
  }

  get day(): number {
    return this.clk.day;
  }

  get time(): number {
    return this.clk.time;
  }

  get night(): boolean {
    return this.clk.night;
  }

  bases(): BaseCluster[] {
    return this.store.bases();
  }

  lookouts(): { x: number; z: number }[] {
    return this.store.lookouts();
  }

  /** Standing campfires: ambient zombies don't appear in their light at night (hordes.ts asks if it's there). */
  campfires(): { x: number; z: number }[] {
    return this.store.campfires();
  }
}

/**
 * Infinite mode's rules inside the simulation (like Mission for story mode): the clock, hunger, packs and the
 * stash, building, gathering, crates and bags, beds and respawning, the leash, and the horde director.
 * Every change to the world itself goes out as an event (piece / unpiece / node / crate / bag / unbag), so each
 * client's WorldMirror stays in step; join() hands a newcomer the whole current state.
 */
export class OpenRules implements OpenRulesApi {
  readonly view: OpenView;
  private readonly map: GameMap;
  private readonly world: OpenWorldData;
  /** The save this run started from: the world's name, slot, difficulty… and its play time so far. */
  private readonly loaded: WorldSave;
  private readonly clock: WorldClock;
  private readonly store: StructureStore;
  private readonly director: HordeDirectorApi;
  private readonly threats: Threats;
  private host: OpenHost | null = null;
  private readonly pandas = new Map<string, PandaState>();
  /** Saved pandas (humans by nickname, bot seats by id: see keyOf), including the ones not in the world right now. */
  private readonly players: Record<string, PlayerSave> = {};
  private readonly nodes = new Map<number, NodeState>();
  private readonly crates = new Set<number>();
  private readonly bags = new Map<number, LootBag>();
  private nextBagId: number;
  private readonly stash: Resources;
  private kills: number;
  private bestDay: number;
  private startTicks = 0;
  private lastDay: number;
  private wasNight: boolean;
  private spikeT = 0;
  private regrowT = 0;
  private campTurn = 0;
  private hordesAt = -Infinity;
  private visible: HordeSnap[] = [];
  private leashed: string[] = [];
  private readonly leashOut = { mx: 0, mz: 0 };

  constructor(map: GameMap, save: WorldSave) {
    const world = map.open;
    if (!world) throw new Error('OpenRules needs the open world');
    if (save.seed !== world.seed) throw new Error('This save belongs to another world');
    this.map = map;
    this.world = world;
    this.loaded = save;
    this.clock = new WorldClock(save.clock);
    this.store = new StructureStore(save.pieces, save.nextPieceId);
    for (const [id, left, regrow] of save.nodes) {
      if (world.nodes[id]) this.nodes.set(id, { left, regrow });
    }
    for (const id of save.crates) this.crates.add(id);
    for (const b of save.bags) this.bags.set(b.id, copyBag(b));
    this.nextBagId = save.nextBagId;
    this.stash = copyResources(save.stash);
    for (const [k, p] of Object.entries(save.players)) this.players[k] = { ...p, pack: copyResources(p.pack) };
    this.kills = save.kills;
    this.bestDay = Math.max(save.bestDay, this.clock.day);
    this.lastDay = this.clock.day;
    this.wasNight = this.clock.night;
    this.director = createHordeDirector(
      world.seed,
      save.difficulty,
      { hordes: save.hordes, nextSiege: save.nextSiege, sieges: save.sieges },
      this.clock.total,
    );
    this.threats = new Threats(this.clock, this.store);

    // Bots' view. Getters can't be arrows, so they read through locals.
    const clock = this.clock;
    const director = this.director;
    const store = this.store;
    const pandas = this.pandas;
    this.view = {
      world,
      get night() {
        return clock.night;
      },
      get siege() {
        return director.siege;
      },
      stash: this.stash,
      pieceAt: store.at,
      piecesNear: (x, z, r) => store.near(x, z, r),
      nodeLeft: (id) => this.nodeLeft(id),
      base: () => {
        const b = store.bases()[0];
        return b ? { x: b.x, z: b.z, r: b.r } : null;
      },
      pack: (id) => pandas.get(id)?.pack ?? NO_RESOURCES,
      hunger: (id) => pandas.get(id)?.hunger ?? OPEN.hungerMax,
    };
  }

  // ================================================================ setup and pandas

  init(host: OpenHost): void {
    this.host = host;
    this.startTicks = host.ticks;
    this.store.attach(host);
  }

  spawnPoint(spec: PlayerSpec): { x: number; z: number } {
    const saved = this.players[keyOf(spec)];
    if (saved) {
      const p = this.freeSpot(saved.x, saved.z);
      if (p) return p;
    }
    return this.campSpot();
  }

  initSurvivor(s: Survivor): void {
    const st = freshState();
    const saved = this.players[keyOf(s.spec)];
    // Remembered while the seat is still the bot's (it always is here; the save's name if a guest already has it).
    if (isBotSeat(s.spec.id)) st.botName = !s.spec.bot && saved && saved.bot ? saved.name : s.spec.name;
    if (saved) {
      st.hunger = clamp(saved.hunger, 0, OPEN.hungerMax);
      st.pack = copyResources(saved.pack);
      const bed = this.store.get(saved.bed);
      st.bed = bed && bed.kind === 'bed' ? bed.id : -1;
      // One owner per bed: if a panda in the world holds it now, it stays theirs.
      for (const [id, o] of this.pandas) {
        if (id !== s.spec.id && st.bed >= 0 && o.bed === st.bed) st.bed = -1;
      }
      s.hp = clamp(saved.hp, 1, SURVIVOR.maxHp);
      // The main weapon is whatever they picked in the menu this time; the extra slot is what they carried.
      s.extra = saved.extra && saved.extra !== s.main ? saved.extra : null;
      s.weapon = saved.hand === 'extra' && s.extra ? s.extra : s.main;
      const hadJavelins = saved.weapon === 'javelin' || saved.extra === 'javelin';
      s.ammo = !hasJavelins(s) ? 0 : hadJavelins ? clamp(saved.ammo, 0, JAVELIN.ammo) : JAVELIN.ammo;
      s.crackers = clamp(saved.crackers, 0, CRACKER.max);
      s.kills = saved.kills;
    }
    this.pandas.set(s.spec.id, st);
  }

  forgetSurvivor(s: Survivor): void {
    if (!s.npc) this.players[keyOf(s.spec)] = this.playerSave(s, this.state(s));
    this.pandas.delete(s.spec.id);
  }

  speedMul(s: Survivor): number {
    return this.state(s).hunger < OPEN.hungryAt ? OPEN.slowWhenHungry : 1;
  }

  /** With 2+ humans, a human at the leash can't move further away from the nearest other one (bots don't count). */
  leash(s: Survivor, mx: number, mz: number): { mx: number; mz: number } {
    const out = this.leashOut;
    out.mx = mx;
    out.mz = mz;
    if (s.spec.bot || s.npc) return out;
    const o = this.nearestHuman(s);
    if (!o) return out;
    const dx = s.x - o.x;
    const dz = s.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d < OPEN.leash) return out;
    const ax = dx / d;
    const az = dz / d;
    const away = mx * ax + mz * az;
    if (away > 0) {
      out.mx = mx - ax * away;
      out.mz = mz - az * away;
    }
    return out;
  }

  bleedTime(_s: Survivor, someoneElseActive: boolean): number {
    return someoneElseActive ? OPEN.bleedTime : OPEN.aloneBleedTime;
  }

  /** Nobody came in time: the pack stays behind as a bag, and the panda gets up at their bed (else the camp). */
  bledOut(host: OpenHost, s: Survivor): void {
    const st = this.state(s);
    if (packTotal(st.pack) > 0) {
      this.dropBag(host, s.x, s.z, st.pack, 0, s.spec.name);
      for (const k of RESOURCE_KINDS) st.pack[k] = 0;
    }
    const at = this.respawnSpot(st);
    host.respawnSurvivor(s, at.x, at.z, OPEN.respawnHp);
    st.hunger = OPEN.respawnHunger;
    st.warned = false;
    host.emit({ e: 'respawn', id: s.spec.id });
  }

  wantsFood(s: Survivor): boolean {
    return this.state(s).hunger <= OPEN.hungerMax - OPEN.bambooFood;
  }

  ate(s: Survivor): void {
    const st = this.state(s);
    st.hunger = feed(st.hunger, OPEN.bambooFood);
  }

  // ================================================================ every tick

  preStep(host: OpenHost): void {
    const clock = this.clock;
    clock.step(SIM_DT);
    const day = clock.day;
    if (day !== this.lastDay) {
      this.lastDay = day;
      if (day > this.bestDay) this.bestDay = day;
      host.emit({ e: 'dawn', day });
    }
    const night = clock.night;
    if (night && !this.wasNight) host.emit({ e: 'dusk' });
    this.wasNight = night;

    this.hunger(host);
    this.director.step(host, this.threats);

    this.spikeT -= SIM_DT;
    if (this.spikeT <= 0) {
      this.spikeT += OPEN.spikes.every;
      this.spikes(host);
    }
    this.regrowT -= SIM_DT;
    if (this.regrowT <= 0) {
      this.regrowT += REGROW_STEP;
      this.regrow(host, REGROW_STEP);
    }
  }

  postStep(host: OpenHost): void {
    if (host.ticks % LOOT_EVERY === 0) {
      for (const s of host.survivors) {
        if (s.state !== 'active') continue;
        const st = this.state(s);
        this.lootCrates(host, s, st);
        this.lootBags(host, s, st);
        this.deposit(host, s, st);
        this.claimBed(host, s, st);
      }
    }
    if (host.ticks % LEASH_EVERY === 0) this.updateLeash(host);
  }

  private hunger(host: OpenHost): void {
    for (const s of host.survivors) {
      if (s.state !== 'active') continue;
      const st = this.state(s);
      st.hunger = drainHunger(st.hunger, SIM_DT);
      if (st.hunger < OPEN.hungryAt) {
        if (!st.warned) {
          st.warned = true;
          host.emit({ e: 'hungry', id: s.spec.id });
        }
      } else if (st.hunger > OPEN.hungryAt + HUNGRY_RESET) {
        st.warned = false;
      }
      // Starving hurts, but never kills: it stops at the floor.
      if (st.hunger <= 0 && s.hp > OPEN.starveFloor) s.hp = Math.max(OPEN.starveFloor, s.hp - OPEN.starveDamage * SIM_DT);
    }
  }

  /** Every OPEN.spikes.every seconds: each zombie standing on spikes gets hurt, and the spikes wear. */
  private spikes(host: OpenHost): void {
    if (this.store.ofKind('spikes').size === 0) return;
    for (const z of host.zombies) {
      if (z.state === 'dying' || !z.body) continue;
      const p = this.store.at(tileOf(z.x), tileOf(z.z));
      if (!p || p.kind !== 'spikes' || p.ruined) continue;
      host.hurtZombie(z, OPEN.spikes.damage);
      this.wear(host, p, OPEN.spikes.wear, false);
    }
  }

  private regrow(host: OpenHost, dt: number): void {
    for (const [id, n] of this.nodes) {
      n.regrow -= dt;
      if (n.regrow > 0) continue;
      this.nodes.delete(id);
      host.emit({ e: 'node', id, left: this.world.nodes[id].amount });
    }
  }

  private lootCrates(host: OpenHost, s: Survivor, st: PandaState): void {
    const r = OPEN.lootRadius;
    const cx1 = chunkOf(s.x + r);
    const cz1 = chunkOf(s.z + r);
    for (let j = chunkOf(s.z - r); j <= cz1; j++) {
      for (let i = chunkOf(s.x - r); i <= cx1; i++) {
        for (const id of this.world.chunkContents(i, j).crates) {
          if (this.crates.has(id)) continue;
          const c = this.world.crates[id];
          if (c && Math.hypot(c.x - s.x, c.z - s.z) <= r) this.openCrate(host, s, st, c.id);
        }
      }
    }
  }

  /** Everything in the crate goes to the panda; what doesn't fit (pack, firecrackers) is left in a bag there. */
  private openCrate(host: OpenHost, s: Survivor, st: PandaState, id: number): void {
    const c = this.world.crates[id];
    this.crates.add(id);
    const loot = c.loot;
    const left = fillPack(st.pack, loot.res);
    let crackers = loot.crackers ?? 0;
    const take = Math.max(0, Math.min(crackers, CRACKER.max - s.crackers));
    s.crackers += take;
    crackers -= take;
    if (loot.weapon) host.giveWeapon(s, loot.weapon);
    if (loot.food) st.hunger = feed(st.hunger, loot.food);
    host.emit({ e: 'crate', id, by: s.spec.id });
    if (left || crackers > 0) this.dropBag(host, c.x, c.z, left ?? {}, crackers, '');
  }

  /**
   * A bag gives what fits in the pack, and firecrackers up to the cap; the rest stays in it. When nothing
   * would go in, the panda hears their pack is full (now and then, not on every check).
   */
  private lootBags(host: OpenHost, s: Survivor, st: PandaState): void {
    if (!this.bags.size) return;
    const r = OPEN.lootRadius;
    let full = false;
    for (const b of this.bags.values()) {
      if (Math.abs(b.x - s.x) > r || Math.abs(b.z - s.z) > r || Math.hypot(b.x - s.x, b.z - s.z) > r) continue;
      const before = packTotal(b.res);
      if (before > 0) {
        const left = fillPack(st.pack, b.res);
        for (const k of RESOURCE_KINDS) b.res[k] = left?.[k] ?? 0;
      }
      const took = before - packTotal(b.res);
      const crackers = Math.max(0, Math.min(b.crackers, CRACKER.max - s.crackers));
      s.crackers += crackers;
      b.crackers -= crackers;
      if (took <= 0 && crackers <= 0) {
        if (before > 0) full = true;
        continue;
      }
      if (b.crackers > 0 || packTotal(b.res) > 0) {
        host.emit({ e: 'bag', b: copyBag(b) });
      } else {
        this.bags.delete(b.id);
        host.emit({ e: 'unbag', id: b.id, by: s.spec.id });
      }
      return; // one a check is plenty
    }
    if (full && host.ticks - st.fullAt >= PACK_FULL_EVERY) {
      st.fullAt = host.ticks;
      host.emit({ e: 'deny', id: s.spec.id, why: 'Your pack is full' });
    }
  }

  private deposit(host: OpenHost, s: Survivor, st: PandaState): void {
    if (packTotal(st.pack) === 0) return;
    if (!this.store.nearestStanding('storage', s.x, s.z, OPEN.depositRadius)) return;
    if (moveAll(st.pack, this.stash)) host.emit({ e: 'deposit', id: s.spec.id });
  }

  /**
   * Beds are personal: one another panda has claimed stays theirs, here or away (but a player may take a bot's).
   * Only the players' beds can be claimed (not the abandoned buildings' own, until someone repairs one), and bots
   * only claim beds at the main base.
   */
  private claimBed(host: OpenHost, s: Survivor, st: PandaState): void {
    const bed = this.store.nearestStanding('bed', s.x, s.z, BED_CLAIM, isPlayers);
    if (!bed || bed.id === st.bed) return;
    if (s.spec.bot) {
      const base = this.store.bases()[0];
      if (!base || Math.hypot(tileCenter(bed.gx) - base.x, tileCenter(bed.gz) - base.z) > base.r + BOT_BED_PAD) return;
    }
    const mayTake = !s.spec.bot;
    for (const o of host.survivors) {
      if (o === s) continue;
      const os = this.pandas.get(o.spec.id);
      if (os && os.bed === bed.id && !(mayTake && o.spec.bot)) return;
    }
    // Pandas away from the world keep theirs too (their saved entry; a bot seat's only against a player).
    const away: PlayerSave[] = [];
    for (const [k, p] of Object.entries(this.players)) {
      if (p.bed !== bed.id || host.survivors.some((o) => !o.npc && keyOf(o.spec) === k)) continue;
      if (!(mayTake && p.bot)) return;
      away.push(p);
    }
    for (const o of host.survivors) {
      const os = o === s ? undefined : this.pandas.get(o.spec.id);
      if (os && os.bed === bed.id) os.bed = -1;
    }
    for (const p of away) p.bed = -1;
    st.bed = bed.id;
    host.emit({ e: 'bed', id: s.spec.id, bed: bed.id });
  }

  private updateLeash(host: OpenHost): void {
    let humans = 0;
    for (const s of host.survivors) if (isHuman(s)) humans++;
    if (humans < 2) {
      if (this.leashed.length) this.leashed = [];
      return;
    }
    const list: string[] = [];
    for (const s of host.survivors) {
      if (!isHuman(s)) continue;
      const o = this.nearestHuman(s);
      if (o && Math.hypot(o.x - s.x, o.z - s.z) > OPEN.leashWarn) list.push(s.spec.id);
    }
    this.leashed = list;
  }

  // ================================================================ fighting and building

  /** A swing that hit no zombie: the nearest node in reach and inside the arc gives a handful into the pack. */
  swing(host: OpenHost, s: Survivor, range: number, arc: number): void {
    const reach = range + NODE_R_MAX;
    let best: ResourceNode | null = null;
    let bestD = Infinity;
    const cx1 = chunkOf(s.x + reach);
    const cz1 = chunkOf(s.z + reach);
    for (let j = chunkOf(s.z - reach); j <= cz1; j++) {
      for (let i = chunkOf(s.x - reach); i <= cx1; i++) {
        for (const id of this.world.chunkContents(i, j).nodes) {
          const n = this.world.nodes[id];
          if (!n) continue;
          const dx = n.x - s.x;
          const dz = n.z - s.z;
          const d = Math.hypot(dx, dz);
          if (d > range + n.r || d >= bestD) continue;
          if (d > n.r) {
            // Inside the arc counts by the node's edge, not just its middle (big trunks, wide groves).
            const cos = (dx * s.faceX + dz * s.faceZ) / d;
            const off = Math.acos(clamp(cos, -1, 1));
            if (off > arc / 2 + Math.asin(Math.min(1, n.r / d))) continue;
          }
          if (this.nodeLeft(id) <= 0) continue;
          best = n;
          bestD = d;
        }
      }
    }
    if (!best) return;

    const st = this.state(s);
    if (packRoom(st.pack) <= 0) {
      host.emit({ e: 'deny', id: s.spec.id, why: 'Your pack is full' });
      return;
    }
    const left = this.nodeLeft(best.id);
    const n = Math.min(left, gatherPerHit(best.kind, s.weapon), packRoom(st.pack));
    st.pack[best.gives] += n;
    const now = left - n;
    const ns = this.nodes.get(best.id);
    if (ns) {
      ns.left = now;
      ns.regrow = OPEN.nodeRegrow;
    } else {
      this.nodes.set(best.id, { left: now, regrow: OPEN.nodeRegrow });
    }
    host.emit({ e: 'node', id: best.id, left: now });
    host.emit({ e: 'gather', id: s.spec.id, r: best.gives, n, x: r1(best.x), z: r1(best.z) });
    host.noise(s.x, s.z, OPEN.gatherNoise);
  }

  /** The solid piece 0.6–1.3 m ahead of a zombie walking (dirX, dirZ), if any (gates count: they stop zombies). */
  blockingPiece(z: Zombie, dirX: number, dirZ: number): Piece | null {
    for (let i = 0; i < AHEAD.length; i++) {
      const d = AHEAD[i];
      const p = this.store.at(tileOf(z.x + dirX * d), tileOf(z.z + dirZ * d));
      if (p && isSolid(p)) return p;
    }
    return null;
  }

  damagePiece(host: OpenHost, id: number, damage: number): void {
    const p = this.store.get(id);
    if (p) this.wear(host, p, damage, true);
  }

  onNoise(x: number, z: number, radius: number): void {
    this.director.onNoise(x, z, radius);
  }

  /** Killed, or fell out of the world (still has hp): the director hears of both, only a kill counts or drops scrap. */
  onZombieDeath(z: Zombie): void {
    this.director.onZombieDeath(z);
    if (z.hp > 0) return;
    this.kills++;
    if (z.siege && this.host && Math.random() < OPEN.siege.scrapChance) this.dropScrap(this.host, z.x, z.z);
  }

  ownsZombie(z: Zombie): boolean {
    return this.director.owns(z);
  }

  command(host: OpenHost, id: string, cmd: OpenCommand): void {
    const s = host.survivors.find((o) => o.spec.id === id);
    if (!s) return;
    const why = this.run(host, s, cmd);
    if (why) host.emit({ e: 'deny', id, why });
  }

  /** Carries out a command; the reason when it's refused, else null. */
  private run(host: OpenHost, s: Survivor, cmd: OpenCommand): string | null {
    if (s.state !== 'active') return "You can't do that now";
    const st = this.state(s);
    switch (cmd.c) {
      case 'place':
        return this.place(host, s, st, cmd.kind, cmd.gx, cmd.gz, cmd.rot);
      case 'upgrade':
        return this.upgrade(host, s, st, cmd.id);
      case 'repair':
        return this.repair(host, s, st, cmd.id);
      case 'demolish':
        return this.demolish(host, s, st, cmd.id);
      case 'craft':
        return this.craft(host, s, st, cmd.recipe);
      default:
        return 'Unknown command';
    }
  }

  private place(host: OpenHost, s: Survivor, st: PandaState, kind: PieceKind, gx: number, gz: number, rot: Rot): string | null {
    if (!PIECES[kind]) return 'Unknown piece';
    if (!Number.isInteger(gx) || !Number.isInteger(gz)) return 'Not here';
    const x = tileCenter(gx);
    const z = tileCenter(gz);
    if (Math.hypot(x - s.x, z - s.z) > OPEN.buildReach) return 'Too far away';
    const why = canPlace(this.map, this.store.at, kind, gx, gz);
    if (why) return why;
    if (this.occupied(host, gx, gz)) return IN_THE_WAY;
    if (!pay(st.pack, this.stashFor(s), placeCost(kind))) return 'Not enough materials';
    const p: Piece = {
      id: this.store.takeId(),
      kind,
      tier: 0,
      gx,
      gz,
      rot: (Number.isInteger(rot) ? rot & 3 : 0) as Rot,
      hp: maxHp(kind, 0),
      ruined: false,
      poi: -1,
      owner: s.spec.name,
    };
    this.store.add(p);
    this.emitPiece(host, p);
    host.emit({ e: 'built', id: s.spec.id, kind, how: 'place', x, z });
    return null;
  }

  private upgrade(host: OpenHost, s: Survivor, st: PandaState, id: number): string | null {
    const p = this.store.get(id);
    if (!p) return "It's gone";
    if (this.tooFar(s, p)) return 'Too far away';
    if (p.ruined) return 'Repair it first';
    const cost = upgradeCost(p);
    if (!cost) return PIECES[p.kind].upgrades.length ? 'Already as strong as it gets' : "That can't be upgraded";
    if (!pay(st.pack, this.stashFor(s), cost)) return 'Not enough materials';
    p.tier = (p.tier + 1) as Tier;
    p.hp = maxHp(p.kind, p.tier);
    // A world piece someone has put work into is theirs now (and counts towards bases, beds, lookouts…).
    if (p.owner === '') p.owner = s.spec.name;
    this.store.changed(p);
    this.emitPiece(host, p);
    host.emit({ e: 'built', id: s.spec.id, kind: p.kind, how: 'upgrade', x: tileCenter(p.gx), z: tileCenter(p.gz) });
    return null;
  }

  private repair(host: OpenHost, s: Survivor, st: PandaState, id: number): string | null {
    const p = this.store.get(id);
    if (!p) return "It's gone";
    if (this.tooFar(s, p)) return 'Too far away';
    const cost = repairCost(p);
    if (!cost) return "It's not damaged";
    // Rubble is passable: someone may be standing in it, and a body can't appear around them.
    if (p.ruined && PIECES[p.kind].blocks !== 'none' && this.occupied(host, p.gx, p.gz)) return IN_THE_WAY;
    if (!pay(st.pack, this.stashFor(s), cost)) return 'Not enough materials';
    p.hp = maxHp(p.kind, p.tier);
    p.ruined = false;
    if (p.owner === '') p.owner = s.spec.name;
    this.store.changed(p);
    this.emitPiece(host, p);
    host.emit({ e: 'built', id: s.spec.id, kind: p.kind, how: 'repair', x: tileCenter(p.gx), z: tileCenter(p.gz) });
    return null;
  }

  /** Your own pieces, the world's, and anyone's rubble; standing ones give back a share of their price. */
  private demolish(host: OpenHost, s: Survivor, st: PandaState, id: number): string | null {
    const p = this.store.get(id);
    if (!p) return "It's gone";
    if (this.tooFar(s, p)) return 'Too far away';
    if (!p.ruined && p.owner !== '' && p.owner !== s.spec.name) return "That's not yours";
    const refund = refundFor(p);
    this.store.remove(p.id);
    for (const o of this.pandas.values()) if (o.bed === p.id) o.bed = -1;
    for (const k of Object.keys(this.players)) if (this.players[k].bed === p.id) this.players[k].bed = -1;
    this.give(host, s, st, refund);
    host.emit({ e: 'unpiece', id: p.id });
    host.emit({ e: 'built', id: s.spec.id, kind: p.kind, how: 'demolish', x: tileCenter(p.gx), z: tileCenter(p.gz) });
    return null;
  }

  private craft(host: OpenHost, s: Survivor, st: PandaState, recipe: RecipeId): string | null {
    const def = RECIPES[recipe];
    if (!def) return 'Unknown recipe';
    if (!this.store.nearestStanding(def.station, s.x, s.z, OPEN.craftReach)) {
      return def.station === 'campfire' ? 'You need to be at a campfire' : 'You need to be at a workbench';
    }
    const blocked = recipeBlocked(def, s, st.hunger);
    if (blocked) return blocked;
    if (!pay(st.pack, this.stashFor(s), def.cost)) return 'Not enough materials';
    if (def.weapon) host.giveWeapon(s, def.weapon);
    if (def.crackers) s.crackers = Math.min(CRACKER.max, s.crackers + def.crackers);
    if (def.food) st.hunger = feed(st.hunger, def.food);
    if (def.heal) s.hp = Math.min(SURVIVOR.maxHp, s.hp + def.heal);
    host.emit({ e: 'crafted', id: s.spec.id, recipe: def.id });
    return null;
  }

  // ================================================================ snapshot, save, join

  snapshot(): OpenSnap {
    const host = this.host;
    const survivors: OpenSurvivorSnap[] = [];
    if (host) {
      for (const s of host.survivors) {
        const st = this.state(s);
        survivors.push({
          id: s.spec.id,
          hunger: Math.round(st.hunger),
          pack: copyResources(st.pack),
          respawn: s.state === 'downed' ? r1(Math.max(0, s.bleed)) : 0,
          bed: st.bed,
        });
      }
      // The list is replaced (never changed in place), so older snapshots can keep theirs.
      if (host.ticks - this.hordesAt >= HORDES_EVERY) {
        this.hordesAt = host.ticks;
        this.visible = this.director.visibleHordes(host, this.threats).map((h) => ({ x: r1(h.x), z: r1(h.z), n: Math.round(h.n) }));
      }
    }
    const sg = this.director.siege;
    return {
      day: this.clock.day,
      time: Math.round(this.clock.time * 1000) / 1000,
      night: this.clock.night,
      survivors,
      stash: copyResources(this.stash),
      siege: sg
        ? { x: r1(sg.x), z: r1(sg.z), tx: r1(sg.tx), tz: r1(sg.tz), eta: r1(Math.max(0, sg.eta)), size: Math.round(sg.size), base: sg.base }
        : null,
      hordes: this.visible,
      leash: this.leashed,
    };
  }

  save(host: OpenHost, now: number): WorldSave {
    const players: Record<string, PlayerSave> = {};
    for (const [k, p] of Object.entries(this.players)) players[k] = { ...p, pack: copyResources(p.pack) };
    for (const s of host.survivors) if (!s.npc) players[keyOf(s.spec)] = this.playerSave(s, this.state(s));
    const nodes: [number, number, number][] = [];
    for (const [id, n] of this.nodes) nodes.push([id, n.left, r1(n.regrow)]);
    const d = this.director.save();
    const w = this.loaded;
    return {
      v: 1,
      slot: w.slot,
      name: w.name,
      seed: this.world.seed,
      difficulty: w.difficulty,
      bots: w.bots,
      created: w.created,
      saved: now,
      played: r1(w.played + Math.max(0, host.ticks - this.startTicks) / SIM_HZ),
      clock: r1(this.clock.total),
      pieces: this.copyPieces(r1),
      nextPieceId: this.store.nextId,
      nodes,
      crates: [...this.crates],
      bags: [...this.bags.values()].map(copyBag),
      nextBagId: this.nextBagId,
      stash: copyResources(this.stash),
      players,
      hordes: d.hordes.map((h) => ({ x: r1(h.x), z: r1(h.z), n: h.n, hx: h.hx, hz: h.hz })),
      nextSiege: d.nextSiege,
      sieges: d.sieges,
      kills: this.kills,
      bestDay: Math.max(this.bestDay, this.clock.day),
    };
  }

  join(): WorldJoin {
    const nodes: [number, number][] = [];
    for (const [id, n] of this.nodes) nodes.push([id, n.left]);
    return {
      seed: this.world.seed,
      clock: r1(this.clock.total),
      pieces: this.copyPieces(Math.ceil),
      nodes,
      crates: [...this.crates],
      bags: [...this.bags.values()].map(copyBag),
    };
  }

  // ================================================================ helpers

  private state(s: Survivor): PandaState {
    let st = this.pandas.get(s.spec.id);
    if (!st) {
      st = freshState();
      this.pandas.set(s.spec.id, st);
    }
    return st;
  }

  private nodeLeft(id: number): number {
    const n = this.nodes.get(id);
    return n ? n.left : (this.world.nodes[id]?.amount ?? 0);
  }

  /** Damage to a piece: bites ('chomp') and spikes wearing. At 0 it's rubble; a 'piece' event per 10 % band. */
  private wear(host: OpenHost, p: Piece, damage: number, chomp: boolean): void {
    if (p.ruined || damage <= 0) return;
    const max = maxHp(p.kind, p.tier);
    const band = hpBand(p.hp, max);
    p.hp = Math.max(0, p.hp - damage);
    const x = tileCenter(p.gx);
    const z = tileCenter(p.gz);
    if (chomp) host.emit({ e: 'chomp', x, z });
    if (p.hp <= 0) {
      p.hp = 0;
      p.ruined = true;
      this.store.changed(p);
      host.emit({ e: 'smash', x, z });
      this.emitPiece(host, p);
    } else if (hpBand(p.hp, max) !== band) {
      this.emitPiece(host, p);
    }
  }

  /** A copy goes out (the piece keeps changing here), with whole hit points. */
  private emitPiece(host: OpenHost, p: Piece): void {
    host.emit({ e: 'piece', p: { ...p, hp: Math.ceil(p.hp) } });
  }

  private copyPieces(round: (v: number) => number): Piece[] {
    const out: Piece[] = [];
    for (const p of this.store.pieces.values()) out.push({ ...p, hp: round(p.hp) });
    return out;
  }

  private tooFar(s: Survivor, p: Piece): boolean {
    return Math.hypot(tileCenter(p.gx) - s.x, tileCenter(p.gz) - s.z) > OPEN.buildReach;
  }

  /** The team stash, when a standing storage chest is within reach of `s` (else null: the pack alone pays). */
  private stashFor(s: Survivor): Resources | null {
    return this.store.nearestStanding('storage', s.x, s.z, OPEN.stashReach) ? this.stash : null;
  }

  /** Someone (a panda or a zombie) is standing on tile (gx, gz). */
  private occupied(host: OpenHost, gx: number, gz: number): boolean {
    const x = tileCenter(gx);
    const z = tileCenter(gz);
    const lim = OPEN.tile / 2 + SURVIVOR.radius;
    for (const s of host.survivors) {
      if (s.body && Math.abs(s.x - x) < lim && Math.abs(s.z - z) < lim) return true;
    }
    for (const zb of host.zombies) {
      if (zb.state !== 'dying' && zb.body && Math.abs(zb.x - x) < lim && Math.abs(zb.z - z) < lim) return true;
    }
    return false;
  }

  /** Resources for a panda: the pack first, then the stash if a chest is in reach, else a bag at their feet. */
  private give(host: OpenHost, s: Survivor, st: PandaState, res: Cost): void {
    const left = fillPack(st.pack, res);
    if (!left) return;
    const stash = this.stashFor(s);
    if (stash) addResources(stash, left);
    else this.dropBag(host, s.x, s.z, left, 0, s.spec.name);
  }

  private dropBag(host: OpenHost, x: number, z: number, res: Cost, crackers: number, owner: string): void {
    const half = this.world.size / 2 - 2;
    const b: LootBag = {
      id: this.nextBagId++,
      x: r1(clamp(x, -half, half)),
      z: r1(clamp(z, -half, half)),
      res: bagResources(res),
      crackers: Math.max(0, Math.floor(crackers)),
      owner,
    };
    if (packTotal(b.res) === 0 && b.crackers === 0) return;
    this.bags.set(b.id, b);
    host.emit({ e: 'bag', b: copyBag(b) });
    if (this.bags.size > MAX_BAGS) {
      for (const old of this.bags.values()) {
        if (old.owner !== '' || old === b) continue;
        this.bags.delete(old.id);
        host.emit({ e: 'unbag', id: old.id, by: '' });
        break;
      }
    }
  }

  /** A siege zombie's scrap: into a world bag already lying close by, else a new one. */
  private dropScrap(host: OpenHost, x: number, z: number): void {
    for (const b of this.bags.values()) {
      if (b.owner !== '' || Math.hypot(b.x - x, b.z - z) > SCRAP_MERGE) continue;
      b.res.scrap++;
      host.emit({ e: 'bag', b: copyBag(b) });
      return;
    }
    this.dropBag(host, x, z, { scrap: 1 }, 0, '');
  }

  /** The nearest other human in the world (bots and story characters don't count), or null. */
  private nearestHuman(s: Survivor): Survivor | null {
    const host = this.host;
    if (!host) return null;
    let best: Survivor | null = null;
    let bestD = Infinity;
    for (const o of host.survivors) {
      if (o === s || !isHuman(o)) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Next spot at the camp (taking turns, so pandas don't land on each other). */
  private campSpot(): { x: number; z: number } {
    const sp = this.world.spawn;
    const [dx, dz] = CAMP_SPOTS[this.campTurn++ % CAMP_SPOTS.length];
    return { x: sp.x + dx, z: sp.z + dz };
  }

  private respawnSpot(st: PandaState): { x: number; z: number } {
    const bed = st.bed >= 0 ? this.store.get(st.bed) : undefined;
    if (bed && bed.kind === 'bed' && !bed.ruined) {
      const p = this.besideTile(bed.gx, bed.gz);
      if (p) return p;
    }
    return this.campSpot();
  }

  /** (x, z) itself when a panda can stand there, else the middle of a free tile next to it; null if neither. */
  private freeSpot(x: number, z: number): { x: number; z: number } | null {
    const half = this.world.size / 2 - 4;
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > half || Math.abs(z) > half) return null;
    // Not on a bridge either: the body would appear on the ground under the deck.
    const t = this.map.terrain;
    if (this.standable(tileOf(x), tileOf(z)) && !t.isWater(x, z) && !t.onBridge(x, z)) return { x, z };
    return this.besideTile(tileOf(x), tileOf(z));
  }

  /** The middle of a free, dry tile next to (gx, gz), off walls and bridges: the four sides first, then the corners. */
  private besideTile(gx: number, gz: number): { x: number; z: number } | null {
    const t = this.map.terrain;
    for (let k = 0; k < NEIGHBOURS.length; k += 2) {
      const tx = gx + NEIGHBOURS[k];
      const tz = gz + NEIGHBOURS[k + 1];
      const x = tileCenter(tx);
      const z = tileCenter(tz);
      if (this.standable(tx, tz) && !t.isWater(x, z) && !t.isWall(x, z) && !t.onBridge(x, z)) return { x, z };
    }
    return null;
  }

  private standable(gx: number, gz: number): boolean {
    const p = this.store.at(gx, gz);
    return !p || !isSolid(p);
  }

  private playerSave(s: Survivor, st: PandaState): PlayerSave {
    // Downed when the world is saved: they'll be back on their feet at their bed (keeping their pack).
    const down = s.state !== 'active';
    const at = down ? this.respawnSpot(st) : s;
    // A bot seat is saved as the bot's panda, under the bot's name, even while a guest plays it.
    const seat = isBotSeat(s.spec.id);
    return {
      name: seat ? (st.botName ?? s.spec.name) : s.spec.name,
      variant: s.spec.variant,
      weapon: s.main,
      bot: seat,
      x: r1(at.x),
      z: r1(at.z),
      hp: down ? OPEN.respawnHp : Math.max(1, Math.ceil(s.hp)),
      hunger: r1(st.hunger),
      pack: copyResources(st.pack),
      extra: s.extra,
      hand: s.extra && s.weapon === s.extra ? 'extra' : 'main',
      ammo: s.ammo,
      crackers: s.crackers,
      bed: st.bed,
      kills: s.kills,
    };
  }
}

/** Tile offsets next to a tile, as (dx, dz) pairs: sides, then corners. */
const NEIGHBOURS: readonly number[] = [0, 1, 1, 0, 0, -1, -1, 0, 1, 1, -1, 1, 1, -1, -1, -1];

function freshState(): PandaState {
  return { hunger: OPEN.hungerMax, pack: emptyResources(), bed: -1, warned: false, fullAt: -Infinity, botName: null };
}
