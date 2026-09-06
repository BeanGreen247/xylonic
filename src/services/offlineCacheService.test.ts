import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// Minimal in-memory bridge: nothing persisted, every "read" is empty so the
// service builds a fresh v2 index + registry.
const bridge = vi.hoisted(() => ({
  isCacheAvailable: true,
  getCacheDir: vi.fn(async () => '/cache'),
  readCacheIndex: vi.fn(async () => null),
  readAudioRegistry: vi.fn(async () => null),
  readUserCacheIndex: vi.fn(async () => null),
  writeUserCacheIndex: vi.fn(async () => true),
  writeAudioRegistry: vi.fn(async () => true),
  readUserMetadata: vi.fn(async () => null),
  writeUserMetadata: vi.fn(async () => true),
  deleteAudioDir: vi.fn(async () => true),
  deleteCachedFile: vi.fn(async () => true),
}));
vi.mock('../platform/bridge', () => ({ getBridge: () => bridge }));

async function freshService() {
  vi.resetModules();
  const mod = await import('./offlineCacheService');
  await mod.offlineCacheService.initialize('kenny', 'https://srv:4533');
  return mod.offlineCacheService;
}

const song = (id: string) => ({
  id,
  title: `t-${id}`,
  artist: 'a',
  album: 'al',
  albumId: 'al1',
  duration: 100,
});

beforeEach(() => vi.clearAllMocks());

describe('offlineCacheService totalSize accounting', () => {
  it('adds fileSize on first registerNativeDownload', async () => {
    const svc = await freshService();
    await svc.registerNativeDownload(song('s1'), 'original', 'hash1', '.mp3', 1000);
    expect(svc.getCacheIndex().totalSize).toBe(1000);
    expect(Object.keys(svc.getCacheIndex().songs)).toEqual(['s1']);
  });

  it('does NOT double-count when the same song is re-registered', async () => {
    const svc = await freshService();
    await svc.registerNativeDownload(song('s1'), 'original', 'hash1', '.mp3', 1000);
    await svc.registerNativeDownload(song('s1'), 'original', 'hash1', '.mp3', 1000);
    expect(svc.getCacheIndex().totalSize).toBe(1000);
  });

  it('replaces the old size when a re-register reports a different fileSize', async () => {
    const svc = await freshService();
    await svc.registerNativeDownload(song('s1'), 'original', 'hash1', '.mp3', 1000);
    await svc.registerNativeDownload(song('s1'), '320', 'hash2', '.mp3', 250);
    expect(svc.getCacheIndex().totalSize).toBe(250);
  });

  it('sums sizes across distinct songs', async () => {
    const svc = await freshService();
    await svc.registerNativeDownload(song('s1'), 'original', 'h1', '.mp3', 1000);
    await svc.registerNativeDownload(song('s2'), 'original', 'h2', '.mp3', 500);
    expect(svc.getCacheIndex().totalSize).toBe(1500);
    expect(Object.keys(svc.getCacheIndex().songs).sort()).toEqual(['s1', 's2']);
  });

  it('decrements totalSize on removeFromCache', async () => {
    const svc = await freshService();
    await svc.registerNativeDownload(song('s1'), 'original', 'h1', '.mp3', 1000);
    await svc.registerNativeDownload(song('s2'), 'original', 'h2', '.mp3', 500);
    await svc.removeFromCache('s1');
    expect(svc.getCacheIndex().totalSize).toBe(500);
    expect(Object.keys(svc.getCacheIndex().songs)).toEqual(['s2']);
  });

  it('never drives totalSize negative on a spurious remove', async () => {
    const svc = await freshService();
    await svc.registerNativeDownload(song('s1'), 'original', 'h1', '.mp3', 1000);
    await svc.removeFromCache('s1');
    await svc.removeFromCache('s1'); // already gone
    expect(svc.getCacheIndex().totalSize).toBeGreaterThanOrEqual(0);
  });

  it('isCached reflects register / remove', async () => {
    const svc = await freshService();
    expect(svc.isCached('s1')).toBe(false);
    await svc.registerNativeDownload(song('s1'), 'original', 'h1', '.mp3', 1000);
    expect(svc.isCached('s1')).toBe(true);
    await svc.removeFromCache('s1');
    expect(svc.isCached('s1')).toBe(false);
  });
});

describe('offlineCacheService debounced index save', () => {
  it('coalesces rapid registers into one write after the 500ms window', async () => {
    const svc = await freshService();
    vi.clearAllMocks();
    vi.useFakeTimers();
    try {
      await svc.registerNativeDownload(song('s1'), 'original', 'h1', '.mp3', 100);
      await svc.registerNativeDownload(song('s2'), 'original', 'h2', '.mp3', 100);
      expect(bridge.writeUserCacheIndex).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      expect(bridge.writeUserCacheIndex).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushAll() forces an immediate write', async () => {
    const svc = await freshService();
    vi.clearAllMocks();
    await svc.registerNativeDownload(song('s1'), 'original', 'h1', '.mp3', 100);
    await svc.flushAll();
    expect(bridge.writeUserCacheIndex).toHaveBeenCalledTimes(1);
  });
});
