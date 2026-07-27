import React, { useState, useEffect } from 'react';
import { usePlayer } from '../../context/PlayerContext';
import { useRemoteMode } from '../../context/RemoteModeContext';
import { useOfflineMode } from '../../context/OfflineModeContext';
import SearchBar from '../common/SearchBar';
import { getBridge } from '../../platform/bridge';
import { isPerformanceModeEnabled } from '../../services/performanceModeService';
import { isPowerSaverEnabled } from '../../services/powerSaverService';
import XylonicLogo from '../common/XylonicLogo';
import { isAppStoreBuild } from '../../config/buildVariant';
import './Header.css';

const bridge = getBridge();

const Header: React.FC = () => {
  const { currentSong } = usePlayer();
  const { isRemoteModeAvailable, isRemoteMode, availableDevices } = useRemoteMode();
  const { offlineModeEnabled, toggleOfflineMode } = useOfflineMode();
  const [showMiniPlayerNotification, setShowMiniPlayerNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [perfMode,   setPerfMode]   = useState(isPerformanceModeEnabled);
  const [powerSaver, setPowerSaver] = useState(isPowerSaverEnabled);

  useEffect(() => {
    const handler = () => {
      setPerfMode(isPerformanceModeEnabled());
      setPowerSaver(isPowerSaverEnabled());
    };
    window.addEventListener('appModeChanged', handler);
    return () => window.removeEventListener('appModeChanged', handler);
  }, []);

  const handleMiniPlayer = async () => {
    // Check if a song is playing
    if (!currentSong) {
      setNotificationMessage('A song must be playing to open Mini Player');
      setShowMiniPlayerNotification(true);
      
      // Auto-dismiss after 4 seconds
      setTimeout(() => {
        setShowMiniPlayerNotification(false);
      }, 4000);
      
      return;
    }
    
    await bridge.toggleMiniPlayer();
  };

  const handleGitHubClick = () => {
    const url = 'https://github.com/BeanGreen247/xylonic';
    if (window.require) {
      const { shell } = window.require('electron');
      shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleDeveloperClick = () => {
    const url = 'https://github.com/BeanGreen247';
    if (window.require) {
      const { shell } = window.require('electron');
      shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleSupportClick = () => {
    const url = 'https://github.com/sponsors/BeanGreen247';
    if (window.require) {
      const { shell } = window.require('electron');
      shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <header className="header">
      {/* Mini Player Notification */}
      {showMiniPlayerNotification && (
        <div className="quality-notification">
          <i className="fas fa-info-circle"></i>
          <span>{notificationMessage}</span>
          <button
            className="notification-close"
            onClick={() => setShowMiniPlayerNotification(false)}
            title="Dismiss"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      )}

      <div className="header-left">
        <h1 className="app-title">
          <XylonicLogo size={28} />
          Xylonic
        </h1>
        <button className="github-link" onClick={handleGitHubClick} title="View on GitHub">
          <i className="fab fa-github"></i>
        </button>
        {!isAppStoreBuild && (
          <button className="support-link" onClick={handleSupportClick} title="Support the Project">
            <i className="fas fa-heart"></i>
          </button>
        )}
      </div>

      <div className="header-center">
        <SearchBar />
        {isRemoteModeAvailable && (
          <button
            className={`mini-player-button${isRemoteMode ? ' remote-btn--active' : ''}`}
            aria-label="Remote"
            title={isRemoteMode ? 'Remote: connected — click to manage' : 'Connect to another Xylonic device on your network'}
            onClick={() => window.dispatchEvent(new Event('xylonic-open-remote-picker'))}
          >
            <i className="fas fa-satellite-dish btn-icon" />
            <span className="btn-label">
              {isRemoteMode
                ? 'Connected'
                : availableDevices.length > 0
                  ? `Remote (${availableDevices.length})`
                  : 'Remote'}
            </span>
          </button>
        )}
        {!bridge.isCapacitor && (
          <button
            onClick={handleMiniPlayer}
            className="mini-player-button"
            aria-label="Mini Player"
            title={currentSong ? "Mini Player (Ctrl+M)" : "No song loaded - play a song to use Mini Player"}
            disabled={!currentSong}
          >
            <i className="fas fa-compress-alt btn-icon" />
            <span className="btn-label">Mini</span>
          </button>
        )}
      </div>

      <div className="header-right">
        <button
          className={`offline-toggle-btn${offlineModeEnabled ? ' active' : ''}`}
          onClick={toggleOfflineMode}
          title={offlineModeEnabled ? 'Offline Mode active — tap to go online' : 'Go offline (play cached library without network)'}
          aria-label={offlineModeEnabled ? 'Disable offline mode' : 'Enable offline mode'}
          aria-pressed={offlineModeEnabled}
        >
          <i className={`fas fa-${offlineModeEnabled ? 'plane' : 'globe'}`} />
          {offlineModeEnabled && <span className="offline-toggle-label">Offline</span>}
        </button>
        {perfMode && !powerSaver && (
          <span
            className="header-mode-badge header-mode-badge--perf"
            title="Gaming Mode active — frame rate capped at 30 fps"
          >
            <i className="fas fa-tachometer-alt" />
          </span>
        )}
        {powerSaver && (
          <span
            className="header-mode-badge header-mode-badge--eco"
            title="Power Saver Mode active — frame rate capped at 5 fps"
          >
            <i className="fas fa-leaf" />
          </span>
        )}
      </div>
    </header>
  );
};

export default Header;