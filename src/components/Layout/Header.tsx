import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { usePlayer } from '../../context/PlayerContext';
import KeyboardHelp from '../common/KeyboardHelp';
import SearchBar from '../common/SearchBar';
import HamburgerMenu from '../common/HamburgerMenu';
import './Header.css';

type HeaderProps = {
  onLogout?: () => void;
};

const Header: React.FC<HeaderProps> = ({ onLogout }) => {
  const { username } = useAuth();
  const { currentSong } = usePlayer();
  const [serverUrl, setServerUrl] = useState(localStorage.getItem('serverUrl') || '');
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [showMiniPlayerNotification, setShowMiniPlayerNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');

  // React to localStorage changes (for example when mini player closes/opens)
  useEffect(() => {
    const updateServerUrl = () => {
      const url = localStorage.getItem('serverUrl') || '';
      setServerUrl(url);
    };
    
    // Update on storage events
    window.addEventListener('storage', updateServerUrl);
    
    // Also set up an interval to check periodically as storage events don't always fire
    const interval = setInterval(updateServerUrl, 1000);
    
    return () => {
      window.removeEventListener('storage', updateServerUrl);
      clearInterval(interval);
    };
  }, []);

  const handleHelp = () => {
    setShowKeyboardHelp(true);
  };

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
    
    if (window.electron?.toggleMiniPlayer) {
      await window.electron.toggleMiniPlayer();
    }
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

  const handleLogoutClick = () => onLogout?.();

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
          <i className="fas fa-music"></i>
          Xylonic
        </h1>
        <button className="github-link" onClick={handleGitHubClick} title="View on GitHub">
          <i className="fab fa-github"></i>
        </button>
        <button className="support-link" onClick={handleSupportClick} title="Support the Project">
          <i className="fas fa-heart"></i>
        </button>
      </div>

      <div className="header-center">
        <div className="server-info">
          <div className="user-info-stack">
            <div className="username">
              <i className="fas fa-user"></i>
              <span>{username}</span>
            </div>
            <div className="server-url">
              <i className="fas fa-server"></i>
              <span>{serverUrl}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="header-right">
        <SearchBar />
        
        {/* Hamburger Menu with Theme, Offline Mode, and Downloads */}
        <HamburgerMenu />
        
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
        <button onClick={handleHelp} className="help-button" aria-label="Help" title="Help">
          <i className="fas fa-question-circle btn-icon" />
          <span className="btn-label">Help</span>
        </button>
        <button onClick={handleLogoutClick} className="logout-button" aria-label="Logout" title="Logout">
          <i className="fas fa-sign-out-alt btn-icon" />
          <span className="btn-label">Logout</span>
        </button>
      </div>

      <KeyboardHelp isOpen={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />
    </header>
  );
};

export default Header;