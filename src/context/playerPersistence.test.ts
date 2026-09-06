import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveQueue,
  loadQueue,
  saveIndex,
  loadIndex,
  saveShuffle,
  loadShuffle,
  saveRepeat,
  loadRepeat,
  clearPlayerPersistence,
} from './playerPersistence';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('username', 'kenny');
});

describe('playerPersistence', () => {
  it('round-trips the queue', () => {
    const q = [{ id: 'a' }, { id: 'b' }];
    saveQueue(q);
    expect(loadQueue()).toEqual(q);
  });

  it('defaults to an empty queue / index 0 / no shuffle / repeat off', () => {
    expect(loadQueue()).toEqual([]);
    expect(loadIndex()).toBe(0);
    expect(loadShuffle()).toBe(false);
    expect(loadRepeat()).toBe('off');
  });

  it('round-trips index, shuffle and repeat', () => {
    saveIndex(7);
    saveShuffle(true);
    saveRepeat('all');
    expect(loadIndex()).toBe(7);
    expect(loadShuffle()).toBe(true);
    expect(loadRepeat()).toBe('all');
  });

  it('coerces an unknown repeat value to off', () => {
    localStorage.setItem('repeat_pref_kenny', 'sideways');
    expect(loadRepeat()).toBe('off');
  });

  it('is namespaced per user', () => {
    saveIndex(3);
    localStorage.setItem('username', 'bob');
    expect(loadIndex()).toBe(0);
    localStorage.setItem('username', 'kenny');
    expect(loadIndex()).toBe(3);
  });

  it('falls back to guest when no username is set', () => {
    localStorage.removeItem('username');
    saveShuffle(true);
    expect(localStorage.getItem('shuffle_pref_guest')).toBe('true');
  });

  it('survives a corrupt queue payload', () => {
    localStorage.setItem('queue_kenny', '{not json');
    expect(loadQueue()).toEqual([]);
  });

  it('clearPlayerPersistence wipes all four keys', () => {
    saveQueue([{ id: 'a' }]);
    saveIndex(5);
    saveShuffle(true);
    saveRepeat('one');
    clearPlayerPersistence();
    expect(localStorage.getItem('queue_kenny')).toBeNull();
    expect(localStorage.getItem('queue_idx_kenny')).toBeNull();
    expect(localStorage.getItem('shuffle_pref_kenny')).toBeNull();
    expect(localStorage.getItem('repeat_pref_kenny')).toBeNull();
  });
});
