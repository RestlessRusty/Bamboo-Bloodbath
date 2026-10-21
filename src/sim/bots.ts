import { CRACKER, JAVELIN, NOISE } from '../config';
import type { BambooSpot, Cracker, CrackerDrop, Javelin, Survivor, Zombie } from './entities';
import type { GameMap } from './gameMap';
import type { PlayerInput } from './types';

/** What a bot is allowed to look at. Implemented by Simulation. */
export interface BotWorld {
  readonly map: GameMap;
  readonly survivors: readonly Survivor[];
  readonly zombies: readonly Zombie[];
  readonly javelins: readonly Javelin[];
  readonly crackers: readonly Cracker[];
  readonly crackerDrops: readonly CrackerDrop[];
  readonly bamboo: readonly BambooSpot[];
  steer(x: number, z: number, dx: number, dz: number, avoidWater: boolean): { x: number; z: number };
  detour(x: number, z: number, tx: number, tz: number): { x: number; z: number; cost: number; wall: boolean } | null;
  /** Where buddies should stay (story: beside the cart, heading dx, dz), or null to follow the leader. */
  guard(): { x: number; z: number; dx: number; dz: number } | null;
}

/** Anything that drives a survivor instead of a player's controls. */
export interface Brain {
  think(me: Survivor, w: BotWorld, dt: number): PlayerInput;
}

/** Which side of the leader each bot buddy walks on. */
const SLOT_SIDE = [-1, 1, 0, 1];

const BOT_NAMES = ['Bao', 'Mochi', 'Dumpling', 'Lychee', 'Tofu', 'Noodle', 'Sesame', 'Wonton', 'Boba', 'Kiwi'];

export function botName(index: number): string {
  return BOT_NAMES[index % BOT_NAMES.length];
}

export function nearest<T extends { x: number; z: number }>(items: readonly T[], from: { x: number; z: number }, maxD: number): T | null {
  let best: T | null = null;
  let bestD = maxD;
  for (const it of items) {
    const d = Math.hypot(it.x - from.x, it.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = it;
    }
  }
  return best;
}

/** A pack at least this big within PACK_RANGE makes a bot throw a firecracker. */
const PACK_SIZE = 4;
const PACK_RANGE = 7;
/** Bots guard the story cart while the leader is within this of it. */
const GUARD_LEASH = 28;

/**
 * Walks a survivor towards a point the way a player would: through passes and over bridges,
 * around trees, and sideways for a moment when stuck on something.
 */
export class Walker {
  private checkT = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private detourT = 0;
  private detourX = 0;
  private detourZ = 0;

  /**
   * Sets the movement in `out` to head for (tx, tz), stopping within `arrive` (NaN target: stand still).
   * `maxSpeed` caps how far the stick is pushed (sneaking). Call once per tick.
   */
  walk(me: Survivor, w: BotWorld, out: PlayerInput, tx: number, tz: number, arrive: number, dt: number, maxSpeed = 1): void {
    if (!Number.isNaN(tx)) {
      const dx = tx - me.x;
      const dz = tz - me.z;
      const d = Math.hypot(dx, dz);
      if (d > arrive) {
        // Use a pass when a ridge is in the way; a bridge or ford for water unless swimming is much shorter.
        let wx = tx;
        let wz = tz;
        let avoidWater = !w.map.terrain.isWater(tx, tz);
        const via = w.detour(me.x, me.z, tx, tz);
        if (via && (via.wall || via.cost < d * 2 + 15)) {
          wx = via.x;
          wz = via.z;
        } else if (via) {
          avoidWater = false; // the crossing is too far: swim
        }
        const wl = Math.hypot(wx - me.x, wz - me.z) || 1;
        let dir = w.steer(me.x, me.z, (wx - me.x) / wl, (wz - me.z) / wl, avoidWater);
        if (this.detourT > 0) {
          const x = dir.x * 0.3 + this.detourX;
          const z = dir.z * 0.3 + this.detourZ;
          const l = Math.hypot(x, z) || 1;
          dir = { x: x / l, z: z / l };
        }
        const sp = Math.min(maxSpeed, d / 1.5 + 0.3, 1);
        out.mx = dir.x * sp;
        out.mz = dir.z * sp;
      }
    }

    // Stuck on something? Take a short sideways detour.
    this.detourT -= dt;
    this.checkT -= dt;
    if (this.checkT <= 0) {
      const wanting = Math.hypot(out.mx, out.mz) > 0.3;
      const moved = Math.hypot(me.x - this.lastX, me.z - this.lastZ);
      if (wanting && moved < 0.35) {
        const s = Math.random() < 0.5 ? -1 : 1;
        this.detourT = 0.9;
        this.detourX = -out.mz * s;
        this.detourZ = out.mx * s;
      }
      this.lastX = me.x;
      this.lastZ = me.z;
      this.checkT = 0.8;
    }
  }
}

/**
 * A simple buddy AI that produces the same PlayerInput a human would.
 * Priorities: revive downed friends > flee when nearly dead > eat > pick up javelins and firecrackers
 * > fight > follow the leader. Sleeping zombies are left alone (and tiptoed past).
 */
export class BotBrain implements Brain {
  private readonly walker = new Walker();

  constructor(private readonly slot: number) {}

  think(me: Survivor, w: BotWorld, dt: number): PlayerInput {
    const out: PlayerInput = { mx: 0, mz: 0, ax: 0, az: 0, attack: false, dash: false, cracker: false };

    let threat: Zombie | null = null;
    let td = Infinity;
    let sleeperNear = false;
    let packN = 0;
    let packX = 0;
    let packZ = 0;
    for (const z of w.zombies) {
      if (z.state === 'dying') continue;
      const d = Math.hypot(z.x - me.x, z.z - me.z);
      if (z.state === 'sleep') {
        if (d < 9) sleeperNear = true;
        continue;
      }
      if (d < PACK_RANGE && z.state !== 'stun') {
        packN++;
        packX += z.x;
        packZ += z.z;
      }
      if (d < td) {
        td = d;
        threat = z;
      }
    }

    const canThrow = me.weapon === 'javelin' && me.ammo > 0;
    const reach = canThrow ? 11 : me.weapon === 'axe' ? 2.2 : me.weapon === 'knife' ? 1.8 : 1.4;
    // Swarmed and nothing crackling nearby yet: throw a firecracker away from the pack.
    const crackling = w.crackers.some((c) => Math.hypot(c.x - me.x, c.z - me.z) < 15);
    if (packN >= PACK_SIZE && me.crackers > 0 && me.crackerCd === 0 && !crackling) {
      const ax = me.x - packX / packN;
      const az = me.z - packZ / packN;
      const al = Math.hypot(ax, az) || 1;
      out.cracker = true;
      out.ax = ax / al;
      out.az = az / al;
    } else if (threat && td < reach) {
      out.attack = true;
      out.ax = (threat.x - me.x) / td;
      out.az = (threat.z - me.z) / td;
    }

    let tx = NaN;
    let tz = NaN;
    let arrive = 1.2;
    const goTo = (x: number, z: number, r: number) => {
      tx = x;
      tz = z;
      arrive = r;
    };

    const downed = nearest(w.survivors.filter((s) => s !== me && s.state === 'downed'), me, 30);
    const snack = me.hp < 55 ? nearest(w.bamboo.filter((b) => b.active), me, 20) : null;
    const spear = me.weapon === 'javelin' && me.ammo < JAVELIN.ammo ? nearest(w.javelins.filter((j) => !j.flying), me, 14) : null;
    const loot = me.crackers < CRACKER.max ? nearest(w.crackerDrops, me, 10) : null;
    const leader = nearest(w.survivors.filter((s) => !s.spec.bot && s.state === 'active'), me, Infinity);
    // Story escort: stick by the cart (and keep it rolling) unless the leader wandered off.
    const guard = w.guard();
    const guarding = !!guard && !!leader && Math.hypot(leader.x - guard.x, leader.z - guard.z) < GUARD_LEASH;

    if (downed && (!threat || td > 2.5)) {
      goTo(downed.x, downed.z, 0.6);
    } else if (threat && td < 4 && me.hp < 30) {
      goTo(me.x - (threat.x - me.x) * 3, me.z - (threat.z - me.z) * 3, 0.5);
      if (td < 2) out.dash = true;
    } else if (snack) {
      goTo(snack.x, snack.z, 0.3);
    } else if (spear && (!threat || td > 4)) {
      goTo(spear.x, spear.z, 0.3);
    } else if (loot && (!threat || td > 4)) {
      goTo(loot.x, loot.z, 0.3);
    } else if (threat && td < 4 && !canThrow) {
      goTo(threat.x, threat.z, 0.9);
    } else if (threat && canThrow && td < 3) {
      goTo(me.x - (threat.x - me.x) * 2, me.z - (threat.z - me.z) * 2, 0.5);
    } else if (guard && guarding) {
      // Beside the cart (one each side, the third behind), a little ahead of its middle.
      const side = SLOT_SIDE[this.slot % SLOT_SIDE.length];
      const back = side === 0 ? -2.6 : 0.4;
      goTo(guard.x + guard.dx * back - guard.dz * side * 2.1, guard.z + guard.dz * back + guard.dx * side * 2.1, 0.6);
    } else if (leader) {
      // Walk a little behind the leader (relative to the way ahead), on our own side.
      const ahead = w.map.route.locate(leader.x, leader.z).next;
      const gx = ahead.x - leader.x;
      const gz = ahead.z - leader.z;
      const gl = Math.hypot(gx, gz) || 1;
      const fx = gx / gl;
      const fz = gz / gl;
      const side = SLOT_SIDE[this.slot % SLOT_SIDE.length];
      goTo(leader.x - fx * 2.2 - fz * side * 1.8, leader.z - fz * 2.2 + fx * side * 1.8, leader.speed > 0.5 ? 0.4 : 1.5);
    } else {
      const next = w.map.route.locate(me.x, me.z).next;
      goTo(next.x, next.z, 0);
    }

    // Tiptoe past sleepers unless something awake is already close.
    this.walker.walk(me, w, out, tx, tz, arrive, dt, sleeperNear && td > 6 ? NOISE.sneakFrac * 0.9 : 1);
    return out;
  }
}
