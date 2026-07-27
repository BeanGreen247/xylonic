/**
 * Image Cache Context
 * Provides image caching functionality across the app
 */

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { imageCacheService } from '../services/imageCacheService';
import { searchCacheService } from '../services/searchCacheService';
import { logger } from '../utils/logger';

interface ImageCacheContextType {
  isInitialized: boolean;
  getCachedImage: (coverArtId: string, serverFetchFn: () => string) => Promise<string>;
  clearCache: () => Promise<void>;
  getCacheStats: () => Promise<any>;
}

const ImageCacheContext = createContext<ImageCacheContextType | undefined>(undefined);

export const ImageCacheProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    console.log('%cIMAGE CACHE useEffect FIRED!', 'background: blue; color: white; font-size: 16px;');
    
    const initializeCache = async () => {
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

          setIsInitialized(true);
        } catch (error) {
          logger.error('[ImageCacheContext] Initialization failed:', error);
          setIsInitialized(false);
        }
      } else {
        setIsInitialized(false);
      }
    };

    // Initialize on mount
    initializeCache();

    const handleAuthChanged = () => {
      initializeCache();
    };

    const handleLogout = () => {
      setIsInitialized(false);
    };

    // Re-initialize only when auth credentials change in another tab
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'username' || e.key === 'serverUrl') {
        initializeCache();
      }
    };

    window.addEventListener('auth-changed', handleAuthChanged);
    window.addEventListener('logout', handleLogout);
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('auth-changed', handleAuthChanged);
      window.removeEventListener('logout', handleLogout);
      window.removeEventListener('storage', handleStorageChange as EventListener);
    };
  }, []);

  const getCachedImage = useCallback(async (coverArtId: string, serverFetchFn: () => string): Promise<string> => {
    if (!isInitialized) {
      return serverFetchFn();
    }
    return imageCacheService.getImage(coverArtId, serverFetchFn);
  }, [isInitialized]);

  const clearCache = async () => {
    await imageCacheService.clearCache();
  };

  const getCacheStats = async () => {
    return imageCacheService.getCacheStats();
  };

  return (
    <ImageCacheContext.Provider value={{ isInitialized, getCachedImage, clearCache, getCacheStats }}>
      {children}
    </ImageCacheContext.Provider>
  );
};

export const useImageCache = () => {
  const context = useContext(ImageCacheContext);
  if (!context) {
    throw new Error('useImageCache must be used within ImageCacheProvider');
  }
  return context;
};

export default useImageCache;
