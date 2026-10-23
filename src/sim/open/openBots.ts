import { CRACKER, JAVELIN, NOISE } from '../../config';
import { BotBrain, Walker, type BotWorld, type Brain } from '../bots';
import type { BambooSpot, Survivor, Zombie } from '../entities';
import type { PlayerInput } from '../types';
import { hasJavelins, PAW, stowed, WEAPONS } from '../weapons';
import { chunkOf, OPEN, PIECES, tileCenter, tileOf } from './config';
import type { NodeKind, OpenView, Piece, ResourceNode } from './types';

/** Which side of the leader each bot walks on (the same as BotBrain's). */
const SIDE = [-1, 1, 0, 1];

/** Zombies closer than this to us are fought (BotBrain only goes for them within 4 m). */
const FIGHT_NEAR = 8;
/** Zombies this close to the leader are fought too, if they're within CHASE of us. */
const GUARD_LEADER = 8;
const CHASE = 25;
/** With the leader further than this, catch up first: no gathering or trips to the stash. */
const LEADER_FAR = 40;
/** Eat below this hunger, at a snack this close (closer while catching up). */
const EAT_BELOW = OPEN.hungryAt;
const SNACK_RANGE = 45;
const SNACK_RANGE_FAR = 25;
/** BotBrain goes to heal at a snack below this hp, this close (as in bots.ts). */
const HEAL_BELOW = 55;
const HEAL_RANGE = 20;
/** Defend the base in a siege while the leader is this close to it. */
const DEFEND_RANGE = 80;
/** Empty the pack once it's this full and a storage chest is this close. */
const PACK_FULL = 0.8;
const DEPOSIT_RANGE = 60;
/** Gather from nodes this close to the leader, and keep at one until the leader is this far from it. */
const GATHER_RANGE = 12;
const GATHER_KEEP = 16;
/** No gathering with an awake zombie this close (it would be a fight soon). */
const CALM = 12;
/** Stand this far from a node's edge to hit it (inside every weapon's reach, outside its collider). */
const STAND_GAP = 0.75;
/** Wood first, then bamboo, stone and scrap. */
const NODE_RANK: Record<NodeKind, number> = { tree: 0, grove: 1, rock: 2, scrap: 3 };
/** Seconds between looks for food, storage and nodes. */
const SEARCH_EVERY = 0.6;
/** A target we got no closer to for GIVE_UP seconds is left alone for SKIP_TIME. */
const GIVE_UP = 6;
const SKIP_TIME = 30;
/** Barely moving for this long while trying to: look for a gate through whatever is in the way. */
const STUCK_TIME = 2.4;
const STUCK_SAMPLE = 0.6;
/** Keys of skippable targets (nodes, storage chests and snack spots share one map). */
const NODE_KEY = 0;
const STORE_KEY = 1e7;
const SNACK_KEY = 2e7;

/** Whether a panda can stand at (x, z): no wall or other solid piece on that tile. */
function free(open: OpenView, x: number, z: number): boolean {
  const p = open.pieceAt(tileOf(x), tileOf(z));
  return !p || p.ruined || PIECES[p.kind].blocks !== 'all';
}

/** Going through a gate: walk to the point before it, then straight through to the point after it. */
interface GatePass {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  t: number;
  through: boolean;
}

/**
 * A bot buddy for the open world. A BotBrain inside does what it already does well (reviving, fleeing,
 * close fights, healing snacks, picking up javelins and firecrackers); on top of that this one fights
 * what's going for the leader, eats when hungry, holds the base in a siege, empties its pack at the
 * storage and chops, mines and cuts near the leader when there's nothing else to do.
 */
class OpenBot implements Brain {
  private readonly inner: BotBrain;
  private readonly walker = new Walker();
  private readonly side: number;
  private clock = 0;
  private searchT = 0;
  private swapCd = 0;
  /** What the last search found (re-checked every tick, re-picked every SEARCH_EVERY). */
  private base: { x: number; z: number; r: number } | null = null;
  private snack: BambooSpot | null = null;
  private snackI = -1;
  /** A snack BotBrain would heal at (see watchHeal), and seconds to its next look. */
  private heal: BambooSpot | null = null;
  private healT = 0;
  private store: Piece | null = null;
  private node: ResourceNode | null = null;
  private readonly skip = new Map<number, number>();
  /** Progress towards the current target: its key, the closest we got, and seconds since. */
  private goalKey = -1;
  private goalBest = Infinity;
  private goalT = 0;
  private moveT = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private stuckT = 0;
  private gate: GatePass | null = null;
  /** Where to stand to hit a node (standSpot's result). */
  private spotX = 0;
  private spotZ = 0;

  constructor(slot: number) {
    this.inner = new BotBrain(slot);
    this.side = SIDE[slot % SIDE.length];
  }

  think(me: Survivor, w: BotWorld, dt: number): PlayerInput {
    const out = this.inner.think(me, w, dt);
    const open = w.open;
    if (!open) return out;
    this.clock += dt;
    this.swapCd = Math.max(0, this.swapCd - dt);

    // The nearest awake zombie (as BotBrain sees it), and whether a sleeper is close.
    let threat: Zombie | null = null;
    let td = Infinity;
    let sleeperNear = false;
    for (const z of w.zombies) {
      if (z.state === 'dying') continue;
      const d = Math.hypot(z.x - me.x, z.z - me.z);
      if (z.state === 'sleep') {
        if (d < 9) sleeperNear = true;
        continue;
      }
      if (d < td) {
        td = d;
        threat = z;
      }
    }
    this.watchHeal(me, w, dt);
    if (this.innerBusy(me, w, threat, td)) {
      this.gate = null;
      this.goalKey = -1;
      return out;
    }

    const leader = this.leaderOf(me, w);
    const far = leader ? Math.hypot(leader.x - me.x, leader.z - me.z) : 0;
    const pack = open.pack(me.spec.id);
    const carried = pack.bamboo + pack.wood + pack.stone + pack.scrap;
    const hungry = open.hunger(me.spec.id) < EAT_BELOW;

    this.searchT -= dt;
    if (this.searchT <= 0) {
      this.searchT = SEARCH_EVERY;
      this.search(me, w, open, leader, far, carried, hungry, td > CALM);
    }

    let tx = NaN;
    let tz = NaN;
    let arrive = 1.2;
    let key = -1;
    let direct = false;
    const foe = this.foe(me, w, leader, threat, td);
    const siege = open.siege;
    const base = this.base;
    const anchor = leader ?? me;
    const node = this.node;

    if (foe) {
      // 3. Fight what's coming at us or at the leader (throwers stop at throwing range).
      tx = foe.x;
      tz = foe.z;
      arrive = me.weapon === 'javelin' && me.ammo > 0 ? 7 : 0.9;
      this.gate = null;
    } else if (hungry && this.snack && this.snack.active) {
      // 4. Eat.
      tx = this.snack.x;
      tz = this.snack.z;
      arrive = 0.3;
      key = SNACK_KEY + this.snackI;
    } else if (siege && siege.base && base && Math.hypot(anchor.x - base.x, anchor.z - base.z) < DEFEND_RANGE) {
      // 5. Siege: hold the base on the side it's coming from, one bot each side.
      let sx = siege.x - base.x;
      let sz = siege.z - base.z;
      const sl = Math.hypot(sx, sz) || 1;
      sx /= sl;
      sz /= sl;
      const r = Math.max(2, base.r * 0.6);
      tx = base.x + sx * r - sz * this.side * 2.5;
      tz = base.z + sz * r + sx * this.side * 2.5;
      arrive = 2;
      if (!free(open, tx, tz)) {
        tx = base.x;
        tz = base.z;
        arrive = Math.max(2.5, base.r * 0.5);
      }
    } else if (this.store && carried >= OPEN.packMax * PACK_FULL) {
      // 6. Empty the pack into the stash (walking close enough is all it takes).
      tx = tileCenter(this.store.gx);
      tz = tileCenter(this.store.gz);
      arrive = OPEN.depositRadius - 0.4;
      key = STORE_KEY + this.store.id;
      direct = Math.hypot(tx - me.x, tz - me.z) < 3.5;
    } else if (node && leader && td > CALM && carried < OPEN.packMax && this.canGather(me) && open.nodeLeft(node.id) > 0) {
      // 7. Gather: walk up to the node and hit it, with the right tool if we have it.
      const d = Math.hypot(node.x - me.x, node.z - me.z);
      const range = me.weapon === 'javelin' ? PAW.range : WEAPONS[me.weapon].range;
      if (me.attackTime < 0 && this.swapCd === 0) {
        const other = stowed(me);
        const good = OPEN.goodTool[node.kind];
        if (other && other !== 'javelin' && (me.weapon === 'javelin' || (me.weapon !== good && other === good))) {
          out.swap = true;
          this.swapCd = 1.5;
        }
      }
      if (d <= node.r + range * 0.8) {
        this.goalKey = NODE_KEY + node.id;
        this.goalBest = Infinity;
        this.goalT = 0;
        if (!out.swap && d > 0.05) {
          out.attack = true;
          out.ax = (node.x - me.x) / d;
          out.az = (node.z - me.z) / d;
        }
      } else if (this.standSpot(w, open, node, me)) {
        tx = this.spotX;
        tz = this.spotZ;
        arrive = 0.2;
        key = NODE_KEY + node.id;
        // The last bit straight: steering would keep pushing us round the node itself.
        direct = d < node.r + 2.5;
      } else {
        this.skip.set(NODE_KEY + node.id, this.clock + SKIP_TIME);
        this.node = null;
      }
    } else if (leader) {
      // 8. Follow: a little behind the leader (the way they face), on our own side.
      tx = leader.x - leader.faceX * 2.2 - leader.faceZ * this.side * 1.8;
      tz = leader.z - leader.faceZ * 2.2 + leader.faceX * this.side * 1.8;
      arrive = leader.speed > 0.5 ? 0.4 : 1.5;
      if (!free(open, tx, tz)) {
        tx = leader.x;
        tz = leader.z;
        arrive = 2.2;
      }
    } else if (base && Math.hypot(base.x - me.x, base.z - me.z) > base.r + 4) {
      // Nobody to follow (the humans are down or gone): wait at the base.
      tx = base.x;
      tz = base.z;
      arrive = base.r + 2;
    }

    out.mx = 0;
    out.mz = 0;
    const sneak = sleeperNear && td > 6 ? NOISE.sneakFrac * 0.9 : 1;
    if (this.gate && this.throughGate(me, w, out, dt, sneak)) return out;
    if (direct) this.straight(me, out, tx, tz, arrive);
    else this.walker.walk(me, w, out, tx, tz, arrive, dt, sneak);
    if (!Number.isNaN(tx)) this.progress(me, open, out, key, tx, tz, arrive, dt);
    return out;
  }

  /**
   * Keeps `heal` on an uneaten snack BotBrain would go for to heal (it does below HEAL_BELOW hp, within
   * HEAL_RANGE). The open world has hundreds of spots, so they're only looked through every SEARCH_EVERY,
   * or straight away once the one we had is eaten.
   */
  private watchHeal(me: Survivor, w: BotWorld, dt: number): void {
    if (me.hp >= HEAL_BELOW) {
      this.heal = null;
      this.healT = 0;
      return;
    }
    if (this.heal && !this.heal.active) this.healT = 0;
    this.healT -= dt;
    if (this.healT > 0) return;
    this.healT = SEARCH_EVERY;
    this.heal = null;
    let bestD = HEAL_RANGE;
    for (const b of w.bamboo) {
      if (!b.active) continue;
      const d = Math.hypot(b.x - me.x, b.z - me.z);
      if (d < bestD) {
        bestD = d;
        this.heal = b;
      }
    }
  }

  /** BotBrain's own priorities above following the leader: when one of them applies, let it drive. */
  private innerBusy(me: Survivor, w: BotWorld, threat: Zombie | null, td: number): boolean {
    if (threat && td < 4) return true; // fighting up close, or fleeing
    for (const s of w.survivors) {
      if (s !== me && s.state === 'downed' && Math.hypot(s.x - me.x, s.z - me.z) < 30) return true;
    }
    const heal = this.heal;
    if (heal && heal.active && Math.hypot(heal.x - me.x, heal.z - me.z) < HEAL_RANGE) return true;
    if (hasJavelins(me) && me.ammo < JAVELIN.ammo) {
      for (const j of w.javelins) if (!j.flying && Math.hypot(j.x - me.x, j.z - me.z) < 14) return true;
    }
    if (me.crackers < CRACKER.max) {
      for (const d of w.crackerDrops) if (Math.hypot(d.x - me.x, d.z - me.z) < 10) return true;
    }
    return false;
  }

  /** The nearest standing human (whoever the bots follow). */
  private leaderOf(me: Survivor, w: BotWorld): Survivor | null {
    let best: Survivor | null = null;
    let bestD = Infinity;
    for (const s of w.survivors) {
      if (s === me || s.spec.bot || s.state !== 'active') continue;
      const d = Math.hypot(s.x - me.x, s.z - me.z);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** An awake zombie close to us, else the one closest to the leader if it's within reach of us. */
  private foe(me: Survivor, w: BotWorld, leader: Survivor | null, threat: Zombie | null, td: number): Zombie | null {
    if (threat && td < FIGHT_NEAR) return threat;
    if (!leader) return null;
    let best: Zombie | null = null;
    let bestD = GUARD_LEADER;
    for (const z of w.zombies) {
      if (z.state === 'dying' || z.state === 'sleep') continue;
      const d = Math.hypot(z.x - leader.x, z.z - leader.z);
      if (d < bestD && Math.hypot(z.x - me.x, z.z - me.z) < CHASE) {
        bestD = d;
        best = z;
      }
    }
    return best;
  }

  /** Javelins in hand with nothing else to swap to would get thrown at the trees. */
  private canGather(me: Survivor): boolean {
    if (me.weapon !== 'javelin' || me.ammo === 0) return true;
    const other = stowed(me);
    return !!other && other !== 'javelin';
  }

  private skipped(key: number): boolean {
    return (this.skip.get(key) ?? 0) > this.clock;
  }

  /** Looks for food, a storage chest and a node to gather, as far as each is wanted right now. */
  private search(me: Survivor, w: BotWorld, open: OpenView, leader: Survivor | null, far: number, carried: number, hungry: boolean, calm: boolean): void {
    for (const [k, t] of this.skip) if (t <= this.clock) this.skip.delete(k);
    this.base = open.base();

    this.snack = null;
    this.snackI = -1;
    if (hungry) {
      let bestD = far > LEADER_FAR ? SNACK_RANGE_FAR : SNACK_RANGE;
      for (let i = 0; i < w.bamboo.length; i++) {
        const b = w.bamboo[i];
        if (!b.active) continue;
        const d = Math.hypot(b.x - me.x, b.z - me.z);
        if (d < bestD && !this.skipped(SNACK_KEY + i)) {
          bestD = d;
          this.snack = b;
          this.snackI = i;
        }
      }
    }

    this.store = null;
    if (carried >= OPEN.packMax * PACK_FULL && far < LEADER_FAR) {
      let bestD = DEPOSIT_RANGE;
      for (const p of open.piecesNear(me.x, me.z, DEPOSIT_RANGE)) {
        if (p.kind !== 'storage' || p.ruined || this.skipped(STORE_KEY + p.id)) continue;
        const d = Math.hypot(tileCenter(p.gx) - me.x, tileCenter(p.gz) - me.z);
        if (d < bestD) {
          bestD = d;
          this.store = p;
        }
      }
    }

    if (!leader || far > LEADER_FAR || !calm || carried >= OPEN.packMax || !this.canGather(me)) {
      this.node = null;
      return;
    }
    const n = this.node;
    if (n && open.nodeLeft(n.id) > 0 && !this.skipped(NODE_KEY + n.id) && Math.hypot(n.x - leader.x, n.z - leader.z) < GATHER_KEEP) return;
    this.node = this.pickNode(me, w, open, leader);
  }

  /** The best node near the leader: wood first, then bamboo, stone, scrap; the nearest to us of that kind. */
  private pickNode(me: Survivor, w: BotWorld, open: OpenView, leader: Survivor): ResourceNode | null {
    const world = open.world;
    let best: ResourceNode | null = null;
    let bestRank = Infinity;
    let bestD = Infinity;
    const cx0 = chunkOf(leader.x - GATHER_RANGE);
    const cx1 = chunkOf(leader.x + GATHER_RANGE);
    const cz0 = chunkOf(leader.z - GATHER_RANGE);
    const cz1 = chunkOf(leader.z + GATHER_RANGE);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const id of world.chunkContents(cx, cz).nodes) {
          const n = world.nodes[id];
          if (!n || Math.hypot(n.x - leader.x, n.z - leader.z) > GATHER_RANGE + n.r) continue;
          const rank = NODE_RANK[n.kind];
          const d = Math.hypot(n.x - me.x, n.z - me.z);
          if (rank > bestRank || (rank === bestRank && d >= bestD)) continue;
          if (open.nodeLeft(id) <= 0 || this.skipped(NODE_KEY + id) || this.sleeperBy(w, n.x, n.z)) continue;
          if (!this.standSpot(w, open, n, me)) continue;
          best = n;
          bestRank = rank;
          bestD = d;
        }
      }
    }
    return best;
  }

  /** Chopping is loud: leave nodes next to a sleeping zombie alone. */
  private sleeperBy(w: BotWorld, x: number, z: number): boolean {
    for (const zb of w.zombies) if (zb.state === 'sleep' && Math.hypot(zb.x - x, zb.z - z) < 10) return true;
    return false;
  }

  /**
   * Where to stand to hit a node (into spotX / spotZ): on our side of it, else either side, else the far
   * side, on a tile with no wall and not in the water. False when all four are blocked.
   */
  private standSpot(w: BotWorld, open: OpenView, n: ResourceNode, me: Survivor): boolean {
    let dx = me.x - n.x;
    let dz = me.z - n.z;
    const l = Math.hypot(dx, dz);
    if (l < 0.01) {
      dx = 1;
      dz = 0;
    } else {
      dx /= l;
      dz /= l;
    }
    const r = n.r + STAND_GAP;
    for (let i = 0; i < 4; i++) {
      let ox = dx;
      let oz = dz;
      if (i === 1) {
        ox = -dz;
        oz = dx;
      } else if (i === 2) {
        ox = dz;
        oz = -dx;
      } else if (i === 3) {
        ox = -dx;
        oz = -dz;
      }
      const x = n.x + ox * r;
      const z = n.z + oz * r;
      if (!free(open, x, z) || w.map.terrain.isWater(x, z)) continue;
      this.spotX = x;
      this.spotZ = z;
      return true;
    }
    return false;
  }

  /** Straight at (tx, tz) without steering, slowing down at the end like the Walker. */
  private straight(me: Survivor, out: PlayerInput, tx: number, tz: number, arrive: number): void {
    const dx = tx - me.x;
    const dz = tz - me.z;
    const d = Math.hypot(dx, dz);
    if (d <= arrive) return;
    const sp = Math.min(1, d / 1.5 + 0.3);
    out.mx = (dx / d) * sp;
    out.mz = (dz / d) * sp;
  }

  /**
   * Keeps track of getting closer to the target. Stuck against something: look for a gate through it.
   * No closer for a while: leave that target alone (another tree, another chest) for a bit.
   */
  private progress(me: Survivor, open: OpenView, out: PlayerInput, key: number, tx: number, tz: number, arrive: number, dt: number): void {
    const d = Math.hypot(tx - me.x, tz - me.z);
    if (key !== this.goalKey) {
      this.goalKey = key;
      this.goalBest = d;
      this.goalT = 0;
    } else if (d < this.goalBest - 0.3) {
      this.goalBest = d;
      this.goalT = 0;
    } else if (d > arrive + 0.3) {
      this.goalT += dt;
    }

    this.moveT -= dt;
    if (this.moveT <= 0) {
      this.moveT = STUCK_SAMPLE;
      const moved = Math.hypot(me.x - this.lastX, me.z - this.lastZ);
      this.stuckT = Math.hypot(out.mx, out.mz) > 0.3 && moved < 0.3 ? this.stuckT + STUCK_SAMPLE : 0;
      this.lastX = me.x;
      this.lastZ = me.z;
    }
    if (this.stuckT >= STUCK_TIME) {
      this.stuckT = 0;
      this.findGate(open, me, tx, tz);
    }

    if (key >= 0 && this.goalT > GIVE_UP) {
      this.skip.set(key, this.clock + SKIP_TIME);
      this.goalT = 0;
      if (this.node && key === NODE_KEY + this.node.id) this.node = null;
      if (this.store && key === STORE_KEY + this.store.id) this.store = null;
      if (this.snack && key === SNACK_KEY + this.snackI) this.snack = null;
    }
  }

  /** A gate near us that leads towards (tx, tz) through the wall it sits in. */
  private findGate(open: OpenView, me: Survivor, tx: number, tz: number): void {
    let best: Piece | null = null;
    let bestCost = Infinity;
    for (const p of open.piecesNear(me.x, me.z, 24)) {
      if (p.kind !== 'gate' || p.ruined) continue;
      const gx = tileCenter(p.gx);
      const gz = tileCenter(p.gz);
      const cost = Math.hypot(gx - me.x, gz - me.z) + Math.hypot(tx - gx, tz - gz);
      if (cost < bestCost) {
        bestCost = cost;
        best = p;
      }
    }
    if (!best) return;
    const gx = tileCenter(best.gx);
    const gz = tileCenter(best.gz);
    // Through it across the wall line it's in (walls left and right: pass front to back).
    const solid = (x: number, z: number) => {
      const q = open.pieceAt(x, z);
      return !!q && !q.ruined && PIECES[q.kind].blocks !== 'none';
    };
    let ax = 0;
    let az = 0;
    if (solid(best.gx - 1, best.gz) || solid(best.gx + 1, best.gz)) az = 1;
    else if (solid(best.gx, best.gz - 1) || solid(best.gx, best.gz + 1)) ax = 1;
    else {
      const l = Math.hypot(tx - gx, tz - gz) || 1;
      ax = (tx - gx) / l;
      az = (tz - gz) / l;
    }
    // Only worth it when the target is on the other side.
    const mine = (me.x - gx) * ax + (me.z - gz) * az;
    const theirs = (tx - gx) * ax + (tz - gz) * az;
    if (mine * theirs > 0) return;
    const s = mine >= 0 ? 1 : -1;
    this.gate = { ax: gx + ax * s * 2.4, az: gz + az * s * 2.4, bx: gx - ax * s * 2.4, bz: gz - az * s * 2.4, t: 10, through: false };
  }

  /** Drives a gate pass; false once it's done (or took too long). */
  private throughGate(me: Survivor, w: BotWorld, out: PlayerInput, dt: number, sneak: number): boolean {
    const g = this.gate;
    if (!g) return false;
    g.t -= dt;
    if (!g.through && Math.hypot(g.ax - me.x, g.az - me.z) < 0.8) g.through = true;
    if (g.t <= 0 || (g.through && Math.hypot(g.bx - me.x, g.bz - me.z) < 0.8)) {
      this.gate = null;
      return false;
    }
    if (g.through) this.straight(me, out, g.bx, g.bz, 0.5);
    else this.walker.walk(me, w, out, g.ax, g.az, 0.5, dt, sneak);
    return true;
  }
}

/** The bot buddy for infinite mode (`slot`: which side of the leader it walks on). */
export function createOpenBot(slot: number): Brain {
  return new OpenBot(slot);
}
