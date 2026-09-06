import { describe, it, expect, vi, beforeEach } from 'vitest';
import md5 from 'md5';

vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const offlineMock = vi.hoisted(() => ({ enabled: false }));
vi.mock('./offlineCacheService', () => ({
  offlineCacheService: { getConfig: () => offlineMock },
}));
vi.mock('./networkStatsService', () => ({
  networkStatsService: { recordMetadataFetch: vi.fn() },
}));
vi.mock('./credentialsService', () => ({
  credentialsService: { getCached: () => ({ serverUrl: 's', username: 'u', password: 'p' }) },
}));

const axiosGet = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({ default: { get: axiosGet } }));

import { getStreamUrl, getAllSongs } from './subsonicApi';

beforeEach(() => {
  offlineMock.enabled = false;
  axiosGet.mockReset();
});

function params(url: string) {
  return new URLSearchParams(url.split('?')[1]);
}

describe('getStreamUrl auth params', () => {
  it('builds a stream URL with a 32-char hex salt and token = md5(password + salt)', () => {
    const p = params(getStreamUrl('https://srv', 'user', 'secret', 'song1'));
    const salt = p.get('s')!;
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(p.get('t')).toBe(md5('secret' + salt));
    expect(p.get('u')).toBe('user');
    expect(p.get('id')).toBe('song1');
  });

  it('uses a fresh random salt on every call', () => {
    const a = params(getStreamUrl('h', 'u', 'p', 'x')).get('s');
    const b = params(getStreamUrl('h', 'u', 'p', 'x')).get('s');
    expect(a).not.toBe(b);
  });

  it('adds maxBitRate only when a bitrate is given', () => {
    expect(params(getStreamUrl('h', 'u', 'p', 'x')).has('maxBitRate')).toBe(false);
    expect(params(getStreamUrl('h', 'u', 'p', 'x', 192)).get('maxBitRate')).toBe('192');
  });
});

describe('getAllSongs pagination', () => {
  const pageData = (n: number) => ({
    data: { 'subsonic-response': { status: 'ok', searchResult3: { song: Array.from({ length: n }, (_, i) => ({ id: String(i) })) } } },
  });
  // axios mock keyed by the songOffset in the requested URL
  const byOffset = (map: Record<number, number>, dflt = 0) =>
    axiosGet.mockImplementation((url: string) => {
      const off = Number(params(url).get('songOffset'));
      return Promise.resolve(pageData(off in map ? map[off] : dflt));
    });

  it('does a single request for a library smaller than one page', async () => {
    byOffset({ 0: 120 });
    const songs = await getAllSongs('s', 'u', 'p');
    expect(axiosGet).toHaveBeenCalledTimes(1);
    expect(songs).toHaveLength(120);
  });

  it('probes page 0, then fetches the rest in a concurrent batch of 4', async () => {
    byOffset({ 0: 500, 500: 500, 1000: 500, 1500: 500, 2000: 120 });
    const songs = await getAllSongs('s', 'u', 'p');
    // 1 probe + one batch of 4
    expect(axiosGet).toHaveBeenCalledTimes(5);
    expect(songs).toHaveLength(500 + 500 + 500 + 500 + 120);
    const offsets = axiosGet.mock.calls.map((c: unknown[]) => Number(params(c[0] as string).get('songOffset')));
    expect(offsets[0]).toBe(0);
    expect(offsets.slice(1).sort((a, b) => a - b)).toEqual([500, 1000, 1500, 2000]);
  });

  it('keeps going for multiple batches until a short page appears', async () => {
    byOffset({ 0: 500, 500: 500, 1000: 500, 1500: 500, 2000: 500, 2500: 500, 3000: 500, 3500: 500, 4000: 30 });
    const songs = await getAllSongs('s', 'u', 'p');
    expect(songs).toHaveLength(8 * 500 + 30);
    expect(axiosGet).toHaveBeenCalledTimes(9); // probe + 2 batches of 4
  });

  it('returns just the probe page when it is already short', async () => {
    byOffset({ 0: 300 });
    expect(await getAllSongs('s', 'u', 'p')).toHaveLength(300);
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });

  it('throws when the server reports failed', async () => {
    axiosGet.mockResolvedValueOnce({ data: { 'subsonic-response': { status: 'failed', error: { message: 'nope' } } } });
    await expect(getAllSongs('s', 'u', 'p')).rejects.toThrow('nope');
  });
});

describe('offline mode guard', () => {
  it('getAllSongs refuses to hit the network when offline mode is enabled', async () => {
    offlineMock.enabled = true;
    await expect(getAllSongs('s', 'u', 'p')).rejects.toThrow(/Offline mode/);
    expect(axiosGet).not.toHaveBeenCalled();
  });
});
