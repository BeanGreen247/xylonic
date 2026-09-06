import { describe, it, expect, vi, beforeEach } from 'vitest';
import { electronBridge } from './electronBridge';

// electronBridge is a thin pass-through to window.electron.* — verify each
// method forwards to the right IPC name with its args, and that renamed
// channels (download notification, cache reads) map correctly.

const api = {
  readColorConfig: vi.fn().mockResolvedValue('cfg'),
  writeColorConfig: vi.fn().mockResolvedValue(true),
  readUserCacheIndex: vi.fn().mockResolvedValue(null),
  writeUserCacheIndex: vi.fn().mockResolvedValue(true),
  saveAudioFile: vi.fn().mockResolvedValue({ success: true, path: '/p' }),
  safeStorageAvailable: vi.fn().mockResolvedValue(true),
  encryptCredential: vi.fn().mockResolvedValue('enc'),
  setDownloadProgress: vi.fn().mockResolvedValue(undefined),
  clearDownloadProgress: vi.fn().mockResolvedValue(undefined),
  setDownloadActive: vi.fn().mockResolvedValue(undefined),
  getCacheStats: vi.fn().mockResolvedValue({ totalSize: 5, fileCount: 2 }),
};

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { electron: unknown }).electron = api;
});

describe('electronBridge pass-through contract', () => {
  it('advertises Electron capabilities', () => {
    expect(electronBridge.isElectron).toBe(true);
    expect(electronBridge.isCapacitor).toBe(false);
    expect(electronBridge.isCacheAvailable).toBe(true);
  });

  it('forwards cache index calls with the user id', async () => {
    await electronBridge.readUserCacheIndex('kenny@s');
    await electronBridge.writeUserCacheIndex('kenny@s', '{"x":1}');
    expect(api.readUserCacheIndex).toHaveBeenCalledWith('kenny@s');
    expect(api.writeUserCacheIndex).toHaveBeenCalledWith('kenny@s', '{"x":1}');
  });

  it('forwards saveAudioFile args and returns its result', async () => {
    const r = await electronBridge.saveAudioFile([1, 2, 3], 'hash', '.mp3');
    expect(api.saveAudioFile).toHaveBeenCalledWith([1, 2, 3], 'hash', '.mp3');
    expect(r).toEqual({ success: true, path: '/p' });
  });

  it('maps download-notification methods to the renamed IPC channels', async () => {
    await electronBridge.showDownloadNotification({ title: 't', text: 'x', progress: 0.5, ongoing: true });
    await electronBridge.hideDownloadNotification();
    expect(api.setDownloadProgress).toHaveBeenCalledWith({ title: 't', text: 'x', progress: 0.5, ongoing: true });
    expect(api.clearDownloadProgress).toHaveBeenCalledTimes(1);
  });

  it('forwards credential calls', async () => {
    expect(await electronBridge.safeStorageAvailable()).toBe(true);
    await electronBridge.encryptCredential('secret');
    expect(api.encryptCredential).toHaveBeenCalledWith('secret');
  });

  it('returns getCacheStats shape unchanged', async () => {
    expect(await electronBridge.getCacheStats()).toEqual({ totalSize: 5, fileCount: 2 });
  });

  it('media-session methods are local no-ops (not IPC)', async () => {
    await expect(electronBridge.updateMediaPlaybackState(true, 1, 2)).resolves.toBeUndefined();
    expect(typeof electronBridge.onMediaControl(() => {})).toBe('function');
  });
});
