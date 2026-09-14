/**
 * Per-user persistence of the playback queue, index, shuffle and repeat prefs.
 * Extracted verbatim from PlayerContext as the second slice of the WS-ARCH
 * split (step toward `usePlayerPersistence`). Keys and semantics are unchanged
 * for index/shuffle/repeat.
 *
 * WS-PERF (T22): the queue itself (`saveQueue`/`loadQueue`) no longer goes
 * through `localStorage.setItem(JSON.stringify(...))` — that blocked the main
 * thread on every save, including a plain `next`/`prev` where the song list
 * hadn't even changed. It's backed by `playerQueueStore` (IndexedDB,
 * structured clone, hydrated into memory before first paint — see
 * `index.tsx`) instead: no manual (de)serialization, and the write itself is
 * async. Same external contract (`saveQueue(songs)` / `loadQueue(): T[]`,
 * synchronous read) so call sites didn't need to change.
 */

import { playerQueueStore } from '../services/playerQueueStore';

export type RepeatMode = 'off' | 'all' | 'one';

const user = () => localStorage.getItem('username') || 'guest';
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
  playerQueueStore.set(user(), songs);
}

export function loadQueue<T>(): T[] {
  return playerQueueStore.getSync<T>(user()) ?? [];
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

/** Wipe the queue plus the three prefs (used on logout / clear). */
export function clearPlayerPersistence(): void {
  playerQueueStore.clear(user());
  for (const key of [INDEX_KEY(), SHUFFLE_KEY(), REPEAT_KEY()]) {
    tryStorage(() => localStorage.removeItem(key), undefined);
  }
}
