import { describe, it, expect } from 'vitest';
import { fallbackBridge } from './fallbackBridge';

// Contract check for the pure web bridge: every method resolves without throwing
// and returns the documented "unavailable" shape. The Electron/Capacitor bridges
// need their platform globals; this pins the interface the others must match.

describe('fallbackBridge contract', () => {
  it('reports no native capabilities', () => {
    expect(fallbackBridge.isElectron).toBe(false);
    expect(fallbackBridge.isCapacitor).toBe(false);
    expect(fallbackBridge.isCacheAvailable).toBe(false);
  });

  it('cache reads resolve to null / empty, writes to false', async () => {
    expect(await fallbackBridge.readCacheIndex()).toBeNull();
    expect(await fallbackBridge.readUserCacheIndex('u')).toBeNull();
    expect(await fallbackBridge.readAudioRegistry()).toBeNull();
    expect(await fallbackBridge.getCacheDir()).toBe('');
    expect(await fallbackBridge.writeCacheIndex('{}')).toBe(false);
    expect(await fallbackBridge.writeUserMetadata('u', '{}')).toBe(false);
  });

  it('file ops report failure shapes rather than throwing', async () => {
    expect(await fallbackBridge.saveAudioFile([], 'h', '.mp3')).toEqual({ success: false, path: '' });
    expect(await fallbackBridge.migrateFileToHashStorage('o', 'h', 'f')).toMatchObject({ success: false });
    expect(await fallbackBridge.getCacheStats()).toEqual({ totalSize: 0, fileCount: 0 });
    expect(await fallbackBridge.deleteAudioDir('h')).toBe(false);
  });

  it('secure storage is unavailable', async () => {
    expect(await fallbackBridge.safeStorageAvailable()).toBe(false);
    expect(await fallbackBridge.encryptCredential('p')).toBeNull();
    expect(await fallbackBridge.decryptCredential('e')).toBeNull();
  });

  it('event subscriptions return an unsubscribe function', () => {
    expect(typeof fallbackBridge.onMediaControl(() => {})).toBe('function');
    expect(typeof fallbackBridge.onPlayerStateChanged(() => {})).toBe('function');
    expect(typeof fallbackBridge.onCacheRebuildTrigger(() => {})).toBe('function');
    // calling the returned unsubscribe must not throw
    expect(() => fallbackBridge.onMediaControl(() => {})()).not.toThrow();
  });

  it('media / notification no-ops resolve undefined', async () => {
    await expect(fallbackBridge.startMediaService()).resolves.toBeUndefined();
    await expect(fallbackBridge.updateMediaPlaybackState(true, 0, 0)).resolves.toBeUndefined();
    await expect(fallbackBridge.setDownloadActive(true)).resolves.toBeUndefined();
    await expect(fallbackBridge.getSystemStats()).resolves.toBeNull();
  });

  it('miniplayer queries resolve false / null', async () => {
    expect(await fallbackBridge.toggleMiniPlayer()).toBe(false);
    expect(await fallbackBridge.isMiniPlayer()).toBe(false);
    expect(await fallbackBridge.requestPlayerState()).toBeNull();
  });
});
