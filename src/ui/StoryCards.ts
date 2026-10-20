import type { Card, StoryArt } from '../sim/story/types';
import { el } from './dom';
import { storyArt } from './storyArt';

/**
 * The story between chapters: a few short cards, one at a time. "Next" pages through,
 * "Skip" (one tap) jumps past all of them.
 */
export class StoryCards {
  private readonly el: HTMLDivElement;
  private readonly art: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly dots: HTMLElement;
  private readonly nextBtn: HTMLButtonElement;
  private cards: readonly Card[] = [];
  private defaultArt: StoryArt = 'radio';
  private index = 0;
  private you = '';
  private doneLabel = '';
  private onDone: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = el(
      'div',
      'modal story-cards',
      `<div class="card story-card">
        <div class="story-art" data-ref="art"></div>
        <h2 data-ref="title"></h2>
        <p data-ref="text"></p>
        <div class="story-dots" data-ref="dots"></div>
        <div class="story-card-buttons">
          <button class="btn ghost" data-act="skip">Skip</button>
          <button class="btn primary" data-act="next" data-ref="next">Next</button>
        </div>
      </div>`,
    );
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.art = this.ref('art');
    this.title = this.ref('title');
    this.text = this.ref('text');
    this.dots = this.ref('dots');
    this.nextBtn = this.ref<HTMLButtonElement>('next');
    this.el.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'next') this.advance();
      else if (act === 'skip') this.finish();
    });
    window.addEventListener('keydown', (e) => {
      if (this.el.hidden) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.advance();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.finish();
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /**
   * Shows `cards` (none: calls `onDone` right away). `onDone` runs inside the tap that closes them.
   * `doneLabel` is the button on the last card.
   */
  play(cards: readonly Card[], art: StoryArt, you: string, onDone: () => void, doneLabel = 'Let’s go!'): void {
    this.cards = cards;
    this.defaultArt = art;
    this.you = you;
    this.doneLabel = doneLabel;
    this.index = 0;
    this.onDone = onDone;
    if (!cards.length) {
      this.finish();
      return;
    }
    this.el.hidden = false;
    this.render();
  }

  /** Close without calling back (e.g. leaving to the menu). */
  cancel(): void {
    this.onDone = null;
    this.el.hidden = true;
  }

  private advance(): void {
    if (this.index < this.cards.length - 1) {
      this.index++;
      this.render();
    } else {
      this.finish();
    }
  }

  private finish(): void {
    this.el.hidden = true;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  private render(): void {
    const c = this.cards[this.index];
    this.art.innerHTML = storyArt(c.art ?? this.defaultArt);
    this.title.textContent = c.title ?? '';
    this.title.hidden = !c.title;
    this.text.textContent = c.text.split('{you}').join(this.you);
    const last = this.index === this.cards.length - 1;
    this.nextBtn.textContent = last ? this.doneLabel : 'Next';
    this.dots.innerHTML = this.cards.map((_, i) => `<span class="${i === this.index ? 'on' : ''}"></span>`).join('');
  }

  private ref<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.el.querySelector<T>(`[data-ref="${name}"]`)!;
  }
}
