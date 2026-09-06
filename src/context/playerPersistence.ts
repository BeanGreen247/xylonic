/**
 * Per-user persistence of the playback queue, index, shuffle and repeat prefs.
 * Extracted verbatim from PlayerContext as the second slice of the WS-ARCH
 * split (step toward `usePlayerPersistence`). Keys and semantics are unchanged.
 *
 * NOTE (WS-PERF): `saveQueue` still stringifies the whole `Song[]`. Converting
 * it to `{ ids, idx }` + an IDB song store is a separate WS-PERF task; this
 * extraction deliberately preserves current behaviour.
 */

export type RepeatMode = 'off' | 'all' | 'one';

const user = () => localStorage.getItem('username') || 'guest';
const QUEUE_KEY = () => `queue_${user()}`;
const INDEX_KEY = () => `queue_idx_${user()}`;
const SHUFFLE_KEY = () => `shuffle_pref_${user()}`;
const REPEAT_KEY = () => `repeat_pref_${user()}`;

function tryStorage<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback; // storage disabled / quota exceeded / private mode
  }
}

export function saveQueue<T>(songs: T[]): void {
  tryStorage(() => localStorage.setItem(QUEUE_KEY(), JSON.stringify(songs)), undefined);
}

export function loadQueue<T>(): T[] {
  return tryStorage<T[]>(() => {
    const raw = localStorage.getItem(QUEUE_KEY());
    return raw ? (JSON.parse(raw) as T[]) : [];
  }, []);
}

export function saveIndex(idx: number): void {
  tryStorage(() => localStorage.setItem(INDEX_KEY(), String(idx)), undefined);
}

export function loadIndex(): number {
  return tryStorage(() => {
    const raw = localStorage.getItem(INDEX_KEY());
    return raw !== null ? parseInt(raw, 10) : 0;
  }, 0);
}

export function saveShuffle(v: boolean): void {
  tryStorage(() => localStorage.setItem(SHUFFLE_KEY(), String(v)), undefined);
}

export function loadShuffle(): boolean {
  return tryStorage(() => localStorage.getItem(SHUFFLE_KEY()) === 'true', false);
}

export function saveRepeat(v: RepeatMode): void {
  tryStorage(() => localStorage.setItem(REPEAT_KEY(), v), undefined);
}

export function loadRepeat(): RepeatMode {
  return tryStorage<RepeatMode>(() => {
    const v = localStorage.getItem(REPEAT_KEY());
    return v === 'all' || v === 'one' ? v : 'off';
  }, 'off');
}

/** Wipe all four keys (used on logout / clear). */
export function clearPlayerPersistence(): void {
  for (const key of [QUEUE_KEY(), INDEX_KEY(), SHUFFLE_KEY(), REPEAT_KEY()]) {
    tryStorage(() => localStorage.removeItem(key), undefined);
  }
}
