import type { RigidBody, World } from '@dimforge/rapier3d-compat';
import { DOWNED, GOAL_RADIUS, GRAVITY, JAVELIN, MATCH_TIME, PICKUP, SIM_DT, SURVIVOR, ZOMBIE } from '../config';
import { approachAngle } from '../core/math';
import { Rng } from '../core/rng';
import { BotBrain, type BotWorld } from './bots';
import type { BambooSpot, Javelin, RackSlot, Survivor, Zombie } from './entities';
import type { GameMap } from './gameMap';
import type { Circle } from './mapLayout';
import { RAPIER } from './physics';
import { Obstacles } from './steering';
import { NO_INPUT, type GameEvent, type MatchPhase, type PlayerInput, type PlayerSpec, type Snapshot } from './types';
import { PAW, WEAPONS, type MeleeDef } from './weapons';

/** Height of the capsule centre above the feet (same for pandas and zombies). */
const CENTER_HEIGHT = SURVIVOR.halfHeight + SURVIVOR.radius;

/** Spawn offsets around the start point, spread towards the goal (+X, -Z). */
const SPAWN_OFFSETS: readonly [number, number][] = [
  [0, 0],
  [1.8, 0.4],
  [-0.4, -1.8],
  [1.6, -1.6],
];

const dist2d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Authoritative game state. Pure logic, no rendering: in single player it runs locally,
 * in multiplayer it runs on the host and the other phones only draw its snapshots.
 */
export class Simulation implements BotWorld {
  readonly survivors: Survivor[] = [];
  readonly zombies: Zombie[] = [];
  readonly javelins: Javelin[] = [];
  readonly bamboo: BambooSpot[];
  readonly racks: RackSlot[];

  private readonly world: World;
  private readonly obstacles: Obstacles;
  private readonly scratch: Circle[] = [];
  private readonly rng = new Rng((Math.random() * 4294967296) >>> 0);
  private readonly routeLength: number;
  private events: GameEvent[] = [];
  private tick = 0;
  private timeLeft = MATCH_TIME;
  private phase: MatchPhase = 'playing';
  private rescued = 0;
  private nextZombieId = 1;
  private nextJavelinId = 1;
  private spawnTimer = 0;

  constructor(
    readonly map: GameMap,
    specs: readonly PlayerSpec[],
  ) {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.timestep = SIM_DT;

    const { props, layout } = map;
    this.obstacles = new Obstacles([
      ...props.trees.filter((t) => t.collide).map((t) => ({ x: t.x, z: t.z, r: t.radius })),
      ...props.rocks.map((r) => ({ x: r.x, z: r.z, r: r.radius })),
    ]);
    this.bamboo = props.bambooSpots.map((b) => ({ ...b, active: true, respawn: 0 }));
    this.racks = props.racks.map((r) => ({ ...r }));
    this.routeLength = dist2d(layout.start, layout.goal);

    this.buildStatic();
    specs.forEach((spec, i) => this.spawnSurvivor(spec, i));
    this.spawnInitialHorde();
  }

  // ================================================================ public API

  step(inputs: ReadonlyMap<string, PlayerInput>): void {
    if (this.phase !== 'playing') return;
    this.tick++;
    this.timeLeft = Math.max(0, this.timeLeft - SIM_DT);

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
    this.updatePickups();
    this.updateSpawning();
    this.cleanupZombies();
    this.checkEnd();
  }

  /** Current state plus all events since the previous call. */
  snapshot(): Snapshot {
    const events = this.events;
    this.events = [];
    return {
      tick: this.tick,
      timeLeft: this.timeLeft,
      phase: this.phase,
      rescued: this.rescued,
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
      bamboo: this.bamboo.map((b) => b.active),
      racks: this.racks.map((r) => r.weapon),
      events,
    };
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
    for (const o of this.obstacles.near(x, z, 2.4, this.scratch)) {
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

    if (avoidWater) {
      const t = this.map.terrain;
      if (t.isWater(x + sx * 1.6, z + sz * 1.6) || t.isWater(x, z)) {
        // Walk around the pond instead of into it.
        const { pond } = this.map.layout;
        const rx = x - pond.x;
        const rz = z - pond.z;
        const rl = Math.hypot(rx, rz) || 1;
        let tx = -rz / rl;
        let tz = rx / rl;
        if (tx * dx + tz * dz < 0) {
          tx = -tx;
          tz = -tz;
        }
        sx = tx + (rx / rl) * 0.5;
        sz = tz + (rz / rl) * 0.5;
      }
    }

    const l = Math.hypot(sx, sz) || 1;
    return { x: sx / l, z: sz / l };
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
    for (const r of props.rocks) {
      world.createCollider(RAPIER.ColliderDesc.cylinder(1.2, r.radius).setTranslation(r.x, r.y, r.z));
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
    const { start, goal } = this.map.layout;
    const [ox, oz] = SPAWN_OFFSETS[index % SPAWN_OFFSETS.length];
    const x = start.x + ox;
    const z = start.z + oz;
    const toGoal = Math.atan2(goal.x - x, goal.z - z);
    this.survivors.push({
      spec,
      body: this.createBody(x, z),
      x,
      y: this.map.terrain.heightAt(x, z),
      z,
      rot: toGoal,
      faceX: Math.sin(toGoal),
      faceZ: Math.cos(toGoal),
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
      brain: spec.bot ? new BotBrain(index) : null,
    });
  }

  private spawnZombie(x: number, z: number, from: string | null): void {
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
      state: 'walk',
      stateTime: 0,
      stun: 0,
      hurt: 0,
      look: Math.floor(this.rng.next() * 4),
      from,
      speedMul: this.rng.range(0.85, 1.1),
      target: null,
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
      if (dist2d({ x, z }, this.map.layout.start) < 32) continue;
      if (this.validSpawn(x, z)) this.spawnZombie(x, z, null);
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
    }

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
    this.drive(body, tx, tz, s.dashTime > 0 ? Infinity : SURVIVOR.accel);
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
    s.inWater = this.map.terrain.isWater(p.x, p.z);
    s.hidden = s.attackTime < 0 && this.map.layout.thickets.some((t) => dist2d(t, s) < t.r);
    s.hurt = Math.max(0, s.hurt - SIM_DT * 3);
    if (s.inWater && !wasInWater) this.events.push({ e: 'splash', x: s.x, z: s.z });

    if (p.y < -20) {
      // Fell through the world somehow: put them back at the start.
      const { start } = this.map.layout;
      body.setTranslation({ x: start.x, y: this.map.terrain.heightAt(start.x, start.z) + 2, z: start.z }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }

    if (s.state === 'active' && dist2d(s, this.map.layout.goal) < GOAL_RADIUS) {
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

    if (z.retarget <= 0) {
      z.retarget = 0.25 + this.rng.next() * 0.1;
      z.target = this.pickTarget(z);
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
        if (t && dist2d(t, z) < ZOMBIE.biteReach) this.hurtSurvivor(t, ZOMBIE.biteDamage);
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
        this.hurtSurvivor(t, ZOMBIE.lungeDamage);
      }
      if (z.stateTime >= ZOMBIE.lungeTime) z.state = 'walk';
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

    // Zombies can't swim: if one ends up in the pond, shove it back out.
    if (this.map.terrain.isWater(z.x, z.z)) {
      const { pond } = this.map.layout;
      const rx = z.x - pond.x;
      const rz = z.z - pond.z;
      const rl = Math.hypot(rx, rz) || 1;
      sepX += (rx / rl) * 3;
      sepZ += (rz / rl) * 3;
    }

    z.rot = approachAngle(z.rot, Math.atan2(z.faceX, z.faceZ), ZOMBIE.turnSpeed * SIM_DT);
    this.drive(body, dirX * speed + sepX * 1.5, dirZ * speed + sepZ * 1.5, z.state === 'lunge' ? Infinity : ZOMBIE.accel);

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
      if (s.state !== 'active') continue;
      const d = dist2d(s, z);
      let sense = s.hidden ? ZOMBIE.hiddenSense : ZOMBIE.sense;
      if (s === z.target) sense *= 1.3; // stick with the current victim a bit longer
      if (d < sense && d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private damageZombie(z: Zombie, damage: number, nx: number, nz: number, knockback: number, stun: number, by: Survivor | null): void {
    z.hp -= damage;
    z.hurt = 1;
    const kill = z.hp <= 0;
    this.events.push({ e: 'hit', x: z.x, y: z.y + 0.9, z: z.z, kill });
    if (kill) {
      z.state = 'dying';
      z.stateTime = 0;
      z.speed = 0;
      if (z.body) {
        this.world.removeRigidBody(z.body);
        z.body = null;
      }
      if (by) by.kills++;
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
      case 'stun':
        return z.stateTime;
      default:
        return 0;
    }
  }

  private desiredHorde(): number {
    const alive = this.survivors.filter((s) => s.state === 'active' || s.state === 'downed').length;
    const raw = (ZOMBIE.base + ZOMBIE.perSurvivor * alive) * (1 + ZOMBIE.progressBonus * this.progress());
    return Math.min(ZOMBIE.max, Math.round(raw));
  }

  /** 0 at the start camp, 1 at the rescue hut (best survivor). */
  private progress(): number {
    let best = 0;
    for (const s of this.survivors) {
      if (s.state === 'dead') continue;
      const p = s.state === 'rescued' ? 1 : 1 - dist2d(s, this.map.layout.goal) / this.routeLength;
      best = Math.max(best, p);
    }
    return Math.max(0, Math.min(1, best));
  }

  private validSpawn(x: number, z: number): boolean {
    const { layout, terrain } = this.map;
    const half = layout.size / 2 - 3;
    if (Math.abs(x) > half || Math.abs(z) > half) return false;
    if (terrain.isWater(x, z)) return false;
    if (dist2d({ x, z }, layout.start) < layout.start.r + 8) return false;
    if (dist2d({ x, z }, layout.goal) < layout.goal.r + 2) return false;
    if (this.survivors.some((s) => s.state !== 'dead' && s.state !== 'rescued' && dist2d(s, { x, z }) < ZOMBIE.safeRadius)) return false;
    return this.obstacles.near(x, z, 0.8, this.scratch).length === 0;
  }

  private updateSpawning(): void {
    const anchors = this.survivors.filter((s) => s.state === 'active' || s.state === 'downed');
    if (!anchors.length) return;
    this.spawnTimer -= SIM_DT;
    const alive = this.zombies.reduce((n, z) => n + (z.state === 'dying' ? 0 : 1), 0);
    if (alive >= this.desiredHorde() || this.spawnTimer > 0) return;
    this.spawnTimer = ZOMBIE.spawnInterval;

    const { goal } = this.map.layout;
    for (let tries = 0; tries < 8; tries++) {
      const a = this.rng.pick(anchors);
      // Mostly spawn ahead of the group, sometimes from anywhere.
      const toGoal = Math.atan2(goal.x - a.x, goal.z - a.z);
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
    const anchors = this.survivors.filter((s) => s.state === 'active' || s.state === 'downed');
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      let remove = false;
      if (z.state === 'dying') remove = z.stateTime >= ZOMBIE.dyingTime;
      else if (!z.target && z.from === null) {
        // Recycle stragglers left far behind.
        remove = anchors.length > 0 && anchors.every((s) => dist2d(s, z) > ZOMBIE.despawnRadius);
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

      const ground = terrain.heightAt(nx, nz);
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
    j.y = this.map.terrain.heightAt(j.x, j.z) + (pitch < 0 ? 0.35 : 0.08);
    j.pitch = pitch;
    j.flying = false;
    j.age = 0;
    if (this.map.terrain.isWater(j.x, j.z)) this.events.push({ e: 'splash', x: j.x, z: j.z });
    else this.events.push({ e: 'thud', x: j.x, y: j.y, z: j.z });
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
    const stillPlaying = this.survivors.some((s) => s.state === 'active' || s.state === 'downed');
    if (!stillPlaying || this.timeLeft <= 0) this.phase = this.rescued > 0 ? 'won' : 'lost';
  }
}
