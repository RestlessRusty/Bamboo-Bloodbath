import type { Difficulty } from '../config';
import { loadMap } from '../game/maps';
import { drawMinimap } from '../render/minimap';
import type { Settings } from '../settings';
import { refOf } from '../sim/maps';
import type { Chapter } from '../sim/story/types';
import type { StoryProgress } from '../storyProgress';
import { difficultyButtons, el, markActive, scrollHint } from './dom';

/** Chapters per act, and the act headings in the chapter list (a heading shows only once its act has chapters). */
const ACT_SIZE = 5;
const ACT_NAMES = ['Act 1: Find the Cure', 'Act 2: Root of the Problem'];

export interface StoryMenuHandlers {
  onPlay(chapter: number): void;
  /** A chapter was picked in the list: show its map behind the menu. */
  onSelect(chapter: number): void;
  onBack(): void;
  /** Bot buddies or difficulty changed: persist settings. */
  onChange(): void;
}

/** Chapter list for story mode, with bot buddies and the selected chapter's mini-map. */
export class StoryMenu {
  private readonly el: HTMLDivElement;
  private readonly list: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly blurb: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private progress: StoryProgress | null = null;
  private selected = 0;
  private drawn = -1;

  constructor(
    parent: HTMLElement,
    private readonly chapters: readonly Chapter[],
    private readonly settings: Settings,
    private readonly h: StoryMenuHandlers,
  ) {
    this.el = el(
      'div',
      'menu',
      `<div class="menu-panel story-menu">
        <h1 class="logo story-logo"><span>Find the</span><span class="blood">Cure</span></h1>
        <div class="scroll-body chapter-scroll" data-ref="scroll">
          <div class="chapter-acts" data-ref="list"></div>
        </div>
        <div class="story-setup">
          <canvas class="map-mini" width="80" height="80" data-ref="mini"></canvas>
          <div class="story-setup-info">
            <p class="hint small" data-ref="blurb"></p>
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
          </div>
        </div>
        <div class="menu-buttons">
          <button class="btn primary big" data-act="play" data-ref="play">Play</button>
          <button class="btn ghost" data-act="back">Back</button>
        </div>
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.list = this.ref('list');
    this.canvas = this.ref<HTMLCanvasElement>('mini');
    this.blurb = this.ref('blurb');
    this.playBtn = this.ref<HTMLButtonElement>('play');
    scrollHint(this.ref('scroll'));

    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!t || (t as HTMLButtonElement).disabled) return;
      switch (t.dataset.act) {
        case 'chapter':
          this.select(Number(t.dataset.i) || 0);
          break;
        case 'bots':
          this.settings.bots = Number(t.dataset.v) || 0;
          this.refresh();
          this.h.onChange();
          break;
        case 'difficulty':
          this.settings.difficulty = t.dataset.v as Difficulty;
          this.refresh();
          this.h.onChange();
          break;
        case 'play':
          this.h.onPlay(this.selected);
          break;
        case 'back':
          this.h.onBack();
          break;
      }
    });
  }

  /** Opens on `chapter`, or on the first unlocked chapter not finished yet. */
  show(progress: StoryProgress, chapter?: number): void {
    this.progress = progress;
    const firstOpen = progress.done.findIndex((d, i) => !d && i < progress.unlocked);
    const want = chapter ?? (firstOpen >= 0 ? firstOpen : progress.unlocked - 1);
    this.el.hidden = false;
    this.select(Math.max(0, Math.min(progress.unlocked - 1, want)));
    this.list.querySelector('.chapter-btn.active')?.scrollIntoView({ block: 'nearest' });
  }

  hide(): void {
    this.el.hidden = true;
  }

  private select(i: number): void {
    if (!this.progress || i >= this.progress.unlocked) return;
    this.selected = i;
    this.refresh();
    if (this.drawn !== i) {
      this.drawn = i;
      drawMinimap(this.canvas, loadMap(refOf(this.chapters[i].map)));
    }
    this.h.onSelect(i);
  }

  private refresh(): void {
    const p = this.progress;
    if (!p) return;
    // Rebuilding empties the list for a moment, which would snap a scrolled list back to the top.
    const scroller = this.ref('scroll');
    const scrolled = scroller.scrollTop;
    this.list.innerHTML = '';
    let act: HTMLElement | null = null;
    this.chapters.forEach((c, i) => {
      if (i % ACT_SIZE === 0) {
        const n = i / ACT_SIZE;
        const section = el('section', 'chapter-act');
        const head = el('h3', 'act-head');
        head.textContent = ACT_NAMES[n] ?? `Act ${n + 1}`;
        act = el('ol', 'chapter-list');
        section.append(head, act);
        this.list.appendChild(section);
      }
      const locked = i >= p.unlocked;
      const li = el('li');
      const b = el('button', `chapter-btn${i === this.selected ? ' active' : ''}${p.done[i] ? ' done' : ''}`);
      b.dataset.act = 'chapter';
      b.dataset.i = String(i);
      b.disabled = locked;
      b.innerHTML = `<span class="chapter-num"></span><span class="chapter-title"></span><span class="chapter-mark"></span>`;
      b.querySelector('.chapter-num')!.textContent = String(i + 1);
      b.querySelector('.chapter-title')!.textContent = locked ? '???' : c.title;
      b.querySelector('.chapter-mark')!.textContent = locked ? '🔒' : p.done[i] ? '✓' : '';
      li.appendChild(b);
      act?.appendChild(li);
    });
    scroller.scrollTop = scrolled;
    const c = this.chapters[this.selected];
    const rules = [c.timeLimit ? `${Math.round(c.timeLimit / 60)} min clock` : 'No clock', c.map.name].join(' · ');
    this.blurb.textContent = `${c.blurb} (${rules})`;
    this.playBtn.textContent = p.done[this.selected] ? 'Play again' : 'Play';
    for (const b of this.ref('bots').querySelectorAll<HTMLElement>('[data-v]')) {
      b.classList.toggle('active', Number(b.dataset.v) === this.settings.bots);
    }
    markActive(this.ref('difficulty'), this.settings.difficulty);
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
