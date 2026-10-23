import { DIFFICULTY, SIM_DT, type Difficulty } from '../../config';
import { Rng } from '../../core/rng';
import type { Survivor, Zombie } from '../entities';
import { OPEN } from './config';
import type { HordeDirectorApi, HordeSave, HordeSnap, OpenHost, SiegeSnap, ThreatContext } from './types';

/**
 * Infinite mode's threats: lone zombies around the pandas, roaming hordes (markers that turn into real
 * zombies near a panda and back into markers when everyone has left), and sieges. Owned by OpenRules,
 * stepped once per tick from its preStep. Only the host runs it.
 */

/** Roaming hordes this close to a panda show on the map. */
const HORDE_SEE = 120;
/** Quieter noises than this (footsteps, swings, groans) don't carry to roaming hordes. */
const MIN_HEARD = 8;
/** A horde that heard something goes to look for this long, a bit faster than it roams. */
const LURE_TIME = 90;
const LURE_SPEED = 1.5;
/** Most zombies put on the map per tick, and spawn spots tried per tick: bodies cost, so spread them out. */
const SPAWNS_PER_TICK = 3;
const TRIES_PER_TICK = 8;
/** Seconds between ambient spawns, and between the slower checks (materialise, despawn, new hordes). */
const AMBIENT_EVERY = 0.35;
const CHECK_EVERY = 0.5;
/** Ambient zombies leave this many of OPEN.zombiesMax free for hordes and sieges. */
const AMBIENT_ROOM = 10;
/** A missing roaming horde (killed off, or a new day's extra one) turns up this often. */
const HORDE_REGROW = 120;
/** Siege zombies on the map at once; the rest follow in waves as these fall. */
const SIEGE_WAVE = 30;
/** Pandas within this of the one a siege hunts count as its group. */
const GROUP_RANGE = 30;
/** How fast the siege marker closes in during the warning (it's only drawn on the map). */
const SIEGE_APPROACH = 1.5;
/** Roaming hordes keep this far inside the world's edge. */
const EDGE = 40;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Zombies never appear this close past a base's edge (inside the walls, or right at them). */
const BASE_CLEAR = 4;

/** Whether (x, z) is in (or right by) one of the bases. */
function inBase(bases: readonly { x: number; z: number; r: number }[], x: number, z: number): boolean {
  for (const b of bases) if (Math.hypot(b.x - x, b.z - z) < b.r + BASE_CLEAR) return true;
  return false;
}

/**
 * The rules may hand over the campfires too (ThreatContext doesn't promise them). Without them, the
 * bases stand in: that's where the campfires usually are.
 */
type FireContext = ThreatContext & { campfires?(): readonly { x: number; z: number }[] };

interface Ambient {
  kind: 'ambient';
  members: Zombie[];
}

interface Horde {
  kind: 'horde';
  id: number;
  /** The marker: where the horde is. While materialised its zombies walk to it. */
  x: number;
  z: number;
  /** Heading (unit vector). */
  hx: number;
  hz: number;
  /** Zombies in it: the ones on the map plus the ones still to be put there. */
  n: number;
  /** Its zombies on the map (empty while it's only a marker). */
  members: Zombie[];
  real: boolean;
  /** Every member's goal: the marker's position, moved in place. */
  goal: { x: number; z: number };
  /** A noise it's going to look at, and for how much longer. */
  lureX: number;
  lureZ: number;
  lureT: number;
  turnT: number;
  /** Spawn spots that failed since the last one that worked (widens the search). */
  fails: number;
  /** What's left of a siege that gave up: heads away and is gone once nobody is near. */
  leaving: boolean;
}

interface Siege {
  kind: 'siege';
  /** World clock when it gets there. */
  arrive: number;
  attacking: boolean;
  /** Seconds since it got there. */
  t: number;
  base: boolean;
  /** The panda whose group it hunts (null: it goes for the base). */
  lead: Survivor | null;
  /** From the target towards where it comes from (unit vector). */
  dx: number;
  dz: number;
  /** Zombies not on the map yet. */
  left: number;
  members: Zombie[];
  /** What it's going for: every member's goal, moved in place. */
  goal: { x: number; z: number };
  fails: number;
}

type Group = Ambient | Horde | Siege;

class HordeDirector implements HordeDirectorApi {
  private readonly rng: Rng;
  private readonly hordeMul: number;
  private readonly sleepShare: number;
  private readonly hordes: Horde[] = [];
  private readonly ambient: Ambient = { kind: 'ambient', members: [] };
  /** Every zombie this director put on the map, and the group it's in. */
  private readonly owner = new Map<Zombie, Group>();
  private current: Siege | null = null;
  /** This tick's siege snapshot (a new object each tick, so older snapshots keep theirs). */
  private snap: SiegeSnap | null = null;
  private nextSiege: number;
  private sieges: number;
  private nextId = 1;
  /** Fresh worlds place their hordes on the first tick with a panda about (so they start far from everyone). */
  private ready: boolean;
  /** Pandas in the world this tick (standing or downed). */
  private readonly pandas: Survivor[] = [];
  private checkT = 0;
  private ambientT = 0;
  private growT = HORDE_REGROW;
  private budget = 0;
  private tries = 0;

  constructor(seed: number, difficulty: Difficulty, saved: { hordes: HordeSave[]; nextSiege: number; sieges: number } | null, clock: number) {
    this.rng = new Rng((seed ^ Math.imul(Math.floor(clock) + 1, 0x9e3779b1)) >>> 0);
    const diff = DIFFICULTY[difficulty];
    this.hordeMul = diff.horde;
    this.sleepShare = Math.min(0.9, OPEN.ambient.sleepShare * diff.sleepShare);
    this.sieges = saved && saved.sieges > 0 ? Math.floor(saved.sieges) : 0;
    for (const h of saved?.hordes ?? []) {
      if (!Number.isFinite(h.x) || !Number.isFinite(h.z) || !(h.n >= 1)) continue;
      const half = OPEN.worldSize / 2 - EDGE;
      const hx = Number.isFinite(h.hx) ? h.hx : 0;
      const hz = Number.isFinite(h.hz) ? h.hz : 0;
      this.hordes.push(this.newHorde(clamp(h.x, -half, half), clamp(h.z, -half, half), Math.round(h.n), hx, hz));
    }
    this.ready = this.hordes.length > 0;
    this.nextSiege = saved && saved.nextSiege > 0 ? saved.nextSiege : this.firstSiege(clock);
  }

  get siege(): SiegeSnap | null {
    return this.snap;
  }

  step(host: OpenHost, ctx: ThreatContext): void {
    this.budget = SPAWNS_PER_TICK;
    this.tries = TRIES_PER_TICK;
    const pandas = this.pandas;
    pandas.length = 0;
    for (const s of host.survivors) if (!s.npc && (s.state === 'active' || s.state === 'downed')) pandas.push(s);
    if (!this.ready && pandas.length) {
      this.ready = true;
      const want = this.hordeTarget(ctx.day);
      for (let i = 0; i < want; i++) this.placeHorde(host);
    }

    this.checkT -= SIM_DT;
    const check = this.checkT <= 0;
    if (check) {
      this.checkT = CHECK_EVERY;
      this.prune(this.ambient);
      for (const h of this.hordes) this.prune(h);
      if (this.current) this.prune(this.current);
    }

    // Sieges first: their waves get the spawn budget before anything else.
    this.stepSiege(host, ctx, check);
    this.moveHordes(host, ctx.night);
    if (check) {
      this.checkHordes(host);
      this.despawnAmbient(host);
      if (this.ready) this.growHordes(host, ctx.day);
    }
    this.fillHordes(host, ctx);
    this.stepAmbient(host, ctx);
  }

  onNoise(x: number, z: number, radius: number): void {
    if (radius < MIN_HEARD) return;
    const heard = (OPEN.hordes.hearRange * radius) / OPEN.gatherNoise;
    for (const h of this.hordes) {
      if (h.leaving) continue;
      const d = Math.hypot(x - h.x, z - h.z);
      if (d > heard || d < 4) continue;
      h.lureX = x;
      h.lureZ = z;
      h.lureT = LURE_TIME;
    }
  }

  onZombieDeath(z: Zombie): void {
    this.forget(z);
  }

  owns(z: Zombie): boolean {
    return this.owner.has(z);
  }

  visibleHordes(host: OpenHost, ctx: ThreatContext): HordeSnap[] {
    const out: HordeSnap[] = [];
    if (!this.hordes.length) return out;
    const looks = ctx.lookouts();
    for (const h of this.hordes) {
      if (h.n <= 0) continue;
      let seen = false;
      for (const s of host.survivors) {
        if ((s.state === 'active' || s.state === 'downed') && Math.hypot(s.x - h.x, s.z - h.z) < HORDE_SEE) {
          seen = true;
          break;
        }
      }
      if (!seen) {
        for (const l of looks) {
          if (Math.hypot(l.x - h.x, l.z - h.z) < OPEN.lookoutRange) {
            seen = true;
            break;
          }
        }
      }
      if (seen) out.push({ x: r1(h.x), z: r1(h.z), n: h.n });
    }
    return out;
  }

  save(): { hordes: HordeSave[]; nextSiege: number; sieges: number } {
    const hordes: HordeSave[] = [];
    for (const h of this.hordes) {
      // A beaten siege walking off isn't a horde worth keeping.
      if (h.leaving || h.n <= 0) continue;
      hordes.push({ x: r2(h.x), z: r2(h.z), n: h.n, hx: r2(h.hx), hz: r2(h.hz) });
    }
    return { hordes, nextSiege: this.nextSiege, sieges: this.sieges };
  }

  // ================================================================ bookkeeping

  /** A zombie of ours died (or fell out of the world): it leaves its group, and a horde is one smaller. */
  private forget(z: Zombie): void {
    const g = this.owner.get(z);
    if (!g) return;
    this.owner.delete(z);
    const i = g.members.indexOf(z);
    if (i >= 0) g.members.splice(i, 1);
    if (g.kind === 'horde') g.n = Math.max(0, g.n - 1);
  }

  /** Deaths the rules didn't tell us about (a zombie that fell through the world just starts dying). */
  private prune(g: Group): void {
    const m = g.members;
    for (let i = m.length - 1; i >= 0; i--) if (m[i].state === 'dying') this.forget(m[i]);
  }

  private adopt(z: Zombie, g: Group): void {
    this.owner.set(z, g);
    g.members.push(z);
  }

  /** Zombies on the map that count against OPEN.zombiesMax (dying ones don't, as in spawnZombie). */
  private live(host: OpenHost): number {
    let n = 0;
    for (const z of host.zombies) if (z.state !== 'dying') n++;
    return n;
  }

  private canSpawn(host: OpenHost): boolean {
    return this.budget > 0 && this.tries > 0 && this.live(host) < OPEN.zombiesMax;
  }

  /** One spawn attempt (spawnZombie checks the spot is fair). */
  private trySpawn(host: OpenHost, x: number, z: number, opts: { asleep?: boolean; horde?: number; siege?: boolean; goal?: { x: number; z: number } | null }): Zombie | null {
    this.tries--;
    const zb = host.spawnZombie(x, z, opts);
    if (zb) this.budget--;
    return zb;
  }

  private nearestPanda(x: number, z: number): number {
    let best = Infinity;
    for (const s of this.pandas) best = Math.min(best, Math.hypot(s.x - x, s.z - z));
    return best;
  }

  /** The panda closest to (x, z), standing ones first (a downed one only when nobody is up). */
  private closestPanda(x: number, z: number): Survivor | null {
    let best: Survivor | null = null;
    let bestD = Infinity;
    for (const s of this.pandas) {
      const d = Math.hypot(s.x - x, s.z - z) + (s.state === 'active' ? 0 : 1e6);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  // ================================================================ ambient zombies

  private stepAmbient(host: OpenHost, ctx: ThreatContext): void {
    this.ambientT -= SIM_DT;
    if (this.ambientT > 0) return;
    this.ambientT = AMBIENT_EVERY;
    const A = OPEN.ambient;
    const pandas = this.pandas;
    if (!pandas.length || !this.canSpawn(host) || this.live(host) >= OPEN.zombiesMax - AMBIENT_ROOM) return;
    let want = ((ctx.night ? A.night : A.day) + A.perPlayer * pandas.length) * this.hordeMul;
    if (this.current?.attacking) want *= 0.5; // make room for the siege
    if (this.ambient.members.length >= Math.round(want)) return;

    const lights = ctx.night ? this.lights(ctx) : null;
    const bases = ctx.bases();
    for (let i = 0; i < 4 && this.tries > 0; i++) {
      const p = this.rng.pick(pandas);
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(A.spawnMin, A.spawnMax);
      const x = p.x + Math.sin(a) * d;
      const z = p.z + Math.cos(a) * d;
      // Out of everyone's sight, never inside a base, and never in a campfire's light at night.
      if (
        this.nearestPanda(x, z) < A.spawnMin * 0.9 ||
        inBase(bases, x, z) ||
        (lights && lights.some((l) => Math.hypot(l.x - x, l.z - z) < l.r))
      ) {
        this.tries--;
        continue;
      }
      const zb = this.trySpawn(host, x, z, { asleep: this.rng.next() < this.sleepShare, horde: -1, siege: false, goal: null });
      if (zb) {
        this.adopt(zb, this.ambient);
        return;
      }
    }
  }

  /** Lit circles ambient zombies keep out of at night. */
  private lights(ctx: ThreatContext): { x: number; z: number; r: number }[] {
    const fires = (ctx as FireContext).campfires?.();
    if (fires) return fires.map((f) => ({ x: f.x, z: f.z, r: OPEN.campfireLight }));
    return ctx.bases().map((b) => ({ x: b.x, z: b.z, r: b.r + OPEN.campfireLight }));
  }

  /** Lone zombies nobody is near any more wander off. */
  private despawnAmbient(host: OpenHost): void {
    const m = this.ambient.members;
    for (let i = m.length - 1; i >= 0; i--) {
      const z = m[i];
      if (this.nearestPanda(z.x, z.z) < OPEN.ambient.despawn) continue;
      m.splice(i, 1);
      this.owner.delete(z);
      host.despawnZombie(z);
    }
  }

  // ================================================================ roaming hordes

  private hordeTarget(day: number): number {
    const H = OPEN.hordes;
    return Math.min(H.max, H.count + H.perDay * Math.max(0, day - 1));
  }

  private hordeSize(): number {
    return Math.max(3, Math.round(this.rng.range(OPEN.hordes.sizeMin, OPEN.hordes.sizeMax) * this.hordeMul));
  }

  private newHorde(x: number, z: number, n: number, hx: number, hz: number): Horde {
    const l = Math.hypot(hx, hz);
    const a = this.rng.range(0, Math.PI * 2);
    return {
      kind: 'horde',
      id: this.nextId++,
      x,
      z,
      hx: l > 0.01 ? hx / l : Math.sin(a),
      hz: l > 0.01 ? hz / l : Math.cos(a),
      n,
      members: [],
      real: false,
      goal: { x, z },
      lureX: 0,
      lureZ: 0,
      lureT: 0,
      turnT: this.rng.range(5, 30),
      fails: 0,
      leaving: false,
    };
  }

  /** A new horde somewhere out in the wild, well away from every panda and the camp. */
  private placeHorde(host: OpenHost): boolean {
    const half = OPEN.worldSize / 2 - EDGE - 20;
    const camp = host.map.open?.spawn;
    for (let i = 0; i < 30; i++) {
      const x = this.rng.range(-half, half);
      const z = this.rng.range(-half, half);
      if (this.nearestPanda(x, z) < OPEN.hordes.dematerialize + 20) continue;
      if (camp && Math.hypot(x - camp.x, z - camp.z) < OPEN.hordes.dematerialize) continue;
      if (host.map.terrain.isWater(x, z)) continue;
      const a = this.rng.range(0, Math.PI * 2);
      this.hordes.push(this.newHorde(x, z, this.hordeSize(), Math.sin(a), Math.cos(a)));
      return true;
    }
    return false;
  }

  /** Killed-off hordes come back slowly, and every new day brings one more (up to the cap). */
  private growHordes(host: OpenHost, day: number): void {
    let roaming = 0;
    for (const h of this.hordes) if (!h.leaving) roaming++;
    if (roaming >= this.hordeTarget(day)) {
      this.growT = HORDE_REGROW;
      return;
    }
    this.growT -= CHECK_EVERY;
    if (this.growT <= 0 && this.placeHorde(host)) this.growT = HORDE_REGROW;
  }

  private turn(h: Horde, a: number): void {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const hx = h.hx * c - h.hz * s;
    const hz = h.hx * s + h.hz * c;
    const l = Math.hypot(hx, hz) || 1;
    h.hx = hx / l;
    h.hz = hz / l;
  }

  /** Markers drift (faster at night), go to look at noises, stop at the shore and turn back at the edge. */
  private moveHordes(host: OpenHost, night: boolean): void {
    const half = OPEN.worldSize / 2 - EDGE;
    const terrain = host.map.terrain;
    const roam = OPEN.hordes.roamSpeed * (night ? OPEN.hordes.nightSpeed : 1);
    for (const h of this.hordes) {
      let speed = roam;
      if (h.lureT > 0) {
        h.lureT -= SIM_DT;
        const dx = h.lureX - h.x;
        const dz = h.lureZ - h.z;
        const d = Math.hypot(dx, dz);
        if (d < 4) {
          h.lureT = 0;
          speed = 0;
        } else {
          h.hx = dx / d;
          h.hz = dz / d;
          speed *= LURE_SPEED;
        }
      } else if (h.leaving) {
        speed *= 2;
      } else {
        h.turnT -= SIM_DT;
        if (h.turnT <= 0) {
          h.turnT = this.rng.range(15, 40);
          this.turn(h, this.rng.range(-0.9, 0.9));
        }
        // Near the edge and heading out: turn back towards the middle.
        if ((Math.abs(h.x) > half - 30 || Math.abs(h.z) > half - 30) && h.hx * h.x + h.hz * h.z > 0) {
          const l = Math.hypot(h.x, h.z) || 1;
          h.hx = -h.x / l;
          h.hz = -h.z / l;
          this.turn(h, this.rng.range(-0.6, 0.6));
        }
      }
      if (speed > 0) {
        if (terrain.isWater(h.x + h.hx * 3, h.z + h.hz * 3)) {
          // Zombies can't swim: wait at the shore, roaming ones turn away.
          if (h.lureT > 0) h.lureT = Math.min(h.lureT, 5);
          else this.turn(h, (this.rng.next() < 0.5 ? -1 : 1) * this.rng.range(1.2, 2.4));
        } else {
          h.x = clamp(h.x + h.hx * speed * SIM_DT, -half, half);
          h.z = clamp(h.z + h.hz * speed * SIM_DT, -half, half);
        }
      }
      h.goal.x = h.x;
      h.goal.z = h.z;
    }
  }

  /** Materialise hordes a panda came near; turn hordes everyone has left back into markers. */
  private checkHordes(host: OpenHost): void {
    const H = OPEN.hordes;
    for (let i = this.hordes.length - 1; i >= 0; i--) {
      const h = this.hordes[i];
      if (h.real) {
        let near = this.nearestPanda(h.x, h.z) < H.dematerialize;
        for (let j = 0; j < h.members.length && !near; j++) near = this.nearestPanda(h.members[j].x, h.members[j].z) < H.dematerialize;
        if (!near) {
          // Back to a marker where its zombies are, as many as are left.
          if (h.members.length) {
            let cx = 0;
            let cz = 0;
            for (const m of h.members) {
              cx += m.x;
              cz += m.z;
            }
            h.x = cx / h.members.length;
            h.z = cz / h.members.length;
          }
          for (const m of h.members) {
            this.owner.delete(m);
            host.despawnZombie(m);
          }
          h.members.length = 0;
          h.real = false;
          if (h.leaving) h.n = 0;
        }
      } else if (h.n > 0 && this.nearestPanda(h.x, h.z) < H.materialize) {
        h.real = true;
        h.fails = 0;
      }
      if (h.n <= 0 && !h.members.length) this.hordes.splice(i, 1);
    }
  }

  /** Puts a materialised horde's zombies on the map around its marker, a few per tick, as room allows. */
  private fillHordes(host: OpenHost, ctx: ThreatContext): void {
    let bases: { x: number; z: number; r: number }[] | null = null;
    for (const h of this.hordes) {
      if (!h.real || h.leaving) continue;
      while (h.members.length < h.n && this.canSpawn(host)) {
        const r = 3 + Math.sqrt(h.n) * 1.5 + Math.min(25, h.fails * 2);
        const a = this.rng.range(0, Math.PI * 2);
        const d = this.rng.range(0, r);
        const x = h.x + Math.sin(a) * d;
        const z = h.z + Math.cos(a) * d;
        // Never inside someone's walls (a horde roaming over a base fills in once it's past).
        bases ??= ctx.bases();
        if (inBase(bases, x, z)) {
          this.tries--;
          h.fails++;
          continue;
        }
        const zb = this.trySpawn(host, x, z, { horde: h.id, siege: false, goal: h.goal });
        if (!zb) {
          h.fails++;
          continue;
        }
        h.fails = 0;
        zb.horde = h.id;
        zb.siege = false;
        zb.goal = h.goal;
        this.adopt(zb, h);
      }
    }
  }

  // ================================================================ sieges

  /** The first siege of a world; an old world already past that window gets the usual gap from now. */
  private firstSiege(clock: number): number {
    const S = OPEN.siege;
    const first = this.rng.range(S.firstMin, S.firstMax) * OPEN.dayLength;
    if (clock < first - S.warn - S.lookoutWarn) return first;
    return clock + this.rng.range(S.gapMin, S.gapMax) * OPEN.dayLength;
  }

  private stepSiege(host: OpenHost, ctx: ThreatContext, check: boolean): void {
    const S = OPEN.siege;
    const s = this.current;
    if (!s) {
      // Only ask about lookouts once the earliest possible warning time has come.
      if (check && ctx.clock >= this.nextSiege - S.warn - S.lookoutWarn) {
        const warn = S.warn + (ctx.lookouts().length > 0 ? S.lookoutWarn : 0);
        if (ctx.clock >= this.nextSiege - warn) this.startSiege(host, ctx, Math.max(this.nextSiege, ctx.clock + warn));
      }
      this.snap = this.current ? this.siegeSnap(this.current, ctx.clock) : null;
      return;
    }

    // Hunting pandas: keep after their group (a new lead if that one went down or left).
    if (s.lead) {
      if (s.lead.state !== 'active' || !this.pandas.includes(s.lead)) s.lead = this.closestPanda(s.goal.x, s.goal.z) ?? s.lead;
      if (this.pandas.includes(s.lead)) this.groupMiddle(s.lead, s.goal);
    }

    if (!s.attacking) {
      if (ctx.clock >= s.arrive) {
        s.attacking = true;
        s.t = 0;
      }
    } else {
      s.t += SIM_DT;
      this.sendWave(host, s);
      if (s.left === 0 && s.members.length === 0) {
        this.current = null;
        host.emit({ e: 'siegeOver', won: true });
      } else if (s.t >= S.giveUp) {
        this.retreat(s);
        this.current = null;
        host.emit({ e: 'siegeOver', won: false });
      }
    }
    this.snap = this.current ? this.siegeSnap(this.current, ctx.clock) : null;
  }

  private startSiege(host: OpenHost, ctx: ThreatContext, arrive: number): void {
    const S = OPEN.siege;
    if (!this.pandas.length) {
      this.nextSiege = ctx.clock + 120; // nobody about: try again in a while
      return;
    }
    this.sieges++;
    this.nextSiege = arrive + this.rng.range(S.gapMin, S.gapMax) * OPEN.dayLength;

    // The biggest base if anyone is close to it; otherwise the pandas nearest to it (or to the camp).
    const bases = ctx.bases();
    const big = bases.length ? bases[0] : null;
    let base = false;
    if (big) for (const p of this.pandas) if (Math.hypot(p.x - big.x, p.z - big.z) < S.baseRange) base = true;
    const goal = { x: 0, z: 0 };
    let lead: Survivor | null = null;
    if (big && base) {
      goal.x = big.x;
      goal.z = big.z;
    } else {
      const ref = big ?? host.map.open?.spawn ?? { x: 0, z: 0 };
      lead = this.closestPanda(ref.x, ref.z);
      if (lead) this.groupMiddle(lead, goal);
    }

    // Come from a direction with dry, open ground at the spawn distance.
    const half = OPEN.worldSize / 2 - 12;
    let dx = 0;
    let dz = 1;
    for (let i = 0; i < 12; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      dx = Math.sin(a);
      dz = Math.cos(a);
      const x = goal.x + dx * S.spawnDist;
      const z = goal.z + dz * S.spawnDist;
      if (Math.abs(x) < half && Math.abs(z) < half && !host.map.terrain.isWater(x, z) && host.map.terrain.ridgeAmount(x, z) < 0.15) break;
    }

    let players = 0;
    for (const p of host.survivors) if (!p.npc && p.state !== 'dead') players++;
    const size = Math.max(1, Math.min(S.max, Math.round((S.base + S.perDay * ctx.day + S.perPlayer * players) * this.hordeMul)));

    this.current = { kind: 'siege', arrive, attacking: false, t: 0, base, lead, dx, dz, left: size, members: [], goal, fails: 0 };
    host.emit({
      e: 'siege',
      x: r1(clamp(goal.x + dx * S.spawnDist, -half, half)),
      z: r1(clamp(goal.z + dz * S.spawnDist, -half, half)),
      eta: r1(Math.max(0, arrive - ctx.clock)),
      base,
    });
  }

  /** Middle of the pandas around `lead`, into `out`. */
  private groupMiddle(lead: Survivor, out: { x: number; z: number }): void {
    let x = 0;
    let z = 0;
    let n = 0;
    for (const p of this.pandas) {
      if (Math.hypot(p.x - lead.x, p.z - lead.z) > GROUP_RANGE) continue;
      x += p.x;
      z += p.z;
      n++;
    }
    out.x = n ? x / n : lead.x;
    out.z = n ? z / n : lead.z;
  }

  /** Siege zombies come out of the wild on their side of the target, keeping SIEGE_WAVE on the map. */
  private sendWave(host: OpenHost, s: Siege): void {
    const dist = OPEN.siege.spawnDist;
    while (s.left > 0 && s.members.length < SIEGE_WAVE && this.canSpawn(host)) {
      if (s.fails > 20) {
        // That side is no good (a lake, a cliff): come round a bit.
        const c = Math.cos(0.6);
        const sn = Math.sin(0.6);
        const dx = s.dx * c - s.dz * sn;
        s.dz = s.dx * sn + s.dz * c;
        s.dx = dx;
        s.fails = 0;
      }
      const r = 4 + Math.min(16, s.fails);
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(0, r);
      const x = s.goal.x + s.dx * dist + Math.sin(a) * d;
      const z = s.goal.z + s.dz * dist + Math.cos(a) * d;
      const zb = this.trySpawn(host, x, z, { horde: -1, siege: true, goal: s.goal });
      if (!zb) {
        s.fails++;
        continue;
      }
      s.fails = 0;
      s.left--;
      zb.siege = true;
      zb.horde = -1;
      zb.goal = s.goal;
      this.adopt(zb, s);
    }
  }

  /** A siege that gave up: whoever's left becomes a horde walking off the way it came. */
  private retreat(s: Siege): void {
    if (!s.members.length) return;
    let cx = 0;
    let cz = 0;
    for (const m of s.members) {
      cx += m.x;
      cz += m.z;
    }
    const h = this.newHorde(cx / s.members.length, cz / s.members.length, s.members.length, s.dx, s.dz);
    h.real = true;
    h.leaving = true;
    for (const m of s.members) {
      m.siege = false;
      m.horde = h.id;
      m.goal = h.goal;
      this.adopt(m, h);
    }
    s.members.length = 0;
    this.hordes.push(h);
  }

  private siegeSnap(s: Siege, clock: number): SiegeSnap {
    const half = OPEN.worldSize / 2;
    let x: number;
    let z: number;
    if (s.members.length) {
      x = 0;
      z = 0;
      for (const m of s.members) {
        x += m.x;
        z += m.z;
      }
      x /= s.members.length;
      z /= s.members.length;
    } else {
      // Not on the map yet: a marker closing in on where it'll come out.
      const far = OPEN.siege.spawnDist + (s.attacking ? 0 : Math.max(0, s.arrive - clock) * SIEGE_APPROACH);
      x = clamp(s.goal.x + s.dx * far, -half, half);
      z = clamp(s.goal.z + s.dz * far, -half, half);
    }
    return {
      x: r1(x),
      z: r1(z),
      tx: r1(s.goal.x),
      tz: r1(s.goal.z),
      eta: s.attacking ? 0 : r1(Math.max(0, s.arrive - clock)),
      size: s.members.length + s.left,
      base: s.base,
    };
  }
}

/**
 * The rules' threat director. `saved` is the save's hordes / next siege / siege count: with no hordes it
 * places fresh ones (on the first tick a panda is about), with `nextSiege` 0 it schedules the first siege
 * from `clock`.
 */
export function createHordeDirector(
  seed: number,
  difficulty: Difficulty,
  saved: { hordes: HordeSave[]; nextSiege: number; sieges: number } | null,
  clock: number,
): HordeDirectorApi {
  return new HordeDirector(seed, difficulty, saved, clock);
}
