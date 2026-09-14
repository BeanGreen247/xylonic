import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { playerQueueStore } from './playerQueueStore';

// jsdom has no IndexedDB, so init() falls back to memory-only — exactly the
// path exercised here (the IDB tier itself is integration-tested on device,
// same convention as persistentCache.test.ts).

interface TestSong {
  id: string;
  title: string;
}

beforeEach(() => {
  playerQueueStore.clear('alice');
  playerQueueStore.clear('bob');
});

describe('playerQueueStore — memory tier', () => {
  it('returns null for a user with nothing stored', () => {
    expect(playerQueueStore.getSync('alice')).toBeNull();
  });

  it('round-trips a written queue', () => {
    const songs: TestSong[] = [{ id: '1', title: 'A' }, { id: '2', title: 'B' }];
    playerQueueStore.set('alice', songs);
    expect(playerQueueStore.getSync<TestSong>('alice')).toEqual(songs);
  });

  it('keeps per-user queues independent', () => {
    playerQueueStore.set('alice', [{ id: '1', title: 'A' }]);
    playerQueueStore.set('bob', [{ id: '2', title: 'B' }]);
    expect(playerQueueStore.getSync<TestSong>('alice')).toEqual([{ id: '1', title: 'A' }]);
    expect(playerQueueStore.getSync<TestSong>('bob')).toEqual([{ id: '2', title: 'B' }]);
  });

  it('overwrites on a second set', () => {
    playerQueueStore.set('alice', [{ id: '1', title: 'A' }]);
    playerQueueStore.set('alice', [{ id: '2', title: 'B' }]);
    expect(playerQueueStore.getSync<TestSong>('alice')).toEqual([{ id: '2', title: 'B' }]);
  });

  it('clear removes the stored queue', () => {
    playerQueueStore.set('alice', [{ id: '1', title: 'A' }]);
    playerQueueStore.clear('alice');
    expect(playerQueueStore.getSync('alice')).toBeNull();
  });

  it('init() resolves without an IDB available (jsdom has none)', async () => {
    await expect(playerQueueStore.init()).resolves.toBeUndefined();
  });
});
