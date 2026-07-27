import React, { useState, useRef, useEffect, CSSProperties } from 'react';
import ReactDOM from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { useAuth } from '../../context/AuthContext';
import { usePlayer } from '../../context/PlayerContext';
import { useSearch } from '../../context/SearchContext';
import { offlineCacheService } from '../../services/offlineCacheService';
import { imageCacheService } from '../../services/imageCacheService';
import { searchCacheService } from '../../services/searchCacheService';
import { logger } from '../../utils/logger';
import { getConnectionHistory, ConnectionProfile } from '../../services/connectionHistoryService';
import { isSecureStorageAvailable, getDecryptedPassword } from '../../services/secureCredentialService';
import { testConnection } from '../../services/subsonicApi';
import { useRemoteMode } from '../../context/RemoteModeContext';
import FirewallSetupDialog from './FirewallSetupDialog';
import ThemeSelector from './ThemeSelector';
import SleepTimerPicker, { fmtSleepRemaining } from './SleepTimerPicker';
import DownloadManagerWindow from '../Library/DownloadManagerWindow';
import { TopLevelView } from '../Library/LibraryViewToggle';
import { getBridge } from '../../platform/bridge';
import './HamburgerMenu.css';

const PREF_KEY = (username: string) => `xylonic_library_view_${username}`;

function makeCacheKey(key: string, user: string, server: string): string {
  const hash = server.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0);
  return `${key}_${user}_${Math.abs(hash)}`;
}

function clearPrecacheFlags(user: string, server: string) {
  localStorage.removeItem(makeCacheKey('cachePreloaded', user, server));
  localStorage.removeItem(makeCacheKey('cachePreloadTimestamp', user, server));
}

const VIEW_LABELS: Record<TopLevelView, string> = {
  artists: 'Artists',
  allAlbums: 'Albums',
  allSongs: 'Songs',
  likedSongs: 'Liked',
};

const HamburgerMenu: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [showDownloadManager, setShowDownloadManager] = useState(false);
  const [loggingEnabled, setLoggingEnabled] = useState(false);
  const [isClearingAllCaches, setIsClearingAllCaches] = useState(false);
  const [isRebuildingCache, setIsRebuildingCache] = useState(false);
  const [preferredView, setPreferredView] = useState<TopLevelView>('artists');

  // Switch server
  const [showSwitchPicker, setShowSwitchPicker] = useState(false);
  const [connections, setConnections] = useState<ConnectionProfile[]>([]);
  const [switchPassConn, setSwitchPassConn] = useState<ConnectionProfile | null>(null);
  const [switchPassword, setSwitchPassword] = useState('');
  const [switchError, setSwitchError] = useState('');
  const [switching, setSwitching] = useState(false);

  const [showFirewallDialog, setShowFirewallDialog] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({});

  const { isOnline, offlineModeEnabled, toggleOfflineMode, cacheInitialized } = useOfflineMode();
  const {
    remoteControlEnabled,    setRemoteControlEnabled,
    remoteControllerEnabled, setRemoteControllerEnabled,
  } = useRemoteMode();
  const { username, login } = useAuth();
  const { sleepTimerRemaining } = usePlayer();
  const { buildSearchIndex } = useSearch();
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadLoggingPreference = async () => {
      const enabled = logger.isEnabled();
      setLoggingEnabled(enabled);
    };
    loadLoggingPreference();
  }, []);

  useEffect(() => {
    if (!username) return;
    const saved = localStorage.getItem(PREF_KEY(username)) as TopLevelView | null;
    if (saved && ['artists', 'allAlbums', 'allSongs', 'likedSongs'].includes(saved)) {
      setPreferredView(saved);
    }
  }, [username]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || dropdownRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Android: full-width flush panel between header and bottom nav
  useEffect(() => {
    if (!isOpen || !Capacitor.isNativePlatform()) return;
    const header = document.querySelector('.header');
    const bottomNav = document.querySelector('.mobile-bottom-nav');
    if (!header) return;
    const top = header.getBoundingClientRect().bottom;
    const bottom = bottomNav ? window.innerHeight - bottomNav.getBoundingClientRect().top : 0;
    setDropdownStyle({
      position: 'fixed',
      top: `${top}px`,
      left: 0,
      right: 0,
      width: '100%',
      minWidth: 'unset',
      bottom: bottom > 0 ? `${bottom}px` : undefined,
      maxHeight: bottom > 0 ? undefined : `calc(100vh - ${top}px)`,
      borderRadius: '0',
      borderLeft: 'none',
      borderRight: 'none',
      borderTop: 'none',
      borderBottom: bottom > 0 ? 'none' : undefined,
    });
  }, [isOpen]);

  // Desktop: anchor to the button via fixed positioning (avoids flex/overflow clipping)
  useEffect(() => {
    if (!isOpen || Capacitor.isNativePlatform()) return;
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const minWidth = 320;
    const margin = 8;
    // Align right edge with button's right edge, but clamp so left edge never goes off-screen
    const idealLeft = rect.right - minWidth;
    const left = Math.max(margin, idealLeft);
    setDropdownStyle({
      position: 'fixed',
      top: `${rect.bottom + 8}px`,
      left: `${left}px`,
      right: 'auto', // override CSS `right: 0` which would otherwise stretch the width
    });
  }, [isOpen]);

  const handlePreferredViewChange = (view: TopLevelView) => {
    setPreferredView(view);
    if (username) {
      localStorage.setItem(PREF_KEY(username), view);
    }
  };

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

  const handleOpenSwitchPicker = () => {
    setConnections(getConnectionHistory());
    setShowSwitchPicker(true);
    setIsOpen(false);
  };

  const handleSwitchSelect = async (conn: ConnectionProfile) => {
    setShowSwitchPicker(false);
    setSwitching(true);
    try {
      const secureAvail = await isSecureStorageAvailable();
      if (secureAvail) {
        const pwd = await getDecryptedPassword(conn.serverUrl, conn.username);
        if (pwd) {
          const resp = await testConnection(conn.serverUrl, conn.username, pwd);
          if (resp.data['subsonic-response']?.status === 'ok') {
            login(conn.serverUrl, conn.username, pwd);
            setSwitching(false);
            return;
          }
        }
      }
      // No stored password or test failed — prompt
      setSwitchPassConn(conn);
      setSwitchPassword('');
      setSwitchError('');
    } catch {
      setSwitchPassConn(conn);
      setSwitchPassword('');
      setSwitchError('');
    } finally {
      setSwitching(false);
    }
  };

  const handleSwitchWithPassword = async () => {
    if (!switchPassConn || !switchPassword) return;
    setSwitching(true);
    try {
      const resp = await testConnection(switchPassConn.serverUrl, switchPassConn.username, switchPassword);
      if (resp.data['subsonic-response']?.status === 'ok') {
        login(switchPassConn.serverUrl, switchPassConn.username, switchPassword);
        setSwitchPassConn(null);
      } else {
        setSwitchError('Wrong password or connection failed.');
      }
    } catch {
      setSwitchError('Could not reach server.');
    } finally {
      setSwitching(false);
    }
  };

  const handleOpenLogFolder = async () => {
    try {
      await getBridge().openLogFolder();
    } catch (error) {
      console.error('Failed to open log folder:', error);
    }
    setIsOpen(false);
  };

  const handleRebuildCache = async () => {
    if (isRebuildingCache) return;

    const confirmed = window.confirm(
      'Rebuild Cache?\n\n' +
      'This will clear the image and search caches and re-run the\n' +
      'initial precaching process on reload.\n' +
      'Downloaded audio files will not be affected.\n\n' +
      'Continue?'
    );
    if (!confirmed) return;

    setIsRebuildingCache(true);
    setIsOpen(false);

    try {
      logger.log('[HamburgerMenu] Rebuilding cache...');
      await imageCacheService.clearAllCacheAndReset();
      await searchCacheService.clearCache();
      const user = username || localStorage.getItem('username') || 'unknown';
      const server = localStorage.getItem('serverUrl') || 'unknown';
      clearPrecacheFlags(user, server);
      window.location.reload();
    } catch (error) {
      logger.error('[HamburgerMenu] Cache rebuild failed:', error);
      alert(`❌ Cache rebuild failed: ${(error as Error).message}`);
      setIsRebuildingCache(false);
    }
  };

  const handleClearAllCaches = async () => {
    if (isClearingAllCaches) return;

    const confirmed = window.confirm(
      '⚠️ Clear All Caches?\n\n' +
      'This will:\n' +
      '• Delete all cached album artwork (IndexedDB)\n' +
      '• Delete all offline cache data (permanent_cache)\n' +
      '• Reset all precache completion flags\n\n' +
      'The cache will rebuild automatically on next launch.\n\n' +
      'Continue?'
    );
    if (!confirmed) return;

    setIsClearingAllCaches(true);
    setIsOpen(false);

    try {
      logger.log('[HamburgerMenu] Clearing all caches...');
      await offlineCacheService.clearAllCache();
      await imageCacheService.clearAllCacheAndReset();
      await searchCacheService.clearCache();
      const user = username || localStorage.getItem('username') || 'unknown';
      const server = localStorage.getItem('serverUrl') || 'unknown';
      clearPrecacheFlags(user, server);

      alert('✅ All caches cleared. The app will now reload to rebuild.');
      window.location.reload();
    } catch (error) {
      logger.error('[HamburgerMenu] Clear all caches failed:', error);
      alert(`❌ Failed to clear caches: ${(error as Error).message}`);
      setIsClearingAllCaches(false);
    }
  };

  const dropdownJsx = isOpen ? (
    <div className="hamburger-dropdown" style={dropdownStyle} ref={dropdownRef}>
      <button onClick={handleThemeClick} className="menu-item">
        <i className="fas fa-palette"></i>
        <span>Theme</span>
      </button>

      <button onClick={handleOpenSwitchPicker} className="menu-item" disabled={switching}>
        <i className={`fas fa-${switching ? 'spinner fa-spin' : 'exchange-alt'}`}></i>
        <span>{switching ? 'Switching…' : 'Switch Server'}</span>
      </button>

      {/* ── Sleep Timer ── */}
      <div className="menu-divider"></div>
      <SleepTimerPicker triggerClassName="menu-item" onClose={() => setIsOpen(false)}>
        <i className="fas fa-moon" />
        <span>Sleep Timer</span>
        {sleepTimerRemaining !== null && (
          <span className="menu-item-badge">{fmtSleepRemaining(sleepTimerRemaining)}</span>
        )}
      </SleepTimerPicker>
      <div className="menu-divider"></div>

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
        onClick={handleRebuildCache}
        className="menu-item"
        disabled={isRebuildingCache}
        title="Re-fetch library index from server without deleting downloaded files"
      >
        <i className={`fas fa-${isRebuildingCache ? 'spinner fa-spin' : 'sync-alt'}`}></i>
        <span>{isRebuildingCache ? 'Rebuilding...' : 'Rebuild Cache'}</span>
      </button>

      <button
        onClick={handleClearAllCaches}
        className="menu-item"
        disabled={isClearingAllCaches}
        title="Delete all caches — rebuild happens on next launch"
      >
        <i className={`fas fa-${isClearingAllCaches ? 'spinner fa-spin' : 'trash-alt'}`}></i>
        <span>{isClearingAllCaches ? 'Clearing...' : 'Clear All Caches'}</span>
      </button>

      <div className="menu-divider"></div>

      <div className="menu-section-label">Default View</div>
      <div className="menu-view-options">
        {(['artists', 'allAlbums', 'allSongs'] as TopLevelView[]).map(view => (
          <button
            key={view}
            className={`view-option-btn ${preferredView === view ? 'active' : ''}`}
            onClick={() => handlePreferredViewChange(view)}
            title={`Default to ${VIEW_LABELS[view]} view`}
          >
            <i className={`fas fa-${view === 'artists' ? 'users' : view === 'allAlbums' ? 'compact-disc' : 'music'}`}></i>
            {VIEW_LABELS[view]}
          </button>
        ))}
      </div>

      <div className="menu-divider"></div>

      <button
        onClick={() => setRemoteControlEnabled(!remoteControlEnabled)}
        className={`menu-item ${remoteControlEnabled ? 'active' : ''}`}
        title="Allow other Xylonic devices on the same network to control playback on this device"
      >
        <i className="fas fa-satellite-dish"></i>
        <span>Be Controlled</span>
        <span className={`menu-item-badge ${remoteControlEnabled ? '' : 'disabled'}`}>
          {remoteControlEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </button>
      {!Capacitor.isNativePlatform() && (
        <>
          <button
            onClick={() => setRemoteControllerEnabled(!remoteControllerEnabled)}
            className={`menu-item ${remoteControllerEnabled ? 'active' : ''}`}
            title="Discover and control other Xylonic devices on the same network"
          >
            <i className="fas fa-gamepad"></i>
            <span>Control Others</span>
            <span className={`menu-item-badge ${remoteControllerEnabled ? '' : 'disabled'}`}>
              {remoteControllerEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </button>
          {remoteControllerEnabled && (
            <button
              className="menu-item"
              title="Browse Xylonic devices discovered on the local network"
              onClick={() => {
                setIsOpen(false);
                window.dispatchEvent(new Event('xylonic-open-remote-picker'));
              }}
            >
              <i className="fas fa-network-wired"></i>
              <span>Remote Devices…</span>
            </button>
          )}
          <button
            className="menu-item"
            title="Open firewall setup instructions for remote mode ports"
            onClick={() => { setIsOpen(false); setShowFirewallDialog(true); }}
          >
            <i className="fas fa-fire-alt"></i>
            <span>Firewall Setup…</span>
          </button>
        </>
      )}

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
  ) : null;

  return (
    <div className="hamburger-menu-container" ref={menuRef}>
      <button
        ref={buttonRef}
        className={`hamburger-button ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Menu"
        title="Menu"
      >
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
        <span className="hamburger-line"></span>
      </button>

      {Capacitor.isNativePlatform()
        ? dropdownJsx
        : dropdownJsx && ReactDOM.createPortal(dropdownJsx, document.body)
      }

      {showThemeSelector && <ThemeSelector onClose={() => setShowThemeSelector(false)} />}
      {showFirewallDialog && <FirewallSetupDialog onClose={() => setShowFirewallDialog(false)} />}
      <DownloadManagerWindow isOpen={showDownloadManager} onClose={() => setShowDownloadManager(false)} />

      {/* ── Switch server connection picker ── */}
      {showSwitchPicker && ReactDOM.createPortal(
        <>
          <div className="quality-picker-backdrop" onClick={() => setShowSwitchPicker(false)} />
          <div className="quality-picker-modal" role="listbox" aria-label="Switch server">
            <div className="quality-picker-header">
              <span className="quality-picker-title">
                <i className="fas fa-exchange-alt" />
                Switch Server
              </span>
              <button className="quality-picker-close" onClick={() => setShowSwitchPicker(false)} aria-label="Close">
                <i className="fas fa-times" />
              </button>
            </div>
            <p className="quality-picker-hint">Select a saved connection to switch to.</p>
            <div className="quality-picker-list">
              {connections.length === 0 && (
                <p style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: 13 }}>
                  No saved connections yet.
                </p>
              )}
              {connections.map(conn => (
                <button
                  key={conn.id}
                  className="quality-picker-item"
                  role="option"
                  aria-selected={false}
                  onClick={() => handleSwitchSelect(conn)}
                >
                  <div className="conn-picker-icon"><i className="fas fa-server" /></div>
                  <div className="quality-picker-info">
                    <span className="quality-picker-name">{conn.displayName}</span>
                    <span className="quality-picker-desc">{conn.username} · {conn.serverUrl}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}

      {/* ── Switch server password prompt ── */}
      {switchPassConn && ReactDOM.createPortal(
        <>
          <div className="quality-picker-backdrop" onClick={() => setSwitchPassConn(null)} />
          <div className="quality-picker-modal switch-pass-modal" role="dialog">
            <div className="quality-picker-header">
              <span className="quality-picker-title">
                <i className="fas fa-lock" />
                Enter Password
              </span>
              <button className="quality-picker-close" onClick={() => setSwitchPassConn(null)} aria-label="Close">
                <i className="fas fa-times" />
              </button>
            </div>
            <div className="switch-pass-body">
              <p className="quality-picker-hint">
                Switching to <strong>{switchPassConn.displayName}</strong>
              </p>
              <input
                type="password"
                className="switch-pass-input"
                placeholder="Password"
                value={switchPassword}
                autoFocus
                onChange={e => setSwitchPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSwitchWithPassword(); }}
              />
              {switchError && (
                <p className="switch-pass-error">
                  <i className="fas fa-times-circle" /> {switchError}
                </p>
              )}
              <button
                className="switch-pass-btn"
                onClick={handleSwitchWithPassword}
                disabled={switching || !switchPassword}
              >
                {switching ? <><i className="fas fa-spinner fa-spin" /> Connecting…</> : 'Connect'}
              </button>
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
};

export default HamburgerMenu;
