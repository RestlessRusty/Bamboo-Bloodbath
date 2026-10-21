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

/**
 * Marks a scrolling area with `.more` while there's more below, and puts a "▾ more" tag right
 * after it (tap it to scroll), so a list cut off on a short screen doesn't look complete.
 */
export function scrollHint(body: HTMLElement): void {
  const tag = el('button', 'more-hint', '▾ more');
  tag.type = 'button';
  tag.hidden = true;
  tag.addEventListener('click', () => body.scrollBy({ top: Math.max(40, body.clientHeight * 0.7), behavior: 'smooth' }));
  body.after(tag);
  const update = () => {
    const more = body.scrollHeight - body.scrollTop - body.clientHeight > 4;
    body.classList.toggle('more', more);
    tag.hidden = !more;
  };
  // Observer callbacks wait a frame: changing layout inside one makes Chrome report a "ResizeObserver loop" error.
  let queued = false;
  const later = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  body.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', later);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(later).observe(body);
  new MutationObserver(later).observe(body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
