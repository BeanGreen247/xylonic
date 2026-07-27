/**
 * Offline Mode Context
 * Manages offline mode state and internet connectivity
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { OfflineModeConfig } from '../types/offline';
import { offlineCacheService } from '../services/offlineCacheService';
import { useAuth } from './AuthContext';
import { logger } from '../utils/logger';
import { syncPendingChanges, getPendingChangesCount, startPeriodicSync, stopPeriodicSync, syncNow } from '../services/likedSongsService';

interface OfflineModeContextType {
  isOnline: boolean;
  offlineModeEnabled: boolean;
  isCellular: boolean;
  config: OfflineModeConfig;
  toggleOfflineMode: () => void;
  updateConfig: (config: Partial<OfflineModeConfig>) => void;
  checkConnectivity: () => Promise<boolean>;
  cacheInitialized: boolean;
}

const OfflineModeContext = createContext<OfflineModeContextType | undefined>(undefined);

export const OfflineModeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, username, serverUrl } = useAuth();
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [isCellular, setIsCellular] = useState<boolean>(() => {
    const conn = (navigator as any).connection;
    return conn?.type === 'cellular';
  });
  const offlineTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cacheInitialized, setCacheInitialized] = useState<boolean>(false);
  // Seed enabled from localStorage immediately so the offline guard in PlayerContext
  // is active from the very first render — before initCache() resolves.
  const [config, setConfig] = useState<OfflineModeConfig>(() => ({
    enabled: localStorage.getItem('offlineMode') === 'true',
    preferCache: true,
    warnCacheSizeAt: 1000
  }));

  /**
   * Initialize cache service when authenticated
   */
  useEffect(() => {
    const initCache = async () => {
      if (isAuthenticated && username && serverUrl) {
        try {
          await offlineCacheService.initialize(username, serverUrl);
          const savedConfig = offlineCacheService.getConfig();
          
          // Check if user logged in with offline mode
          const isOfflineMode = localStorage.getItem('offlineMode') === 'true';
          
          if (isOfflineMode) {
            // Auto-enable offline mode if user logged in with it
            logger.log('[OfflineMode] User logged in with offline mode, auto-enabling');
            const offlineConfig = {
              ...savedConfig,
              enabled: true
            };
            setConfig(offlineConfig);
            offlineCacheService.saveConfig(offlineConfig);
          } else {
            setConfig(savedConfig);
          }
          
          setCacheInitialized(true);
          logger.log('[OfflineMode] Cache initialized for user:', username);
        } catch (error) {
          logger.error('[OfflineMode] Failed to initialize cache:', error);
        }
      } else {
        setCacheInitialized(false);
      }
    };

    initCache();
  }, [isAuthenticated, username, serverUrl]);

  /**
   * Monitor online/offline status
   */
  useEffect(() => {
    const handleOnline = async () => {
      // Cancel any pending grace-period offline transition
      if (offlineTimerRef.current) {
        clearTimeout(offlineTimerRef.current);
        offlineTimerRef.current = null;
      }
      logger.log('[OfflineMode] Internet connection restored');
      setIsOnline(true);

      // Sync pending liked songs changes when connection is restored
      if (getPendingChangesCount() > 0) {
        logger.log('[OfflineMode] Syncing pending liked songs changes...');
        try {
          const result = await syncPendingChanges();
          logger.log(`[OfflineMode] Liked songs sync: ${result.synced} synced, ${result.failed} failed`);
        } catch (error) {
          logger.error('[OfflineMode] Failed to sync liked songs:', error);
        }
      }
    };

    const handleOffline = () => {
      // Grace period: only mark offline after 6 s of sustained disconnection
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = setTimeout(() => {
        offlineTimerRef.current = null;
        logger.log('[OfflineMode] Internet connection lost (confirmed after grace period)');
        setIsOnline(false);
      }, 6000);
    };

    // Re-sync liked songs immediately when the app returns to foreground.
    // On Android the WebView suspends JS when backgrounded, so setInterval
    // ticks are delayed — this guarantees an up-to-date view on resume.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncNow().catch(() => {});
      }
    };

    const conn = (navigator as any).connection;
    const handleConnectionChange = () => {
      setIsCellular(conn?.type === 'cellular');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    conn?.addEventListener('change', handleConnectionChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      conn?.removeEventListener('change', handleConnectionChange);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Check internet connectivity (ping test)
   */
  const checkConnectivity = async (): Promise<boolean> => {
    const attempt = async (): Promise<boolean> => {
      try {
        await fetch('https://www.google.com/favicon.ico', {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-cache',
        });
        return true;
      } catch {
        return false;
      }
    };

    let online = await attempt();
    if (!online) {
      // Wait 3 s then retry once before declaring offline
      await new Promise(r => setTimeout(r, 3000));
      online = await attempt();
    }

    if (online) {
      setIsOnline(true);
      logger.log('[OfflineMode] Connectivity check: online');
      if (getPendingChangesCount() > 0) {
        syncPendingChanges()
          .then(r => logger.log(`[OfflineMode] Sync on reconnect: ${r.synced} synced, ${r.failed} failed`))
          .catch(e => logger.error('[OfflineMode] Sync on reconnect failed:', e));
      }
      return true;
    } else {
      setIsOnline(false);
      logger.log('[OfflineMode] Connectivity check: offline');
      return false;
    }
  };

  /**
   * Toggle offline mode
   */
  const toggleOfflineMode = async () => {
    const wasOffline = config.enabled;
    const newConfig = {
      ...config,
      enabled: !config.enabled
    };
    setConfig(newConfig);
    offlineCacheService.saveConfig(newConfig);
    // Keep both keys in sync so either code path in initCache restores the state correctly.
    localStorage.setItem('offlineMode', String(newConfig.enabled));
    logger.log('[OfflineMode] Offline mode:', newConfig.enabled ? 'enabled' : 'disabled');
    
    // If switching from offline to online, sync pending changes.
    // Do not gate on isOnline — the user is explicitly going online so we
    // attempt sync regardless of stale context state; failures are retried
    // next time connectivity is confirmed.
    if (wasOffline && !newConfig.enabled) {
      if (getPendingChangesCount() > 0) {
        logger.log('[OfflineMode] Syncing pending liked songs changes...');
        try {
          const result = await syncPendingChanges();
          logger.log(`[OfflineMode] Liked songs sync: ${result.synced} synced, ${result.failed} failed`);
        } catch (error) {
          logger.error('[OfflineMode] Failed to sync liked songs:', error);
        }
      }
    }
  };

  /**
   * Update configuration
   */
  const updateConfig = (updates: Partial<OfflineModeConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    offlineCacheService.saveConfig(newConfig);
    logger.log('[OfflineMode] Config updated:', updates);
  };

  /**
   * Periodic liked-songs sync: keep starredSongIds fresh across devices.
   * Runs every 30 s when online and not in manual offline mode.
   */
  useEffect(() => {
    if (isOnline && !config.enabled && isAuthenticated) {
      startPeriodicSync();
    } else {
      stopPeriodicSync();
    }
    return () => stopPeriodicSync();
  }, [isOnline, config.enabled, isAuthenticated]);

  /**
   * Handle auth changes (login with offline mode, logout)
   */
  useEffect(() => {
    const handleAuthChange = () => {
      const isOfflineMode = localStorage.getItem('offlineMode') === 'true';
      setConfig(prevConfig => {
        if (isOfflineMode && prevConfig.enabled !== true) {
          logger.log('[OfflineMode] Auth changed, enabling offline mode');
          const offlineConfig = {
            ...prevConfig,
            enabled: true
          };
          offlineCacheService.saveConfig(offlineConfig);
          return offlineConfig;
        }
        return prevConfig;
      });
    };

    const handleLogout = () => {
      logger.log('[OfflineMode] Logout detected, disabling offline mode');
      const defaultConfig: OfflineModeConfig = {
        enabled: false,
        preferCache: true,
        warnCacheSizeAt: 1000
      };
      setConfig(defaultConfig);
      offlineCacheService.saveConfig(defaultConfig);
      setCacheInitialized(false);
    };

    window.addEventListener('auth-changed', handleAuthChange);
    window.addEventListener('logout', handleLogout);
    return () => {
      window.removeEventListener('auth-changed', handleAuthChange);
      window.removeEventListener('logout', handleLogout);
    };
  }, []); // Empty dependency array - only setup/cleanup

  const value: OfflineModeContextType = {
    isOnline,
    offlineModeEnabled: config.enabled,
    isCellular,
    config,
    toggleOfflineMode,
    updateConfig,
    checkConnectivity,
    cacheInitialized
  };

  return (
    <OfflineModeContext.Provider value={value}>
      {children}
    </OfflineModeContext.Provider>
  );
};

export const useOfflineMode = (): OfflineModeContextType => {
  const context = useContext(OfflineModeContext);
  if (!context) {
    throw new Error('useOfflineMode must be used within OfflineModeProvider');
  }
  return context;
};

export default { OfflineModeProvider, useOfflineMode };
