import React, { useState, useRef, useEffect } from 'react';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { offlineCacheService } from '../../services/offlineCacheService';
import { imageCacheService } from '../../services/imageCacheService';
import { logger } from '../../utils/logger';
import ThemeSelector from './ThemeSelector';
import DownloadManagerWindow from '../Library/DownloadManagerWindow';
import './HamburgerMenu.css';

const electron = (window as any).electron;

const HamburgerMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [showDownloadManager, setShowDownloadManager] = useState(false);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [isClearingAllCaches, setIsClearingAllCaches] = useState(false);
  const { isOnline, offlineModeEnabled, toggleOfflineMode, cacheInitialized } = useOfflineMode();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load logging preference on mount
    const loadLoggingPreference = async () => {
      const enabled = logger.isEnabled();
      setLoggingEnabled(enabled);
    };
    loadLoggingPreference();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleOfflineModeToggle = () => {
    toggleOfflineMode();
    setIsOpen(false);
  };

  const handleThemeClick = () => {
    setShowThemeSelector(true);
    setIsOpen(false);
  };

  const handleDownloadsClick = () => {
    setShowDownloadManager(true);
    setIsOpen(false);
  };

  const handleLoggingToggle = async () => {
    const newState = !loggingEnabled;
    const success = await logger.setEnabled(newState);
    if (success) {
      setLoggingEnabled(newState);
    }
  };

  const handleOpenLogFolder = async () => {
    if (window.electron?.openLogFolder) {
      try {
        await window.electron.openLogFolder();
      } catch (error) {
        console.error('Failed to open log folder:', error);
      }
    }
    setIsOpen(false);
  };

  const handleClearAllCaches = async () => {
    if (isClearingAllCaches) {
      return;
    }

    const confirmed = window.confirm(
      '⚠️ Clear All Caches?\n\n' +
      'This will:\n' +
      '• Delete all cached album artwork (IndexedDB)\n' +
      '• Delete all offline cache data (permanent_cache)\n' +
      '• Reset all precache completion flags\n' +
      '• Force complete re-download and re-index on restart\n\n' +
      'Continue?'
    );

    if (!confirmed) {
      return;
    }

    setIsClearingAllCaches(true);
    setIsOpen(false);

    try {
      logger.log('[HamburgerMenu] Clearing all caches...');
      
      // Clear offline cache (permanent_cache)
      logger.log('[HamburgerMenu] Clearing offline cache...');
      await offlineCacheService.clearAllCache();
      
      // Clear image cache (IndexedDB)
      logger.log('[HamburgerMenu] Clearing image cache...');
      await imageCacheService.clearAllCacheAndReset();
      
      alert(
        '✅ All caches cleared successfully!\n\n' +
        'The app will now reload to rebuild all caches.'
      );
      
      // Reload the app to trigger precache dialog
      window.location.reload();
    } catch (error) {
      logger.error('[HamburgerMenu] Clear all caches failed:', error);
      alert(`❌ Failed to clear caches: ${(error as Error).message}`);
      setIsClearingAllCaches(false);
    }
  };

  return (
    <div className="hamburger-menu-container" ref={menuRef}>
      <button 
        className={`hamburger-button ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Menu"
        title="Menu"
      >
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
      </button>

      {isOpen && (
        <div className="hamburger-dropdown">
          <button onClick={handleThemeClick} className="menu-item">
            <i className="fas fa-palette"></i>
            <span>Theme</span>
          </button>

          <button onClick={handleOfflineModeToggle} className={`menu-item ${offlineModeEnabled ? 'active' : ''}`}>
            <i className={`fas fa-${offlineModeEnabled ? 'plane' : 'cloud'}`}></i>
            <span>{offlineModeEnabled ? 'Offline Mode' : 'Online Mode'}</span>
            <span className={`menu-item-badge ${offlineModeEnabled ? '' : 'disabled'}`}>
              {offlineModeEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </button>

          <button onClick={handleDownloadsClick} className="menu-item">
            <i className="fas fa-download"></i>
            <span>Downloads</span>
          </button>

          <button 
            onClick={handleClearAllCaches} 
            className="menu-item"
            disabled={isClearingAllCaches}
            title="Clear all caches (images + offline data) and force complete rebuild"
          >
            <i className={`fas fa-${isClearingAllCaches ? 'spinner fa-spin' : 'trash-alt'}`}></i>
            <span>{isClearingAllCaches ? 'Clearing...' : 'Clear All Caches'}</span>
          </button>

          <div className="menu-divider"></div>

          <button onClick={handleLoggingToggle} className={`menu-item ${loggingEnabled ? 'active' : ''}`}>
            <i className={`fas fa-${loggingEnabled ? 'file-alt' : 'file'}`}></i>
            <span>Debug Logging</span>
            <span className={`menu-item-badge ${loggingEnabled ? '' : 'disabled'}`}>
              {loggingEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </button>

          {loggingEnabled && (
            <button onClick={handleOpenLogFolder} className="menu-item menu-item-small">
              <i className="fas fa-folder-open"></i>
              <span>Open Log Folder</span>
            </button>
          )}
        </div>
      )}

      {showThemeSelector && <ThemeSelector onClose={() => setShowThemeSelector(false)} />}
      <DownloadManagerWindow isOpen={showDownloadManager} onClose={() => setShowDownloadManager(false)} />
    </div>
  );
};

export default HamburgerMenu;
