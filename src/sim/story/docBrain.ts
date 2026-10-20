import { NOISE } from '../../config';
import { nearest, Walker, type Brain, type BotWorld } from '../bots';
import type { Survivor, Zombie } from '../entities';
import type { PlayerInput } from '../types';
import type { DocMode, Pt } from './types';

/** Doc slaps zombies this close (she'd rather not). */
const SLAP_RANGE = 1.5;
/** …and backs off from awake ones this close. */
const FLEE_RANGE = 3.2;

/**
 * Doc Mapo, the medic. Not a fighter: revives anyone who's down, backs away from zombies
 * (towards you), and otherwise follows you around or waits at her post.
 */
export class DocBrain implements Brain {
  mode: DocMode = 'wait';
  post: Pt | null = null;
  private readonly walker = new Walker();

  think(me: Survivor, w: BotWorld, dt: number): PlayerInput {
    const out: PlayerInput = { mx: 0, mz: 0, ax: 0, az: 0, attack: false, dash: false, cracker: false };

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
    // While shielded (waiting alone) zombies ignore her, so she ignores them too.
    const scary = threat && threat.state !== 'stun' && !me.shielded ? threat : null;

    if (threat && td < SLAP_RANGE && !me.shielded) {
      out.attack = true;
      out.ax = (threat.x - me.x) / td;
      out.az = (threat.z - me.z) / td;
    }

    let tx = NaN;
    let tz = NaN;
    let arrive = 1;
    const goTo = (x: number, z: number, r: number) => {
      tx = x;
      tz = z;
      arrive = r;
    };

    const downed = nearest(w.survivors.filter((s) => s !== me && s.state === 'downed'), me, 30);
    const leader = nearest(w.survivors.filter((s) => !s.spec.bot && s.state === 'active'), me, Infinity);

    if (downed && (!scary || td > 2)) {
      // Medic first.
      goTo(downed.x, downed.z, 0.6);
    } else if (scary && td < FLEE_RANGE) {
      // Back away, drifting towards whoever can protect her.
      let ax = (me.x - scary.x) / td;
      let az = (me.z - scary.z) / td;
      if (leader) {
        const lx = leader.x - me.x;
        const lz = leader.z - me.z;
        const ll = Math.hypot(lx, lz);
        if (ll > 1.5) {
          ax += (lx / ll) * 0.6;
          az += (lz / ll) * 0.6;
        }
      }
      const al = Math.hypot(ax, az) || 1;
      goTo(me.x + (ax / al) * 4, me.z + (az / al) * 4, 0.3);
      if (td < 1.4) out.dash = true;
    } else if (this.mode === 'follow' && leader) {
      // A step behind the leader (relative to where they're heading), on the other side from the bots.
      const ahead = w.map.route.locate(leader.x, leader.z).next;
      const gx = ahead.x - leader.x;
      const gz = ahead.z - leader.z;
      const gl = Math.hypot(gx, gz) || 1;
      const fx = gx / gl;
      const fz = gz / gl;
      goTo(leader.x - fx * 2.4 + fz * 0.8, leader.z - fz * 2.4 - fx * 0.8, leader.speed > 0.5 ? 0.5 : 1.8);
    } else if (this.post) {
      goTo(this.post.x, this.post.z, 0.8);
    }

    this.walker.walk(me, w, out, tx, tz, arrive, dt, sleeperNear && td > 6 ? NOISE.sneakFrac * 0.9 : 1);
    return out;
  }
}
