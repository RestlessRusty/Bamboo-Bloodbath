import type { Difficulty } from './config';

/** Personal records on this device for one map at one difficulty (quick play: solo and multiplayer). */
export interface MapRecord {
  plays: number;
  /** Matches where at least one panda reached the rescue hut. */
  wins: number;
  /** Fastest won match in seconds, or null before the first win. */
  bestTime: number | null;
  mostKills: number;
}

/** What changed after a match, for the end screen. */
export interface RecordResult {
  record: MapRecord;
  newBestTime: boolean;
  newMostKills: boolean;
}

const KEY = 'bamboo-bloodbath/records/v1';

let cache: Record<string, MapRecord> | null = null;

const keyOf = (mapId: string, difficulty: Difficulty) => `${mapId}/${difficulty}`;
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

function load(): Record<string, MapRecord> {
  if (cache) return cache;
  cache = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, Partial<MapRecord>> | null;
    if (raw && typeof raw === 'object') {
      for (const [k, r] of Object.entries(raw)) {
        if (!r || typeof r !== 'object') continue;
        const t = r.bestTime;
        cache[k] = {
          plays: count(r.plays),
          wins: count(r.wins),
          bestTime: typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null,
          mostKills: count(r.mostKills),
        };
      }
    }
  } catch {
    // Storage blocked or corrupt: start with no records.
  }
  return cache;
}

export function getRecord(mapId: string, difficulty: Difficulty): MapRecord {
  return { ...(load()[keyOf(mapId, difficulty)] ?? { plays: 0, wins: 0, bestTime: null, mostKills: 0 }) };
}

/** Adds a finished match. `time`: seconds the match took. */
export function addResult(mapId: string, difficulty: Difficulty, won: boolean, time: number, kills: number): RecordResult {
  const all = load();
  const r = getRecord(mapId, difficulty);
  // A new record only counts as "new" when it beats an earlier one, not on the very first match.
  const newBestTime = won && r.bestTime !== null && time < r.bestTime;
  const newMostKills = r.plays > 0 && kills > r.mostKills;
  r.plays++;
  if (won) {
    r.wins++;
    r.bestTime = r.bestTime === null ? time : Math.min(r.bestTime, time);
  }
  r.mostKills = Math.max(r.mostKills, kills);
  all[keyOf(mapId, difficulty)] = r;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not fatal; records just won't persist.
  }
  return { record: { ...r }, newBestTime, newMostKills };
}
