/** Story mode progress on this device: which chapters are unlocked and finished. */
export interface StoryProgress {
  /** Chapters 0..unlocked-1 can be played. */
  unlocked: number;
  done: boolean[];
}

const KEY = 'bamboo-bloodbath/story/v1';

export function loadProgress(count: number): StoryProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<StoryProgress> | null;
    if (raw && typeof raw === 'object') {
      let unlocked = typeof raw.unlocked === 'number' && Number.isFinite(raw.unlocked) ? Math.round(raw.unlocked) : 1;
      const list = Array.isArray(raw.done) ? raw.done : [];
      const done = Array.from({ length: count }, (_, i) => list[i] === true);
      // Saved before more chapters were added: the old last chapter capped `unlocked`, so finishing it
      // still opens the next one.
      done.forEach((d, i) => {
        if (d) unlocked = Math.max(unlocked, i + 2);
      });
      return { unlocked: Math.max(1, Math.min(count, unlocked)), done };
    }
  } catch {
    // Storage blocked or corrupt: start from chapter 1.
  }
  return { unlocked: 1, done: Array.from({ length: count }, () => false) };
}

/** Marks chapter `index` finished and unlocks the next one. */
export function completeChapter(p: StoryProgress, index: number): void {
  p.done[index] = true;
  p.unlocked = Math.min(p.done.length, Math.max(p.unlocked, index + 2));
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Not fatal; progress just won't persist.
  }
}
