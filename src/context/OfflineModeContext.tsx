/**
 * Offline Mode Context
 * Manages offline mode state and internet connectivity
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { OfflineModeConfig } from '../types/offline';
import { offlineCacheService } from '../services/offlineCacheService';
import { useAuth } from './AuthContext';
import { logger } from '../utils/logger';
import { syncPendingChanges, getPendingChangesCount } from '../services/likedSongsService';

interface OfflineModeContextType {
  isOnline: boolean;
  offlineModeEnabled: boolean;
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
  const [cacheInitialized, setCacheInitialized] = useState<boolean>(false);
  const [config, setConfig] = useState<OfflineModeConfig>({
    enabled: false,
    preferCache: true,
    warnCacheSizeAt: 1000
  });

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
      logger.log('[OfflineMode] Internet connection lost');
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  /**
   * Check internet connectivity (ping test)
   */
  const checkConnectivity = async (): Promise<boolean> => {
    try {
      // Try to fetch a lightweight resource
      const response = await fetch('https://www.google.com/favicon.ico', {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-cache'
      });
      
      const online = true; // If no error, we're online
      setIsOnline(online);
      logger.log('[OfflineMode] Connectivity check: online');
      return online;
    } catch (error) {
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
    logger.log('[OfflineMode] Offline mode:', newConfig.enabled ? 'enabled' : 'disabled');
    
    // If switching from offline to online, sync pending changes
    if (wasOffline && !newConfig.enabled && isOnline) {
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
