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
  const page = (n: number) =>
    Promise.resolve({ data: { 'subsonic-response': { status: 'ok', searchResult3: { song: Array.from({ length: n }, (_, i) => ({ id: String(i) })) } } } });

  it('stops after the first short (< 500) page', async () => {
    axiosGet.mockResolvedValueOnce(await page(500)).mockResolvedValueOnce(await page(120));
    const songs = await getAllSongs('s', 'u', 'p');
    expect(axiosGet).toHaveBeenCalledTimes(2);
    expect(songs).toHaveLength(620);
  });

  it('terminates on an empty final page', async () => {
    axiosGet.mockResolvedValueOnce(await page(500)).mockResolvedValueOnce(await page(0));
    const songs = await getAllSongs('s', 'u', 'p');
    expect(axiosGet).toHaveBeenCalledTimes(2);
    expect(songs).toHaveLength(500);
  });

  it('advances songOffset by 500 between pages', async () => {
    axiosGet.mockResolvedValueOnce(await page(500)).mockResolvedValueOnce(await page(1));
    await getAllSongs('s', 'u', 'p');
    expect(params(axiosGet.mock.calls[0][0]).get('songOffset')).toBe('0');
    expect(params(axiosGet.mock.calls[1][0]).get('songOffset')).toBe('500');
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
