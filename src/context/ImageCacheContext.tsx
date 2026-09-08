/**
 * Image Cache
 * App-lifetime singleton (was a context provider) exposing image-cache
 * readiness + helpers. Collapsed to a module store + useSyncExternalStore
 * hook so it no longer needs to wrap the provider tree.
 */

import { useMemo, useSyncExternalStore } from 'react';
import { imageCacheService } from '../services/imageCacheService';
import { searchCacheService } from '../services/searchCacheService';
import { logger } from '../utils/logger';

interface ImageCacheContextType {
  isInitialized: boolean;
  getCachedImage: (coverArtId: string, serverFetchFn: () => string) => Promise<string>;
  clearCache: () => Promise<void>;
  getCacheStats: () => Promise<any>;
}

let initialized = false;
let started = false;
const listeners = new Set<() => void>();

const setInitialized = (value: boolean) => {
  if (initialized === value) return;
  initialized = value;
  for (const l of listeners) l();
};

const runInit = async () => {
  const username = localStorage.getItem('username');
  const serverUrl = localStorage.getItem('serverUrl');

  if (!window.indexedDB) {
    logger.warn('[ImageCacheContext] IndexedDB not supported');
    return;
  }

  if (username && serverUrl) {
    try {
      // Parallel init — they open separate IDB databases
      await Promise.all([
        imageCacheService.initialize(username, serverUrl),
        searchCacheService.initialize(username, serverUrl),
      ]);

      // Build alias map + proactive memory warm (non-critical)
      try {
        const index = searchCacheService.getIndex();
        if (index && index.albums.length > 0) {
          imageCacheService.buildAliasMap(index.albums, index.songs);
          const topArtistIds = index.artists
            .slice(0, 80)
            .map((a: any) => a.coverArt)
            .filter(Boolean) as string[];
          imageCacheService.prewarmBatch(topArtistIds).catch(() => {});
        }
      } catch (aliasErr) {
        logger.warn('[ImageCacheContext] Could not build coverArt alias map:', aliasErr);
      }

      setInitialized(true);
    } catch (error) {
      logger.error('[ImageCacheContext] Initialization failed:', error);
      setInitialized(false);
    }
  } else {
    setInitialized(false);
  }
};

/** Kick off init + wire auth listeners exactly once, on first hook use. */
const ensureStarted = () => {
  if (started) return;
  started = true;

  runInit();

  // Re-initialize when auth credentials change (this tab or another)
  window.addEventListener('auth-changed', () => { runInit(); });
  window.addEventListener('logout', () => { setInitialized(false); });
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === 'username' || e.key === 'serverUrl') runInit();
  });
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const getSnapshot = () => initialized;

async function getCachedImage(coverArtId: string, serverFetchFn: () => string): Promise<string> {
  if (!initialized) {
    return serverFetchFn();
  }
  return imageCacheService.getImage(coverArtId, serverFetchFn);
}

function clearCache(): Promise<void> {
  return imageCacheService.clearCache();
}

function getCacheStats(): Promise<any> {
  return imageCacheService.getCacheStats();
}

const helpers = { getCachedImage, clearCache, getCacheStats };

export const useImageCache = (): ImageCacheContextType => {
  ensureStarted();
  const isInitialized = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return useMemo(() => ({ isInitialized, ...helpers }), [isInitialized]);
};

export default useImageCache;
