import { cyclePick } from '../game/maps';
import { PANDA_LOOKS } from '../render/pandaModel';
import type { Settings } from '../settings';
import { PANDA_VARIANTS, type WeaponType } from '../sim/types';
import { el } from './dom';
import { MapPicker } from './MapPicker';

export interface MenuHandlers {
  onStory(): void;
  onPlaySolo(): void;
  onMultiplayer(): void;
  onSettings(): void;
  onHowTo(): void;
  /** Panda or weapon changed: update the 3D preview. */
  onPreview(): void;
  /** Map choice changed: show that map behind the menu. */
  onMapPreview(): void;
  /** Anything changed: persist settings. */
  onChange(): void;
}

export class Menu {
  private readonly el: HTMLDivElement;
  private readonly mapPicker: MapPicker;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly h: MenuHandlers,
  ) {
    this.el = el(
      'div',
      'menu',
      `<div class="menu-panel">
        <h1 class="logo"><span>Bamboo</span><span class="blood">Bloodbath</span></h1>
        <p class="tagline">Cute pandas. Sharp things. Hungry zombies.</p>
        <label class="field">
          <span>Nickname</span>
          <input data-ref="name" maxlength="14" placeholder="Your name" autocomplete="off" spellcheck="false" />
        </label>
        <div class="picker">
          <span>Panda</span>
          <button class="arrow-btn" data-act="prev" aria-label="Previous panda">‹</button>
          <b data-ref="variant"></b>
          <button class="arrow-btn" data-act="next" aria-label="Next panda">›</button>
        </div>
        <div class="picker">
          <span>Weapon</span>
          <div class="seg" data-ref="weapons">
            <button data-act="weapon" data-v="knife">Knife</button>
            <button data-act="weapon" data-v="axe">Axe</button>
            <button data-act="weapon" data-v="javelin">Javelin</button>
          </div>
        </div>
        <div class="picker">
          <span>Bot buddies</span>
          <div class="seg" data-ref="bots">
            <button data-act="bots" data-v="0">0</button>
            <button data-act="bots" data-v="1">1</button>
            <button data-act="bots" data-v="2">2</button>
            <button data-act="bots" data-v="3">3</button>
          </div>
        </div>
        <div data-ref="map"></div>
        <div class="menu-buttons">
          <button class="btn primary big story" data-act="story">Story</button>
          <button class="btn primary big" data-act="solo">Play solo</button>
          <button class="btn" data-act="multi">Multiplayer</button>
          <button class="btn ghost" data-act="howto">How to play</button>
          <button class="btn ghost" data-act="settings">Settings</button>
        </div>
        <p class="hint small" data-ref="toast"></p>
      </div>`,
    );
    parent.appendChild(this.el);

    this.mapPicker = new MapPicker((dir) => {
      settings.map = cyclePick(settings.map, dir);
      this.mapPicker.set(settings.map, true);
      h.onChange();
      h.onMapPreview();
    });
    this.ref('map').replaceWith(this.mapPicker.el);
    this.mapPicker.set(settings.map, true);

    const name = this.ref<HTMLInputElement>('name');
    name.value = settings.nickname;
    name.addEventListener('input', () => {
      settings.nickname = name.value.slice(0, 14);
      h.onChange();
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });

    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t || (t as HTMLButtonElement).disabled) return;
      switch (t.dataset.act) {
        case 'story':
          h.onStory();
          break;
        case 'solo':
          h.onPlaySolo();
          break;
        case 'multi':
          h.onMultiplayer();
          break;
        case 'settings':
          h.onSettings();
          break;
        case 'howto':
          h.onHowTo();
          break;
        case 'prev':
          this.cycleVariant(-1);
          break;
        case 'next':
          this.cycleVariant(1);
          break;
        case 'weapon':
          settings.weapon = t.dataset.v as WeaponType;
          this.refresh();
          h.onChange();
          h.onPreview();
          break;
        case 'bots':
          settings.bots = Number(t.dataset.v) || 0;
          this.refresh();
          h.onChange();
          break;
      }
    });

    this.refresh();
  }

  show(message = ''): void {
    this.ref('toast').textContent = message;
    this.mapPicker.set(this.settings.map, true); // may have changed in a lobby
    this.refresh(); // bot count may have changed in the story menu
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  private cycleVariant(dir: number): void {
    const n = PANDA_VARIANTS.length;
    const i = PANDA_VARIANTS.indexOf(this.settings.variant);
    this.settings.variant = PANDA_VARIANTS[(i + dir + n) % n];
    this.refresh();
    this.h.onChange();
    this.h.onPreview();
  }

  private refresh(): void {
    this.ref('variant').textContent = PANDA_LOOKS[this.settings.variant].label;
    for (const b of this.ref('weapons').querySelectorAll<HTMLElement>('[data-v]')) {
      b.classList.toggle('active', b.dataset.v === this.settings.weapon);
    }
    for (const b of this.ref('bots').querySelectorAll<HTMLElement>('[data-v]')) {
      b.classList.toggle('active', Number(b.dataset.v) === this.settings.bots);
    }
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
