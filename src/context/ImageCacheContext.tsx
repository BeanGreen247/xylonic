/**
 * Image Cache Context
 * Provides image caching functionality across the app
 */

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { imageCacheService } from '../services/imageCacheService';
import { logger } from '../utils/logger';

interface ImageCacheContextType {
  isInitialized: boolean;
  getCachedImage: (coverArtId: string, serverFetchFn: () => string) => Promise<string>;
  clearCache: () => Promise<void>;
  getCacheStats: () => Promise<any>;
}

const ImageCacheContext = createContext<ImageCacheContextType | undefined>(undefined);

export const ImageCacheProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  console.log('%c🎬 IMAGE CACHE PROVIDER RENDERING', 'background: #222; color: #bada55; font-size: 20px; font-weight: bold;');
  const [isInitialized, setIsInitialized] = useState(false);
  console.log('%c[ImageCacheProvider] isInitialized state:', 'color: cyan', isInitialized);

  useEffect(() => {
    console.log('%cIMAGE CACHE useEffect FIRED!', 'background: blue; color: white; font-size: 16px;');
    
    const initializeCache = async () => {
      console.log('%c📞 initializeCache() CALLED', 'background: green; color: white;');
      const username = localStorage.getItem('username');
      const serverUrl = localStorage.getItem('serverUrl');

      console.log('%cCredentials check:', 'color: yellow', { 
        username: username || 'MISSING', 
        serverUrl: serverUrl || 'MISSING'
      });

      // Check IndexedDB support
      if (!window.indexedDB) {
        console.error('%cERROR: IndexedDB NOT SUPPORTED!', 'background: red; color: white; font-size: 16px;');
        return;
      }
      console.log('%cIndexedDB is supported', 'color: green;');

      if (username && serverUrl) {
        try {
          console.log('%cCalling imageCacheService.initialize...', 'background: purple; color: white;');
          await imageCacheService.initialize(username, serverUrl);
          console.log('%cimageCacheService.initialize RETURNED SUCCESSFULLY', 'background: green; color: white; font-size: 14px;');
          
          setIsInitialized(true);
          console.log('%cIMAGE CACHE FULLY READY!', 'background: lime; color: black; font-size: 20px; font-weight: bold;');
        } catch (error) {
          console.error('%cIMAGE CACHE INIT FAILED:', 'background: red; color: white; font-size: 16px;', error);
          setIsInitialized(false);
        }
      } else {
        console.warn('%cWARNING: Cannot initialize - missing credentials', 'color: orange;');
        setIsInitialized(false);
      }
    };

    // Initialize on mount
    initializeCache();

    // Re-initialize when auth changes (login/logout)
    const handleAuthChanged = () => {
      console.log('[ImageCacheContext] auth-changed event received, re-initializing cache');
      logger.log('ImageCacheContext: auth-changed event received, re-initializing cache');
      initializeCache();
    };

    // Handle logout - clear initialization state
    const handleLogout = () => {
      console.log('[ImageCacheContext] logout event received, clearing cache state');
      logger.log('ImageCacheContext: logout event received, clearing cache state');
      
      // Only clear memory cache (blob URLs), keep IndexedDB data for all users
      // Don't call cleanup() which would close the database
      setIsInitialized(false);
    };

    // Re-initialize when storage changes (for cross-tab sync)
    const handleStorageChange = () => {
      console.log('[ImageCacheContext] storage event received, re-initializing cache');
      initializeCache();
    };

    window.addEventListener('auth-changed', handleAuthChanged);
    window.addEventListener('logout', handleLogout);
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('auth-changed', handleAuthChanged);
      window.removeEventListener('logout', handleLogout);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const getCachedImage = async (coverArtId: string, serverFetchFn: () => string): Promise<string> => {
    console.log('[ImageCacheContext.getCachedImage] Called for:', coverArtId, '| isInitialized:', isInitialized);
    if (!isInitialized) {
      console.log('[ImageCacheContext.getCachedImage] Cache not ready, returning server URL');
      return serverFetchFn();
    }
    console.log('[ImageCacheContext.getCachedImage] Getting from service...');
    return imageCacheService.getImage(coverArtId, serverFetchFn);
  };

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
