import { CRACKER } from '../config';
import type { BuildKey } from '../input/InputManager';
import type { GameMap } from '../sim/gameMap';
import { OPEN, PIECES, RECIPES, RESOURCE_LABELS, TIER_NAMES, tileCenter, tileOf } from '../sim/open/config';
import type { WorldMirror } from '../sim/open/mirror';
import { canAfford, canPlace, maxHp, placeCost, repairCost, upgradeCost } from '../sim/open/structures';
import {
  emptyResources,
  PIECE_KINDS,
  RECIPE_IDS,
  RESOURCE_KINDS,
  type Cost,
  type GhostSpec,
  type OpenCommand,
  type OpenSnap,
  type OpenSurvivorSnap,
  type Piece,
  type PieceKind,
  type RecipeId,
  type Resources,
  type ResourceKind,
  type Rot,
} from '../sim/open/types';
import type { Snapshot, SurvivorSnap } from '../sim/types';
import { el, formatTime, scrollHint } from './dom';

export interface OpenHudHandlers {
  onCommand(cmd: OpenCommand): void;
  /** The build preview changed (null: none). */
  onGhost(g: GhostSpec | null): void;
  /** Build mode on / off: the input switches its fight buttons off / on (InputManager.setBuildMode). */
  onBuildMode(on: boolean): void;
}

/** The ghost goes on the tile this far in front of the panda. */
const GHOST_AHEAD = 2.5;
/** Station / stash checks and prices run every Nth update (~10 Hz). */
const SLOW_EVERY = 6;
const DENY_MS = 1800;
/** The same refusal again within this long isn't shown (or buzzed) again. Shorter than DENY_MS. */
const DENY_REPEAT_MS = 1500;
/** "+2" floaters on the pack add up gathers this close together. */
const GAIN_MS = 1400;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;
const COMPASS_SHORT = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Compass direction of (dx, dz), north being -Z: "north-east", or "NE" with `short`. */
export function compass(dx: number, dz: number, short = false): string {
  const i = ((Math.round(Math.atan2(dx, -dz) / (Math.PI / 4)) % 8) + 8) % 8;
  return short ? COMPASS_SHORT[i] : COMPASS[i];
}

/** Little resource pictures for the pack, prices and the palette. */
export const RES_ICON: Record<ResourceKind, string> = {
  bamboo:
    '<svg class="res-icon" viewBox="0 0 16 16"><rect x="5.5" y="1" width="5" height="14" rx="2" fill="#8fd16a" stroke="#2b1e1a" stroke-width="1.5"/><path d="M5.5 6h5M5.5 10.5h5" stroke="#2b1e1a" stroke-width="1.3"/></svg>',
  wood: '<svg class="res-icon" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.3" fill="#c98a52" stroke="#2b1e1a" stroke-width="1.5"/><circle cx="8" cy="8" r="3.1" fill="none" stroke="#8b5a3c" stroke-width="1.2"/></svg>',
  stone:
    '<svg class="res-icon" viewBox="0 0 16 16"><path d="M2 11.5L4 5l5-3 5 4 1 5.5-4 3H5z" fill="#b9b8af" stroke="#2b1e1a" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  scrap:
    '<svg class="res-icon" viewBox="0 0 16 16"><path d="M8 1.5l5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5z" fill="#9db4c0" stroke="#2b1e1a" stroke-width="1.5" stroke-linejoin="round"/><circle cx="8" cy="8" r="2.2" fill="#fff8ea" stroke="#2b1e1a" stroke-width="1.2"/></svg>',
};

const ICON_SUN =
  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="#ffd23f" stroke="#2b1e1a" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="#2b1e1a" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_MOON =
  '<svg viewBox="0 0 24 24"><path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.5 7 7 0 0 1-5-13.5z" fill="#e8ecff" stroke="#2b1e1a" stroke-width="2" stroke-linejoin="round"/></svg>';
const ICON_HAMMER = '<svg viewBox="0 0 24 24"><path d="M4.5 19.5l8.5-8.5"/><path d="M10 9l5-5 5.5 5.5-5 5z"/></svg>';
const ICON_CRAFT = '<svg viewBox="0 0 24 24"><path d="M3 8h12a5 5 0 0 0 6-3v5a5 5 0 0 1-5 5h-1l2 4H7l2-4H8a5 5 0 0 1-5-5z"/></svg>';
const ICON_ROTATE = '<svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 3.5V8h-4.5"/></svg>';

/** A price as little icons and numbers (only the kinds it needs). */
export function costHtml(cost: Cost): string {
  let html = '';
  for (const k of RESOURCE_KINDS) {
    const n = cost[k] ?? 0;
    if (n > 0) html += `<span class="cost-item">${RES_ICON[k]}${n}</span>`;
  }
  return html || '<span class="cost-item">free</span>';
}

/** "Wood wall", "Campfire", "Ruined stone gate". */
export function pieceName(p: Piece): string {
  const def = PIECES[p.kind];
  const name = def.upgrades.length ? `${TIER_NAMES[p.tier]} ${def.label.toLowerCase()}` : def.label;
  return p.ruined ? `Ruined ${name.toLowerCase()}` : name;
}

interface ResChip {
  root: HTMLElement;
  count: HTMLElement;
  gain: HTMLElement | null;
}

/** Shows or hides only when that changes (the HUD updates every frame). */
function vis(e: HTMLElement, visible: boolean): void {
  if (e.hidden === visible) e.hidden = !visible;
}

function findSurvivor(snap: Snapshot, id: string): SurvivorSnap | undefined {
  for (const s of snap.survivors) if (s.id === id) return s;
  return undefined;
}

function findOpen(o: OpenSnap, id: string): OpenSurvivorSnap | undefined {
  for (const s of o.survivors) if (s.id === id) return s;
  return undefined;
}

/**
 * Infinite mode's part of the HUD: the day, hunger, the pack (and the stash near a storage chest),
 * siege and leash warnings, the respawn countdown, refusals, build mode and the craft panel.
 * The rules decide everything; this only previews (ghost, prices) and sends OpenCommands.
 */
export class OpenHud {
  private readonly el: HTMLDivElement;
  private readonly sky: HTMLElement;
  private readonly dayText: HTMLElement;
  private readonly hungerBox: HTMLElement;
  private readonly hungerFill: HTMLElement;
  private readonly packChips: ResChip[] = [];
  private readonly stashRow: HTMLElement;
  private readonly stashChips: ResChip[] = [];
  private readonly siegeEl: HTMLElement;
  private readonly leashEl: HTMLElement;
  private readonly fullEl: HTMLElement;
  private readonly respawnEl: HTMLElement;
  private readonly buildBtn: HTMLButtonElement;
  private readonly craftBtn: HTMLButtonElement;
  private readonly denyEl: HTMLElement;
  private readonly buildPanel: HTMLElement;
  private readonly infoName: HTMLElement;
  private readonly infoCost: HTMLElement;
  private readonly infoNote: HTMLElement;
  private readonly upgradeBtn: HTMLButtonElement;
  private readonly repairBtn: HTMLButtonElement;
  private readonly demolishBtn: HTMLButtonElement;
  private readonly paletteBtns = new Map<PieceKind, HTMLButtonElement>();
  private readonly placeBtn: HTMLButtonElement;
  private readonly placeLabel: HTMLElement;
  private readonly rotateBtn: HTMLButtonElement;
  private readonly craftPanel: HTMLElement;
  private readonly craftTitle: HTMLElement;
  private readonly craftRows = new Map<RecipeId, { row: HTMLElement; btn: HTMLButtonElement }>();
  private readonly html = new Map<HTMLElement, string>();

  private map: GameMap | null = null;
  private mirror: WorldMirror | null = null;
  private localId = '';
  private pieceAt: (gx: number, gz: number) => Piece | undefined = () => undefined;
  /** The local panda in the latest snapshot. */
  private me: SurvivorSnap | undefined;
  private frame = 0;

  /** What building and crafting can spend right now: the pack, plus the stash near a storage chest. */
  private readonly have: Resources = emptyResources();
  private stashNear = false;
  private benchNear = false;
  private fireNear = false;

  private isBuilding = false;
  private sel: PieceKind = 'wall';
  private rot: Rot = 0;
  /** The tile in front of the panda and what's known about it (re-checked when it, the piece or the world changes). */
  private tgx = NaN;
  private tgz = NaN;
  private trev = -1;
  private tsel: PieceKind | null = null;
  private target: Piece | undefined;
  private reason: string | null = null;
  private affordPlace = false;
  private upCost: Cost | null = null;
  private repCost: Cost | null = null;
  private upOk = false;
  private repOk = false;
  private ghost: GhostSpec | null = null;
  private readonly poor = new Map<PieceKind, boolean>();

  private craftOpen = false;
  private readonly craftPoor = new Map<RecipeId, boolean>();
  private denyUntil = 0;
  private denyText = '';
  private denyAt = -Infinity;
  private readonly gainN = [0, 0, 0, 0];
  private readonly gainUntil = [0, 0, 0, 0];

  // What's on screen, so nothing is written to the DOM when it hasn't changed.
  private dayKey = -1;
  private nightShown: boolean | null = null;
  private hungerShown = -1;
  private hungerLow: boolean | null = null;
  private readonly packShown = [-1, -1, -1, -1];
  private readonly stashShown = [-1, -1, -1, -1];
  private siegeEta = -2;
  private siegeSize = -1;
  private siegeDir = '';
  private siegeBase: boolean | null = null;
  private respawnShown = -1;

  constructor(
    parent: HTMLElement,
    private readonly h: OpenHudHandlers,
  ) {
    const chips = RESOURCE_KINDS.map((k) => `<span class="res-chip" data-r="${k}" title="${RESOURCE_LABELS[k]}">${RES_ICON[k]}<b></b><i class="res-gain"></i></span>`).join('');
    const stash = RESOURCE_KINDS.map((k) => `<span class="res-chip" data-r="${k}">${RES_ICON[k]}<b></b></span>`).join('');
    this.el = el(
      'div',
      'open-hud',
      `<div class="open-top">
        <div class="open-day"><span class="open-sky" data-ref="sky"></span><span data-ref="day"></span></div>
        <div class="open-stats">
          <div class="open-hunger" data-ref="hunger" title="Hunger"><div data-ref="hunger-fill"></div><span>Food</span></div>
          <div class="open-res" data-ref="pack">${chips}</div>
        </div>
        <div class="open-res open-stash" data-ref="stash" hidden><small>Stash</small>${stash}</div>
        <div class="open-alert siege" data-ref="siege" hidden></div>
        <div class="open-alert" data-ref="leash" hidden>Too far from your friends: head back!</div>
        <div class="open-alert" data-ref="full" hidden>Pack full! Empty it at a storage chest.</div>
      </div>
      <div class="open-respawn" data-ref="respawn" hidden></div>
      <div class="open-side">
        <button class="open-btn" data-act="build" data-ref="build-btn" aria-label="Build" title="Build (B)">${ICON_HAMMER}</button>
        <button class="open-btn" data-act="craft" data-ref="craft-btn" aria-label="Craft" title="Craft (F)" hidden>${ICON_CRAFT}</button>
      </div>
      <div class="open-build" data-ref="build" hidden>
        <div class="build-actions">
          <button class="btn small ghost danger-text" data-act="demolish" data-ref="demolish" hidden>Demolish</button>
          <button class="btn small" data-act="upgrade" data-ref="upgrade" hidden></button>
          <button class="btn small" data-act="repair" data-ref="repair" hidden></button>
          <button class="btn small ghost" data-act="exit">Done</button>
        </div>
        <div class="build-info"><b data-ref="info-name"></b><span class="cost" data-ref="info-cost"></span><span class="build-note" data-ref="info-note"></span></div>
        <div class="build-palette" data-ref="palette"></div>
      </div>
      <button class="open-act place" data-act="place" data-ref="place" aria-label="Place" hidden>${ICON_HAMMER}<span data-ref="place-label">Place</span></button>
      <button class="open-act rotate" data-act="rotate" data-ref="rotate" aria-label="Rotate" hidden>${ICON_ROTATE}</button>
      <div class="card open-craft" data-ref="craft" hidden>
        <div class="craft-head"><b data-ref="craft-title"></b><button class="btn small ghost" data-act="craft-close">Close</button></div>
        <div class="scroll-body craft-body" data-ref="craft-body"></div>
      </div>
      <div class="open-deny" data-ref="deny"></div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);

    this.sky = this.ref('sky');
    this.dayText = this.ref('day');
    this.hungerBox = this.ref('hunger');
    this.hungerFill = this.ref('hunger-fill');
    this.stashRow = this.ref('stash');
    for (const c of this.ref('pack').querySelectorAll<HTMLElement>('.res-chip')) {
      this.packChips.push({ root: c, count: c.querySelector('b')!, gain: c.querySelector<HTMLElement>('.res-gain') });
    }
    for (const c of this.stashRow.querySelectorAll<HTMLElement>('.res-chip')) {
      this.stashChips.push({ root: c, count: c.querySelector('b')!, gain: null });
    }
    this.siegeEl = this.ref('siege');
    this.leashEl = this.ref('leash');
    this.fullEl = this.ref('full');
    this.respawnEl = this.ref('respawn');
    this.buildBtn = this.ref<HTMLButtonElement>('build-btn');
    this.craftBtn = this.ref<HTMLButtonElement>('craft-btn');
    this.denyEl = this.ref('deny');
    this.buildPanel = this.ref('build');
    this.infoName = this.ref('info-name');
    this.infoCost = this.ref('info-cost');
    this.infoNote = this.ref('info-note');
    this.upgradeBtn = this.ref<HTMLButtonElement>('upgrade');
    this.repairBtn = this.ref<HTMLButtonElement>('repair');
    this.demolishBtn = this.ref<HTMLButtonElement>('demolish');
    this.placeBtn = this.ref<HTMLButtonElement>('place');
    this.placeLabel = this.ref('place-label');
    this.rotateBtn = this.ref<HTMLButtonElement>('rotate');
    this.craftPanel = this.ref('craft');
    this.craftTitle = this.ref('craft-title');

    const palette = this.ref('palette');
    PIECE_KINDS.forEach((kind, i) => {
      const def = PIECES[kind];
      const b = el('button', 'palette-btn', `<b>${def.label}</b><span class="cost">${costHtml(def.cost)}</span>`);
      b.dataset.act = 'piece';
      b.dataset.kind = kind;
      b.title = `${def.label} (${i + 1}): ${def.blurb}`;
      palette.appendChild(b);
      this.paletteBtns.set(kind, b);
    });

    const craftBody = this.ref('craft-body');
    for (const id of RECIPE_IDS) {
      const r = RECIPES[id];
      const row = el('div', 'craft-row', `<div class="craft-info"><b>${r.label}</b><small>${r.blurb}</small></div>`);
      const btn = el('button', 'btn small primary', costHtml(r.cost));
      btn.dataset.act = 'make';
      btn.dataset.recipe = id;
      row.appendChild(btn);
      craftBody.appendChild(row);
      this.craftRows.set(id, { row, btn });
    }
    scrollHint(craftBody);

    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t) return;
      // Keyboard Space / Enter must not "click" the last tapped button again.
      if (t instanceof HTMLButtonElement) t.blur();
      switch (t.dataset.act) {
        case 'build':
          this.setBuilding(!this.isBuilding);
          break;
        case 'exit':
          this.setBuilding(false);
          break;
        case 'piece':
          this.select(t.dataset.kind as PieceKind);
          break;
        case 'place':
          this.primary();
          break;
        case 'rotate':
          this.rotate();
          break;
        case 'upgrade':
          this.upgrade();
          break;
        case 'repair':
          this.repair();
          break;
        case 'demolish':
          this.demolish();
          break;
        case 'craft':
          this.toggleCraft();
          break;
        case 'craft-close':
          this.setCraft(false);
          break;
        case 'make':
          this.craft(t.dataset.recipe as RecipeId);
          break;
      }
    });
  }

  /** In build mode (palette and ghost showing, no fighting). */
  get building(): boolean {
    return this.isBuilding;
  }

  /** A match in an open world begins (or a guest joins one). */
  start(map: GameMap, mirror: WorldMirror, localId: string): void {
    this.map = map;
    this.mirror = mirror;
    this.localId = localId;
    this.pieceAt = (gx, gz) => mirror.pieceAt(gx, gz);
    this.me = undefined;
    this.isBuilding = false;
    this.craftOpen = false;
    this.sel = 'wall';
    this.rot = 0;
    this.ghost = null;
    this.tgx = NaN;
    this.trev = -1;
    this.denyUntil = 0;
    this.denyText = '';
    this.denyAt = -Infinity;
    this.gainN.fill(0);
    this.gainUntil.fill(0);
    this.dayKey = -1;
    this.nightShown = null;
    this.hungerShown = -1;
    this.hungerLow = null;
    this.packShown.fill(-1);
    this.stashShown.fill(-1);
    this.siegeEta = -2;
    this.respawnShown = -1;
    this.poor.clear();
    this.craftPoor.clear();
    this.buildPanel.hidden = true;
    this.placeBtn.hidden = true;
    this.rotateBtn.hidden = true;
    this.craftPanel.hidden = true;
    this.buildBtn.classList.remove('active');
    this.denyEl.classList.remove('show');
    this.markPalette();
    this.el.hidden = false;
  }

  /** Leaving the world: build mode off, everything hidden. */
  stop(): void {
    if (this.isBuilding) this.setBuilding(false);
    this.setCraft(false);
    document.body.classList.remove('open-building');
    this.el.hidden = true;
    this.map = null;
    this.mirror = null;
    this.me = undefined;
  }

  /** Infinite mode's keyboard shortcuts (wire InputManager.onBuildKey here). */
  key(k: BuildKey): void {
    if (!this.mirror) return;
    if (typeof k === 'number') {
      const kind = PIECE_KINDS[k - 1];
      if (kind) this.select(kind);
      return;
    }
    switch (k) {
      case 'toggle':
        this.setBuilding(!this.isBuilding);
        break;
      case 'rotate':
        if (this.isBuilding) this.rotate();
        break;
      case 'place':
        this.primary();
        break;
      case 'demolish':
        if (this.isBuilding) this.demolish();
        break;
      case 'craft':
        this.toggleCraft();
        break;
    }
  }

  /**
   * A command of ours was refused (the rules' 'deny' event), or a check here failed. False when the same
   * refusal went up less than DENY_REPEAT_MS ago (e.g. "Your pack is full" on every swing): it only stays up
   * longer, and the caller should skip its buzz too.
   */
  deny(why: string): boolean {
    const now = performance.now();
    this.denyUntil = now + DENY_MS;
    if (why === this.denyText && now < this.denyAt + DENY_REPEAT_MS) return false;
    this.denyText = why;
    this.denyAt = now;
    this.denyEl.textContent = why;
    this.denyEl.classList.remove('show');
    void this.denyEl.offsetWidth;
    this.denyEl.classList.add('show');
    return true;
  }

  /** We gathered something: "+2" next to that resource, adding up quick hits into one floater. */
  gained(r: ResourceKind, n: number): void {
    const i = RESOURCE_KINDS.indexOf(r);
    const chip = this.packChips[i];
    if (!chip?.gain) return;
    const now = performance.now();
    this.gainN[i] = now < this.gainUntil[i] ? this.gainN[i] + n : n;
    this.gainUntil[i] = now + GAIN_MS;
    chip.gain.textContent = `+${this.gainN[i]}`;
    chip.root.classList.remove('bump');
    void chip.root.offsetWidth;
    chip.root.classList.add('bump');
  }

  update(snap: Snapshot): void {
    const o = snap.open;
    if (!o || !this.mirror || !this.map) {
      vis(this.el, false);
      return;
    }
    vis(this.el, true);
    const me = findSurvivor(snap, this.localId);
    const mine = findOpen(o, this.localId);
    this.me = me;
    const slow = this.frame++ % SLOW_EVERY === 0;
    const now = performance.now();

    this.updateDay(o);
    this.updateHunger(mine);
    if (slow && me) this.scanStations(me);
    this.updateHave(mine, o);
    this.updateRes(mine, o);
    this.updateSiege(o);
    this.updateAlerts(o, mine);
    this.updateRespawn(snap, me, mine);
    this.updateFloaters(now);
    if (this.denyUntil && now > this.denyUntil) {
      this.denyUntil = 0;
      this.denyEl.classList.remove('show');
    }

    const active = me?.state === 'active';
    if (!active && this.isBuilding) this.setBuilding(false);
    const station = active && (this.benchNear || this.fireNear);
    if (!station && this.craftOpen) this.setCraft(false);
    vis(this.buildBtn, active);
    vis(this.craftBtn, station);

    if (slow) this.markPalette();
    if (this.isBuilding && me) this.updateBuild(me, slow);
    if (this.craftOpen && slow) this.markCraft();
  }

  // ------------------------------------------------------------------ status

  private updateDay(o: OpenSnap): void {
    // Time of day 0 is 06:00; shown in 10-minute steps.
    const hours = (6 + o.time * 24) % 24;
    const hh = Math.floor(hours);
    const tens = Math.min(5, Math.floor((hours - hh) * 6));
    const key = o.day * 1000 + hh * 10 + tens;
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dayText.textContent = `Day ${o.day} · ${String(hh).padStart(2, '0')}:${tens}0`;
    }
    if (o.night !== this.nightShown) {
      this.nightShown = o.night;
      this.sky.innerHTML = o.night ? ICON_MOON : ICON_SUN;
      this.el.classList.toggle('night', o.night);
    }
  }

  private updateHunger(mine: OpenSurvivorSnap | undefined): void {
    const hunger = mine?.hunger ?? OPEN.hungerMax;
    const pct = Math.round((Math.max(0, hunger) / OPEN.hungerMax) * 100);
    if (pct !== this.hungerShown) {
      this.hungerShown = pct;
      this.hungerFill.style.width = `${pct}%`;
    }
    const low = hunger < OPEN.hungryAt;
    if (low !== this.hungerLow) {
      this.hungerLow = low;
      this.hungerBox.classList.toggle('low', low);
    }
  }

  /** Storage chest in stash reach, workbench / campfire in craft reach (standing ones only). */
  private scanStations(me: SurvivorSnap): void {
    const mirror = this.mirror!;
    const stash2 = OPEN.stashReach * OPEN.stashReach;
    const craft2 = OPEN.craftReach * OPEN.craftReach;
    let stash = false;
    let bench = false;
    let fire = false;
    for (const p of mirror.pieces.values()) {
      if (p.ruined || (p.kind !== 'storage' && p.kind !== 'workbench' && p.kind !== 'campfire')) continue;
      const dx = tileCenter(p.gx) - me.x;
      const dz = tileCenter(p.gz) - me.z;
      const d2 = dx * dx + dz * dz;
      if (p.kind === 'storage') stash ||= d2 <= stash2;
      else if (d2 <= craft2) {
        if (p.kind === 'workbench') bench = true;
        else fire = true;
      }
    }
    this.stashNear = stash;
    this.benchNear = bench;
    this.fireNear = fire;
  }

  private updateHave(mine: OpenSurvivorSnap | undefined, o: OpenSnap): void {
    for (const k of RESOURCE_KINDS) this.have[k] = (mine?.pack[k] ?? 0) + (this.stashNear ? o.stash[k] : 0);
  }

  private updateRes(mine: OpenSurvivorSnap | undefined, o: OpenSnap): void {
    let total = 0;
    for (let i = 0; i < RESOURCE_KINDS.length; i++) {
      const n = mine?.pack[RESOURCE_KINDS[i]] ?? 0;
      total += n;
      if (n === this.packShown[i]) continue;
      this.packShown[i] = n;
      this.packChips[i].count.textContent = String(n);
      this.packChips[i].root.classList.toggle('zero', n === 0);
    }
    vis(this.fullEl, total >= OPEN.packMax && !this.stashNear);
    vis(this.stashRow, this.stashNear);
    if (!this.stashNear) return;
    for (let i = 0; i < RESOURCE_KINDS.length; i++) {
      const n = o.stash[RESOURCE_KINDS[i]];
      if (n === this.stashShown[i]) continue;
      this.stashShown[i] = n;
      this.stashChips[i].count.textContent = String(n);
      this.stashChips[i].root.classList.toggle('zero', n === 0);
    }
  }

  private updateSiege(o: OpenSnap): void {
    const s = o.siege;
    vis(this.siegeEl, !!s);
    if (!s) {
      this.siegeEta = -2;
      return;
    }
    const eta = Math.ceil(s.eta);
    const dir = compass(s.x - s.tx, s.z - s.tz, true);
    if (eta === this.siegeEta && s.size === this.siegeSize && dir === this.siegeDir && s.base === this.siegeBase) return;
    this.siegeEta = eta;
    this.siegeSize = s.size;
    this.siegeDir = dir;
    this.siegeBase = s.base;
    const what = s.base ? 'Defend the base!' : 'A horde is hunting you!';
    this.siegeEl.textContent =
      eta > 0 ? `Siege from the ${dir} in ${formatTime(eta)}! ${what}` : `${what} ${s.size} zombie${s.size === 1 ? '' : 's'} left`;
  }

  private updateAlerts(o: OpenSnap, mine: OpenSurvivorSnap | undefined): void {
    let far = false;
    for (const id of o.leash) if (id === this.localId) far = true;
    vis(this.leashEl, far && !!mine);
  }

  private updateRespawn(snap: Snapshot, me: SurvivorSnap | undefined, mine: OpenSurvivorSnap | undefined): void {
    const down = me?.state === 'downed' && !!mine && mine.respawn > 0;
    vis(this.respawnEl, down);
    if (!down || !mine) {
      this.respawnShown = -1;
      return;
    }
    const left = Math.ceil(mine.respawn);
    if (left === this.respawnShown) return;
    this.respawnShown = left;
    let friend = false;
    for (const s of snap.survivors) if (s.id !== this.localId && s.state === 'active') friend = true;
    const where = mine.bed >= 0 ? 'at your bed' : 'at the camp';
    this.respawnEl.textContent = `Respawning ${where} in ${left} s…${friend ? ' a friend can still revive you' : ''}`;
  }

  private updateFloaters(now: number): void {
    for (let i = 0; i < this.packChips.length; i++) {
      if (!this.gainUntil[i] || now < this.gainUntil[i]) continue;
      this.gainUntil[i] = 0;
      this.gainN[i] = 0;
      this.packChips[i].root.classList.remove('bump');
    }
  }

  // ------------------------------------------------------------------ build mode

  private setBuilding(on: boolean): void {
    if (on && (this.me?.state !== 'active' || !this.mirror)) return;
    if (on === this.isBuilding) return;
    this.isBuilding = on;
    if (on) this.setCraft(false);
    this.buildPanel.hidden = !on;
    this.placeBtn.hidden = !on;
    this.rotateBtn.hidden = !on;
    this.buildBtn.classList.toggle('active', on);
    document.body.classList.toggle('open-building', on);
    this.tgx = NaN;
    this.trev = -1;
    if (!on && this.ghost) {
      this.ghost = null;
      this.h.onGhost(null);
    }
    this.h.onBuildMode(on);
    if (on && this.me) this.updateBuild(this.me, true);
  }

  private select(kind: PieceKind): void {
    this.sel = kind;
    this.markPalette();
    if (!this.isBuilding) this.setBuilding(true);
    else if (this.me) this.updateBuild(this.me, true);
  }

  private rotate(): void {
    this.rot = ((this.rot + 1) % 4) as Rot;
    if (this.me) this.updateBuild(this.me, true);
  }

  /** Every frame while building: which tile, what's on it, can we place / upgrade / repair, and the ghost. */
  private updateBuild(me: SurvivorSnap, force: boolean): void {
    const mirror = this.mirror!;
    const gx = tileOf(me.x + Math.sin(me.rot) * GHOST_AHEAD);
    const gz = tileOf(me.z + Math.cos(me.rot) * GHOST_AHEAD);
    const moved = gx !== this.tgx || gz !== this.tgz || mirror.rev !== this.trev || this.sel !== this.tsel;
    if (!moved && !force) return;
    if (moved) {
      this.tgx = gx;
      this.tgz = gz;
      this.trev = mirror.rev;
      this.tsel = this.sel;
      this.target = mirror.pieceAt(gx, gz);
      this.reason = this.target ? null : canPlace(this.map!, this.pieceAt, this.sel, gx, gz);
      this.upCost = this.target ? upgradeCost(this.target) : null;
      this.repCost = this.target ? repairCost(this.target) : null;
    }
    const p = this.target;
    this.affordPlace = !p && canAfford(this.have, placeCost(this.sel));
    this.upOk = !!this.upCost && canAfford(this.have, this.upCost);
    this.repOk = !!this.repCost && canAfford(this.have, this.repCost);

    const valid = p ? this.upOk || this.repOk : !this.reason && this.affordPlace;
    const kind = p ? p.kind : this.sel;
    const tier = p ? p.tier : 0;
    const rot = p ? p.rot : this.rot;
    const g = this.ghost;
    if (!g || g.kind !== kind || g.tier !== tier || g.gx !== gx || g.gz !== gz || g.rot !== rot || g.valid !== valid) {
      this.ghost = { kind, tier, gx, gz, rot, valid };
      this.h.onGhost(this.ghost);
    }
    this.renderTarget();
  }

  /** The line above the palette: the piece to place (price, or why not), or the piece on the tile with its actions. */
  private renderTarget(): void {
    const p = this.target;
    this.upgradeBtn.hidden = !this.upCost;
    this.repairBtn.hidden = !this.repCost;
    this.demolishBtn.hidden = !p;
    let label: string;
    let off: boolean;
    if (p) {
      this.setText(this.infoName, pieceName(p));
      this.setHtml(this.infoCost, '');
      this.setText(this.infoNote, p.ruined ? 'Rubble: repair it to use it again' : `${Math.ceil(p.hp)}/${maxHp(p.kind, p.tier)} HP`);
      this.infoNote.classList.remove('why');
      if (this.upCost) {
        // Two short lines, to fit the narrow column beside the Place button.
        const to = TIER_NAMES[Math.min(2, p.tier + 1)];
        this.setHtml(this.upgradeBtn, `<b>↑ ${to}</b><span class="cost">${costHtml(this.upCost)}</span>`);
        const title = `Upgrade to ${to}`;
        if (this.upgradeBtn.title !== title) this.upgradeBtn.title = title;
        this.upgradeBtn.classList.toggle('poor', !this.upOk);
      }
      if (this.repCost) {
        this.setHtml(this.repairBtn, `<b>Repair</b><span class="cost">${costHtml(this.repCost)}</span>`);
        this.repairBtn.classList.toggle('poor', !this.repOk);
      }
      label = this.repCost && (this.repOk || !this.upCost) ? 'Repair' : this.upCost ? 'Upgrade' : 'Taken';
      off = !this.upOk && !this.repOk;
    } else {
      const def = PIECES[this.sel];
      this.setText(this.infoName, def.label);
      this.setHtml(this.infoCost, costHtml(placeCost(this.sel)));
      const why = this.reason ?? (this.affordPlace ? null : 'Not enough resources');
      this.setText(this.infoNote, why ?? def.blurb);
      this.infoNote.classList.toggle('why', !!why);
      label = 'Place';
      off = !!why;
    }
    this.setText(this.placeLabel, label);
    this.placeBtn.classList.toggle('off', off);
  }

  /** Greys out the pieces we can't pay for, and marks the chosen one. */
  private markPalette(): void {
    for (const [kind, b] of this.paletteBtns) {
      const poor = !canAfford(this.have, placeCost(kind));
      if (this.poor.get(kind) !== poor) {
        this.poor.set(kind, poor);
        b.classList.toggle('poor', poor);
      }
      b.classList.toggle('active', kind === this.sel);
    }
  }

  /** The big button / Space: place on an empty tile; on a piece, whatever it needs (a repair first, else an upgrade). */
  private primary(): void {
    if (!this.isBuilding) return;
    if (!this.target) this.place();
    else if (this.repCost && (this.repOk || !this.upCost)) this.repair();
    else this.upgrade();
  }

  private place(): void {
    if (!this.isBuilding) return;
    if (this.target) return this.refuse('Something is already built here');
    if (this.reason) return this.refuse(this.reason);
    if (!this.affordPlace) return this.refuse(`Not enough resources for a ${PIECES[this.sel].label.toLowerCase()}`);
    this.h.onCommand({ c: 'place', kind: this.sel, gx: this.tgx, gz: this.tgz, rot: this.rot });
  }

  private upgrade(): void {
    const p = this.target;
    if (!p || !this.upCost) return this.refuse(p ? 'It can’t be upgraded any further' : 'Nothing to upgrade here');
    if (!this.upOk) return this.refuse('Not enough resources to upgrade it');
    this.h.onCommand({ c: 'upgrade', id: p.id });
  }

  private repair(): void {
    const p = this.target;
    if (!p || !this.repCost) return this.refuse(p ? 'It’s in one piece' : 'Nothing to repair here');
    if (!this.repOk) return this.refuse('Not enough resources to repair it');
    this.h.onCommand({ c: 'repair', id: p.id });
  }

  private demolish(): void {
    const p = this.target;
    if (!p) return this.refuse('Nothing to demolish here');
    this.h.onCommand({ c: 'demolish', id: p.id });
  }

  // ------------------------------------------------------------------ crafting

  private toggleCraft(): void {
    if (this.craftOpen) return this.setCraft(false);
    if (this.me?.state !== 'active') return;
    if (!this.benchNear && !this.fireNear) return this.refuse('Stand next to a workbench or campfire to craft');
    this.setCraft(true);
  }

  private setCraft(on: boolean): void {
    this.craftOpen = on;
    this.craftPanel.hidden = !on;
    this.craftBtn.classList.toggle('active', on);
    if (!on) return;
    if (this.isBuilding) this.setBuilding(false);
    this.craftPoor.clear();
    this.markCraft();
  }

  /** Recipes of the stations in reach, greyed when we can't pay (or carry no more firecrackers). */
  private markCraft(): void {
    const bench = this.benchNear;
    const fire = this.fireNear;
    this.setText(this.craftTitle, bench && fire ? 'Workbench & campfire' : bench ? 'Workbench' : 'Campfire');
    const full = (this.me?.crackers ?? 0) >= CRACKER.max;
    for (const [id, { row, btn }] of this.craftRows) {
      const r = RECIPES[id];
      row.hidden = !(r.station === 'workbench' ? bench : fire);
      const poor = !canAfford(this.have, r.cost) || (!!r.crackers && full);
      if (this.craftPoor.get(id) === poor) continue;
      this.craftPoor.set(id, poor);
      btn.classList.toggle('poor', poor);
    }
  }

  private craft(id: RecipeId): void {
    const r = RECIPES[id];
    if (!r) return;
    if (r.crackers && (this.me?.crackers ?? 0) >= CRACKER.max) return this.refuse(`You can carry only ${CRACKER.max} firecrackers`);
    if (!canAfford(this.have, r.cost)) return this.refuse(`Not enough resources for ${r.label.toLowerCase()}`);
    this.h.onCommand({ c: 'craft', recipe: id });
  }

  // ------------------------------------------------------------------ helpers

  /** deny() for the checks here, which have nothing to do with its result. */
  private refuse(why: string): void {
    this.deny(why);
  }

  private setText(e: HTMLElement, text: string): void {
    if (e.textContent !== text) e.textContent = text;
  }

  /** innerHTML only when it changed (reading innerHTML back would serialise the DOM every time). */
  private setHtml(e: HTMLElement, html: string): void {
    if (this.html.get(e) === html) return;
    this.html.set(e, html);
    e.innerHTML = html;
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
