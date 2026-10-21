import { drawMapBase } from '../render/minimap';
import type { GameMap } from '../sim/gameMap';
import type { PlayerSpec, Snapshot, StorySnap, SurvivorSnap } from '../sim/types';

/** The ground picture is drawn once per match at this size and scaled onto both maps. */
const BASE_PX = 512;
const BASE_CELLS = 96;
/** Repaint every Nth HUD update: ~15 Hz for the corner map, ~30 Hz while it's enlarged. */
const SMALL_EVERY = 4;
const BIG_EVERY = 2;
/** Markers on the enlarged map are this much bigger (in CSS px). */
const BIG_SCALE = 1.5;

const INK = '#2b1e1a';
/** Where to go: the rescue hut or the story objective. */
const GOAL = '#4fd1b0';
const DOWNED = '#ff5a5a';

type Who = 'me' | 'human' | 'bot' | 'npc';
/** Same colours as the name tags over the pandas. */
const FILL: Record<Who, string> = { me: '#ffe066', human: '#ffffff', bot: '#cfe9ff', npc: '#ffc2c2' };

/** Map of the match in the HUD corner (and enlarged on tap): the team and where to go, north up like the camera. */
export class HudMap {
  private readonly base = document.createElement('canvas');
  private map: GameMap | null = null;
  private who = new Map<string, Who>();
  private localId = '';
  private frame = 0;
  private dpr = 1;

  constructor(
    private readonly small: HTMLCanvasElement,
    private readonly big: HTMLCanvasElement,
  ) {
    this.base.width = BASE_PX;
    this.base.height = BASE_PX;
    // Canvas pixels follow the CSS size (it depends on the screen height); 0 while hidden.
    const ro = new ResizeObserver((entries) => {
      this.dpr = Math.min(window.devicePixelRatio || 1, 3);
      for (const e of entries) {
        const c = e.target as HTMLCanvasElement;
        const px = Math.round(e.contentRect.width * this.dpr);
        if (c.width !== px) c.width = c.height = px;
      }
      this.frame = 0;
    });
    ro.observe(small);
    ro.observe(big);
  }

  setMap(map: GameMap): void {
    this.map = map;
    const ctx = this.base.getContext('2d');
    if (ctx) drawMapBase(ctx, map, BASE_PX, BASE_PX, BASE_CELLS);
    this.frame = 0;
  }

  setTeam(specs: readonly PlayerSpec[], localId: string): void {
    this.localId = localId;
    this.who = new Map(specs.map((s) => [s.id, s.id === localId ? 'me' : s.npc ? 'npc' : s.bot ? 'bot' : 'human']));
  }

  /** `bigOpen`: the enlarged map is showing (the corner one is left as it was meanwhile). */
  update(snap: Snapshot, time: number, bigOpen: boolean): void {
    const every = bigOpen ? BIG_EVERY : SMALL_EVERY;
    if (this.frame++ % every !== 0) return;
    if (bigOpen) this.paint(this.big, snap, time, BIG_SCALE);
    else this.paint(this.small, snap, time, 1);
  }

  private paint(c: HTMLCanvasElement, snap: Snapshot, time: number, scale: number): void {
    const map = this.map;
    const ctx = c.getContext('2d');
    if (!map || !ctx || !c.width) return;
    const w = c.width;
    ctx.drawImage(this.base, 0, 0, w, w);

    const size = map.layout.size;
    const k = w / size;
    const px = (x: number) => (x + size / 2) * k;
    /** One CSS pixel. */
    const u = this.dpr * scale;
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.lineJoin = 'round';

    if (snap.story) this.paintObjective(ctx, snap.story, map, px, k, u, pulse);
    else hut(ctx, px(map.layout.goal.x), px(map.layout.goal.z), u, pulse);

    // Buddies under, you on top.
    let me: SurvivorSnap | undefined;
    for (const s of snap.survivors) {
      if (s.id === this.localId) {
        me = s;
        continue;
      }
      if (s.state === 'rescued' || s.state === 'dead') continue;
      const who = this.who.get(s.id) ?? 'bot';
      const r = (who === 'human' ? 4.5 : 3.5) * u;
      if (s.state === 'downed') dot(ctx, px(s.x), px(s.z), r * (1 + 0.3 * pulse), DOWNED, u);
      else dot(ctx, px(s.x), px(s.z), r, FILL[who], u);
    }
    if (me?.state === 'downed') dot(ctx, px(me.x), px(me.z), 5 * u * (1 + 0.3 * pulse), DOWNED, u);
    else if (me?.state === 'active') arrow(ctx, px(me.x), px(me.z), me.rot, 8 * u, u);
  }

  /** The story stage's goal: the place to reach, items left, devices to switch, the zone to hold, the cart. */
  private paintObjective(
    ctx: CanvasRenderingContext2D,
    st: StorySnap,
    map: GameMap,
    px: (v: number) => number,
    k: number,
    u: number,
    pulse: number,
  ): void {
    if (st.zone) {
      ctx.beginPath();
      ctx.arc(px(st.zone.x), px(st.zone.z), Math.max(st.zone.r * k, 5 * u), 0, Math.PI * 2);
      ctx.fillStyle = st.holding ? 'rgba(79, 209, 176, 0.55)' : `rgba(79, 209, 176, ${(0.25 + 0.2 * pulse).toFixed(2)})`;
      ctx.fill();
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
    for (const it of st.items) diamond(ctx, px(it.x), px(it.z), 3.5 * u, '#f2b82e', u);
    for (const d of st.devices) {
      if (d.live && !d.done) ring(ctx, px(d.x), px(d.z), (4 + 1.5 * pulse) * u, '#ff8a2a', u);
    }
    if (st.cart) {
      const s = 4 * u;
      ctx.fillStyle = '#a27a52';
      ctx.fillRect(px(st.cart.x) - s, px(st.cart.z) - s, s * 2, s * 2);
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = INK;
      ctx.strokeRect(px(st.cart.x) - s, px(st.cart.z) - s, s * 2, s * 2);
    }
    const t = st.target;
    if (!t) return;
    const { goal, goalStyle } = map.layout;
    if (goalStyle !== 'none' && Math.hypot(t.x - goal.x, t.z - goal.z) < 3) hut(ctx, px(goal.x), px(goal.z), u, pulse);
    else {
      ring(ctx, px(t.x), px(t.z), (5 + 2 * pulse) * u, GOAL, u);
      dot(ctx, px(t.x), px(t.z), 2.5 * u, GOAL, u);
    }
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, u: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** A coloured ring with a dark edge, readable on any ground. */
function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, u: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = 3.5 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, u: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.5 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** The rescue hut: a little house in a pulsing ring. */
function hut(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, pulse: number): void {
  ring(ctx, x, y, (9 + 2 * pulse) * u, GOAL, u);
  const s = 5.5 * u;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y - s * 0.1);
  ctx.lineTo(x + s * 0.7, y - s * 0.1);
  ctx.lineTo(x + s * 0.7, y + s * 0.8);
  ctx.lineTo(x - s * 0.7, y + s * 0.8);
  ctx.lineTo(x - s * 0.7, y - s * 0.1);
  ctx.lineTo(x - s, y - s * 0.1);
  ctx.closePath();
  ctx.fillStyle = GOAL;
  ctx.fill();
  ctx.lineWidth = 1.5 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** You: an arrowhead pointing where your panda faces (`rot` 0 faces +Z, i.e. down the map). */
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number, len: number, u: number): void {
  const fx = Math.sin(rot);
  const fz = Math.cos(rot);
  ctx.beginPath();
  ctx.moveTo(x + fx * len, y + fz * len);
  ctx.lineTo(x - fx * len * 0.6 + fz * len * 0.65, y - fz * len * 0.6 - fx * len * 0.65);
  ctx.lineTo(x - fx * len * 0.25, y - fz * len * 0.25);
  ctx.lineTo(x - fx * len * 0.6 - fz * len * 0.65, y - fz * len * 0.6 + fx * len * 0.65);
  ctx.closePath();
  ctx.fillStyle = FILL.me;
  ctx.fill();
  ctx.lineWidth = 1.5 * u;
  ctx.strokeStyle = INK;
  ctx.stroke();
}
