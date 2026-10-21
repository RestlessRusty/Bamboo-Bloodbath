import { DIFFICULTIES } from './config';
import { OPEN } from './sim/open/config';
import type { WorldSave, WorldSlotInfo } from './sim/open/types';

/** Infinite-mode worlds saved on this device, one localStorage entry per slot. */

const key = (slot: number) => `bamboo-bloodbath:world-v1:${slot}`;

function read(slot: number): WorldSave | null {
  try {
    const raw = localStorage.getItem(key(slot));
    if (!raw) return null;
    const w = JSON.parse(raw) as WorldSave;
    // Just enough checking that a damaged entry can't crash the menu; the rules sanitise the rest on load.
    if (!w || w.v !== 1 || typeof w.seed !== 'number' || typeof w.name !== 'string' || !Array.isArray(w.pieces)) return null;
    if (!DIFFICULTIES.includes(w.difficulty)) w.difficulty = 'normal';
    w.slot = slot;
    return w;
  } catch {
    return null;
  }
}

export function worldInfo(w: WorldSave): WorldSlotInfo {
  return {
    slot: w.slot,
    name: w.name,
    day: Math.floor(w.clock / OPEN.dayLength) + 1,
    difficulty: w.difficulty,
    bots: w.bots,
    saved: w.saved,
    played: w.played,
  };
}

/** Every slot, null where it's empty (OPEN.slots long). */
export function listWorlds(): (WorldSlotInfo | null)[] {
  return Array.from({ length: OPEN.slots }, (_, i) => {
    const w = read(i);
    return w ? worldInfo(w) : null;
  });
}

export function loadWorld(slot: number): WorldSave | null {
  return read(slot);
}

/** False if the browser refused (storage full or blocked). */
export function storeWorld(save: WorldSave): boolean {
  try {
    localStorage.setItem(key(save.slot), JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function deleteWorld(slot: number): void {
  try {
    localStorage.removeItem(key(slot));
  } catch {
    // Storage blocked: nothing to delete anyway.
  }
}

/** First empty slot, or -1 when all are taken. */
export function freeSlot(): number {
  return listWorlds().findIndex((w) => w === null);
}
