import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { persistentCache } from './persistentCache';

// jsdom has no IndexedDB, so `init()` falls back to memory-only — exactly the
// path we want to exercise here (the IDB tier is integration-tested on device).

const TTL = 1000;

beforeEach(() => {
  vi.useFakeTimers();
  persistentCache.invalidate();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('persistentCache — memory tier', () => {
  it('returns a value set within its TTL', () => {
    persistentCache.set('k', { n: 1 }, TTL);
    expect(persistentCache.get<{ n: number }>('k')).toEqual({ n: 1 });
  });

  it('returns null once the fresh TTL has passed', () => {
    persistentCache.set('k', 'v', TTL);
    vi.advanceTimersByTime(TTL + 1);
    expect(persistentCache.get('k')).toBeNull();
  });

  it('peek reports fresh, then stale, then dead', () => {
    persistentCache.set('k', 'v', TTL);
    expect(persistentCache.peek('k')).toMatchObject({ fresh: true, stale: false });

    vi.advanceTimersByTime(TTL + 1);
    expect(persistentCache.peek('k')).toMatchObject({ fresh: false, stale: true });

    vi.advanceTimersByTime(TTL * 8); // past ttl * STALE_FACTOR
    expect(persistentCache.peek('k')).toBeNull();
  });

  it('invalidate(prefix) only drops matching keys', () => {
    persistentCache.set('meta:a', 1, TTL);
    persistentCache.set('meta:b', 2, TTL);
    persistentCache.set('img:c', 3, TTL);

    persistentCache.invalidate('meta:');

    expect(persistentCache.get('meta:a')).toBeNull();
    expect(persistentCache.get('meta:b')).toBeNull();
    expect(persistentCache.get('img:c')).toBe(3);
  });
});

describe('persistentCache — swr', () => {
  it('serves a fresh hit without calling the fetcher', async () => {
    persistentCache.set('k', 'cached', TTL);
    const fetcher = vi.fn().mockResolvedValue('fresh');

    await expect(persistentCache.swr('k', fetcher, TTL)).resolves.toBe('cached');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('awaits the fetcher on a hard miss and stores the result', async () => {
    const fetcher = vi.fn().mockResolvedValue('fresh');

    await expect(persistentCache.swr('k', fetcher, TTL)).resolves.toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(persistentCache.get('k')).toBe('fresh');
  });

  it('serves stale data immediately and revalidates in the background', async () => {
    persistentCache.set('k', 'stale', TTL);
    vi.advanceTimersByTime(TTL + 1);

    let resolveFetch!: (v: string) => void;
    const fetcher = vi.fn(() => new Promise<string>((r) => { resolveFetch = r; }));

    // Returns the stale value right away…
    await expect(persistentCache.swr('k', fetcher, TTL)).resolves.toBe('stale');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // …and the background refresh updates the cache when it lands.
    resolveFetch('fresh');
    await vi.waitFor(() => expect(persistentCache.get('k')).toBe('fresh'));
  });

  it('fires onRevalidated with the fresh value after a background refresh', async () => {
    persistentCache.set('k', 'stale', TTL);
    vi.advanceTimersByTime(TTL + 1);
    const onRevalidated = vi.fn();
    const fetcher = vi.fn().mockResolvedValue('fresh');

    await expect(
      persistentCache.swr('k', fetcher, TTL, { onRevalidated }),
    ).resolves.toBe('stale');

    await vi.waitFor(() => expect(onRevalidated).toHaveBeenCalledWith('fresh'));
  });

  it('dedupes concurrent hard-miss callers into one fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue('fresh');

    const [a, b] = await Promise.all([
      persistentCache.swr('k', fetcher, TTL),
      persistentCache.swr('k', fetcher, TTL),
    ]);

    expect(a).toBe('fresh');
    expect(b).toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps serving stale data if the background revalidation fails', async () => {
    persistentCache.set('k', 'stale', TTL);
    vi.advanceTimersByTime(TTL + 1);
    const fetcher = vi.fn().mockRejectedValue(new Error('network'));

    await expect(persistentCache.swr('k', fetcher, TTL)).resolves.toBe('stale');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(persistentCache.get('k')).toBeNull(); // still only the expired entry
    expect(persistentCache.peek('k')).toMatchObject({ data: 'stale', stale: true });
  });
});
