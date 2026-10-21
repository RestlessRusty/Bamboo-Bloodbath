import { DIFFICULTY, MAX_PLAYERS, type Difficulty } from '../config';
import type { Settings } from '../settings';
import type { WorldSlotInfo } from '../sim/open/types';
import { difficultyButtons, el, markActive, scrollHint } from './dom';

const ICON_TRASH = `<svg viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>`;

export interface InfiniteMenuHandlers {
  /** Play a saved world solo (with its bot buddies). */
  onPlay(slot: number): void;
  /** Make a new world in an empty slot and play it; `seed` null picks a random one. */
  onCreate(slot: number, opts: { name: string; seed: number | null; difficulty: Difficulty; bots: number }): void;
  /** Open a multiplayer room playing this world. */
  onHost(slot: number): void;
  /** Already confirmed here. */
  onDelete(slot: number): void;
  onBack(): void;
}

/** "3 h 20 min" / "12 min" of play. */
function playedText(seconds: number): string {
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${Math.max(1, min)} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/** When a world was last saved: "just now", "5 min ago", "yesterday", "3 days ago". */
function agoText(epochMs: number): string {
  const s = Math.max(0, (Date.now() - epochMs) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d <= 1 ? 'yesterday' : `${d} days ago`;
}

/** A typed seed: digits are taken as they are, any other text is hashed (so "banana" is a world too). */
function parseSeed(text: string): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Infinite mode's start screen: the saved worlds (OPEN.slots of them) to play, host or delete, and a
 * form to make a new world in an empty slot. Deleting asks right on the slot's card.
 */
export class InfiniteMenu {
  private readonly el: HTMLDivElement;
  private readonly listView: HTMLElement;
  private readonly list: HTMLElement;
  private readonly form: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly seedInput: HTMLInputElement;
  private slots: (WorldSlotInfo | null)[] = [];
  /** Slot whose card is asking "Delete?" (-1: none). */
  private confirming = -1;
  /** Slot the new-world form fills. */
  private formSlot = 0;
  private difficulty: Difficulty = 'normal';
  private bots = 0;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly h: InfiniteMenuHandlers,
  ) {
    const bots = Array.from({ length: MAX_PLAYERS }, (_, n) => `<button data-act="bots" data-v="${n}">${n}</button>`).join('');
    this.el = el(
      'div',
      'menu',
      `<div class="menu-panel infinite-menu">
        <h1 class="logo sub-logo"><span>Infinite</span><span class="blood">World</span></h1>
        <div class="infinite-view" data-ref="list-view">
          <p class="hint small infinite-blurb">One endless world: gather, build a base, survive the nights and the sieges. Saved on this phone.</p>
          <div class="scroll-body world-scroll" data-ref="scroll">
            <ul class="world-list" data-ref="list"></ul>
          </div>
          <div class="menu-buttons">
            <button class="btn ghost" data-act="back">Back</button>
          </div>
        </div>
        <div class="infinite-view" data-ref="form" hidden>
          <label class="field">
            <span>Name</span>
            <input data-ref="name" maxlength="20" autocomplete="off" spellcheck="false" />
          </label>
          <label class="field">
            <span>Seed</span>
            <input data-ref="seed" maxlength="16" placeholder="Random" autocomplete="off" spellcheck="false" />
          </label>
          <div class="picker">
            <span>Difficulty</span>
            <div class="seg" data-ref="difficulty">${difficultyButtons()}</div>
          </div>
          <div class="picker">
            <span>Bot buddies</span>
            <div class="seg" data-ref="bots">${bots}</div>
          </div>
          <div class="menu-buttons">
            <button class="btn primary big" data-act="create">Create world</button>
            <button class="btn ghost" data-act="cancel">Cancel</button>
          </div>
        </div>
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.listView = this.ref('list-view');
    this.list = this.ref('list');
    this.form = this.ref('form');
    this.nameInput = this.ref<HTMLInputElement>('name');
    this.seedInput = this.ref<HTMLInputElement>('seed');
    scrollHint(this.ref('scroll'));
    for (const input of [this.nameInput, this.seedInput]) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
      });
    }

    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t || (t as HTMLButtonElement).disabled) return;
      const slot = Number(t.dataset.slot);
      switch (t.dataset.act) {
        case 'play':
          h.onPlay(slot);
          break;
        case 'host':
          h.onHost(slot);
          break;
        case 'new':
          this.openForm(slot);
          break;
        case 'delete':
          this.confirming = slot;
          this.render();
          break;
        case 'delete-yes':
          // Shown as empty right away; main may show() the fresh list too.
          this.confirming = -1;
          this.slots[slot] = null;
          this.render();
          h.onDelete(slot);
          break;
        case 'delete-no':
          this.confirming = -1;
          this.render();
          break;
        case 'difficulty':
          this.difficulty = t.dataset.v as Difficulty;
          this.refreshForm();
          break;
        case 'bots':
          this.bots = Number(t.dataset.v) || 0;
          this.refreshForm();
          break;
        case 'create':
          h.onCreate(this.formSlot, {
            name: this.nameInput.value.trim().slice(0, 20) || `World ${this.formSlot + 1}`,
            seed: parseSeed(this.seedInput.value),
            difficulty: this.difficulty,
            bots: this.bots,
          });
          break;
        case 'cancel':
          this.showList();
          break;
        case 'back':
          h.onBack();
          break;
      }
    });
  }

  /** The slots as saved now (after a delete, call it again with the new list). */
  show(slots: (WorldSlotInfo | null)[]): void {
    this.slots = slots.slice();
    this.confirming = -1;
    this.showList();
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  private showList(): void {
    this.form.hidden = true;
    this.listView.hidden = false;
    this.render();
  }

  private openForm(slot: number): void {
    this.formSlot = slot;
    this.nameInput.value = '';
    this.nameInput.placeholder = `World ${slot + 1}`;
    this.seedInput.value = '';
    this.difficulty = this.settings.difficulty;
    this.bots = Math.max(0, Math.min(MAX_PLAYERS - 1, this.settings.bots));
    this.refreshForm();
    this.listView.hidden = true;
    this.form.hidden = false;
  }

  private refreshForm(): void {
    markActive(this.ref('difficulty'), this.difficulty);
    markActive(this.ref('bots'), String(this.bots));
  }

  /** One card per slot: a saved world with Play / Host / Delete, or an empty slot with "New world". */
  private render(): void {
    this.list.innerHTML = '';
    this.slots.forEach((w, i) => {
      const li = el('li', 'world-card');
      const info = el('div', 'world-info');
      const name = el('b', 'world-name');
      const meta = el('small', 'world-meta');
      info.append(name, meta);
      const btns = el('div', 'world-btns');
      li.append(info, btns);
      const button = (act: string, cls: string, html: string) => {
        const b = el('button', cls, html);
        b.dataset.act = act;
        b.dataset.slot = String(i);
        btns.appendChild(b);
        return b;
      };
      if (!w) {
        li.classList.add('empty');
        name.textContent = 'Empty slot';
        meta.textContent = `Slot ${i + 1}`;
        button('new', 'btn small primary', 'New world');
      } else if (this.confirming === i) {
        li.classList.add('confirm');
        name.textContent = `Delete “${w.name}”?`;
        meta.textContent = `Day ${w.day}. This can’t be undone.`;
        button('delete-yes', 'btn small danger', 'Delete');
        button('delete-no', 'btn small', 'Keep');
      } else {
        name.textContent = w.name;
        const bots = w.bots === 0 ? 'no bots' : `${w.bots} bot${w.bots === 1 ? '' : 's'}`;
        meta.textContent = `Day ${w.day} · ${DIFFICULTY[w.difficulty].label} · ${bots} · ${playedText(w.played)} · ${agoText(w.saved)}`;
        button('play', 'btn small primary', 'Play');
        button('host', 'btn small', 'Host');
        const del = button('delete', 'icon-btn world-del', ICON_TRASH);
        del.setAttribute('aria-label', `Delete ${w.name}`);
        del.title = 'Delete';
      }
      this.list.appendChild(li);
    });
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
