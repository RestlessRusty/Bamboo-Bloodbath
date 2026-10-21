import { isRoomCode, makeRoomCode } from './protocol';

/**
 * Remembered on this device: your own room code (every room you create uses it when it's free, so
 * friends can keep one link), and the last room you joined with your seat ticket (to get your panda back).
 */
const OWN_KEY = 'bamboo-bloodbath/room-code';
const TICKET_KEY = 'bamboo-bloodbath/room-ticket';
/** The menu offers "Rejoin" this long after you were last connected to a room. */
const REJOIN_MS = 15 * 60 * 1000;

interface Ticket {
  code: string;
  seat: string;
  /** When we were last welcomed into the room (0: never). */
  at: number;
}

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: works for this visit only.
  }
}

let own: string | null = null;

/** This device's room code, made once and then kept. */
export function ownRoomCode(): string {
  if (own) return own;
  const saved = read(OWN_KEY);
  own = isRoomCode(saved) ? saved : makeRoomCode();
  if (saved !== own) write(OWN_KEY, own);
  return own;
}

function ticket(): Ticket | null {
  const t = read(TICKET_KEY) as Partial<Ticket> | null;
  if (!t || !isRoomCode(t.code) || typeof t.seat !== 'string' || !t.seat) return null;
  return { code: t.code, seat: t.seat, at: typeof t.at === 'number' ? t.at : 0 };
}

/** The seat ticket to join room `code` with: the same one as last time for the same room. */
export function seatFor(code: string): string {
  const t = ticket();
  if (t && t.code === code) return t.seat;
  const seat = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  write(TICKET_KEY, { code, seat, at: 0 });
  return seat;
}

/** We're (still) in room `code`: keeps the rejoin offer fresh. */
export function markInRoom(code: string): void {
  const t = ticket();
  if (t && t.code === code) write(TICKET_KEY, { ...t, at: Date.now() });
}

/** Left on purpose, or the room is gone: no rejoin offer. */
export function forgetRoom(): void {
  write(TICKET_KEY, null);
}

/** Room we were in recently and didn't leave on purpose (the app was closed, the connection dropped). */
export function rejoinableRoom(): string | null {
  const t = ticket();
  return t && t.at > 0 && Date.now() - t.at < REJOIN_MS ? t.code : null;
}
