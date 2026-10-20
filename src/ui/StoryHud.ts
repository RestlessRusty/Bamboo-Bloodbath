import type { Chapter } from '../sim/story/types';
import type { Snapshot } from '../sim/types';
import { el, formatTime } from './dom';

interface Said {
  who: string;
  text: string;
}

const SPEAKER_CLASS: Record<string, string> = { you: 'you', doc: 'doc', radio: 'radio', buddy: 'buddy' };
/** Most lines waiting at once; older ones are dropped if the story gets ahead of the reader. */
const MAX_QUEUE = 6;

/**
 * Story mode HUD: the current objective (always visible, so the dialogue can be skipped freely)
 * and the dialogue box, one line at a time, with a single Skip button that clears it all.
 */
export class StoryHud {
  private readonly el: HTMLDivElement;
  private readonly obj: HTMLElement;
  private readonly objText: HTMLElement;
  private readonly objSub: HTMLElement;
  private readonly objBar: HTMLElement;
  private readonly objFill: HTMLElement;
  private readonly box: HTMLElement;
  private readonly who: HTMLElement;
  private readonly text: HTMLElement;
  private chapter: Chapter | null = null;
  private names: Record<string, string> = {};
  private queue: Said[] = [];
  private current: Said | null = null;
  private left = 0;
  private stage = -1;

  constructor(parent: HTMLElement) {
    this.el = el(
      'div',
      'story-hud',
      `<div class="story-obj" data-ref="obj">
        <span class="story-obj-text" data-ref="obj-text"></span>
        <span class="story-obj-sub" data-ref="obj-sub"></span>
        <div class="story-obj-bar" data-ref="obj-bar"><div data-ref="obj-fill"></div></div>
      </div>
      <div class="story-say" data-ref="box" hidden>
        <b data-ref="who"></b>
        <span data-ref="text"></span>
        <button class="btn small ghost" data-act="skip">Skip</button>
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.obj = this.ref('obj');
    this.objText = this.ref('obj-text');
    this.objSub = this.ref('obj-sub');
    this.objBar = this.ref('obj-bar');
    this.objFill = this.ref('obj-fill');
    this.box = this.ref('box');
    this.who = this.ref('who');
    this.text = this.ref('text');
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="skip"]')) this.skip();
    });
  }

  /** Start of a chapter: who's who for speaker names and `{you}`. */
  start(chapter: Chapter, you: string, buddy: string | null): void {
    this.reset();
    this.chapter = chapter;
    this.names = { you, doc: 'Doc Mapo', radio: 'Radio', buddy: buddy ?? 'Buddy' };
  }

  /** Leaving the chapter: hide everything and forget queued lines. */
  reset(): void {
    this.chapter = null;
    this.queue = [];
    this.current = null;
    this.stage = -1;
    this.box.hidden = true;
    this.el.hidden = true;
  }

  say(who: string, text: string): void {
    if (!this.chapter) return;
    this.queue.push({ who, text });
    if (this.queue.length > MAX_QUEUE) this.queue.shift();
    if (!this.current) this.next();
  }

  update(snap: Snapshot, dt: number): void {
    const s = snap.story;
    const ch = this.chapter;
    this.el.hidden = !s || !ch || snap.phase !== 'playing';
    if (!s || !ch) return;

    if (this.current) {
      this.left -= dt;
      if (this.left <= 0) this.next();
    }

    const stage = ch.stages[s.stage];
    if (s.stage !== this.stage) {
      this.stage = s.stage;
      // A little bounce whenever the objective changes.
      this.obj.classList.remove('new');
      void this.obj.offsetWidth;
      this.obj.classList.add('new');
    }
    let text = stage.label;
    if (stage.kind === 'collect') text += ` (${s.got}/${s.need})`;
    this.setText(this.objText, text);

    let sub = '';
    if (s.waitDoc) sub = 'Wait for Doc!';
    else if (stage.kind === 'hold') {
      const left = stage.time * (1 - s.hold);
      sub = s.holding ? `${formatTime(left)} to go` : `Get back inside the circle! (${formatTime(left)} to go)`;
    }
    this.setText(this.objSub, sub);
    this.objSub.classList.toggle('warn', s.waitDoc || (stage.kind === 'hold' && !s.holding));
    this.objBar.hidden = stage.kind !== 'hold';
    if (stage.kind === 'hold') this.objFill.style.width = `${s.hold * 100}%`;
    // Sit below the clock when there is one.
    this.obj.classList.toggle('below-timer', snap.timeLeft >= 0);
  }

  private skip(): void {
    this.queue = [];
    this.current = null;
    this.box.hidden = true;
  }

  private next(): void {
    const line = this.queue.shift() ?? null;
    this.current = line;
    this.box.hidden = !line;
    if (!line) return;
    const text = line.text.split('{you}').join(this.names.you ?? 'you');
    this.who.textContent = this.names[line.who] ?? line.who;
    this.who.className = `story-who ${SPEAKER_CLASS[line.who] ?? ''}`;
    this.text.textContent = text;
    // Long enough to read on a phone mid-fight.
    this.left = Math.max(3, 1.8 + text.length * 0.05);
    this.box.classList.remove('pop');
    void this.box.offsetWidth;
    this.box.classList.add('pop');
  }

  private setText(e: HTMLElement, text: string): void {
    if (e.textContent !== text) e.textContent = text;
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
