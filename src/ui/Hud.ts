import { DOWNED, JAVELIN, SURVIVOR } from '../config';
import type { Route } from '../sim/route';
import type { PlayerSpec, Snapshot, SurvivorSnap } from '../sim/types';
import { el, formatTime } from './dom';

export type EndMode = 'solo' | 'host' | 'guest';

export interface HudHandlers {
  onPause(): void;
  onResume(): void;
  onSettings(): void;
  onRestart(): void;
  onLobby(): void;
  onQuit(): void;
}

interface TeamRow {
  row: HTMLElement;
  fill: HTMLElement;
  icon: HTMLElement;
}

const STATUS_ICON: Record<string, string> = { active: '', downed: '!', rescued: '✓', dead: '☠' };

export class Hud {
  private readonly el: HTMLDivElement;
  private readonly timer: HTMLElement;
  private readonly goalBox: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly dist: HTMLElement;
  private readonly saved: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly ammo: HTMLElement;
  private readonly team: HTMLElement;
  private readonly status: HTMLElement;
  private readonly revive: HTMLElement;
  private readonly reviveFill: HTMLElement;
  private readonly reviveText: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly msg: HTMLElement;
  private readonly pausePanel: HTMLElement;
  private readonly pauseNote: HTMLElement;
  private readonly endPanel: HTMLElement;
  private readonly rows = new Map<string, TeamRow>();
  private names = new Map<string, string>();
  private localId = '';
  private total = 1;
  private msgTimer = 0;
  private time = 0;
  private route: Route | null = null;

  constructor(parent: HTMLElement, h: HudHandlers) {
    this.el = el(
      'div',
      'hud',
      `<div class="hud-vignette" data-ref="vignette"></div>
      <div class="hud-topleft">
        <button class="hud-btn" data-act="pause" aria-label="Pause">
          <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        </button>
        <div class="hud-me">
          <div class="hud-hp"><div class="hud-hp-fill" data-ref="hp"></div><span data-ref="hptext"></span></div>
          <div class="hud-ammo" data-ref="ammo"></div>
        </div>
      </div>
      <div class="hud-team" data-ref="team"></div>
      <div class="hud-timer" data-ref="timer"></div>
      <div class="hud-goal" data-ref="goal">
        <svg class="hud-arrow" data-ref="arrow" viewBox="0 0 24 24"><path d="M12 2l8 14h-5v6h-6v-6H4z"/></svg>
        <span data-ref="dist"></span>
        <span class="hud-saved" data-ref="saved"></span>
      </div>
      <div class="hud-status" data-ref="status"></div>
      <div class="hud-revive" data-ref="revive" hidden>
        <span data-ref="revive-text"></span>
        <div class="hud-revive-bar"><div data-ref="revive-fill"></div></div>
      </div>
      <div class="hud-fps" data-ref="fps" hidden></div>
      <div class="hud-msg" data-ref="msg"></div>
      <div class="overlay" data-ref="pause" hidden>
        <div class="card">
          <h2>Paused</h2>
          <p class="hint" data-ref="pause-note">The game keeps running in multiplayer!</p>
          <button class="btn primary" data-act="resume">Resume</button>
          <button class="btn" data-act="settings">Settings</button>
          <button class="btn ghost" data-act="quit">Quit to menu</button>
        </div>
      </div>
      <div class="overlay" data-ref="end" hidden>
        <div class="card">
          <h2 data-ref="end-title"></h2>
          <p data-ref="end-text"></p>
          <p class="hint" data-ref="end-wait">Waiting for the host…</p>
          <button class="btn primary" data-act="restart" data-end="solo">Play again</button>
          <button class="btn primary" data-act="lobby" data-end="host">Back to lobby</button>
          <button class="btn ghost" data-act="quit" data-end="solo host guest">Menu</button>
        </div>
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);

    this.timer = this.ref('timer');
    this.goalBox = this.ref('goal');
    this.arrow = this.ref('arrow');
    this.dist = this.ref('dist');
    this.saved = this.ref('saved');
    this.hpFill = this.ref('hp');
    this.hpText = this.ref('hptext');
    this.ammo = this.ref('ammo');
    this.team = this.ref('team');
    this.status = this.ref('status');
    this.revive = this.ref('revive');
    this.reviveFill = this.ref('revive-fill');
    this.reviveText = this.ref('revive-text');
    this.vignette = this.ref('vignette');
    this.fps = this.ref('fps');
    this.msg = this.ref('msg');
    this.pausePanel = this.ref('pause');
    this.pauseNote = this.ref('pause-note');
    this.endPanel = this.ref('end');

    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'pause') h.onPause();
      else if (act === 'resume') h.onResume();
      else if (act === 'settings') h.onSettings();
      else if (act === 'restart') h.onRestart();
      else if (act === 'lobby') h.onLobby();
      else if (act === 'quit') h.onQuit();
    });
  }

  /** The way to the rescue hut on this match's map: the arrow points along it. */
  setRoute(route: Route): void {
    this.route = route;
  }

  setTeam(specs: readonly PlayerSpec[], localId: string): void {
    this.localId = localId;
    this.total = specs.length;
    this.names = new Map(specs.map((s) => [s.id, s.name]));
    this.team.innerHTML = '';
    this.rows.clear();
    for (const s of specs) {
      if (s.id === localId) continue;
      const row = el('div', 'team-row', `<span class="team-icon"></span><span class="team-name"></span><div class="team-bar"><div></div></div>`);
      row.querySelector('.team-name')!.textContent = s.bot ? `${s.name} (bot)` : s.name;
      this.team.appendChild(row);
      this.rows.set(s.id, { row, fill: row.querySelector<HTMLElement>('.team-bar > div')!, icon: row.querySelector<HTMLElement>('.team-icon')! });
    }
  }

  show(): void {
    this.el.hidden = false;
    this.pausePanel.hidden = true;
    this.endPanel.hidden = true;
    this.msg.classList.remove('show');
  }

  hide(): void {
    this.el.hidden = true;
  }

  setPaused(on: boolean, canPause: boolean): void {
    this.pausePanel.hidden = !on;
    this.pauseNote.hidden = canPause;
  }

  flash(text: string, ms = 3000): void {
    this.msg.textContent = text;
    this.msg.classList.add('show');
    window.clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => this.msg.classList.remove('show'), ms);
  }

  showEnd(won: boolean, text: string, mode: EndMode): void {
    this.ref('end-title').textContent = won ? 'Rescued!' : 'Game over';
    this.ref('end-text').textContent = text;
    this.ref('end-wait').hidden = mode !== 'guest';
    for (const b of this.endPanel.querySelectorAll<HTMLElement>('[data-end]')) {
      b.hidden = !(b.dataset.end ?? '').split(' ').includes(mode);
    }
    this.endPanel.classList.toggle('won', won);
    this.pausePanel.hidden = true;
    this.endPanel.hidden = false;
  }

  update(snap: Snapshot, fps: number | null): void {
    this.time += 1 / 60;
    const t = formatTime(snap.timeLeft);
    if (this.timer.textContent !== t) this.timer.textContent = t;
    this.timer.classList.toggle('urgent', snap.timeLeft < 30);

    const me = snap.survivors.find((s) => s.id === this.localId);
    this.updateMe(me);
    this.updateTeam(snap);
    this.updateRevive(snap, me);

    const active = me?.state === 'active';
    this.goalBox.hidden = !me || !this.route;
    if (me && this.route) {
      // Point at the next waypoint (a pass, say) and show the distance left along the way.
      const { next, remaining } = this.route.locate(me.x, me.z);
      const dx = next.x - me.x;
      const dz = next.z - me.z;
      // Screen up is -Z, screen right is +X.
      this.arrow.style.transform = `rotate(${Math.atan2(dx, -dz)}rad)`;
      this.arrow.style.visibility = active ? 'visible' : 'hidden';
      this.setText(this.dist, active ? `${Math.round(remaining)} m` : '');
      this.setText(this.saved, this.total > 1 ? `🏠 ${snap.rescued}/${this.total}` : '');
    }

    this.fps.hidden = fps === null;
    if (fps !== null) this.setText(this.fps, `${fps} fps`);
  }

  private updateMe(me: SurvivorSnap | undefined): void {
    if (!me) return;
    const hp = Math.max(0, me.hp) / SURVIVOR.maxHp;
    this.hpFill.style.width = `${hp * 100}%`;
    this.hpFill.className = `hud-hp-fill ${hp > 0.5 ? 'good' : hp > 0.25 ? 'ok' : 'bad'}`;
    this.setText(this.hpText, `${Math.max(0, Math.ceil(me.hp))}`);
    this.setText(
      this.ammo,
      me.weapon === 'javelin' ? `Javelins ${'●'.repeat(me.ammo)}${'○'.repeat(Math.max(0, JAVELIN.ammo - me.ammo))}` : '',
    );

    let status = '';
    if (me.state === 'downed') status = `You're down! ${Math.ceil(me.bleed)}s… a buddy can revive you`;
    else if (me.state === 'dead') status = 'You turned into a zombie… spectating';
    else if (me.state === 'rescued') status = 'You made it! Spectating…';
    else if (me.hidden) status = 'Hidden in the bamboo';
    this.setText(this.status, status);
    this.status.classList.toggle('small', me.state === 'active');

    const pulse = 0.5 + 0.5 * Math.sin(this.time * 6);
    const v = me.state === 'downed' ? 0.55 + 0.2 * pulse : Math.max(me.hurt * 0.8, me.state === 'active' && hp < 0.25 ? 0.2 + 0.1 * pulse : 0);
    this.vignette.style.opacity = v.toFixed(2);
  }

  private updateTeam(snap: Snapshot): void {
    for (const s of snap.survivors) {
      const r = this.rows.get(s.id);
      if (!r) continue;
      r.fill.style.width = `${(s.state === 'downed' ? s.bleed / DOWNED.bleedTime : s.hp / SURVIVOR.maxHp) * 100}%`;
      r.row.dataset.state = s.state;
      this.setText(r.icon, STATUS_ICON[s.state] ?? '');
    }
  }

  private updateRevive(snap: Snapshot, me: SurvivorSnap | undefined): void {
    let text = '';
    let progress = 0;
    if (me?.state === 'downed' && me.revive > 0) {
      text = 'Being revived…';
      progress = me.revive;
    } else if (me?.state === 'active') {
      const friend = snap.survivors.find(
        (s) => s.state === 'downed' && s.revive > 0 && Math.hypot(s.x - me.x, s.z - me.z) < DOWNED.reviveRadius + 0.3,
      );
      if (friend) {
        text = `Reviving ${this.names.get(friend.id) ?? 'buddy'}…`;
        progress = friend.revive;
      }
    }
    this.revive.hidden = !text;
    if (text) {
      this.setText(this.reviveText, text);
      this.reviveFill.style.width = `${progress * 100}%`;
    }
  }

  private setText(e: HTMLElement, text: string): void {
    if (e.textContent !== text) e.textContent = text;
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
