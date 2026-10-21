import { SIM_DT, SURVIVOR, ZOMBIE } from '../../config';
import { approachAngle } from '../../core/math';
import type { Brain } from '../bots';
import type { Survivor, Zombie } from '../entities';
import type { GameMap } from '../gameMap';
import type { SimOptions } from '../Simulation';
import type { GameEvent, PlayerSpec, StoryDeviceKind, StoryFail, StoryItemKind, StorySnap } from '../types';
import { DocBrain } from './docBrain';
import type { Chapter, DocMode, EscortStage, Line, Pt, Stage } from './types';

/** What a mission may see and do inside the simulation. Implemented by Simulation. */
export interface MissionHost {
  readonly map: GameMap;
  readonly survivors: readonly Survivor[];
  readonly zombies: readonly Zombie[];
  /** Seconds left on the clock, -1 when untimed. */
  readonly clock: number;
  addSurvivor(spec: PlayerSpec, x: number, z: number, brain: Brain | null): Survivor;
  /** A zombie that hunts the group from anywhere. False if (x, z) isn't a fair place to spawn one. */
  spawnHunter(x: number, z: number): boolean;
  /** Something solid and round, for story machinery. */
  addBlock(x: number, z: number, r: number): void;
  /** Puts the cart at (x, z) facing `yaw` (first call), or rolls it there (later calls). */
  placeCart(x: number, z: number, yaw: number): void;
  emit(ev: GameEvent): void;
  detour(x: number, z: number, tx: number, tz: number): { x: number; z: number; cost: number; wall: boolean } | null;
}

export const DOC_SPEC: PlayerSpec = { id: 'doc', name: 'Doc Mapo', variant: 'red', weapon: 'knife', bot: true, npc: true };

/** Walk over a story item this close to pick it up. */
const PICKUP_RADIUS = 1.3;
/** Doc patches up pandas this close while no awake zombie is within CALM_RANGE of her. */
const HEAL_RANGE = 4;
const HEAL_RATE = 4;
const SELF_HEAL_RATE = 2;
const CALM_RANGE = 6;
/** Waiting Doc is left alone by zombies unless a panda is this close (then the fight is on). */
const SHIELD_RANGE = 20;
/** With Doc following, a "reach" only counts once she's within `r` + this of the spot too. */
const DOC_SLACK = 6;
/** Extra time on the clock when retrying from a checkpoint. */
const RETRY_GRACE = 30;
/** Hold-out waves spawn this far from the zone. */
const WAVE_MIN = 24;
const WAVE_MAX = 32;
/** Default distance from a device's middle to work it. */
const DEVICE_R = 2.6;
/** A device's progress winds back at this share of the working speed while nobody's on it. */
const DEVICE_DECAY = 0.5;
/** Solid footprint of each kind of device (a gate's is its post; the boom is ducked under). */
const DEVICE_SOLID: Record<StoryDeviceKind, number> = { lever: 0.35, pump: 1.1, valve: 0.55, gate: 0.3 };
/** The cart rolls this fast while a panda is within CART_NEAR of it and no zombie within CART_JAM. */
const CART_SPEED = 1.6;
const CART_NEAR = 4.5;
const CART_JAM = 2.3;
/** How fast the cart swings round a bend (rad/s). */
const CART_TURN = 2.2;

interface Item {
  id: number;
  kind: StoryItemKind;
  x: number;
  y: number;
  z: number;
}

interface DeviceState {
  t: number;
  done: boolean;
}

interface Cart {
  x: number;
  z: number;
  yaw: number;
  /** This stage's way, and the index of the point it's rolling towards. */
  path: Pt[];
  next: number;
  /** Length of this stage's way, for the progress bar. */
  total: number;
  state: 'rolling' | 'idle' | 'jammed';
}

interface Pose {
  x: number;
  z: number;
  yaw: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);
const alive = (s: Survivor) => s.state === 'active' || s.state === 'downed';

const startOf = (path: readonly Pt[]): Pose => {
  const a = path[0];
  const b = path[1] ?? a;
  return { x: a.x, z: a.z, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
};
const endOf = (path: readonly Pt[]): Pose => {
  const b = path[path.length - 1];
  const a = path[path.length - 2] ?? b;
  return { x: b.x, z: b.z, yaw: Math.atan2(b.x - a.x, b.z - a.z) };
};

/**
 * Runs one story chapter inside the simulation: a list of stages (reach, collect, hold, activate, escort)
 * done in order, Doc's behaviour, the chapter's machinery and cart, checkpoints, dialogue lines,
 * and the win / lose verdict.
 */
export class Mission {
  /** Set once the chapter is decided; the simulation ends the match on it. */
  outcome: 'won' | 'lost' | null = null;
  private fail: StoryFail | null = null;
  private stage: number;
  private items: Item[] = [];
  private need = 0;
  private holdT = 0;
  private holding = false;
  /** Progress of the device being worked on ("activate" stages). */
  private workT = 0;
  private waitDoc = false;
  private waveT = 0;
  private cue = 0;
  private doc: Survivor | null = null;
  private readonly docBrain = new DocBrain();
  private devices: DeviceState[] = [];
  private cart: Cart | null = null;
  private checkpoint: number;
  private checkpointTime = -1;
  private nextItemId = 1;
  private arrow: Pt | null = null;
  private arrowDist = 0;
  private arrowT = 0;
  private healT = 0;
  private intro = false;

  constructor(
    readonly chapter: Chapter,
    private readonly from: number,
  ) {
    this.stage = from;
    this.checkpoint = from;
  }

  /** Where the group starts: the camp, or the checkpoint of the stage we resume at, facing the objective. */
  get spawn(): { x: number; z: number; toward: Pt } {
    const st = this.chapter.stages[this.from];
    const at = (this.from > 0 && st.checkpoint) || this.chapter.map.start;
    return { x: at.x, z: at.z, toward: this.focus(st) };
  }

  init(host: MissionHost, npcs: readonly PlayerSpec[]): void {
    // Machinery: anything earlier stages already switched (a retry from a checkpoint) stays switched.
    const devs = this.chapter.devices ?? [];
    this.devices = devs.map(() => ({ t: 0, done: false }));
    for (let k = 0; k < this.from; k++) this.finishDevices(this.chapter.stages[k], true);
    for (const d of devs) {
      const r = DEVICE_SOLID[d.kind];
      if (r > 0) host.addBlock(d.x, d.z, r);
    }
    const pose = this.cartAt(this.from);
    if (pose) {
      this.cart = { ...pose, path: [], next: 0, total: 1, state: 'idle' };
      host.placeCart(pose.x, pose.z, pose.yaw);
    }

    const docSpec = npcs.find((s) => s.id === DOC_SPEC.id);
    if (docSpec && this.chapter.doc) {
      let p: Pt = this.postAt(this.from);
      if (this.modeAt(this.from) === 'follow') {
        // Just behind the group.
        const sp = this.spawn;
        const l = dist(sp, sp.toward) || 1;
        p = { x: sp.x - ((sp.toward.x - sp.x) / l) * 1.8, z: sp.z - ((sp.toward.z - sp.z) / l) * 1.8 };
      }
      this.doc = host.addSurvivor(docSpec, p.x, p.z, this.docBrain);
    }
    this.checkpointTime = host.clock;
    this.enterStage(host, this.from, false, false);
    // The opening lines go out with the first tick (events from before it would be lost);
    // a retry from a checkpoint skips them, the HUD still shows the objective.
    this.intro = this.from === 0;
  }

  lose(reason: StoryFail): void {
    if (this.outcome) return;
    this.outcome = 'lost';
    this.fail = reason;
  }

  /** Where bot buddies should stay: beside the cart while it's being escorted. */
  guard(): { x: number; z: number; dx: number; dz: number } | null {
    const c = this.cart;
    if (!c || this.outcome || this.chapter.stages[this.stage].kind !== 'escort') return null;
    return { x: c.x, z: c.z, dx: Math.sin(c.yaw), dz: Math.cos(c.yaw) };
  }

  step(host: MissionHost): void {
    if (this.outcome) return;
    if (this.intro) {
      this.intro = false;
      this.say(host, this.chapter.stages[this.stage].say);
    }
    const doc = this.doc;
    if (doc && doc.state === 'dead') {
      this.lose('doc');
      return;
    }
    if (doc) {
      doc.shielded =
        this.docBrain.mode === 'wait' && !host.survivors.some((s) => !s.npc && s.state === 'active' && dist(s, doc) < SHIELD_RANGE);
    }
    this.heal(host);

    const st = this.chapter.stages[this.stage];
    const humans = host.survivors.filter((s) => !s.spec.bot && s.state === 'active');
    this.waitDoc = false;
    switch (st.kind) {
      case 'reach': {
        if (!humans.some((h) => dist(h, st.at) < st.r)) break;
        const docThere = !doc || this.docBrain.mode !== 'follow' || (doc.state === 'active' && dist(doc, st.at) < st.r + DOC_SLACK);
        if (docThere) this.complete(host);
        else this.waitDoc = true;
        break;
      }
      case 'collect': {
        for (let i = this.items.length - 1; i >= 0; i--) {
          const it = this.items[i];
          const taker = host.survivors.find((s) => !s.npc && s.state === 'active' && dist(s, it) < PICKUP_RADIUS);
          if (!taker) continue;
          this.items.splice(i, 1);
          host.emit({ e: 'collect', id: taker.spec.id, x: it.x, y: it.y, z: it.z });
        }
        if (!this.items.length) this.complete(host);
        break;
      }
      case 'hold': {
        this.holding = humans.some((h) => dist(h, st.at) < st.r);
        if (this.holding) this.holdT += SIM_DT;
        this.waveT -= SIM_DT;
        if (this.waveT <= 0) {
          this.waveT = st.waveEvery;
          this.wave(host, st.at, st.waveSize + this.extraPandas(host));
        }
        this.cues(host, st.cues, this.holdT / st.time);
        if (this.holdT >= st.time) this.complete(host);
        break;
      }
      case 'activate': {
        const devs = this.chapter.devices ?? [];
        const r = st.r ?? DEVICE_R;
        const workers = host.survivors.filter((s) => !s.npc && s.state === 'active');
        const rate = SIM_DT / st.time;
        this.holding = false;
        this.workT = 0;
        let left = 0;
        for (const i of st.devices) {
          const d = this.devices[i];
          const def = devs[i];
          if (!d || !def || d.done) continue;
          const who = workers.find((s) => dist(s, def) < r);
          d.t = who ? Math.min(1, d.t + rate) : Math.max(0, d.t - rate * DEVICE_DECAY);
          if (who && d.t >= 1) {
            d.done = true;
            const y = host.map.terrain.heightAt(def.x, def.z) + 1;
            host.emit({ e: 'collect', id: who.spec.id, x: def.x, y, z: def.z });
            const count = st.devices.filter((k) => this.devices[k]?.done).length;
            const line = st.after?.[count - 1];
            if (line) this.say(host, [line]);
            if (st.waveSize) this.wave(host, def, st.waveSize + this.extraPandas(host));
            continue;
          }
          if (who) this.holding = true;
          this.workT = Math.max(this.workT, d.t);
          left++;
        }
        if (!left) this.complete(host);
        break;
      }
      case 'escort': {
        const c = this.cart;
        if (!c) {
          this.complete(host);
          break;
        }
        const pushed = host.survivors.some((s) => !s.npc && s.state === 'active' && dist(s, c) < CART_NEAR);
        const jammed = host.zombies.some((z) => z.state !== 'dying' && z.state !== 'sleep' && dist(z, c) < CART_JAM);
        c.state = jammed ? 'jammed' : pushed ? 'rolling' : 'idle';
        this.holding = c.state === 'rolling';
        if (c.state === 'rolling') this.rollCart(host, CART_SPEED * SIM_DT);
        // Waves only once the cart is on its way (not while you're still walking up to it).
        if (st.waveEvery && c.state !== 'idle') {
          this.waveT -= SIM_DT;
          if (this.waveT <= 0) {
            this.waveT = st.waveEvery;
            this.wave(host, c, (st.waveSize ?? 2) + this.extraPandas(host));
          }
        }
        this.cues(host, st.cues, 1 - this.cartLeft() / c.total);
        if (c.next >= c.path.length) this.complete(host);
        break;
      }
    }
    this.aim(host);
  }

  snapshot(): StorySnap {
    const st = this.chapter.stages[this.stage];
    const devs = this.chapter.devices ?? [];
    const live = new Set(st.kind === 'activate' ? st.devices : []);
    const c = this.cart;
    let got = this.need - this.items.length;
    let need = this.need;
    let hold = 0;
    if (st.kind === 'activate') {
      need = st.devices.length;
      got = st.devices.filter((i) => this.devices[i]?.done).length;
      hold = this.workT;
    } else if (st.kind === 'hold') {
      hold = Math.min(1, this.holdT / st.time);
    } else if (st.kind === 'escort' && c) {
      hold = Math.max(0, Math.min(1, 1 - this.cartLeft() / c.total));
    }
    return {
      stage: this.stage,
      got,
      need,
      hold,
      holding: this.holding,
      waitDoc: this.waitDoc,
      items: this.items.map((it) => ({ ...it })),
      devices: devs.map((d, i) => ({
        kind: d.kind,
        x: d.x,
        z: d.z,
        yaw: Math.atan2(d.face.x - d.x, d.face.z - d.z),
        t: this.devices[i]?.t ?? 0,
        done: this.devices[i]?.done ?? false,
        live: live.has(i),
      })),
      cart: c ? { x: c.x, z: c.z, yaw: c.yaw, state: c.state, left: this.cartLeft() } : null,
      zone: st.kind === 'hold' ? { x: st.at.x, z: st.at.z, r: st.r } : null,
      target: this.target(st),
      arrow: this.arrow,
      dist: this.arrowDist,
      checkpoint: this.checkpoint,
      checkpointTime: this.checkpointTime,
      fail: this.fail,
    };
  }

  // ---------------------------------------------------------------- stages

  private enterStage(host: MissionHost, i: number, announce: boolean, advanced: boolean): void {
    this.stage = i;
    const st = this.chapter.stages[i];
    this.docBrain.mode = this.modeAt(i);
    this.docBrain.post = this.postAt(i);
    this.items = [];
    if (st.kind === 'collect') {
      const kind = st.item;
      for (const p of st.spots) this.items.push({ id: this.nextItemId++, kind, x: p.x, y: host.map.terrain.groundAt(p.x, p.z), z: p.z });
    }
    if (st.kind === 'escort' && this.cart) {
      const c = this.cart;
      // Roll on from wherever the cart stands (the path's first point, unless the map was authored loosely).
      c.path = dist(c, st.path[0]) > 0.5 ? [{ x: c.x, z: c.z }, ...st.path] : [...st.path];
      c.next = 1;
      c.total = Math.max(1, this.cartLeft());
      c.state = 'idle';
    }
    this.need = this.items.length;
    this.holdT = 0;
    this.holding = false;
    this.workT = 0;
    this.waveT = 3;
    this.cue = 0;
    this.arrowT = 0;
    if (advanced) {
      host.emit({ e: 'objective' });
      if (st.checkpoint) {
        this.checkpoint = i;
        this.checkpointTime = host.clock;
        host.emit({ e: 'checkpoint' });
      }
    }
    if (announce) this.say(host, st.say);
  }

  private complete(host: MissionHost): void {
    const stages = this.chapter.stages;
    const st = stages[this.stage];
    this.finishDevices(st, false);
    this.say(host, st.done);
    if (this.stage >= stages.length - 1) {
      this.outcome = 'won';
      return;
    }
    this.enterStage(host, this.stage + 1, true, true);
  }

  /** The stage's machinery is switched and its gates are open (`all`: its devices too, when skipping past it). */
  private finishDevices(st: Stage, all: boolean): void {
    const mark = (i: number) => {
      const d = this.devices[i];
      if (!d) return;
      d.t = 1;
      d.done = true;
    };
    if (all && st.kind === 'activate') st.devices.forEach(mark);
    st.opens?.forEach(mark);
  }

  /** Where the cart stands at the start of stage `i`, or null for chapters without one. */
  private cartAt(i: number): Pose | null {
    const stages = this.chapter.stages;
    const cur = stages[i];
    if (cur.kind === 'escort') return startOf(cur.path);
    let pose: Pose | null = null;
    for (let k = 0; k < i; k++) {
      const st = stages[k];
      if (st.kind === 'escort') pose = endOf(st.path);
    }
    if (pose) return pose;
    // Before the first escort: parked where that one starts.
    const first = stages.find((s): s is EscortStage => s.kind === 'escort');
    return first ? startOf(first.path) : null;
  }

  /** Moves the cart `step` metres along its way, swinging round the bends. */
  private rollCart(host: MissionHost, step: number): void {
    const c = this.cart;
    if (!c) return;
    while (step > 0 && c.next < c.path.length) {
      const p = c.path[c.next];
      const d = dist(c, p);
      if (d <= step) {
        c.x = p.x;
        c.z = p.z;
        c.next++;
        step -= d;
      } else {
        c.x += ((p.x - c.x) / d) * step;
        c.z += ((p.z - c.z) / d) * step;
        step = 0;
      }
    }
    const p = c.path[Math.min(c.next, c.path.length - 1)];
    if (dist(c, p) > 0.05) c.yaw = approachAngle(c.yaw, Math.atan2(p.x - c.x, p.z - c.z), CART_TURN * SIM_DT);
    host.placeCart(c.x, c.z, c.yaw);
  }

  /** Metres left on the cart's way this stage. */
  private cartLeft(): number {
    const c = this.cart;
    if (!c || c.next >= c.path.length) return 0;
    let left = dist(c, c.path[c.next]);
    for (let k = c.next + 1; k < c.path.length; k++) left += dist(c.path[k - 1], c.path[k]);
    return left;
  }

  /** Doc's mode at stage `i`: the last one set up to there. */
  private modeAt(i: number): DocMode {
    let mode: DocMode = 'wait';
    for (let k = 0; k <= i; k++) mode = this.chapter.stages[k].doc ?? mode;
    return mode;
  }

  private postAt(i: number): Pt {
    let post: Pt = this.chapter.doc?.spawn ?? this.chapter.map.start;
    for (let k = 0; k <= i; k++) post = this.chapter.stages[k].docPost ?? post;
    return post;
  }

  /** A stage's main place: what the group faces when it starts there. */
  private focus(st: Stage): Pt {
    const goal = this.chapter.map.goal;
    switch (st.kind) {
      case 'collect':
        return st.spots[0] ?? goal;
      case 'activate':
        return this.chapter.devices?.[st.devices[0]] ?? goal;
      case 'escort':
        return st.path[1] ?? st.path[0] ?? goal;
      default:
        return st.at;
    }
  }

  /** Where the light beam goes: the one place the objective is, if it's one place. */
  private target(st: Stage): Pt | null {
    switch (st.kind) {
      case 'collect':
      case 'activate':
        return null; // each item / device is marked on its own
      case 'escort': {
        const end = st.path[st.path.length - 1];
        return end ? { x: end.x, z: end.z } : null;
      }
      default:
        return { x: st.at.x, z: st.at.z };
    }
  }

  private say(host: MissionHost, lines: readonly Line[] | undefined): void {
    if (!lines) return;
    const buddy = host.survivors.some((s) => s.spec.bot && !s.npc);
    for (const l of lines) {
      if (l.who === 'buddy' && !buddy) continue;
      host.emit({ e: 'say', who: l.who, text: l.text });
    }
  }

  /** Lines due at fraction `f` of the way through the stage. */
  private cues(host: MissionHost, cues: readonly { at: number; line: Line }[] | undefined, f: number): void {
    while (cues && this.cue < cues.length && f >= cues[this.cue].at) {
      this.say(host, [cues[this.cue].line]);
      this.cue++;
    }
  }

  /** One extra zombie per wave for every two pandas beyond the first. */
  private extraPandas(host: MissionHost): number {
    const pandas = host.survivors.filter((s) => !s.npc && alive(s)).length;
    return Math.floor(Math.max(0, pandas - 1) / 2);
  }

  /** A ring of hunters around a spot, from random directions. */
  private wave(host: MissionHost, at: Pt, count: number): void {
    let spawned = 0;
    for (let tries = 0; tries < count * 8 && spawned < count; tries++) {
      if (host.zombies.length >= ZOMBIE.max) return;
      const a = Math.random() * Math.PI * 2;
      const d = WAVE_MIN + Math.random() * (WAVE_MAX - WAVE_MIN);
      if (host.spawnHunter(at.x + Math.sin(a) * d, at.z + Math.cos(a) * d)) spawned++;
    }
  }

  /** Doc patches up anyone close by while things are calm (herself too, more slowly). */
  private heal(host: MissionHost): void {
    const doc = this.doc;
    this.healT -= SIM_DT;
    if (!doc || doc.state !== 'active') return;
    if (host.zombies.some((z) => z.state !== 'dying' && z.state !== 'sleep' && dist(z, doc) < CALM_RANGE)) return;
    const pulse = this.healT <= 0;
    if (pulse) this.healT = 1.5;
    doc.hp = Math.min(SURVIVOR.maxHp, doc.hp + SELF_HEAL_RATE * SIM_DT);
    for (const s of host.survivors) {
      if (s === doc || s.state !== 'active' || s.hp >= SURVIVOR.maxHp || dist(s, doc) > HEAL_RANGE) continue;
      s.hp = Math.min(SURVIVOR.maxHp, s.hp + HEAL_RATE * SIM_DT);
      if (pulse) host.emit({ e: 'heal', id: s.spec.id });
    }
  }

  /** The HUD arrow: towards the objective (or Doc, when she's down), via passes and bridges. */
  private aim(host: MissionHost): void {
    this.arrowT -= SIM_DT;
    if (this.arrowT > 0) return;
    this.arrowT = 0.2;
    const me = host.survivors.find((s) => !s.spec.bot && s.state === 'active');
    const st = this.chapter.stages[this.stage];
    const closest = (list: readonly Pt[]): Pt | null => {
      let best = Infinity;
      let pick: Pt | null = null;
      for (const p of list) {
        const d = me ? dist(me, p) : 0;
        if (d < best) {
          best = d;
          pick = p;
        }
      }
      return pick;
    };
    let t: Pt | null = null;
    if (this.doc && this.doc.state === 'downed') t = this.doc;
    else if (st.kind === 'collect') {
      t = closest(this.items);
    } else if (st.kind === 'activate') {
      const devs = this.chapter.devices ?? [];
      const r = st.r ?? DEVICE_R;
      const open = st.devices.filter((i) => this.devices[i] && !this.devices[i].done).map((i) => devs[i]);
      t = closest(open);
      if (me && t && dist(me, t) < r * 0.8) t = null; // already there
    } else if (st.kind === 'escort') {
      const c = this.cart;
      if (c && me && dist(me, c) > CART_NEAR * 0.8) t = c;
      else t = this.target(st);
    } else if (st.kind === 'hold') {
      if (me && dist(me, st.at) > st.r * 0.7) t = st.at;
    } else if (this.waitDoc && this.doc) {
      t = this.doc;
    } else {
      t = st.at;
    }
    if (!me || !t) {
      this.arrow = null;
      return;
    }
    const via = host.detour(me.x, me.z, t.x, t.z);
    this.arrow = via ? { x: via.x, z: via.z } : { x: t.x, z: t.z };
    this.arrowDist = via ? via.cost : dist(me, t);
  }
}

/**
 * Simulation options for playing `chapter` from stage `from` (0, or a checkpoint).
 * `clock`: time left when the checkpoint was reached (timed chapters).
 */
export function chapterOptions(chapter: Chapter, from: number, clock: number | null): SimOptions {
  const mission = new Mission(chapter, from);
  const limit = chapter.timeLimit;
  return {
    timeLimit: limit === null ? null : clock !== null && clock >= 0 ? Math.min(limit, clock + RETRY_GRACE) : limit,
    horde: chapter.horde,
    sleepShare: chapter.sleepShare,
    spawn: mission.spawn,
    goalRescue: false,
    mission,
  };
}

/** True when a chapter puts Doc on the map. */
export function hasDoc(chapter: Chapter): boolean {
  return !!chapter.doc;
}
