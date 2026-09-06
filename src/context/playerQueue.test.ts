import { describe, it, expect } from 'vitest';
import { buildShuffleQueue, computeNextIndex, NextIndexInput } from './playerQueue';

// Deterministic PRNG so shuffle order is assertable.
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

describe('buildShuffleQueue', () => {
  it('excludes the current index and is a permutation of the rest', () => {
    const q = buildShuffleQueue(6, 2, seeded(1));
    expect(q).not.toContain(2);
    expect([...q].sort((a, b) => a - b)).toEqual([0, 1, 3, 4, 5]);
  });

  it('plays every other song exactly once per cycle', () => {
    const q = buildShuffleQueue(50, 0, seeded(42));
    expect(new Set(q).size).toBe(49);
    expect(q.every((i) => i >= 1 && i <= 49)).toBe(true);
  });

  it('handles a single-song playlist (nothing else to shuffle)', () => {
    expect(buildShuffleQueue(1, 0)).toEqual([]);
  });

  it('is deterministic for a fixed rng', () => {
    expect(buildShuffleQueue(10, 3, seeded(7))).toEqual(buildShuffleQueue(10, 3, seeded(7)));
  });
});

const base: NextIndexInput = {
  currentIndex: 0,
  playlistLength: 5,
  repeat: 'off',
  shuffle: false,
  shuffleQueue: [],
  shuffleQueuePos: 0,
};

describe('computeNextIndex — sequential', () => {
  it('advances by one', () => {
    expect(computeNextIndex({ ...base, currentIndex: 1 })).toMatchObject({ action: 'advance', nextIndex: 2 });
  });

  it('wraps to 0 at the end (current behaviour, repeat-off included)', () => {
    expect(computeNextIndex({ ...base, currentIndex: 4 })).toMatchObject({ action: 'advance', nextIndex: 0 });
    expect(computeNextIndex({ ...base, currentIndex: 4, repeat: 'all' })).toMatchObject({ nextIndex: 0 });
  });
});

describe('computeNextIndex — repeat one', () => {
  it('signals replay without changing the index', () => {
    const r = computeNextIndex({ ...base, currentIndex: 3, repeat: 'one' });
    expect(r.action).toBe('replay');
    expect(r.nextIndex).toBe(3);
  });
});

describe('computeNextIndex — empty playlist', () => {
  it('is a no-op', () => {
    expect(computeNextIndex({ ...base, playlistLength: 0 }).action).toBe('noop');
  });
});

describe('computeNextIndex — shuffle', () => {
  it('consumes the shuffle queue in order, advancing the cursor', () => {
    const input: NextIndexInput = {
      ...base,
      shuffle: true,
      shuffleQueue: [3, 1, 4, 2],
      shuffleQueuePos: 0,
    };
    const a = computeNextIndex(input);
    expect(a).toMatchObject({ action: 'advance', nextIndex: 3, shuffleQueuePos: 1 });
    const b = computeNextIndex({ ...input, shuffleQueuePos: a.shuffleQueuePos });
    expect(b).toMatchObject({ nextIndex: 1, shuffleQueuePos: 2 });
  });

  it('rebuilds the queue when the cursor runs off the end', () => {
    const r = computeNextIndex(
      { ...base, currentIndex: 2, shuffle: true, shuffleQueue: [0, 1], shuffleQueuePos: 2 },
      seeded(5),
    );
    expect(r.action).toBe('advance');
    expect(r.shuffleQueue).toHaveLength(4); // 5 songs minus current
    expect(r.shuffleQueue).not.toContain(2);
    expect(r.shuffleQueuePos).toBe(1);
    expect(r.shuffleQueue[0]).toBe(r.nextIndex);
  });
});
