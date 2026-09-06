import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('./subsonicApi', () => ({ getStreamUrl: vi.fn(() => 'http://x/stream') }));
vi.mock('../utils/settingsManager', () => ({ getMaxConcurrentDownloads: () => 1 }));
vi.mock('./credentialsService', () => ({
  credentialsService: { getCached: () => ({ serverUrl: 's', username: 'u', password: 'p' }) },
}));
vi.mock('../platform/bridge', () => ({
  getBridge: () => ({
    isCacheAvailable: true,
    setDownloadActive: vi.fn(async () => {}),
    showDownloadNotification: vi.fn(async () => {}),
    hideDownloadNotification: vi.fn(async () => {}),
  }),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' },
  registerPlugin: () => ({ addListener: vi.fn(async () => ({ remove: vi.fn() })) }),
}));

const cacheMock = vi.hoisted(() => ({ cached: new Set<string>() }));
vi.mock('./offlineCacheService', () => ({
  offlineCacheService: {
    isCached: (id: string) => cacheMock.cached.has(id),
    isCoverArtCached: () => true,
    getCacheIndex: () => ({ songs: {} }),
  },
}));

const dlSong = (id: string) => ({ id, title: `t-${id}`, artist: 'a', album: 'al', albumId: 'al1' });

async function freshManager() {
  vi.resetModules();
  localStorage.clear();
  cacheMock.cached.clear();
  const mod = await import('./downloadManagerService');
  mod.downloadManager.pauseQueue(); // stop processQueue side-effects
  return mod.downloadManager;
}

beforeEach(() => vi.clearAllMocks());

describe('downloadManager queue dedup', () => {
  it('adds a single pending item', async () => {
    const dm = await freshManager();
    dm.addSongToQueue(dlSong('s1'), 'al1', 'al', 'a', 'original');
    expect(dm.getQueue()).toHaveLength(1);
    expect(dm.getProgress().totalSongs).toBe(1);
  });

  it('does not enqueue the same song twice while it is still pending', async () => {
    const dm = await freshManager();
    dm.addSongToQueue(dlSong('s1'), 'al1', 'al', 'a', 'original');
    dm.addSongToQueue(dlSong('s1'), 'al1', 'al', 'a', 'original');
    expect(dm.getQueue()).toHaveLength(1);
    expect(dm.getProgress().totalSongs).toBe(1);
  });

  it('does not enqueue a song that is already cached', async () => {
    const dm = await freshManager();
    cacheMock.cached.add('s1');
    dm.addSongToQueue(dlSong('s1'), 'al1', 'al', 'a', 'original');
    expect(dm.getQueue()).toHaveLength(0);
    expect(dm.getProgress().totalSongs).toBe(0);
  });

  it('addAlbumToQueue skips cached and already-queued songs', async () => {
    const dm = await freshManager();
    cacheMock.cached.add('s2');
    dm.addSongToQueue(dlSong('s1'), 'al1', 'al', 'a', 'original'); // already pending
    dm.addAlbumToQueue({
      albumId: 'al1',
      albumName: 'al',
      artistName: 'a',
      songs: [dlSong('s1'), dlSong('s2'), dlSong('s3')],
      quality: 'original',
    });
    const ids = dm.getQueue().map((i) => i.song.id).sort();
    expect(ids).toEqual(['s1', 's3']);
    expect(dm.getProgress().totalSongs).toBe(2);
  });

  it('getProgress pendingSongs = total - completed - failed', async () => {
    const dm = await freshManager();
    dm.addSongToQueue(dlSong('s1'), 'al1', 'al', 'a', 'original');
    dm.addSongToQueue(dlSong('s2'), 'al1', 'al', 'a', 'original');
    const p = dm.getProgress();
    expect(p.pendingSongs).toBe(p.totalSongs - p.completedSongs - p.failedSongs);
    expect(p.pendingSongs).toBe(2);
  });
});
