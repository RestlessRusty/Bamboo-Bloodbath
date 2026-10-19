import { JAVELIN } from '../config';
import type { BambooSpot, Javelin, Survivor, Zombie } from './entities';
import type { GameMap } from './gameMap';
import type { PlayerInput } from './types';

/** What a bot is allowed to look at. Implemented by Simulation. */
export interface BotWorld {
  readonly map: GameMap;
  readonly survivors: readonly Survivor[];
  readonly zombies: readonly Zombie[];
  readonly javelins: readonly Javelin[];
  readonly bamboo: readonly BambooSpot[];
  steer(x: number, z: number, dx: number, dz: number, avoidWater: boolean): { x: number; z: number };
}

/** Which side of the leader each bot buddy walks on. */
const SLOT_SIDE = [-1, 1, 0, 1];

const BOT_NAMES = ['Bao', 'Mochi', 'Dumpling', 'Lychee', 'Tofu', 'Noodle', 'Sesame', 'Wonton', 'Boba', 'Kiwi'];

export function botName(index: number): string {
  return BOT_NAMES[index % BOT_NAMES.length];
}

function nearest<T extends { x: number; z: number }>(items: readonly T[], from: { x: number; z: number }, maxD: number): T | null {
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

/**
 * A simple buddy AI that produces the same PlayerInput a human would.
 * Priorities: revive downed friends > flee when nearly dead > eat > pick up javelins > fight > follow the leader.
 */
export class BotBrain {
  private checkT = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private detourT = 0;
  private detourX = 0;
  private detourZ = 0;

  constructor(private readonly slot: number) {}

  think(me: Survivor, w: BotWorld, dt: number): PlayerInput {
    const out: PlayerInput = { mx: 0, mz: 0, ax: 0, az: 0, attack: false, dash: false };

    let threat: Zombie | null = null;
    let td = Infinity;
    for (const z of w.zombies) {
      if (z.state === 'dying') continue;
      const d = Math.hypot(z.x - me.x, z.z - me.z);
      if (d < td) {
        td = d;
        threat = z;
      }
    }

    const canThrow = me.weapon === 'javelin' && me.ammo > 0;
    const reach = canThrow ? 11 : me.weapon === 'axe' ? 2.2 : me.weapon === 'knife' ? 1.8 : 1.4;
    if (threat && td < reach) {
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
    const leader = nearest(w.survivors.filter((s) => !s.spec.bot && s.state === 'active'), me, Infinity);

    if (downed && (!threat || td > 2.5)) {
      goTo(downed.x, downed.z, 0.6);
    } else if (threat && td < 4 && me.hp < 30) {
      goTo(me.x - (threat.x - me.x) * 3, me.z - (threat.z - me.z) * 3, 0.5);
      if (td < 2) out.dash = true;
    } else if (snack) {
      goTo(snack.x, snack.z, 0.3);
    } else if (spear && (!threat || td > 4)) {
      goTo(spear.x, spear.z, 0.3);
    } else if (threat && td < 4 && !canThrow) {
      goTo(threat.x, threat.z, 0.9);
    } else if (threat && canThrow && td < 3) {
      goTo(me.x - (threat.x - me.x) * 2, me.z - (threat.z - me.z) * 2, 0.5);
    } else if (leader) {
      // Walk a little behind the leader, on our own side.
      const { goal } = w.map.layout;
      const gx = goal.x - leader.x;
      const gz = goal.z - leader.z;
      const gl = Math.hypot(gx, gz) || 1;
      const fx = gx / gl;
      const fz = gz / gl;
      const side = SLOT_SIDE[this.slot % SLOT_SIDE.length];
      goTo(leader.x - fx * 2.2 - fz * side * 1.8, leader.z - fz * 2.2 + fx * side * 1.8, leader.speed > 0.5 ? 0.4 : 1.5);
    } else {
      const { goal } = w.map.layout;
      goTo(goal.x, goal.z, 0);
    }

    if (!Number.isNaN(tx)) {
      const dx = tx - me.x;
      const dz = tz - me.z;
      const d = Math.hypot(dx, dz);
      if (d > arrive) {
        let dir = w.steer(me.x, me.z, dx / d, dz / d, !w.map.terrain.isWater(tx, tz));
        if (this.detourT > 0) {
          const x = dir.x * 0.3 + this.detourX;
          const z = dir.z * 0.3 + this.detourZ;
          const l = Math.hypot(x, z) || 1;
          dir = { x: x / l, z: z / l };
        }
        const sp = Math.min(1, d / 1.5 + 0.3);
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

    return out;
  }
}
