import type { RigidBody, World } from '@dimforge/rapier3d-compat';
import {
  CRACKER,
  DIFFICULTY,
  DOWNED,
  GOAL_RADIUS,
  GRAVITY,
  ICE_GRIP,
  JAVELIN,
  MATCH_TIME,
  NOISE,
  PICKUP,
  SIM_DT,
  SLEEP,
  SURVIVOR,
  ZOMBIE,
  type Difficulty,
} from '../config';
import { approachAngle } from '../core/math';
import { Rng } from '../core/rng';
import { BotBrain, type BotWorld, type Brain } from './bots';
import type { BambooSpot, Cracker, CrackerDrop, Javelin, RackSlot, Survivor, Zombie } from './entities';
import type { GameMap } from './gameMap';
import type { Circle } from './mapLayout';
import { RAPIER } from './physics';
import { Obstacles } from './steering';
import type { Mission, MissionHost } from './story/Mission';
import type { HordeRules } from './story/types';
import { NO_INPUT, type GameEvent, type MatchPhase, type PlayerInput, type PlayerSpec, type Snapshot } from './types';
import { PAW, WEAPONS, type MeleeDef } from './weapons';

/** Rule changes for one match (story chapters). Everything defaults to the normal game. */
export interface SimOptions {
  /** Seconds on the clock, or null for no time limit. Default MATCH_TIME. */
  timeLimit?: number | null;
  horde?: Partial<HordeRules>;
  /** Share of the starting horde that's asleep. */
  sleepShare?: number;
  /** Where the group starts, facing `toward`. Default: the camp, facing the way out. */
  spawn?: { x: number; z: number; toward: { x: number; z: number } };
  /** Reaching the hut takes a panda off the map and wins the match. Default true. */
  goalRescue?: boolean;
  /** Story objectives; it decides when the match is won. */
  mission?: Mission | null;
  /** Scales the horde (on top of `horde` / `sleepShare`), zombie damage and speed. Default normal. */
  difficulty?: Difficulty;
}

/** Height of the capsule centre above the feet (same for pandas and zombies). */
const CENTER_HEIGHT = SURVIVOR.halfHeight + SURVIVOR.radius;

/** The story cart's solid box (it rolls along +Z of its own frame). */
const CART_SIZE = { halfWidth: 0.85, halfHeight: 0.7, halfLength: 1.4 };

/** Spawn offsets around the start point as [towards the goal, sideways]. */
const SPAWN_OFFSETS: readonly [number, number][] = [
  [0, 0],
  [1.4, 1.2],
  [1.4, -1.2],
  [2.6, 0],
];

const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
/** Event coordinates only drive sounds and particles: 10 cm is plenty and keeps snapshots small. */
const r1 = (v: number) => Math.round(v * 10) / 10;

function distToSegment(x: number, z: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
  return Math.hypot(a.x + abx * t - x, a.z + abz * t - z);
}

/**
 * Authoritative game state. Pure logic, no rendering: in single player it runs locally,
 * in multiplayer it runs on the host and the other phones only draw its snapshots.
 */
export class Simulation implements BotWorld, MissionHost {
  readonly survivors: Survivor[] = [];
  readonly zombies: Zombie[] = [];
  readonly javelins: Javelin[] = [];
  readonly crackers: Cracker[] = [];
  readonly crackerDrops: CrackerDrop[] = [];
  readonly bamboo: BambooSpot[];
  readonly racks: RackSlot[];

  private readonly world: World;
  private readonly obstacles: Obstacles;
  private readonly scratch: Circle[] = [];
  private readonly rng = new Rng((Math.random() * 4294967296) >>> 0);
  private events: GameEvent[] = [];
  private tick = 0;
  private readonly timed: boolean;
  private timeLeft: number;
  private phase: MatchPhase = 'playing';
  private rescued = 0;
  /** Bots still out once every human is done (see endEarly), and the clock when that first happened. */
  private botsOut = 0;
  private doneClock: number | null = null;
  private nextZombieId = 1;
  private nextJavelinId = 1;
  private nextCrackerId = 1;
  private spawnTimer = 0;
  private readonly horde: HordeRules;
  private readonly sleepShare: number;
  /** Difficulty multipliers on zombie bites / lunges and walking speed. */
  private readonly zombieDamage: number;
  private readonly zombieSpeed: number;
  private readonly goalRescue: boolean;
  private readonly mission: Mission | null;
  private readonly spawnAt: { x: number; z: number; toward: { x: number; z: number } };
  /** Story cart (escort chapters): a body that pushes everyone aside, and its footprint for steering. */
  private cartBody: RigidBody | null = null;
  private cart: Circle | null = null;

  constructor(
    readonly map: GameMap,
    specs: readonly PlayerSpec[],
    options: SimOptions = {},
  ) {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = SIM_DT;

    this.timed = options.timeLimit !== null;
    this.timeLeft = options.timeLimit ?? MATCH_TIME;
    const diff = DIFFICULTY[options.difficulty ?? 'normal'];
    const rules: HordeRules = {
      base: ZOMBIE.base,
      perSurvivor: ZOMBIE.perSurvivor,
      progressBonus: ZOMBIE.progressBonus,
      max: ZOMBIE.max,
      ...options.horde,
    };
    this.horde = {
      ...rules,
      base: rules.base * diff.horde,
      perSurvivor: rules.perSurvivor * diff.horde,
      max: Math.round(rules.max * Math.min(1, diff.horde)),
    };
    this.sleepShare = Math.min(0.9, (options.sleepShare ?? SLEEP.share) * diff.sleepShare);
    this.zombieDamage = diff.damage;
    this.zombieSpeed = diff.zombieSpeed;
    this.goalRescue = options.goalRescue ?? true;
    this.mission = options.mission ?? null;
    const { start } = map.layout;
    this.spawnAt = options.spawn ?? { x: start.x, z: start.z, toward: map.route.pts[1] }; // first waypoint, or the hut

    const { props } = map;
    this.obstacles = new Obstacles([
      ...props.trees.filter((t) => t.collide).map((t) => ({ x: t.x, z: t.z, r: t.radius })),
      ...props.rocks.map((r) => ({ x: r.x, z: r.z, r: r.radius })),
      ...(map.layout.landmarks ?? []).map((l) => ({ x: l.x, z: l.z, r: l.r })),
    ]);
    this.bamboo = props.bambooSpots.map((b) => ({ ...b, active: true, respawn: 0 }));
    this.racks = props.racks.map((r) => ({ ...r }));

    this.buildStatic();
    specs.filter((s) => !s.npc).forEach((spec, i) => this.spawnSurvivor(spec, i));
    this.mission?.init(
      this,
      specs.filter((s) => s.npc),
    );
    this.spawnInitialHorde();
  }

  // ================================================================ public API

  step(inputs: ReadonlyMap<string, PlayerInput>): void {
    if (this.phase !== 'playing') return;
    this.tick++;
    if (this.timed) this.timeLeft = Math.max(0, this.timeLeft - SIM_DT);

    for (const s of this.survivors) {
      if (s.state === 'active') {
        const input = s.brain ? s.brain.think(s, this, SIM_DT) : (inputs.get(s.spec.id) ?? NO_INPUT);
        this.controlSurvivor(s, input);
      } else if (s.state === 'downed') {
        this.updateDowned(s);
      }
    }
    for (const z of this.zombies) this.controlZombie(z);

    this.world.step();

    for (const s of this.survivors) if (s.body) this.afterSurvivor(s);
    for (const z of this.zombies) this.afterZombie(z);
    this.updateJavelins();
    this.updateCrackers();
    this.updatePickups();
    this.mission?.step(this);
    this.updateSpawning();
    this.cleanupZombies();
    this.checkEnd();
    this.botsOut = this.countBotsOut();
    if (this.botsOut > 0 && this.doneClock === null) this.doneClock = this.timeLeft;
  }

  /**
   * Quick play, once every human is done and someone made it: stop waiting for the bots.
   * A win, timed from when the last human finished. False if that isn't the situation (any more).
   */
  endEarly(): boolean {
    if (this.phase !== 'playing' || this.botsOut === 0) return false;
    if (this.doneClock !== null) this.timeLeft = this.doneClock;
    this.botsOut = 0;
    this.phase = 'won';
    return true;
  }

  /** Current state plus all events since the previous call. */
  snapshot(): Snapshot {
    const events = this.events;
    this.events = [];
    return {
      tick: this.tick,
      timeLeft: this.clock,
      phase: this.phase,
      rescued: this.rescued,
      botsOut: this.botsOut,
      survivors: this.survivors.map((s) => ({
        id: s.spec.id,
        x: s.x,
        y: s.y,
        z: s.z,
        rot: s.rot,
        speed: s.speed,
        attackT: s.attackTime < 0 ? -1 : Math.min(1, s.attackTime / WEAPONS[s.weapon].duration),
        dashing: s.dashTime > 0,
        inWater: s.inWater,
        hidden: s.hidden,
        hp: Math.ceil(s.hp),
        state: s.state,
        weapon: s.weapon,
        ammo: s.ammo,
        bleed: s.state === 'downed' ? s.bleed : 0,
        revive: s.revive,
        hurt: s.hurt,
        kills: s.kills,
        crackers: s.crackers,
      })),
      zombies: this.zombies.map((z) => ({
        id: z.id,
        x: z.x,
        y: z.y,
        z: z.z,
        rot: z.rot,
        speed: z.speed,
        state: z.state,
        t: this.zombieProgress(z),
        look: z.look,
        hurt: z.hurt,
        from: z.from,
      })),
      javelins: this.javelins.map((j) => ({ id: j.id, x: j.x, y: j.y, z: j.z, yaw: j.yaw, pitch: j.pitch, flying: j.flying })),
      crackers: this.crackers.map((c) => ({ id: c.id, x: c.x, y: c.y, z: c.z, flying: c.flying })),
      crackerDrops: this.crackerDrops.map((d) => ({ id: d.id, x: d.x, y: d.y, z: d.z })),
      bamboo: this.bamboo.map((b) => b.active),
      racks: this.racks.map((r) => r.weapon),
      events,
      story: this.mission?.snapshot(),
    };
  }

  /** Seconds left on the clock, -1 when the match is untimed. */
  get clock(): number {
    return this.timed ? this.timeLeft : -1;
  }

  emit(ev: GameEvent): void {
    this.events.push(ev);
  }

  /** Puts a survivor on the map at (x, z), e.g. a story character, facing the hut. */
  addSurvivor(spec: PlayerSpec, x: number, z: number, brain: Brain | null): Survivor {
    const { goal } = this.map.layout;
    const s = this.placeSurvivor(spec, x, z, Math.atan2(goal.x - x, goal.z - z));
    s.brain = brain;
    return s;
  }

  /** A zombie that heads for the group wherever it is. False if (x, z) isn't a fair spot. */
  spawnHunter(x: number, z: number): boolean {
    if (!this.validSpawn(x, z)) return false;
    this.spawnZombie(x, z, null);
    this.zombies[this.zombies.length - 1].hunt = true;
    return true;
  }

  /** Something solid and round at (x, z), placed after the map was built (story machinery). */
  addBlock(x: number, z: number, r: number): void {
    const y = this.map.terrain.heightAt(x, z);
    this.world.createCollider(RAPIER.ColliderDesc.cylinder(1.5, r).setTranslation(x, y + 1, z));
    this.obstacles.add({ x, z, r });
  }

  /** Puts the story cart at (x, z) facing `yaw` (0 = +Z); moves it there smoothly after the first call. */
  placeCart(x: number, z: number, yaw: number): void {
    const y = this.map.terrain.heightAt(x, z) + CART_SIZE.halfHeight + 0.05;
    const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    if (!this.cartBody) {
      this.cartBody = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z).setRotation(rot),
      );
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(CART_SIZE.halfWidth, CART_SIZE.halfHeight, CART_SIZE.halfLength).setFriction(0),
        this.cartBody,
      );
    } else {
      this.cartBody.setNextKinematicTranslation({ x, y, z });
      this.cartBody.setNextKinematicRotation(rot);
    }
    this.cart = { x, z, r: CART_SIZE.halfLength };
  }

  /** Where bot buddies should stay right now (story: beside the cart), or null to just follow the leader. */
  guard(): { x: number; z: number; dx: number; dz: number } | null {
    return this.mission?.guard() ?? null;
  }

  /** Hand a player's panda to (or back from) the bot AI, e.g. when someone disconnects. */
  setBot(id: string, bot: boolean): void {
    const s = this.survivors.find((x) => x.spec.id === id);
    if (!s) return;
    s.spec = { ...s.spec, bot };
    s.brain = bot ? new BotBrain(this.survivors.indexOf(s)) : null;
  }

  dispose(): void {
    this.world.free();
  }

  /** Obstacle- and water-aware direction towards (dx, dz). Used by zombies and bots. */
  steer(x: number, z: number, dx: number, dz: number, avoidWater: boolean): { x: number; z: number } {
    let sx = dx;
    let sz = dz;
    const near = this.obstacles.near(x, z, 2.4, this.scratch);
    const cart = this.cart;
    if (cart && Math.hypot(cart.x - x, cart.z - z) < 2.4 + cart.r) near.push(cart);
    for (const o of near) {
      const ox = o.x - x;
      const oz = o.z - z;
      const od = Math.hypot(ox, oz) || 0.001;
      const gap = od - o.r;
      if (gap > 2) continue;
      const ahead = (ox * dx + oz * dz) / od;
      if (ahead < 0.3) continue;
      // Push sideways, away from the obstacle.
      let px = -dz;
      let pz = dx;
      if (px * ox + pz * oz > 0) {
        px = -px;
        pz = -pz;
      }
      const w = (1 - Math.max(0, gap) / 2) * ahead * 1.6;
      sx += px * w;
      sz += pz * w;
    }

    const t = this.map.terrain;
    if (t.ridges.length) {
      const wx = x + sx * 2.2;
      const wz = z + sz * 2.2;
      if (t.isWall(wx, wz)) {
        // Slide along the rock face: sideways to the slope, a bit away from it.
        const up = t.uphill(wx, wz);
        let tx = -up.z;
        let tz = up.x;
        if (tx * dx + tz * dz < 0) {
          tx = -tx;
          tz = -tz;
        }
        sx = tx - up.x * 0.5;
        sz = tz - up.z * 0.5;
      }
    }

    if (avoidWater) {
      const ax = x + sx * 1.6;
      const az = z + sz * 1.6;
      if (t.isWater(ax, az) || t.isWater(x, z)) {
        // Walk along the shore instead of into the water: sideways to the slope, a bit uphill.
        const up = t.uphill(ax, az);
        let tx = -up.z;
        let tz = up.x;
        if (tx * dx + tz * dz < 0) {
          tx = -tx;
          tz = -tz;
        }
        sx = tx + up.x * 0.5;
        sz = tz + up.z * 0.5;
      }
    }

    const l = Math.hypot(sx, sz) || 1;
    return { x: sx / l, z: sz / l };
  }

  /**
   * When deep water or a ridge blocks the straight way from (x, z) to (tx, tz): the next point to walk to
   * (the near end of the best bridge, ford or pass, or its far end once on it) and the total path length.
   * `wall` is set when a ridge is in the way (no swimming around that). `null` when the way is clear
   * or the map has no crossings.
   */
  detour(x: number, z: number, tx: number, tz: number): { x: number; z: number; cost: number; wall: boolean } | null {
    const crossings = this.map.terrain.crossings;
    if (!crossings.length) return null;
    const blocked = this.blockedBy(x, z, tx, tz);
    if (!blocked) return null;
    let bestCost = Infinity;
    let entry: { x: number; z: number } | null = null;
    let exit: { x: number; z: number } | null = null;
    for (const c of crossings) {
      for (const [e, o] of [
        [c.a, c.b],
        [c.b, c.a],
      ]) {
        const cost = Math.hypot(e.x - x, e.z - z) + c.length + Math.hypot(tx - o.x, tz - o.z);
        if (cost < bestCost) {
          bestCost = cost;
          entry = e;
          exit = o;
        }
      }
    }
    if (!entry || !exit) return null;
    if (Math.hypot(exit.x - x, exit.z - z) < 2.5) return null; // made it across
    // At the entry or already on the crossing: walk to the far end.
    const onIt = Math.hypot(entry.x - x, entry.z - z) < 2.5 || distToSegment(x, z, entry, exit) < 2.5;
    const p = onIt ? exit : entry;
    return { x: p.x, z: p.z, cost: bestCost, wall: blocked === 'wall' };
  }

  /** What's in the way on the straight line between two points: a ridge, deep water, or nothing. */
  private blockedBy(x: number, z: number, tx: number, tz: number): 'wall' | 'water' | null {
    const t = this.map.terrain;
    const n = Math.max(4, Math.min(16, Math.ceil(Math.hypot(tx - x, tz - z) / 3)));
    let water = false;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const px = x + (tx - x) * f;
      const pz = z + (tz - z) * f;
      if (t.ridges.length && t.isWall(px, pz)) return 'wall';
      if (!water && t.isWater(px, pz)) water = true;
    }
    return water ? 'water' : null;
  }

  // ================================================================ setup

  private buildStatic(): void {
    const { grid, props, layout } = this.map;
    const world = this.world;

    world.createCollider(RAPIER.ColliderDesc.trimesh(grid.positions, grid.indices).setFriction(0.3));

    const half = layout.size / 2;
    const len = half + 2;
    const walls: readonly [number, number, number, number][] = [
      [0, -half - 1, len, 1],
      [0, half + 1, len, 1],
      [-half - 1, 0, 1, len],
      [half + 1, 0, 1, len],
    ];
    for (const [x, z, hx, hz] of walls) {
      world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 30, hz).setTranslation(x, 0, z));
    }

    for (const t of props.trees) {
      if (t.collide) world.createCollider(RAPIER.ColliderDesc.cylinder(2, t.radius).setTranslation(t.x, t.y + 1.5, t.z));
    }
    // Boulders: as tall as they look (plus a bit underground for slopes), so nothing invisible sticks out.
    for (const r of props.rocks) {
      const below = 0.6;
      world.createCollider(
        RAPIER.ColliderDesc.cylinder((r.height + below) / 2, r.radius).setTranslation(r.x, r.y + (r.height - below) / 2, r.z),
      );
    }
    for (const l of layout.landmarks ?? []) {
      world.createCollider(RAPIER.ColliderDesc.cylinder(4, l.r).setTranslation(l.x, this.map.terrain.heightAt(l.x, l.z) + 2, l.z));
    }

    // Ridges: a chain of tall invisible boxes along the spine, skipping the passes.
    for (const r of this.map.terrain.ridges) {
      for (let s = 1; s < r.length; s += 2) {
        if (r.openAt(s) >= 0.5) continue;
        const p = r.at(r.fractionOf(s));
        const yaw = Math.atan2(-p.tz, p.tx);
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(1.2, 30, r.wallHalf)
            .setTranslation(p.x, 0, p.z)
            .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
        );
      }
    }

    // Bridges: a deck to walk on plus railings, so the crossing is a proper choke point.
    for (const b of this.map.terrain.bridges) {
      const yaw = Math.atan2(-b.dirZ, b.dirX);
      const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(b.halfLength, 0.2, b.halfWidth).setTranslation(b.x, b.top - 0.2, b.z).setRotation(rot).setFriction(0.3),
      );
      for (const side of [-1, 1]) {
        const off = side * (b.halfWidth - 0.08);
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(b.halfLength, 0.4, 0.08)
            .setTranslation(b.x - b.dirZ * off, b.top + 0.4, b.z + b.dirX * off)
            .setRotation(rot),
        );
      }
    }
  }

  private createBody(x: number, z: number): RigidBody {
    const y = this.map.terrain.heightAt(x, z);
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, y + CENTER_HEIGHT + 0.05, z)
        .lockRotations()
        .setCcdEnabled(true),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(SURVIVOR.halfHeight, SURVIVOR.radius).setFriction(0).setRestitution(0),
      body,
    );
    return body;
  }

  private spawnSurvivor(spec: PlayerSpec, index: number): void {
    const start = this.spawnAt;
    const first = start.toward;
    const [fwd, side] = SPAWN_OFFSETS[index % SPAWN_OFFSETS.length];
    const len = dist2d(start, first) || 1;
    const fx = (first.x - start.x) / len;
    const fz = (first.z - start.z) / len;
    const x = start.x + fx * fwd - fz * side;
    const z = start.z + fz * fwd + fx * side;
    this.placeSurvivor(spec, x, z, Math.atan2(first.x - x, first.z - z));
  }

  private placeSurvivor(spec: PlayerSpec, x: number, z: number, rot: number): Survivor {
    const s: Survivor = {
      spec,
      body: this.createBody(x, z),
      x,
      y: this.map.terrain.heightAt(x, z),
      z,
      rot,
      faceX: Math.sin(rot),
      faceZ: Math.cos(rot),
      speed: 0,
      inWater: false,
      hidden: false,
      hp: SURVIVOR.maxHp,
      state: 'active',
      weapon: spec.weapon,
      ammo: spec.weapon === 'javelin' ? JAVELIN.ammo : 0,
      kills: 0,
      attackTime: -1,
      attackHit: false,
      attackCd: 0,
      throwing: false,
      dashTime: 0,
      dashCd: 0,
      dashX: 0,
      dashZ: 0,
      bleed: 0,
      revive: 0,
      hurt: 0,
      lastRack: -1,
      crackers: CRACKER.start,
      crackerCd: 0,
      brain: spec.bot ? new BotBrain(this.survivors.length) : null,
      npc: !!spec.npc,
      shielded: false,
    };
    this.survivors.push(s);
    return s;
  }

  private spawnZombie(x: number, z: number, from: string | null, sleeper = false, asleep = false): void {
    const rot = this.rng.range(-Math.PI, Math.PI);
    this.zombies.push({
      id: this.nextZombieId++,
      body: this.createBody(x, z),
      x,
      y: this.map.terrain.heightAt(x, z),
      z,
      rot,
      faceX: Math.sin(rot),
      faceZ: Math.cos(rot),
      speed: 0,
      hp: ZOMBIE.hp,
      state: asleep ? 'sleep' : 'walk',
      stateTime: 0,
      stun: 0,
      hurt: 0,
      look: Math.floor(this.rng.next() * 4),
      from,
      sleeper,
      hunt: false,
      speedMul: this.rng.range(0.85, 1.1) * this.zombieSpeed,
      target: null,
      lure: null,
      via: null,
      retarget: 0,
      biteCd: 0,
      biteDone: false,
      lungeCd: this.rng.range(1, 4),
      lungeX: 0,
      lungeZ: 0,
      wanderT: 0,
      wanderX: 0,
      wanderZ: 0,
      groanCd: this.rng.range(2, 10),
    });
  }

  private spawnInitialHorde(): void {
    const want = this.desiredHorde();
    const half = this.map.layout.size / 2 - 3;
    for (let i = 0; i < 400 && this.zombies.length < want; i++) {
      const x = this.rng.range(-half, half);
      const z = this.rng.range(-half, half);
      if (dist2d({ x, z }, this.spawnAt) < 32) continue;
      if (this.validSpawn(x, z)) this.spawnZombie(x, z, null, true, this.rng.next() < this.sleepShare);
    }
  }

  // ================================================================ survivors

  private controlSurvivor(s: Survivor, inp: PlayerInput): void {
    const body = s.body;
    if (!body) return;

    let mx = inp.mx;
    let mz = inp.mz;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    const moving = ml > 0.08;
    const weapon = WEAPONS[s.weapon];

    s.attackCd = Math.max(0, s.attackCd - SIM_DT);
    s.dashCd = Math.max(0, s.dashCd - SIM_DT);
    s.dashTime = Math.max(0, s.dashTime - SIM_DT);

    if (inp.dash && s.dashCd === 0) {
      const len = Math.hypot(mx, mz);
      s.dashX = moving ? mx / len : s.faceX;
      s.dashZ = moving ? mz / len : s.faceZ;
      s.dashTime = SURVIVOR.dashTime;
      s.dashCd = SURVIVOR.dashCooldown;
      this.events.push({ e: 'dash', id: s.spec.id });
      this.noise(s.x, s.z, NOISE.dash);
    }

    s.crackerCd = Math.max(0, s.crackerCd - SIM_DT);
    if (inp.cracker && s.crackers > 0 && s.crackerCd === 0) this.throwCracker(s, inp);

    if (s.attackTime >= 0) {
      s.attackTime += SIM_DT;
      if (!s.attackHit && s.attackTime >= weapon.hitAt) {
        s.attackHit = true;
        if (s.throwing) this.throwJavelin(s);
        else this.melee(s, s.weapon === 'javelin' ? PAW : weapon);
      }
      if (s.attackTime >= weapon.duration) s.attackTime = -1;
    }
    if (inp.attack && s.attackCd === 0 && s.attackTime < 0) {
      s.throwing = s.weapon === 'javelin' && s.ammo > 0;
      this.aimAttack(s, inp);
      s.attackTime = 0;
      s.attackHit = false;
      s.attackCd = weapon.cooldown;
      if (!s.throwing) this.events.push({ e: 'swing', id: s.spec.id, w: s.weapon });
    }

    // Facing is locked while swinging.
    if (s.attackTime < 0 && moving) {
      const len = Math.hypot(mx, mz);
      s.faceX = mx / len;
      s.faceZ = mz / len;
    }
    s.rot = approachAngle(s.rot, Math.atan2(s.faceX, s.faceZ), SURVIVOR.turnSpeed * SIM_DT);

    let tx: number;
    let tz: number;
    if (s.dashTime > 0) {
      tx = s.dashX * SURVIVOR.dashSpeed;
      tz = s.dashZ * SURVIVOR.dashSpeed;
    } else {
      let speed = SURVIVOR.speed;
      if (s.inWater) speed *= SURVIVOR.waterSpeedMul;
      if (s.attackTime >= 0) speed *= SURVIVOR.attackMoveMul;
      tx = mx * speed;
      tz = mz * speed;
    }
    const grip = this.map.terrain.isIce(s.x, s.z) ? ICE_GRIP : 1;
    this.drive(body, tx, tz, s.dashTime > 0 ? Infinity : SURVIVOR.accel * grip);
  }

  /** Explicit aim wins; otherwise snap towards the closest zombie (or one ahead for throws). */
  private aimAttack(s: Survivor, inp: PlayerInput): void {
    const aimLen = Math.hypot(inp.ax, inp.az);
    if (aimLen > 0.1) {
      this.face(s, inp.ax / aimLen, inp.az / aimLen);
      return;
    }
    let best: Zombie | null = null;
    let bestScore = Infinity;
    for (const z of this.zombies) {
      if (z.state === 'dying') continue;
      const dx = z.x - s.x;
      const dz = z.z - s.z;
      const d = Math.hypot(dx, dz);
      let score: number;
      if (d < 2.6) score = d;
      else if (s.throwing && d < 12 && (dx * s.faceX + dz * s.faceZ) / d > 0.75) score = d + 3;
      else continue;
      if (score < bestScore) {
        bestScore = score;
        best = z;
      }
    }
    if (best) {
      const d = dist2d(best, s) || 1;
      this.face(s, (best.x - s.x) / d, (best.z - s.z) / d);
    }
  }

  private face(s: Survivor, x: number, z: number): void {
    s.faceX = x;
    s.faceZ = z;
    s.rot = Math.atan2(x, z);
  }

  private melee(s: Survivor, w: MeleeDef): void {
    for (const z of this.zombies) {
      if (z.state === 'dying') continue;
      const dx = z.x - s.x;
      const dz = z.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > w.range + ZOMBIE.radius) continue;
      if (d > 0.3) {
        const cos = (dx * s.faceX + dz * s.faceZ) / d;
        if (Math.acos(Math.max(-1, Math.min(1, cos))) > w.arc / 2) continue;
      }
      const nx = d > 0.01 ? dx / d : s.faceX;
      const nz = d > 0.01 ? dz / d : s.faceZ;
      this.damageZombie(z, w.damage, nx, nz, w.knockback, w.stun, s);
    }
    // After the hits, so a sneak attack lands before its own noise wakes the victim.
    this.noise(s.x, s.z, NOISE.swing[s.weapon]);
  }

  private throwJavelin(s: Survivor): void {
    s.ammo = Math.max(0, s.ammo - 1);
    const yaw = Math.atan2(s.faceX, s.faceZ);
    this.javelins.push({
      id: this.nextJavelinId++,
      owner: s,
      x: s.x + s.faceX * 0.5,
      y: s.y + 1.25,
      z: s.z + s.faceZ * 0.5,
      vx: s.faceX * JAVELIN.speed,
      vy: JAVELIN.lift,
      vz: s.faceZ * JAVELIN.speed,
      yaw,
      pitch: Math.atan2(JAVELIN.lift, JAVELIN.speed),
      flying: true,
      age: 0,
    });
    this.events.push({ e: 'throw', id: s.spec.id });
  }

  private throwCracker(s: Survivor, inp: PlayerInput): void {
    const aimLen = Math.hypot(inp.ax, inp.az);
    const dx = aimLen > 0.1 ? inp.ax / aimLen : s.faceX;
    const dz = aimLen > 0.1 ? inp.az / aimLen : s.faceZ;
    s.crackers--;
    s.crackerCd = CRACKER.cooldown;
    this.crackers.push({
      id: this.nextCrackerId++,
      x: s.x + dx * 0.5,
      y: s.y + 1.2,
      z: s.z + dz * 0.5,
      vx: dx * CRACKER.speed,
      vy: CRACKER.lift,
      vz: dz * CRACKER.speed,
      flying: true,
      age: 0,
      fuse: 0,
      popCd: 0,
    });
    this.events.push({ e: 'toss', id: s.spec.id });
  }

  private hurtSurvivor(s: Survivor, damage: number): void {
    if (s.state !== 'active') return;
    s.hp -= damage;
    s.hurt = 1;
    this.events.push({ e: 'bite', id: s.spec.id });
    if (s.hp > 0) return;

    s.hp = 0;
    s.state = 'downed';
    s.bleed = this.someoneElseActive(s) ? DOWNED.bleedTime : DOWNED.aloneBleedTime;
    s.revive = 0;
    s.attackTime = -1;
    s.dashTime = 0;
    this.events.push({ e: 'downed', id: s.spec.id });
  }

  private someoneElseActive(s: Survivor): boolean {
    return this.survivors.some((o) => o !== s && o.state === 'active');
  }

  private updateDowned(s: Survivor): void {
    if (s.body) this.drive(s.body, 0, 0, SURVIVOR.accel);

    const helped = this.survivors.some(
      (o) => o !== s && o.state === 'active' && dist2d(o, s) < DOWNED.reviveRadius,
    );
    if (helped) {
      s.revive += SIM_DT / DOWNED.reviveTime;
      if (s.revive >= 1) {
        s.state = 'active';
        s.hp = DOWNED.reviveHp;
        s.revive = 0;
        s.bleed = 0;
        this.events.push({ e: 'revived', id: s.spec.id });
      }
      return; // bleeding pauses while someone is helping
    }

    s.revive = Math.max(0, s.revive - SIM_DT * 0.5);
    if (!this.someoneElseActive(s)) s.bleed = Math.min(s.bleed, DOWNED.aloneBleedTime);
    s.bleed -= SIM_DT;
    if (s.bleed <= 0) this.turnIntoZombie(s);
  }

  private turnIntoZombie(s: Survivor): void {
    s.state = 'dead';
    s.bleed = 0;
    if (s.body) {
      this.world.removeRigidBody(s.body);
      s.body = null;
    }
    this.spawnZombie(s.x, s.z, s.spec.id);
    this.events.push({ e: 'turned', id: s.spec.id });
  }

  private afterSurvivor(s: Survivor): void {
    const body = s.body;
    if (!body) return;
    const p = body.translation();
    const v = body.linvel();
    const wasInWater = s.inWater;
    s.x = p.x;
    s.y = p.y - CENTER_HEIGHT;
    s.z = p.z;
    s.speed = Math.hypot(v.x, v.z);
    s.inWater = this.map.terrain.isWet(p.x, p.z);
    s.hidden = s.attackTime < 0 && this.map.layout.thickets.some((t) => dist2d(t, s) < t.r);
    s.hurt = Math.max(0, s.hurt - SIM_DT * 3);
    if (s.inWater && !wasInWater) {
      this.events.push({ e: 'splash', x: r1(s.x), z: r1(s.z) });
      this.noise(s.x, s.z, NOISE.splash);
    }
    if (s.state === 'active') this.footsteps(s);

    if (p.y < -20) {
      // Fell through the world somehow: put them back at the start.
      const { start } = this.map.layout;
      body.setTranslation({ x: start.x, y: this.map.terrain.heightAt(start.x, start.z) + 2, z: start.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    if (this.goalRescue && s.state === 'active' && dist2d(s, this.map.layout.goal) < GOAL_RADIUS) {
      s.state = 'rescued';
      s.speed = 0;
      this.rescued++;
      this.world.removeRigidBody(body);
      s.body = null;
      this.events.push({ e: 'rescued', id: s.spec.id });
    }
  }

  // ================================================================ zombies

  private controlZombie(z: Zombie): void {
    if (z.state === 'dying') {
      z.stateTime += SIM_DT;
      return;
    }
    const body = z.body;
    if (!body) return;

    z.biteCd = Math.max(0, z.biteCd - SIM_DT);
    z.lungeCd = Math.max(0, z.lungeCd - SIM_DT);
    z.retarget -= SIM_DT;
    z.groanCd -= SIM_DT;

    if (z.stun > 0) {
      z.stun -= SIM_DT;
      z.stateTime += SIM_DT;
      const v = body.linvel();
      body.setLinvel({ x: v.x * 0.9, y: v.y, z: v.z * 0.9 }, true);
      if (z.stun > 0) return;
      z.state = 'walk';
    }

    if (z.state === 'sleep') {
      this.drive(body, 0, 0, ZOMBIE.accel);
      if (z.groanCd <= 0) {
        z.groanCd = this.rng.range(SLEEP.snoreMin, SLEEP.snoreMax);
        if (this.survivors.some((s) => s.state === 'active' && dist2d(s, z) < SLEEP.snoreRange)) {
          this.events.push({ e: 'snore', x: r1(z.x), z: r1(z.z) });
        }
      }
      return;
    }
    if (z.state === 'wake') {
      // Getting up, turning towards whatever woke it.
      z.stateTime += SIM_DT;
      z.rot = approachAngle(z.rot, Math.atan2(z.faceX, z.faceZ), ZOMBIE.turnSpeed * SIM_DT);
      this.drive(body, 0, 0, ZOMBIE.accel);
      if (z.stateTime < SLEEP.wakeTime) return;
      z.state = 'walk';
      z.stateTime = 0;
      z.retarget = 0;
      z.groanCd = this.rng.range(5, 12);
      this.events.push({ e: 'groan', x: r1(z.x), z: r1(z.z) });
      this.noise(z.x, z.z, NOISE.groan);
    }

    if (z.retarget <= 0) {
      z.retarget = 0.25 + this.rng.next() * 0.1;
      const victim = this.pickTarget(z);
      const lure = this.lureFor(z);
      if (lure && !(victim && dist2d(victim, z) < CRACKER.ignoreNear)) {
        // A crackling firecracker beats a survivor who isn't right in its face.
        z.target = null;
        z.lure = { x: lure.x, z: lure.z };
        z.via = this.detour(z.x, z.z, lure.x, lure.z);
      } else {
        z.lure = null;
        z.target = victim;
        z.via = victim ? this.detour(z.x, z.z, victim.x, victim.z) : null;
      }
    }
    const t = z.target && z.target.state === 'active' ? z.target : null;

    let dirX = 0;
    let dirZ = 0;
    let speed = 0;

    if (z.state === 'bite') {
      z.stateTime += SIM_DT;
      if (t) this.faceZombie(z, t.x - z.x, t.z - z.z);
      if (!z.biteDone && z.stateTime >= ZOMBIE.biteWindup) {
        z.biteDone = true;
        if (t && dist2d(t, z) < ZOMBIE.biteReach) this.hurtSurvivor(t, ZOMBIE.biteDamage * this.zombieDamage);
      }
      if (z.stateTime >= ZOMBIE.biteTime) {
        z.state = 'walk';
        z.biteCd = ZOMBIE.biteCooldown;
      }
    } else if (z.state === 'lunge') {
      z.stateTime += SIM_DT;
      dirX = z.lungeX;
      dirZ = z.lungeZ;
      speed = ZOMBIE.lungeSpeed;
      if (t && !z.biteDone && dist2d(t, z) < 1.1) {
        z.biteDone = true;
        this.hurtSurvivor(t, ZOMBIE.lungeDamage * this.zombieDamage);
      }
      if (z.stateTime >= ZOMBIE.lungeTime) z.state = 'walk';
    } else if (z.lure) {
      // Gather round the firecracker (via a bridge or pass if needed).
      const lx = z.lure.x - z.x;
      const lz = z.lure.z - z.z;
      const ld = Math.hypot(lx, lz) || 0.001;
      const goal = z.via ?? z.lure;
      const gx = goal.x - z.x;
      const gz = goal.z - z.z;
      const gl = Math.hypot(gx, gz) || 0.001;
      dirX = gx / gl;
      dirZ = gz / gl;
      speed = !z.via && ld < 1.4 ? 0 : ZOMBIE.speed * z.speedMul;
      if (speed === 0) this.faceZombie(z, lx, lz);
    } else if (t) {
      const dx = t.x - z.x;
      const dz = t.z - z.z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (d < ZOMBIE.biteRange && z.biteCd === 0) {
        z.state = 'bite';
        z.stateTime = 0;
        z.biteDone = false;
      } else if (d > ZOMBIE.lungeMin && d < ZOMBIE.lungeMax && z.lungeCd === 0 && this.rng.next() < ZOMBIE.lungeChance) {
        z.state = 'lunge';
        z.stateTime = 0;
        z.biteDone = false;
        z.lungeX = dx / d;
        z.lungeZ = dz / d;
        z.lungeCd = this.rng.range(4, 7);
        this.faceZombie(z, dx, dz);
      } else if (z.via) {
        // Water in the way: head for the bridge or ford first.
        const vx = z.via.x - z.x;
        const vz = z.via.z - z.z;
        const vl = Math.hypot(vx, vz) || 0.001;
        dirX = vx / vl;
        dirZ = vz / vl;
        speed = ZOMBIE.speed * z.speedMul;
      } else {
        dirX = dx / d;
        dirZ = dz / d;
        speed = d < 0.9 ? 0 : ZOMBIE.speed * z.speedMul;
        if (speed === 0) this.faceZombie(z, dx, dz);
      }
    } else {
      z.wanderT -= SIM_DT;
      if (z.wanderT <= 0) {
        z.wanderT = this.rng.range(2, 4);
        const a = this.rng.range(0, Math.PI * 2);
        const still = this.rng.next() < 0.3;
        z.wanderX = still ? 0 : Math.cos(a);
        z.wanderZ = still ? 0 : Math.sin(a);
      }
      dirX = z.wanderX;
      dirZ = z.wanderZ;
      speed = ZOMBIE.wanderSpeed;
    }

    if (speed > 0 && z.state !== 'lunge' && this.map.terrain.isWet(z.x, z.z)) speed *= ZOMBIE.wadeSpeedMul;

    if (speed > 0 && (dirX !== 0 || dirZ !== 0)) {
      if (z.state !== 'lunge') {
        const st = this.steer(z.x, z.z, dirX, dirZ, true);
        dirX = st.x;
        dirZ = st.z;
      }
      z.faceX = dirX;
      z.faceZ = dirZ;
    }

    // Personal space: zombies spread out instead of stacking.
    let sepX = 0;
    let sepZ = 0;
    for (const o of this.zombies) {
      if (o === z || o.state === 'dying') continue;
      const dx = z.x - o.x;
      const dz = z.z - o.z;
      const d = Math.hypot(dx, dz);
      if (d < 1 && d > 0.001) {
        sepX += (dx / d) * (1 - d);
        sepZ += (dz / d) * (1 - d);
      }
    }

    // Zombies can't swim: if one ends up in the water, shove it back uphill to the shore.
    if (this.map.terrain.isWater(z.x, z.z)) {
      const up = this.map.terrain.uphill(z.x, z.z);
      sepX += up.x * 3;
      sepZ += up.z * 3;
    }

    z.rot = approachAngle(z.rot, Math.atan2(z.faceX, z.faceZ), ZOMBIE.turnSpeed * SIM_DT);
    const grip = this.map.terrain.isIce(z.x, z.z) ? ICE_GRIP : 1;
    this.drive(body, dirX * speed + sepX * 1.5, dirZ * speed + sepZ * 1.5, z.state === 'lunge' ? Infinity : ZOMBIE.accel * grip);

    if (z.groanCd <= 0) {
      z.groanCd = this.rng.range(5, 12);
      if (t) this.events.push({ e: 'groan', x: z.x, z: z.z });
    }
  }

  private faceZombie(z: Zombie, dx: number, dz: number): void {
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return;
    z.faceX = dx / d;
    z.faceZ = dz / d;
  }

  private pickTarget(z: Zombie): Survivor | null {
    let best: Survivor | null = null;
    let bestD = Infinity;
    for (const s of this.survivors) {
      if (s.state !== 'active' || s.shielded) continue;
      const d = dist2d(s, z);
      let sense = s.hidden ? ZOMBIE.hiddenSense : ZOMBIE.sense;
      if (s === z.target) sense *= 1.3; // stick with the current victim a bit longer
      if (z.hunt) sense = Infinity;
      if (d < sense && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private damageZombie(z: Zombie, damage: number, nx: number, nz: number, knockback: number, stun: number, by: Survivor | null): void {
    // Sneak attack: a sleeping zombie never sees it coming.
    z.hp -= z.state === 'sleep' ? damage * SLEEP.sneakAttackMul : damage;
    z.hurt = 1;
    const kill = z.hp <= 0;
    this.events.push({ e: 'hit', x: r1(z.x), y: r1(z.y + 0.9), z: r1(z.z), kill });
    if (kill) {
      z.state = 'dying';
      z.stateTime = 0;
      z.speed = 0;
      if (z.body) {
        this.world.removeRigidBody(z.body);
        z.body = null;
      }
      if (by) by.kills++;
      if (this.rng.next() < CRACKER.dropChance) this.dropCracker(z.x, z.z);
      return;
    }
    z.state = 'stun';
    z.stateTime = 0;
    z.stun = Math.max(z.stun, stun);
    if (z.body) {
      const v = z.body.linvel();
      z.body.setLinvel({ x: nx * knockback, y: Math.min(v.y, 0) + knockback * 0.15, z: nz * knockback }, true);
    }
  }

  private afterZombie(z: Zombie): void {
    z.hurt = Math.max(0, z.hurt - SIM_DT * 4);
    const body = z.body;
    if (!body) return;
    const p = body.translation();
    const v = body.linvel();
    z.x = p.x;
    z.y = p.y - CENTER_HEIGHT;
    z.z = p.z;
    z.speed = Math.hypot(v.x, v.z);
    if (p.y < -20) {
      z.state = 'dying';
      z.stateTime = ZOMBIE.dyingTime;
    }
  }

  private zombieProgress(z: Zombie): number {
    switch (z.state) {
      case 'bite':
        return Math.min(1, z.stateTime / ZOMBIE.biteTime);
      case 'lunge':
        return Math.min(1, z.stateTime / ZOMBIE.lungeTime);
      case 'dying':
        return Math.min(1, z.stateTime / ZOMBIE.dyingTime);
      case 'wake':
        return Math.min(1, z.stateTime / SLEEP.wakeTime);
      case 'stun':
        return z.stateTime;
      default:
        return 0;
    }
  }

  private desiredHorde(): number {
    const alive = this.survivors.filter((s) => !s.npc && (s.state === 'active' || s.state === 'downed')).length;
    const h = this.horde;
    const raw = (h.base + h.perSurvivor * alive) * (1 + h.progressBonus * this.progress());
    return Math.min(h.max, Math.round(raw));
  }

  /** 0 at the start camp, 1 at the rescue hut (best survivor). */
  private progress(): number {
    let best = 0;
    for (const s of this.survivors) {
      if (s.state === 'dead' || s.npc) continue;
      const { route } = this.map;
      const p = s.state === 'rescued' ? 1 : route.locate(s.x, s.z).along / route.length;
      best = Math.max(best, p);
    }
    return Math.max(0, Math.min(1, best));
  }

  private validSpawn(x: number, z: number): boolean {
    const { layout, terrain } = this.map;
    const half = layout.size / 2 - 3;
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    if (terrain.isWater(x, z) || terrain.ridgeAmount(x, z) > 0.15) return false;
    if (dist2d({ x, z }, layout.start) < layout.start.r + 8) return false;
    if (dist2d({ x, z }, layout.goal) < layout.goal.r + 2) return false;
    if (this.cart && dist2d({ x, z }, this.cart) < this.cart.r + 1) return false;
    if (this.survivors.some((s) => s.state !== 'dead' && s.state !== 'rescued' && dist2d(s, { x, z }) < ZOMBIE.safeRadius)) return false;
    return this.obstacles.near(x, z, 0.8, this.scratch).length === 0;
  }

  private updateSpawning(): void {
    const anchors = this.survivors.filter((s) => !s.npc && (s.state === 'active' || s.state === 'downed'));
    if (!anchors.length) return;
    this.spawnTimer -= SIM_DT;
    const alive = this.zombies.reduce((n, z) => n + (z.state === 'dying' ? 0 : 1), 0);
    if (alive >= this.desiredHorde() || this.spawnTimer > 0) return;
    this.spawnTimer = ZOMBIE.spawnInterval;

    for (let tries = 0; tries < 8; tries++) {
      const a = this.rng.pick(anchors);
      // Mostly spawn ahead of the group (along the route), sometimes from anywhere.
      const next = this.map.route.locate(a.x, a.z).next;
      const toGoal = Math.atan2(next.x - a.x, next.z - a.z);
      const ang = this.rng.next() < 0.6 ? toGoal + this.rng.range(-1.2, 1.2) : this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(ZOMBIE.spawnMin, ZOMBIE.spawnMax);
      const x = a.x + Math.sin(ang) * d;
      const z = a.z + Math.cos(ang) * d;
      if (this.validSpawn(x, z)) {
        this.spawnZombie(x, z, null);
        return;
      }
    }
  }

  private cleanupZombies(): void {
    const anchors = this.survivors.filter((s) => !s.npc && (s.state === 'active' || s.state === 'downed'));
    let rearmost = -1; // route distance of the furthest-behind survivor, worked out on demand
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      let remove = false;
      if (z.state === 'dying') remove = z.stateTime >= ZOMBIE.dyingTime;
      else if (!z.target && z.from === null && anchors.length > 0) {
        // Recycle stragglers left far behind.
        const far = anchors.every((s) => dist2d(s, z) > ZOMBIE.despawnRadius);
        if (!far) z.sleeper = false;
        else if (!z.sleeper) remove = true;
        else {
          // The starting horde waits out on the map until the whole group is past it.
          const { route } = this.map;
          if (rearmost < 0) rearmost = Math.min(...anchors.map((s) => route.locate(s.x, s.z).along));
          remove = route.locate(z.x, z.z).along < rearmost;
        }
      }
      if (!remove) continue;
      if (z.body) this.world.removeRigidBody(z.body);
      this.zombies.splice(i, 1);
    }
  }

  // ================================================================ javelins & pickups

  private updateJavelins(): void {
    const terrain = this.map.terrain;
    const half = this.map.layout.size / 2 - 1;
    for (let i = this.javelins.length - 1; i >= 0; i--) {
      const j = this.javelins[i];
      j.age += SIM_DT;
      if (!j.flying) {
        if (j.age > JAVELIN.groundLife) this.javelins.splice(i, 1);
        continue;
      }

      j.vy -= JAVELIN.gravity * SIM_DT;
      const nx = j.x + j.vx * SIM_DT;
      const ny = j.y + j.vy * SIM_DT;
      const nz = j.z + j.vz * SIM_DT;
      j.pitch = Math.atan2(j.vy, Math.hypot(j.vx, j.vz));

      let landed = false;
      for (const z of this.zombies) {
        if (z.state === 'dying') continue;
        if (Math.hypot(nx - z.x, nz - z.z) < JAVELIN.hitRadius && ny > z.y && ny < z.y + 1.7) {
          const sp = Math.hypot(j.vx, j.vz) || 1;
          this.damageZombie(z, JAVELIN.damage, j.vx / sp, j.vz / sp, JAVELIN.knockback, JAVELIN.stun, j.owner);
          this.dropJavelin(j, z.x, z.z, 0);
          landed = true;
          break;
        }
      }
      if (landed) continue;

      const ground = terrain.groundAt(nx, nz);
      const hitTree = this.obstacles.near(nx, nz, 0.05, this.scratch).length > 0 && ny < ground + 4.5;
      const outside = Math.abs(nx) > half || Math.abs(nz) > half;
      if (hitTree || outside || ny <= ground + 0.05 || j.age > JAVELIN.maxAge) {
        this.dropJavelin(j, hitTree || outside ? j.x : nx, hitTree || outside ? j.z : nz, -0.5);
        continue;
      }
      j.x = nx;
      j.y = ny;
      j.z = nz;
    }
  }

  private dropJavelin(j: Javelin, x: number, z: number, pitch: number): void {
    const half = this.map.layout.size / 2 - 2;
    j.x = Math.max(-half, Math.min(half, x));
    j.z = Math.max(-half, Math.min(half, z));
    j.y = this.map.terrain.groundAt(j.x, j.z) + (pitch < 0 ? 0.35 : 0.08);
    j.pitch = pitch;
    j.flying = false;
    j.age = 0;
    if (this.map.terrain.isWet(j.x, j.z)) this.events.push({ e: 'splash', x: r1(j.x), z: r1(j.z) });
    else this.events.push({ e: 'thud', x: r1(j.x), y: r1(j.y), z: r1(j.z) });
    this.noise(j.x, j.z, NOISE.thud);
  }

  // ================================================================ noise & firecrackers

  /** Something loud at (x, z): sleeping zombies within `radius` wake up and turn towards it. */
  private noise(x: number, z: number, radius: number): void {
    for (const zb of this.zombies) {
      if (zb.state !== 'sleep' || Math.hypot(zb.x - x, zb.z - z) > radius) continue;
      zb.state = 'wake';
      zb.stateTime = 0;
      this.faceZombie(zb, x - zb.x, z - zb.z);
      this.events.push({ e: 'wake', x: r1(zb.x), z: r1(zb.z) });
    }
  }

  /** Walking slowly is almost silent; running is heard several metres away. */
  private footsteps(s: Survivor): void {
    const f = s.speed / SURVIVOR.speed;
    if (f < 0.05 || s.dashTime > 0) return;
    let r = f <= NOISE.sneakFrac ? NOISE.sneak : NOISE.sneak + ((NOISE.run - NOISE.sneak) * (f - NOISE.sneakFrac)) / (1 - NOISE.sneakFrac);
    if (s.hidden) r *= NOISE.thicketMul;
    this.noise(s.x, s.z, r);
  }

  /** The nearest crackling firecracker close enough to pull this zombie in. */
  private lureFor(z: Zombie): Cracker | null {
    let best: Cracker | null = null;
    let bestD: number = CRACKER.lure;
    for (const c of this.crackers) {
      if (c.flying) continue;
      const d = dist2d(c, z);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  private updateCrackers(): void {
    const terrain = this.map.terrain;
    const half = this.map.layout.size / 2 - 1;
    for (let i = this.crackers.length - 1; i >= 0; i--) {
      const c = this.crackers[i];
      c.age += SIM_DT;

      if (c.flying) {
        c.vy -= CRACKER.gravity * SIM_DT;
        const nx = c.x + c.vx * SIM_DT;
        const ny = c.y + c.vy * SIM_DT;
        const nz = c.z + c.vz * SIM_DT;
        const ground = terrain.groundAt(nx, nz);
        const hitTree = this.obstacles.near(nx, nz, 0.05, this.scratch).length > 0 && ny < ground + 4.5;
        const outside = Math.abs(nx) > half || Math.abs(nz) > half;
        if (hitTree || outside || ny <= ground + 0.05 || c.age > 3) {
          // Bounce off a tree or the map edge: it drops where it was.
          if (!this.landCracker(c, hitTree || outside ? c.x : nx, hitTree || outside ? c.z : nz)) this.crackers.splice(i, 1);
          continue;
        }
        c.x = nx;
        c.y = ny;
        c.z = nz;
        continue;
      }

      c.fuse -= SIM_DT;
      c.popCd -= SIM_DT;
      if (c.popCd <= 0) {
        c.popCd = this.rng.range(0.12, 0.32);
        this.events.push({ e: 'pop', x: r1(c.x), y: r1(c.y), z: r1(c.z) });
      }
      if (c.fuse <= 0) {
        this.bang(c);
        this.crackers.splice(i, 1);
      }
    }
  }

  /** Puts a firecracker down to crackle. False when it fizzles out in water. */
  private landCracker(c: Cracker, x: number, z: number): boolean {
    const half = this.map.layout.size / 2 - 2;
    c.x = Math.max(-half, Math.min(half, x));
    c.z = Math.max(-half, Math.min(half, z));
    if (this.map.terrain.isWet(c.x, c.z)) {
      this.events.push({ e: 'splash', x: r1(c.x), z: r1(c.z) });
      return false;
    }
    c.y = this.map.terrain.groundAt(c.x, c.z) + 0.1;
    c.flying = false;
    c.fuse = CRACKER.popTime;
    c.popCd = 0;
    this.noise(c.x, c.z, CRACKER.lure);
    return true;
  }

  /** The final bang: loud, and it knocks over (but doesn't hurt) anything right next to it. */
  private bang(c: Cracker): void {
    this.events.push({ e: 'bang', x: r1(c.x), y: r1(c.y), z: r1(c.z) });
    this.noise(c.x, c.z, CRACKER.lure);
    for (const z of this.zombies) {
      if (z.state === 'dying' || !z.body) continue;
      const dx = z.x - c.x;
      const dz = z.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > CRACKER.bangRadius) continue;
      z.state = 'stun';
      z.stateTime = 0;
      z.stun = Math.max(z.stun, CRACKER.bangStun);
      z.lure = null;
      const nx = d > 0.01 ? dx / d : 1;
      const nz = d > 0.01 ? dz / d : 0;
      const v = z.body.linvel();
      z.body.setLinvel({ x: nx * CRACKER.bangKnockback, y: Math.min(v.y, 0) + 2, z: nz * CRACKER.bangKnockback }, true);
    }
  }

  private dropCracker(x: number, z: number): void {
    const terrain = this.map.terrain;
    if (terrain.isWet(x, z)) return;
    if (this.crackerDrops.length >= CRACKER.maxDrops) this.crackerDrops.shift();
    this.crackerDrops.push({ id: this.nextCrackerId++, x, y: terrain.groundAt(x, z) + 0.05, z, age: 0 });
  }

  private updatePickups(): void {
    const active = this.survivors.filter((s) => s.state === 'active');

    for (const b of this.bamboo) {
      if (!b.active) {
        b.respawn -= SIM_DT;
        if (b.respawn <= 0) b.active = true;
        continue;
      }
      const eater = active.find((s) => s.hp < SURVIVOR.maxHp && dist2d(s, b) < PICKUP.bambooRadius);
      if (!eater) continue;
      eater.hp = Math.min(SURVIVOR.maxHp, eater.hp + PICKUP.bambooHeal);
      b.active = false;
      b.respawn = PICKUP.bambooRespawn;
      this.events.push({ e: 'eat', id: eater.spec.id });
    }

    this.racks.forEach((r, i) => {
      for (const s of active) {
        const d = dist2d(s, r);
        if (s.lastRack === i) {
          if (d > PICKUP.rackLeave) s.lastRack = -1;
          continue;
        }
        if (d > PICKUP.rackRadius || r.weapon === s.weapon) continue;
        const old = s.weapon;
        s.weapon = r.weapon;
        r.weapon = old;
        s.ammo = s.weapon === 'javelin' ? JAVELIN.ammo : 0;
        s.attackTime = -1;
        s.lastRack = i;
        this.events.push({ e: 'swap', id: s.spec.id, w: s.weapon });
      }
    });

    for (let i = this.javelins.length - 1; i >= 0; i--) {
      const j = this.javelins[i];
      if (j.flying) continue;
      const taker = active.find(
        (s) => s.weapon === 'javelin' && s.ammo < JAVELIN.ammo && dist2d(s, j) < JAVELIN.pickupRadius,
      );
      if (!taker) continue;
      taker.ammo++;
      this.javelins.splice(i, 1);
      this.events.push({ e: 'grab', id: taker.spec.id });
    }

    for (let i = this.crackerDrops.length - 1; i >= 0; i--) {
      const d = this.crackerDrops[i];
      d.age += SIM_DT;
      if (d.age > CRACKER.dropLife) {
        this.crackerDrops.splice(i, 1);
        continue;
      }
      const taker = active.find((s) => s.crackers < CRACKER.max && dist2d(s, d) < CRACKER.pickupRadius);
      if (!taker) continue;
      taker.crackers++;
      this.crackerDrops.splice(i, 1);
      this.events.push({ e: 'loot', id: taker.spec.id });
    }
  }

  // ================================================================ misc

  /** Accelerate a body towards a horizontal target velocity, keeping its vertical speed. */
  private drive(body: RigidBody, tx: number, tz: number, accel: number): void {
    const v = body.linvel();
    let dx = tx - v.x;
    let dz = tz - v.z;
    const dl = Math.hypot(dx, dz);
    const maxDv = accel * SIM_DT;
    if (dl > maxDv) {
      dx *= maxDv / dl;
      dz *= maxDv / dl;
    }
    // Cap upward speed so bumps in the terrain don't launch anyone.
    body.setLinvel({ x: v.x + dx, y: Math.min(v.y, 4), z: v.z + dz }, true);
  }

  private checkEnd(): void {
    const m = this.mission;
    if (m) {
      // Story: the mission decides; it's lost when the player is gone (bots alone can't do the objectives).
      if (!m.outcome && !this.survivors.some((s) => !s.spec.bot && (s.state === 'active' || s.state === 'downed'))) m.lose('wiped');
      if (!m.outcome && this.timed && this.timeLeft <= 0) m.lose('time');
      if (m.outcome) this.phase = m.outcome;
      return;
    }
    const stillPlaying = this.survivors.some((s) => s.state === 'active' || s.state === 'downed');
    if (!stillPlaying || this.timeLeft <= 0) this.phase = this.rescued > 0 ? 'won' : 'lost';
  }

  /** Bots still playing when no human is (a guest who left counts as a bot) and at least one human made it; else 0. */
  private countBotsOut(): number {
    if (this.mission || this.phase !== 'playing') return 0;
    let bots = 0;
    let humanSaved = false;
    for (const s of this.survivors) {
      const playing = s.state === 'active' || s.state === 'downed';
      if (s.spec.bot) {
        if (playing) bots++;
      } else if (playing) {
        return 0;
      } else if (s.state === 'rescued') {
        humanSaved = true;
      }
    }
    return humanSaved ? bots : 0;
  }
}
