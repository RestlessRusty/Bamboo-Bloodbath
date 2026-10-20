import { DIFFICULTIES, DIFFICULTY } from '../config';

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html) e.innerHTML = html;
  return e;
}

/** Easy / Normal / Hard buttons for a `.seg` (data-act="difficulty", data-v = the difficulty). */
export function difficultyButtons(): string {
  return DIFFICULTIES.map((d) => `<button data-act="difficulty" data-v="${d}">${DIFFICULTY[d].label}</button>`).join('');
}

/** Marks the button for `current` active inside a `.seg`. */
export function markActive(seg: HTMLElement, current: string): void {
  for (const b of seg.querySelectorAll<HTMLElement>('[data-v]')) b.classList.toggle('active', b.dataset.v === current);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
