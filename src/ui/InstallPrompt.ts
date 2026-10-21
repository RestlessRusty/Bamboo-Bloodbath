import { el } from './dom';

/** Chrome's install prompt event (not in the DOM typings). */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const ICON_INSTALL = `<svg viewBox="0 0 24 24"><path d="M12 4v10M7.5 9.5 12 14l4.5-4.5M5 16v3h14v-3"/></svg>`;

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isInstalled = () =>
  window.matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

/**
 * "Install" button: Chrome / Android show their own install prompt (once the browser offers it);
 * iOS has no such prompt, so the button opens a card explaining Share → Add to Home Screen.
 */
export class InstallPrompt {
  readonly button: HTMLButtonElement;
  private readonly card: HTMLDivElement;
  private deferred: InstallEvent | null = null;
  private onMenu = true;

  constructor(modalParent: HTMLElement) {
    this.button = el('button', 'pill-btn', `${ICON_INSTALL}<span>Install</span>`);
    this.button.type = 'button';
    this.button.title = 'Add the game to your home screen';
    this.button.addEventListener('click', () => void this.install());

    this.card = el(
      'div',
      'modal',
      `<div class="card install-card">
        <h2>Install the game</h2>
        <p>Tap <b>Share</b> <span class="share-icon" aria-hidden="true">⬆</span> in the browser bar, then <b>Add to Home Screen</b>.</p>
        <p class="hint">It opens fullscreen from the home screen and works offline.</p>
        <div class="card-foot">
          <button class="btn primary" data-act="close">Got it!</button>
        </div>
      </div>`,
    );
    this.card.hidden = true;
    this.card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="close"]')) this.card.hidden = true;
    });
    modalParent.appendChild(this.card);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // keep the event for our own button instead of the browser's mini bar
      this.deferred = e as InstallEvent;
      this.update();
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.update();
    });
    this.update();
  }

  /** Shown on menus only, not during matches. */
  setOnMenu(on: boolean): void {
    this.onMenu = on;
    this.update();
  }

  private async install(): Promise<void> {
    const e = this.deferred;
    if (!e) {
      this.card.hidden = false;
      return;
    }
    // The event works only once, whatever the player answers.
    this.deferred = null;
    this.update();
    try {
      await e.prompt();
      await e.userChoice;
    } catch {
      // Prompt refused by the browser: nothing to do.
    }
  }

  private update(): void {
    const offered = !!this.deferred || (isIos() && !isInstalled());
    this.button.hidden = !this.onMenu || !offered;
  }
}
