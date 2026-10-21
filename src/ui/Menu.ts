import { PANDA_LOOKS } from '../render/pandaModel';
import type { Settings } from '../settings';
import { PANDA_VARIANTS, type WeaponType } from '../sim/types';
import { el } from './dom';

const ICON_HELP = `<svg viewBox="0 0 24 24"><path d="M8.6 9a3.4 3.4 0 1 1 4.7 3.1c-.8.4-1.3 1.1-1.3 2V15"/><circle class="dot" cx="12" cy="19" r="1.5"/></svg>`;
const ICON_GEAR = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5.6"/><circle cx="12" cy="12" r="1.8"/><path d="M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M5.4 18.6l2.1-2.1M16.5 7.5l2.1-2.1"/></svg>`;

export interface MenuHandlers {
  onStory(): void;
  onQuickPlay(): void;
  /** Infinite mode: the saved worlds. */
  onInfinite(): void;
  onMultiplayer(): void;
  /** "Join XXXX" from an invite link. */
  onInvite(code: string): void;
  onSettings(): void;
  onHowTo(): void;
  /** Panda or weapon changed: update the 3D preview. */
  onPreview(): void;
  /** Anything changed: persist settings. */
  onChange(): void;
}

/** Main menu: who you are (name, panda, weapon) and the ways to play. */
export class Menu {
  private readonly el: HTMLDivElement;
  private invite: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly settings: Settings,
    private readonly h: MenuHandlers,
  ) {
    this.el = el(
      'div',
      'menu',
      `<div class="menu-panel main-menu">
        <div class="menu-head">
          <h1 class="logo"><span>Bamboo</span><span class="blood">Bloodbath</span></h1>
          <div class="menu-icons">
            <button class="icon-btn" data-act="howto" aria-label="How to play" title="How to play">${ICON_HELP}</button>
            <button class="icon-btn" data-act="settings" aria-label="Settings" title="Settings">${ICON_GEAR}</button>
          </div>
        </div>
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
        <div class="modes">
          <div class="mode-group">
            <span class="mode-head">Solo</span>
            <div class="mode-row mode-row-fit">
              <button class="btn primary big" data-act="story">Story</button>
              <button class="btn primary big" data-act="quick">Quick play</button>
              <button class="btn primary big infinite-btn" data-act="infinite">Infinite</button>
            </div>
          </div>
          <div class="mode-group">
            <span class="mode-head">Together</span>
            <div class="mode-row">
              <button class="btn primary big" data-act="multi">Multiplayer</button>
              <button class="btn primary big invite-btn" data-act="invite" data-ref="invite" hidden></button>
            </div>
          </div>
        </div>
        <p class="hint small menu-toast" data-ref="toast"></p>
      </div>`,
    );
    parent.appendChild(this.el);

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
        case 'quick':
          h.onQuickPlay();
          break;
        case 'infinite':
          h.onInfinite();
          break;
        case 'multi':
          h.onMultiplayer();
          break;
        case 'invite':
          if (this.invite) h.onInvite(this.invite);
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
      }
    });

    this.refresh();
  }

  show(message = ''): void {
    this.ref('toast').textContent = message;
    this.refresh();
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }

  /**
   * Room code from an invite link, or a room we dropped out of (`rejoin`): adds a "Join XXXX" /
   * "Rejoin XXXX" button next to Multiplayer (null removes it).
   */
  setInvite(code: string | null, rejoin = false): void {
    this.invite = code;
    const b = this.ref('invite');
    b.textContent = code ? `${rejoin ? 'Rejoin' : 'Join'} ${code}` : '';
    b.hidden = !code;
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
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
