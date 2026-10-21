import type { Difficulty } from '../config';
import { cyclePick } from '../game/maps';
import type { Settings } from '../settings';
import { difficultyButtons, el, markActive } from './dom';
import { MapPicker } from './MapPicker';

export interface QuickPlayHandlers {
  onPlay(): void;
  onRecords(): void;
  /** Map choice changed (or the screen opened): show that map behind the menu. */
  onMapPreview(): void;
  onBack(): void;
  /** Anything changed: persist settings. */
  onChange(): void;
}

/** Quick play setup: map, bot buddies and difficulty for a solo match. */
export class QuickPlayMenu {
  private readonly el: HTMLDivElement;
  private readonly mapPicker: MapPicker;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    h: QuickPlayHandlers,
  ) {
    this.el = el(
      'div',
      'menu',
      `<div class="menu-panel quick-menu">
        <h1 class="logo sub-logo"><span>Quick</span><span class="blood">Play</span></h1>
        <div data-ref="map"></div>
        <div class="picker">
          <span>Bot buddies</span>
          <div class="seg" data-ref="bots">
            <button data-act="bots" data-v="0">0</button>
            <button data-act="bots" data-v="1">1</button>
            <button data-act="bots" data-v="2">2</button>
            <button data-act="bots" data-v="3">3</button>
          </div>
        </div>
        <div class="picker">
          <span>Difficulty</span>
          <div class="seg" data-ref="difficulty">${difficultyButtons()}</div>
        </div>
        <div class="menu-buttons">
          <button class="btn primary big" data-act="play">Play</button>
          <button class="btn ghost" data-act="records">Records</button>
          <button class="btn ghost" data-act="back">Back</button>
        </div>
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);

    this.mapPicker = new MapPicker((dir) => {
      settings.map = cyclePick(settings.map, dir);
      this.mapPicker.set(settings.map, true);
      this.refresh();
      h.onChange();
      h.onMapPreview();
    });
    this.ref('map').replaceWith(this.mapPicker.el);

    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t || (t as HTMLButtonElement).disabled) return;
      switch (t.dataset.act) {
        case 'bots':
          settings.bots = Number(t.dataset.v) || 0;
          this.refresh();
          h.onChange();
          break;
        case 'difficulty':
          settings.difficulty = t.dataset.v as Difficulty;
          this.refresh();
          h.onChange();
          break;
        case 'play':
          h.onPlay();
          break;
        case 'records':
          h.onRecords();
          break;
        case 'back':
          h.onBack();
          break;
      }
    });
  }

  /** The map may have changed in a lobby, bots / difficulty in the story menu. */
  show(): void {
    this.mapPicker.set(this.settings.map, true);
    this.refresh();
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  private refresh(): void {
    for (const b of this.ref('bots').querySelectorAll<HTMLElement>('[data-v]')) {
      b.classList.toggle('active', Number(b.dataset.v) === this.settings.bots);
    }
    markActive(this.ref('difficulty'), this.settings.difficulty);
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
