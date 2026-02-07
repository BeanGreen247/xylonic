import React from 'react';
import { useAuth } from '../../context/AuthContext';
import './Header.css';

const Header: React.FC = () => {
  const { logout } = useAuth();
  
  const username = localStorage.getItem('username') || 'User';
  const serverUrl = localStorage.getItem('serverUrl') || '';

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
        <button 
          className="github-link" 
          onClick={handleGitHubClick}
          title="View on GitHub"
        >
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
        <button className="logout-button" onClick={logout}>
          <i className="fas fa-sign-out-alt"></i>
          Logout
        </button>
      </div>
    </header>
  );
};

export default Header;