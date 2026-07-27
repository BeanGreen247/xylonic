import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useOfflineMode } from '../../context/OfflineModeContext';
import KeyboardHelp from '../common/KeyboardHelp';
import './AppNav.css';

export type AppSection = 'home' | 'library' | 'downloads' | 'settings';

interface AppNavProps {
  current: AppSection;
  onChange: (section: AppSection) => void;
  onLogout?: () => void;
}

const NAV_COLLAPSED_KEY = 'xylonic_nav_collapsed';

const AppNav: React.FC<AppNavProps> = ({ current, onChange, onLogout }) => {
  const { username, serverUrl } = useAuth();
  const { offlineModeEnabled } = useOfflineMode();
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(NAV_COLLAPSED_KEY) === 'true'
  );

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
  };

  return (
    <>
      <nav className={`app-nav${collapsed ? ' collapsed' : ''}`} aria-label="App sections">
        <button
          className="app-nav-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className={`fas fa-chevron-${collapsed ? 'right' : 'left'}`} />
          {!collapsed && <span>Collapse</span>}
        </button>
        <button
          className={`app-nav-item${current === 'home' ? ' active' : ''}`}
          onClick={() => onChange('home')}
          aria-current={current === 'home' ? 'page' : undefined}
          disabled={offlineModeEnabled}
          title={offlineModeEnabled ? 'Home is not available in offline mode' : 'Home'}
        >
          <i className="fas fa-home" />
          <span>Home</span>
        </button>
        <button
          className={`app-nav-item${current === 'library' ? ' active' : ''}`}
          onClick={() => onChange('library')}
          aria-current={current === 'library' ? 'page' : undefined}
          title="Library"
        >
          <i className="fas fa-book-open" />
          <span>Library</span>
        </button>
        <button
          className={`app-nav-item${current === 'downloads' ? ' active' : ''}`}
          onClick={() => onChange('downloads')}
          aria-current={current === 'downloads' ? 'page' : undefined}
          title="Downloads"
        >
          <i className="fas fa-download" />
          <span>Downloads</span>
        </button>
        <div className="app-nav-spacer" />

        <button
          className={`app-nav-item${current === 'settings' ? ' active' : ''}`}
          onClick={() => onChange('settings')}
          aria-current={current === 'settings' ? 'page' : undefined}
          title="Settings"
        >
          <i className="fas fa-cog" />
          <span>Settings</span>
        </button>

        <div className="app-nav-divider" />

        <div className="app-nav-user-info">
          {username && (
            <div className="app-nav-user-row">
              <i className="fas fa-user" />
              <span>{username}</span>
            </div>
          )}
          {serverUrl && (
            <div className="app-nav-server-row" title={serverUrl}>
              <i className="fas fa-server" />
              <span>{serverUrl}</span>
            </div>
          )}
        </div>

        <button
          className="app-nav-item app-nav-help"
          onClick={() => setShowKeyboardHelp(true)}
          title="Help"
        >
          <i className="fas fa-question-circle" />
          <span>Help</span>
        </button>
        <button
          className="app-nav-item app-nav-logout"
          onClick={() => onLogout?.()}
          title="Logout"
        >
          <i className="fas fa-sign-out-alt" />
          <span>Logout</span>
        </button>
      </nav>

      <KeyboardHelp isOpen={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />
    </>
  );
};

export default AppNav;
