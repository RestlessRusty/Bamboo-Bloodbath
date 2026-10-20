import { SIM_DT, SURVIVOR, ZOMBIE } from '../../config';
import type { Brain } from '../bots';
import type { Survivor, Zombie } from '../entities';
import type { GameMap } from '../gameMap';
import type { SimOptions } from '../Simulation';
import type { GameEvent, PlayerSpec, StoryFail, StoryItemKind, StorySnap } from '../types';
import { DocBrain } from './docBrain';
import type { Chapter, DocMode, Line, Pt } from './types';

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

interface Item {
  id: number;
  kind: StoryItemKind;
  x: number;
  y: number;
  z: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.z - b.z);
const alive = (s: Survivor) => s.state === 'active' || s.state === 'downed';

/**
 * Runs one story chapter inside the simulation: a list of stages (reach, collect, hold) done in order,
 * Doc's behaviour, checkpoints, dialogue lines, and the win / lose verdict.
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
  private waitDoc = false;
  private waveT = 0;
  private cue = 0;
  private doc: Survivor | null = null;
  private readonly docBrain = new DocBrain();
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
    return { x: at.x, z: at.z, toward: st.kind === 'collect' ? (st.spots[0] ?? this.chapter.map.goal) : st.at };
  }

  init(host: MissionHost, npcs: readonly PlayerSpec[]): void {
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
          const pandas = host.survivors.filter((s) => !s.npc && alive(s)).length;
          this.wave(host, st.at, st.waveSize + Math.floor(Math.max(0, pandas - 1) / 2));
        }
        const f = this.holdT / st.time;
        while (st.cues && this.cue < st.cues.length && f >= st.cues[this.cue].at) {
          this.say(host, [st.cues[this.cue].line]);
          this.cue++;
        }
        if (f >= 1) this.complete(host);
        break;
      }
    }
    this.aim(host);
  }

  snapshot(): StorySnap {
    const st = this.chapter.stages[this.stage];
    return {
      stage: this.stage,
      got: this.need - this.items.length,
      need: this.need,
      hold: st.kind === 'hold' ? Math.min(1, this.holdT / st.time) : 0,
      holding: this.holding,
      waitDoc: this.waitDoc,
      items: this.items.map((it) => ({ ...it })),
      zone: st.kind === 'hold' ? { x: st.at.x, z: st.at.z, r: st.r } : null,
      target: st.kind === 'collect' ? null : { x: st.at.x, z: st.at.z },
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
    this.need = this.items.length;
    this.holdT = 0;
    this.holding = false;
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
    this.say(host, stages[this.stage].done);
    if (this.stage >= stages.length - 1) {
      this.outcome = 'won';
      return;
    }
    this.enterStage(host, this.stage + 1, true, true);
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

  private say(host: MissionHost, lines: readonly Line[] | undefined): void {
    if (!lines) return;
    const buddy = host.survivors.some((s) => s.spec.bot && !s.npc);
    for (const l of lines) {
      if (l.who === 'buddy' && !buddy) continue;
      host.emit({ e: 'say', who: l.who, text: l.text });
    }
  }

  /** A ring of hunters around the zone, from random directions. */
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
    let t: Pt | null = null;
    if (this.doc && this.doc.state === 'downed') t = this.doc;
    else if (st.kind === 'collect') {
      let best = Infinity;
      for (const it of this.items) {
        const d = me ? dist(me, it) : 0;
        if (d < best) {
          best = d;
          t = it;
        }
      }
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
