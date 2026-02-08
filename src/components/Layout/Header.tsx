import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import ThemeSelector from '../common/ThemeSelector';
import KeyboardHelp from '../common/KeyboardHelp';

interface HeaderProps {
  onLogout: () => void;
}

const Header: React.FC<HeaderProps> = ({ onLogout }) => {
  const { username } = useAuth();
  const serverUrl = localStorage.getItem('serverUrl') || '';
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);

  const handleHelp = () => {
    setShowKeyboardHelp(true);
  };

  const handleGitHubClick = () => {
    // In Electron, use shell.openExternal
    if (window.require) {
      const { shell } = window.require('electron');
      shell.openExternal('https://github.com/BeanGreen247/xylonic');
    } else {
      // Fallback for browser mode
      window.open('https://github.com/BeanGreen247/xylonic', '_blank');
    }
  };

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="app-title">
          <i className="fas fa-music"></i>
          Xylonic
        </h1>
        <button className="github-link" onClick={handleGitHubClick} title="View on GitHub">
          <i className="fab fa-github"></i>
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
        <ThemeSelector />
        <button className="help-button" onClick={handleHelp}>
          <i className="fas fa-question-circle"></i>
          <span>Help</span>
        </button>
        <button className="logout-button" onClick={onLogout}>
          <i className="fas fa-sign-out-alt"></i>
          <span>Logout</span>
        </button>
      </div>

      <KeyboardHelp isOpen={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />
    </header>
  );
};

export default Header;