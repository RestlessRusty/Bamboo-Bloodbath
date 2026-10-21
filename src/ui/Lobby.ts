import { MAX_PLAYERS, type Difficulty } from '../config';
import { inviteLink } from '../net/invite';
import { CODE_LENGTH, normalizeCode, type LobbyPlayer } from '../net/protocol';
import { PANDA_LOOKS } from '../render/pandaModel';
import { WEAPONS } from '../sim/weapons';
import { difficultyButtons, el, markActive, scrollHint } from './dom';
import { MapPicker } from './MapPicker';
import { drawQr } from './qr';

const ICON_COPY = `<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1"/></svg>`;
const ICON_SHARE = `<svg viewBox="0 0 24 24"><circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="M8.7 10.7l6.6-3.9M8.7 13.3l6.6 3.9"/></svg>`;
const ICON_QR = `<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 20.5h1M20.5 14v1"/></svg>`;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // no clipboard access (old browser, not https, or refused)
  }
}

export interface LobbyHandlers {
  onCreate(): void;
  onJoin(code: string): void;
  onStart(): void;
  onBots(n: number): void;
  /** Host cycles the map choice. */
  onMap(dir: number): void;
  onDifficulty(difficulty: Difficulty): void;
  /** Leave the room (or the multiplayer screen) and return to the main menu. */
  onLeave(): void;
}

export interface RoomView {
  code: string;
  players: readonly LobbyPlayer[];
  bots: number;
  /** Map id or "random". */
  mapPick: string;
  difficulty: Difficulty;
  isHost: boolean;
  myId: string;
  /** A match is on without us (we joined late, no bot panda was free): we play the next one. */
  waiting?: boolean;
}

/** Multiplayer screens: create / join, then the room with its code and player list. */
export class Lobby {
  private readonly el: HTMLDivElement;
  private readonly choose: HTMLElement;
  private readonly busy: HTMLElement;
  private readonly room: HTMLElement;
  private readonly qr: HTMLElement;
  private readonly mapPicker: MapPicker;
  /** Current room's code, for copy / share / QR. */
  private code = '';
  private noteTimer = 0;

  constructor(
    parent: HTMLElement,
    private readonly h: LobbyHandlers,
  ) {
    this.el = el(
      'div',
      'modal lobby',
      `<div class="card lobby-card" data-ref="choose">
        <div class="scroll-body" data-ref="choose-body">
          <h2>Multiplayer</h2>
          <p class="hint">Play together on phones, no accounts. One player creates a room and shares its code.</p>
          <button class="btn primary big" data-act="create">Create room</button>
          <p class="hint small" data-ref="own-code"></p>
          <div class="join-row">
            <input data-ref="code" maxlength="${CODE_LENGTH}" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" />
            <button class="btn" data-act="join">Join</button>
          </div>
          <p class="error" data-ref="error"></p>
        </div>
        <div class="card-foot">
          <button class="btn ghost" data-act="leave">Back</button>
        </div>
      </div>
      <div class="card lobby-card" data-ref="busy" hidden>
        <h2 data-ref="busy-text">Connecting…</h2>
        <div class="spinner"></div>
        <button class="btn ghost" data-act="leave">Cancel</button>
      </div>
      <div class="card lobby-card room-card" data-ref="room" hidden>
        <div class="scroll-body room-body" data-ref="room-body">
          <div class="room-col">
            <p class="hint">Room code</p>
            <div class="code-row">
              <div class="room-code" data-ref="room-code"></div>
              <div class="invite-btns">
                <button class="icon-btn" data-act="copy" aria-label="Copy code" title="Copy code">${ICON_COPY}</button>
                <button class="icon-btn" data-act="share" aria-label="Share invite link" title="Share invite link">${ICON_SHARE}</button>
                <button class="icon-btn" data-act="qr" aria-label="Show QR code" title="Show QR code">${ICON_QR}</button>
              </div>
            </div>
            <p class="invite-note" data-ref="invite-note" hidden></p>
            <ul class="player-list" data-ref="players"></ul>
          </div>
          <div class="room-col">
            <div data-ref="map"></div>
            <div class="picker" data-ref="bots-row">
              <span>Bot buddies</span>
              <div class="seg" data-ref="bots"></div>
            </div>
            <div class="picker">
              <span>Difficulty</span>
              <div class="seg" data-ref="difficulty">${difficultyButtons()}</div>
            </div>
            <p class="hint" data-ref="room-hint"></p>
          </div>
        </div>
        <div class="card-foot">
          <button class="btn primary big" data-act="start" data-ref="start">Start!</button>
          <button class="btn ghost" data-act="leave">Leave room</button>
        </div>
      </div>
      <div class="card lobby-card qr-card" data-ref="qr" hidden>
        <h2>Room <span class="qr-code-text" data-ref="qr-code"></span></h2>
        <canvas class="qr-canvas" data-ref="qr-canvas"></canvas>
        <p class="hint small">Scan with the phone camera to open the game and join. <span data-ref="qr-count"></span></p>
        <div class="card-foot">
          <button class="btn primary" data-act="qr-close">Back to the room</button>
        </div>
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.choose = this.ref('choose');
    this.busy = this.ref('busy');
    this.room = this.ref('room');
    this.qr = this.ref('qr');
    this.mapPicker = new MapPicker((dir) => h.onMap(dir));
    this.ref('map').replaceWith(this.mapPicker.el);
    scrollHint(this.ref('choose-body'));
    scrollHint(this.ref('room-body'));

    const code = this.ref<HTMLInputElement>('code');
    code.addEventListener('input', () => {
      code.value = normalizeCode(code.value);
    });
    code.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.tryJoin();
    });

    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t || (t as HTMLButtonElement).disabled) return;
      switch (t.dataset.act) {
        case 'create':
          h.onCreate();
          break;
        case 'join':
          this.tryJoin();
          break;
        case 'leave':
          h.onLeave();
          break;
        case 'start':
          h.onStart();
          break;
        case 'bots':
          h.onBots(Number(t.dataset.v) || 0);
          break;
        case 'difficulty':
          h.onDifficulty(t.dataset.v as Difficulty);
          break;
        case 'copy':
          void this.copyCode();
          break;
        case 'share':
          void this.share();
          break;
        case 'qr':
          this.openQr();
          break;
        case 'qr-close':
          this.qr.hidden = true;
          this.room.hidden = false;
          break;
      }
    });
  }

  showChoose(error = ''): void {
    this.el.hidden = false;
    this.choose.hidden = false;
    this.busy.hidden = true;
    this.room.hidden = true;
    this.qr.hidden = true;
    this.ref('error').textContent = error;
  }

  showBusy(text: string): void {
    this.el.hidden = false;
    this.choose.hidden = true;
    this.busy.hidden = false;
    this.room.hidden = true;
    this.qr.hidden = true;
    this.ref('busy-text').textContent = text;
  }

  /** This device's own room code, used for every room it creates (when it's free). */
  setOwnCode(code: string): void {
    this.ref('own-code').textContent = `Your room code is always ${code}, so friends can keep your invite link.`;
  }

  /** Puts a code in the join field (an invite link we couldn't join, so retrying is one tap). */
  prefillCode(code: string): void {
    this.ref<HTMLInputElement>('code').value = normalizeCode(code);
  }

  showRoom(v: RoomView): void {
    this.el.hidden = false;
    this.choose.hidden = true;
    this.busy.hidden = true;
    // A player joining while the QR code is up keeps it up (more friends may still be scanning).
    this.room.hidden = !this.qr.hidden;
    if (v.code !== this.code) this.hideNote();
    this.code = v.code;
    this.ref('room-code').textContent = v.code;
    this.ref('qr-count').textContent = `${v.players.length}/${MAX_PLAYERS} pandas in the room.`;
    this.mapPicker.set(v.mapPick, v.isHost);

    const list = this.ref('players');
    list.innerHTML = '';
    for (const p of v.players) {
      const li = el('li', p.id === v.myId ? 'me' : '');
      li.textContent = `${p.name}${p.id === 'p1' ? ' (host)' : ''}`;
      const sub = el('small');
      sub.textContent = ` ${PANDA_LOOKS[p.variant]?.label ?? ''} · ${WEAPONS[p.weapon]?.label ?? ''}`;
      li.appendChild(sub);
      list.appendChild(li);
    }
    for (let i = 0; i < v.bots; i++) {
      const li = el('li', 'bot');
      li.textContent = `Bot buddy ${i + 1}`;
      list.appendChild(li);
    }

    const maxBots = MAX_PLAYERS - v.players.length;
    const bots = this.ref('bots');
    bots.innerHTML = '';
    for (let n = 0; n <= maxBots; n++) {
      const b = el('button', n === v.bots ? 'active' : '');
      b.dataset.act = 'bots';
      b.dataset.v = String(n);
      b.textContent = String(n);
      b.disabled = !v.isHost;
      bots.appendChild(b);
    }
    this.ref('bots-row').hidden = maxBots === 0 && v.bots === 0;
    const diff = this.ref('difficulty');
    markActive(diff, v.difficulty);
    for (const b of diff.querySelectorAll<HTMLButtonElement>('button')) b.disabled = !v.isHost;
    this.ref('start').hidden = !v.isHost;
    this.ref('room-hint').textContent = v.isHost
      ? `Share the code or link (up to ${MAX_PLAYERS} pandas), then press Start. Latecomers can take over a bot mid-match.`
      : v.waiting
        ? 'A match is on: you play the next one!'
        : 'Waiting for the host to start the game…';
  }

  hide(): void {
    this.el.hidden = true;
    this.qr.hidden = true;
  }

  private async copyCode(): Promise<void> {
    if (await copyText(this.code)) this.note('Code copied!');
    else this.note('Long-press the code to copy it.');
  }

  /** The phone's share sheet when there is one, otherwise the link goes to the clipboard. */
  private async share(): Promise<void> {
    const url = inviteLink(this.code);
    if ('share' in navigator) {
      try {
        await navigator.share({ title: 'Bamboo Bloodbath', text: `Join my Bamboo Bloodbath room ${this.code}!`, url });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return; // closed the share sheet
      }
    }
    if (await copyText(url)) this.note('Invite link copied!');
    else this.note(url);
  }

  private openQr(): void {
    this.ref('qr-code').textContent = this.code;
    // Fits a landscape phone: the card's title and button take the rest of the height.
    const size = Math.round(Math.max(120, Math.min(240, window.innerHeight - 170, window.innerWidth - 80)));
    drawQr(this.ref<HTMLCanvasElement>('qr-canvas'), inviteLink(this.code), size);
    this.room.hidden = true;
    this.qr.hidden = false;
  }

  /** A short message under the code (copied, link…); a link stays until the next one. */
  private note(text: string): void {
    const n = this.ref('invite-note');
    n.textContent = text;
    n.hidden = false;
    window.clearTimeout(this.noteTimer);
    if (!text.startsWith('http')) this.noteTimer = window.setTimeout(() => this.hideNote(), 2500);
  }

  private hideNote(): void {
    window.clearTimeout(this.noteTimer);
    this.ref('invite-note').hidden = true;
  }

  private tryJoin(): void {
    const code = normalizeCode(this.ref<HTMLInputElement>('code').value);
    if (code.length !== CODE_LENGTH) {
      this.ref('error').textContent = `Room codes have ${CODE_LENGTH} characters.`;
      return;
    }
    this.h.onJoin(code);
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
