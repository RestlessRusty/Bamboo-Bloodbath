import { MAX_PLAYERS, type Difficulty } from '../config';
import { CODE_LENGTH, normalizeCode, type LobbyPlayer } from '../net/protocol';
import { PANDA_LOOKS } from '../render/pandaModel';
import { WEAPONS } from '../sim/weapons';
import { difficultyButtons, el, markActive, scrollHint } from './dom';
import { MapPicker } from './MapPicker';

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
}

/** Multiplayer screens: create / join, then the room with its code and player list. */
export class Lobby {
  private readonly el: HTMLDivElement;
  private readonly choose: HTMLElement;
  private readonly busy: HTMLElement;
  private readonly room: HTMLElement;
  private readonly mapPicker: MapPicker;

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
            <div class="room-code" data-ref="room-code"></div>
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
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.choose = this.ref('choose');
    this.busy = this.ref('busy');
    this.room = this.ref('room');
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
      }
    });
  }

  showChoose(error = ''): void {
    this.el.hidden = false;
    this.choose.hidden = false;
    this.busy.hidden = true;
    this.room.hidden = true;
    this.ref('error').textContent = error;
  }

  showBusy(text: string): void {
    this.el.hidden = false;
    this.choose.hidden = true;
    this.busy.hidden = false;
    this.room.hidden = true;
    this.ref('busy-text').textContent = text;
  }

  showRoom(v: RoomView): void {
    this.el.hidden = false;
    this.choose.hidden = true;
    this.busy.hidden = true;
    this.room.hidden = false;
    this.ref('room-code').textContent = v.code;
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
      ? 'Share the code with friends (up to 4 pandas), then press Start.'
      : 'Waiting for the host to start the game…';
  }

  hide(): void {
    this.el.hidden = true;
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
