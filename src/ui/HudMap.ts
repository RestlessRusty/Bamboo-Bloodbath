import { smoothstep, valueNoise } from '../core/math';
import { drawMapBase } from '../render/minimap';
import type { GameMap } from '../sim/gameMap';
import { OPEN, tileCenter } from '../sim/open/config';
import type { WorldMirror } from '../sim/open/mirror';
import { BIOME_IDS, type BiomeId, type OpenSnap, type PieceKind } from '../sim/open/types';
import type { PlayerSpec, Snapshot, StorySnap, SurvivorSnap } from '../sim/types';

/** The ground picture is drawn once per match at this size and scaled onto both maps. */
const BASE_PX = 512;
const BASE_CELLS = 96;
/** Open world: one picture of the whole world, from this many samples a side (4 m each). */
const OPEN_BASE_PX = 1024;
const OPEN_CELLS = 256;
/** Open world: the corner map shows this many metres around you. */
const OPEN_VIEW = 240;
/** Repaint every Nth HUD update: ~15 Hz for the corner map, ~30 Hz while it's enlarged. */
const SMALL_EVERY = 4;
const BIG_EVERY = 2;
/** Markers on the enlarged map are this much bigger (in CSS px). */
const BIG_SCALE = 1.5;

const INK = '#2b1e1a';
/** Where to go: the rescue hut or the story objective. */
const GOAL = '#4fd1b0';
const DOWNED = '#ff5a5a';
const SIEGE = '#e2463f';
const HORDE = '#7a1f1f';
const CAMP = '#f28c48';
const BAG = '#a27a52';
/** Building pieces: walls and gates by tier (bamboo, wood, stone), the rest by kind. */
const TIER_FILL = ['#9ccf5a', '#b07a45', '#9a9a94'];
const PIECE_FILL: Record<PieceKind, string> = {
  wall: TIER_FILL[0],
  gate: TIER_FILL[0],
  spikes: '#6b6f7a',
  campfire: '#ff8a2a',
  workbench: '#d9a35f',
  bed: '#7fb7ff',
  storage: '#f2b82e',
  lookout: '#8b5a3c',
};
const RUINED = 'rgba(60, 45, 40, 0.55)';

type Who = 'me' | 'human' | 'bot' | 'npc';
/** Same colours as the name tags over the pandas. */
const FILL: Record<Who, string> = { me: '#ffe066', human: '#ffffff', bot: '#cfe9ff', npc: '#ffc2c2' };

/** Map of the match in the HUD corner (and enlarged on tap): the team and where to go, north up like the camera. */
export class HudMap {
  private readonly base = document.createElement('canvas');
  private map: GameMap | null = null;
  /** Infinite mode: the world's pieces and bags as this device knows them. */
  private mirror: WorldMirror | null = null;
  /** World seed the open-world picture was drawn for (-1: none), so a world is drawn only once. */
  private openSeed = -1;
  private who = new Map<string, Who>();
  private localId = '';
  private localName = '';
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
    this.frame = 0;
    if (map.open) {
      if (this.openSeed === map.open.seed && this.base.width === OPEN_BASE_PX) return;
      this.openSeed = map.open.seed;
      this.base.width = this.base.height = OPEN_BASE_PX;
      drawOpenBase(this.base, map);
      return;
    }
    this.openSeed = -1;
    this.mirror = null;
    if (this.base.width !== BASE_PX) this.base.width = this.base.height = BASE_PX;
    const ctx = this.base.getContext('2d');
    if (ctx) drawMapBase(ctx, map, BASE_PX, BASE_PX, BASE_CELLS);
  }

  setOpenMirror(m: WorldMirror | null): void {
    this.mirror = m;
    this.frame = 0;
  }

  setTeam(specs: readonly PlayerSpec[], localId: string): void {
    this.localId = localId;
    this.localName = specs.find((s) => s.id === localId)?.name ?? '';
    this.who = new Map(specs.map((s) => [s.id, s.id === localId ? 'me' : s.npc ? 'npc' : s.bot ? 'bot' : 'human']));
  }

  /** `bigOpen`: the enlarged map is showing (the corner one is left as it was meanwhile). */
  update(snap: Snapshot, time: number, bigOpen: boolean): void {
    const every = bigOpen ? BIG_EVERY : SMALL_EVERY;
    if (this.frame++ % every !== 0) return;
    if (bigOpen) this.paint(this.big, snap, time, BIG_SCALE, true);
    else this.paint(this.small, snap, time, 1, false);
  }

  private paint(c: HTMLCanvasElement, snap: Snapshot, time: number, scale: number, big: boolean): void {
    const map = this.map;
    const ctx = c.getContext('2d');
    if (!map || !ctx || !c.width) return;
    const w = c.width;

    let me: SurvivorSnap | undefined;
    for (const s of snap.survivors) if (s.id === this.localId) me = s;

    // The view: the whole map, or (open world, corner map) a window around you.
    const size = map.layout.size;
    let view = size;
    let cx = 0;
    let cz = 0;
    if (map.open && !big) {
      view = OPEN_VIEW;
      if (me) {
        cx = me.x;
        cz = me.z;
      }
    }
    const k = w / view;
    const ox = cx - view / 2;
    const oz = cz - view / 2;
    const px = (x: number) => (x - ox) * k;
    const pz = (z: number) => (z - oz) * k;
    /** One CSS pixel. */
    const u = this.dpr * scale;
    const pulse = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.lineJoin = 'round';

    if (view === size) ctx.drawImage(this.base, 0, 0, w, w);
    else {
      // Beyond the world's edge: the rim colour (drawImage clips a source rectangle that runs off the picture).
      ctx.fillStyle = '#8c7a62';
      ctx.fillRect(0, 0, w, w);
      const bk = this.base.width / size;
      const sx = (ox + size / 2) * bk;
      const sz = (oz + size / 2) * bk;
      const sw = view * bk;
      const x0 = Math.max(0, sx);
      const z0 = Math.max(0, sz);
      const x1 = Math.min(this.base.width, sx + sw);
      const z1 = Math.min(this.base.height, sz + sw);
      if (x1 > x0 && z1 > z0) {
        const d = w / sw;
        ctx.drawImage(this.base, x0, z0, x1 - x0, z1 - z0, (x0 - sx) * d, (z0 - sz) * d, (x1 - x0) * d, (z1 - z0) * d);
      }
    }

    if (map.open) this.paintOpen(ctx, map, snap.open, px, pz, k, u, pulse, view, ox, oz);
    else if (snap.story) this.paintObjective(ctx, snap.story, map, px, pz, k, u, pulse);
    else hut(ctx, px(map.layout.goal.x), pz(map.layout.goal.z), u, pulse);

    // Buddies under, you on top.
    for (const s of snap.survivors) {
      if (s.id === this.localId || s.state === 'rescued' || s.state === 'dead') continue;
      const who = this.who.get(s.id) ?? 'bot';
      const r = (who === 'human' ? 4.5 : 3.5) * u;
      if (s.state === 'downed') dot(ctx, px(s.x), pz(s.z), r * (1 + 0.3 * pulse), DOWNED, u);
      else dot(ctx, px(s.x), pz(s.z), r, FILL[who], u);
    }
    if (me?.state === 'downed') dot(ctx, px(me.x), pz(me.z), 5 * u * (1 + 0.3 * pulse), DOWNED, u);
    else if (me?.state === 'active') arrow(ctx, px(me.x), pz(me.z), me.rot, 8 * u, u);
  }

  /** Open world: the camp, pieces (bases), your bed, dropped packs, visible hordes and the siege. */
  private paintOpen(
    ctx: CanvasRenderingContext2D,
    map: GameMap,
    o: OpenSnap | undefined,
    px: (v: number) => number,
    pz: (v: number) => number,
    k: number,
    u: number,
    pulse: number,
    view: number,
    ox: number,
    oz: number,
  ): void {
    const world = map.open!;
    ring(ctx, px(world.spawn.x), pz(world.spawn.z), 5 * u, CAMP, u);

    const m = this.mirror;
    let myBed = -1;
    if (o) for (const s of o.survivors) if (s.id === this.localId) myBed = s.bed;
    if (m) {
      // Pieces are small: at least a pixel and a half so a base stays visible on the whole-world map.
      const s = Math.max(OPEN.tile * k, 1.5 * u);
      const margin = OPEN.tile;
      let bed: { x: number; z: number } | null = null;
      for (const p of m.pieces.values()) {
        const x = tileCenter(p.gx);
        const z = tileCenter(p.gz);
        if (x < ox - margin || z < oz - margin || x > ox + view + margin || z > oz + view + margin) continue;
        if (p.id === myBed) bed = { x, z };
        ctx.fillStyle = p.ruined ? RUINED : p.kind === 'wall' || p.kind === 'gate' ? TIER_FILL[p.tier] : PIECE_FILL[p.kind];
        ctx.fillRect(px(x) - s / 2, pz(z) - s / 2, s, s);
      }
      if (bed) bedMark(ctx, px(bed.x), pz(bed.z), u);
      for (const b of m.bags.values()) {
        const mine = b.owner === this.localName && this.localName !== '';
        if (b.x < ox || b.z < oz || b.x > ox + view || b.z > oz + view) continue;
        diamond(ctx, px(b.x), pz(b.z), (mine ? 4 + pulse : 3) * u, mine ? '#ffe066' : BAG, u);
      }
    }
    if (!o) return;
    for (const hd of o.hordes) {
      dot(ctx, px(hd.x), pz(hd.z), Math.min(7, 2.5 + hd.n * 0.25) * u, HORDE, u);
    }
    const sg = o.siege;
    if (sg) {
      ctx.setLineDash([4 * u, 4 * u]);
      ctx.lineWidth = 2 * u;
      ctx.strokeStyle = SIEGE;
      ctx.beginPath();
      ctx.moveTo(px(sg.x), pz(sg.z));
      ctx.lineTo(px(sg.tx), pz(sg.tz));
      ctx.stroke();
      ctx.setLineDash([]);
      ring(ctx, px(sg.x), pz(sg.z), (6 + 2.5 * pulse) * u, SIEGE, u);
      dot(ctx, px(sg.x), pz(sg.z), Math.min(8, 3 + sg.size * 0.1) * u, SIEGE, u);
    }
  }

  /** The story stage's goal: the place to reach, items left, devices to switch, the zone to hold, the cart. */
  private paintObjective(
    ctx: CanvasRenderingContext2D,
    st: StorySnap,
    map: GameMap,
    px: (v: number) => number,
    pz: (v: number) => number,
    k: number,
    u: number,
    pulse: number,
  ): void {
    if (st.zone) {
      ctx.beginPath();
      ctx.arc(px(st.zone.x), pz(st.zone.z), Math.max(st.zone.r * k, 5 * u), 0, Math.PI * 2);
      ctx.fillStyle = st.holding ? 'rgba(79, 209, 176, 0.55)' : `rgba(79, 209, 176, ${(0.25 + 0.2 * pulse).toFixed(2)})`;
      ctx.fill();
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
    for (const it of st.items) diamond(ctx, px(it.x), pz(it.z), 3.5 * u, '#f2b82e', u);
    for (const d of st.devices) {
      if (d.live && !d.done) ring(ctx, px(d.x), pz(d.z), (4 + 1.5 * pulse) * u, '#ff8a2a', u);
    }
    if (st.cart) {
      const s = 4 * u;
      ctx.fillStyle = '#a27a52';
      ctx.fillRect(px(st.cart.x) - s, pz(st.cart.z) - s, s * 2, s * 2);
      ctx.lineWidth = 1.5 * u;
      ctx.strokeStyle = INK;
      ctx.strokeRect(px(st.cart.x) - s, pz(st.cart.z) - s, s * 2, s * 2);
    }
    const t = st.target;
    if (!t) return;
    const { goal, goalStyle } = map.layout;
    if (goalStyle !== 'none' && Math.hypot(t.x - goal.x, t.z - goal.z) < 3) hut(ctx, px(goal.x), pz(goal.z), u, pulse);
    else {
      ring(ctx, px(t.x), pz(t.z), (5 + 2 * pulse) * u, GOAL, u);
      dot(ctx, px(t.x), pz(t.z), 2.5 * u, GOAL, u);
    }
  }
}

type Rgb = [number, number, number];
const rgb = (hex: number): Rgb => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

/**
 * The whole open world from above, once per world: biome ground colours blended across borders, darker
 * valleys and lighter hills, water, ice, ridge rock, then bridges, tracks and the abandoned buildings.
 */
function drawOpenBase(canvas: HTMLCanvasElement, map: GameMap): void {
  const ctx = canvas.getContext('2d');
  const world = map.open;
  if (!ctx || !world) return;
  const { terrain, layout } = map;
  const pal = {} as Record<BiomeId, { a: Rgb; b: Rgb; high: Rgb; cliff: Rgb; water: Rgb; ice: Rgb }>;
  for (const id of BIOME_IDS) {
    const t = world.biomes[id].theme;
    pal[id] = { a: rgb(t.ground.a), b: rgb(t.ground.b), high: rgb(t.ground.high), cliff: rgb(t.ground.cliff), water: rgb(t.water), ice: rgb(t.ice ?? 0xd3ecf6) };
  }
  const weights = {} as Record<BiomeId, number>;
  for (const id of BIOME_IDS) weights[id] = 0;
  const peak = Math.max(4, terrain.peak());
  const size = world.size;
  const n = OPEN_CELLS;
  const cell = size / n;
  const small = document.createElement('canvas');
  small.width = small.height = n;
  const sctx = small.getContext('2d');
  if (!sctx) return;
  const img = sctx.createImageData(n, n);
  const data = img.data;
  const out: Rgb = [0, 0, 0];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -size / 2 + (i + 0.5) * cell;
      const z = -size / 2 + (j + 0.5) * cell;
      world.biomeWeights(x, z, weights);
      const water = terrain.isWater(x, z);
      const ice = !water && terrain.isIce(x, z);
      const y = terrain.heightAt(x, z);
      const mix = valueNoise(x / 9, z / 9, world.seed + 3);
      const high = smoothstep(2.5, peak, y);
      const rock = terrain.isWall(x, z) ? 0.8 : 0;
      out[0] = out[1] = out[2] = 0;
      for (const id of BIOME_IDS) {
        const wgt = weights[id];
        if (wgt <= 0) continue;
        const p = pal[id];
        for (let c = 0; c < 3; c++) {
          let v: number;
          if (water) v = p.water[c];
          else if (ice) v = p.ice[c];
          else {
            v = p.a[c] + (p.b[c] - p.a[c]) * mix;
            v += (p.high[c] - v) * high;
            v += (p.cliff[c] - v) * rock;
          }
          out[c] += v * wgt;
        }
      }
      // Hill shading: lit from the north-west.
      const shade = water || ice ? 1 : 1 + Math.max(-0.18, Math.min(0.18, (terrain.heightAt(x - cell, z - cell) - y) * -0.06));
      const o = (j * n + i) * 4;
      data[o] = Math.min(255, out[0] * shade);
      data[o + 1] = Math.min(255, out[1] * shade);
      data[o + 2] = Math.min(255, out[2] * shade);
      data[o + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
  const w = canvas.width;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, w, w);

  const k = w / size;
  const px = (v: number) => (v + size / 2) * k;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#a27a52';
  for (const road of layout.roads ?? []) {
    ctx.lineWidth = Math.max(1.5, road.width * k);
    ctx.beginPath();
    road.points.forEach((p, i) => (i ? ctx.lineTo(px(p.x), px(p.z)) : ctx.moveTo(px(p.x), px(p.z))));
    ctx.stroke();
  }
  ctx.strokeStyle = '#8b5a3c';
  ctx.lineWidth = Math.max(2, 3 * k);
  for (const c of terrain.crossings) {
    if (c.kind !== 'bridge') continue;
    ctx.beginPath();
    ctx.moveTo(px(c.a.x), px(c.a.z));
    ctx.lineTo(px(c.b.x), px(c.b.z));
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  // Abandoned buildings: a little roof each.
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#d9c3a0';
  for (const p of world.pois) {
    const x = px(p.x);
    const z = px(p.z);
    const s = Math.max(4, p.r * k * 0.6);
    ctx.beginPath();
    ctx.moveTo(x, z - s);
    ctx.lineTo(x + s, z);
    ctx.lineTo(x + s * 0.7, z);
    ctx.lineTo(x + s * 0.7, z + s * 0.8);
    ctx.lineTo(x - s * 0.7, z + s * 0.8);
    ctx.lineTo(x - s * 0.7, z);
    ctx.lineTo(x - s, z);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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

/** Your bed: a pale blue pillow shape with a dark edge, where you respawn. */
function bedMark(ctx: CanvasRenderingContext2D, x: number, y: number, u: number): void {
  const w = 5 * u;
  const h = 3.5 * u;
  ctx.fillStyle = '#7fb7ff';
  ctx.fillRect(x - w, y - h, w * 2, h * 2);
  ctx.lineWidth = 1.5 * u;
  ctx.strokeStyle = INK;
  ctx.strokeRect(x - w, y - h, w * 2, h * 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - w + u, y - h + u, w * 0.7, h * 2 - 2 * u);
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
