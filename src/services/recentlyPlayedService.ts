import { Song } from '../types';

export interface HistoryEntry extends Song {
  playedAt: number;
}

const MAX_HISTORY = 50;
const STORAGE_KEY_PREFIX = 'recentlyPlayed_';

const getKey = (): string => {
  const username = localStorage.getItem('username') || 'guest';
  return `${STORAGE_KEY_PREFIX}${username}`;
};

export const getHistory = (): HistoryEntry[] => {
  try {
    const raw = localStorage.getItem(getKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

export const addToHistory = (song: Song): void => {
  try {
    const history = getHistory().filter(e => e.id !== song.id);
    history.unshift({ ...song, playedAt: Date.now() });
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    localStorage.setItem(getKey(), JSON.stringify(history));
  } catch (e) {
    console.error('[History] Failed to save:', e);
  }
};

export const clearHistory = (): void => {
  localStorage.removeItem(getKey());
};
