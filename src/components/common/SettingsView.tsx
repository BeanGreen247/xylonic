import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Capacitor } from '@capacitor/core';
import { isAppStoreBuild } from '../../config/buildVariant';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { useAuth } from '../../context/AuthContext';
import { usePlayer } from '../../context/PlayerContext';
import { useTheme, ThemeMode } from '../../context/ThemeContext';
import { useRemoteMode } from '../../context/RemoteModeContext';
import { offlineCacheService } from '../../services/offlineCacheService';
import { imageCacheService, type PerformanceCacheStats } from '../../services/imageCacheService';
import { downloadManager } from '../../services/downloadManagerService';
import { searchCacheService } from '../../services/searchCacheService';
import { getConnectionHistory, ConnectionProfile } from '../../services/connectionHistoryService';
import { isSecureStorageAvailable, getDecryptedPassword } from '../../services/secureCredentialService';
import { testConnection } from '../../services/subsonicApi';
import { TopLevelView } from '../Library/LibraryViewToggle';
import { DownloadQuality } from '../../types/offline';
import { getDefaultDownloadQuality, saveDefaultDownloadQuality, saveStreamingQuality, getMaxConcurrentDownloads, saveMaxConcurrentDownloads, MAX_CONCURRENT_DOWNLOADS_LIMIT } from '../../utils/settingsManager';
import ThemeSelector from './ThemeSelector';
import FirewallSetupDialog from './FirewallSetupDialog';
import SleepTimerPicker, { fmtSleepRemaining } from './SleepTimerPicker';
import DownloadManagerWindow from '../Library/DownloadManagerWindow';
import PerformanceCacheSection from './settings/PerformanceCacheSection';
import AboutSection from './settings/AboutSection';
import AdvancedSection from './settings/AdvancedSection';
import './SettingsView.css';

const PREF_KEY = (username: string) => `xylonic_library_view_${username}`;

function makeCacheKey(key: string, user: string, server: string): string {
  const hash = server.split('').reduce((acc, c) => ((acc << 5) - acc) + c.charCodeAt(0), 0);
  return `${key}_${user}_${Math.abs(hash)}`;
}

function clearPrecacheFlags(user: string, server: string) {
  localStorage.removeItem(makeCacheKey('cachePreloaded', user, server));
  localStorage.removeItem(makeCacheKey('cachePreloadTimestamp', user, server));
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const VIEW_OPTIONS: { view: TopLevelView; label: string; icon: string }[] = [
  { view: 'artists',    label: 'Artists', icon: 'fa-users' },
  { view: 'allAlbums',  label: 'Albums',  icon: 'fa-compact-disc' },
  { view: 'allSongs',   label: 'Songs',   icon: 'fa-music' },
  { view: 'likedSongs', label: 'Liked',   icon: 'fa-heart' },
];

const SettingsView: React.FC = () => {
  const { offlineModeEnabled, toggleOfflineMode, config: offlineConfig, updateConfig: updateOfflineConfig } = useOfflineMode();
  const { username, login } = useAuth();
  const { themeMode, setThemeMode } = useTheme();
  const { sleepTimerRemaining, bitrate, setBitrate } = usePlayer();
  const {
    isRemoteModeAvailable,
    remoteControlEnabled,  setRemoteControlEnabled,
    remoteControllerEnabled, setRemoteControllerEnabled,
    availableDevices,
    remoteTarget,
    isOnWifi,
  } = useRemoteMode();
  const [showFirewallDialog, setShowFirewallDialog] = useState(false);

  const [defaultDlQuality, setDefaultDlQuality] = useState<DownloadQuality>(getDefaultDownloadQuality);
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState<number>(getMaxConcurrentDownloads);
  const [showThemeSelector,  setShowThemeSelector]  = useState(false);
  const [showDownloadManager,setShowDownloadManager] = useState(false);
  const [isRebuildingCache,  setIsRebuildingCache]   = useState(false);
  const [isClearingCaches,   setIsClearingCaches]    = useState(false);
  const [isClearingAllData,  setIsClearingAllData]   = useState(false);
  const [perfCacheStats,     setPerfCacheStats]      = useState<PerformanceCacheStats | null>(null);
  const [perfCacheRefreshTick, setPerfCacheRefreshTick] = useState(0);
  const [preferredView,      setPreferredView]       = useState<TopLevelView>('artists');

  // Switch-server state
  const [showSwitchPicker, setShowSwitchPicker] = useState(false);
  const [connections,      setConnections]      = useState<ConnectionProfile[]>([]);
  const [switchPassConn,   setSwitchPassConn]   = useState<ConnectionProfile | null>(null);
  const [switchPassword,   setSwitchPassword]   = useState('');
  const [switchError,      setSwitchError]      = useState('');
  const [switching,        setSwitching]        = useState(false);

  useEffect(() => {
    setPerfCacheStats(null);
    imageCacheService.getPerformanceStats().then(setPerfCacheStats).catch(() => {});
  }, [perfCacheRefreshTick]);

  useEffect(() => {
    if (!username) return;
    const saved = localStorage.getItem(PREF_KEY(username)) as TopLevelView | null;
    if (saved && ['artists', 'allAlbums', 'allSongs', 'likedSongs'].includes(saved)) {
      setPreferredView(saved as TopLevelView);
    }
  }, [username]);

  const handleQualityChange = (q: DownloadQuality) => {
    setDefaultDlQuality(q);
    saveDefaultDownloadQuality(q);
  };

  const handleMaxConcurrentChange = (count: number) => {
    setMaxConcurrentDownloads(count);
    saveMaxConcurrentDownloads(count);
    downloadManager.syncMaxConcurrentDownloads();
  };

  const handleStreamingQualityChange = (raw: string) => {
    const value = raw === '' ? null : Number(raw);
    setBitrate(value);
    saveStreamingQuality(value);
  };

  const handlePreferredViewChange = (view: TopLevelView) => {
    setPreferredView(view);
    if (username) localStorage.setItem(PREF_KEY(username), view);
  };

  const handleOpenSwitchPicker = () => {
    setConnections(getConnectionHistory());
    setShowSwitchPicker(true);
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

  const handleRebuildCache = async () => {
    if (isRebuildingCache) return;
    if (!window.confirm(
      'Rebuild Cache?\n\nThis will clear the image and search caches and re-run the initial precaching process on reload.\nDownloaded audio files will not be affected.\n\nContinue?'
    )) return;
    setIsRebuildingCache(true);
    try {
      await imageCacheService.clearAllCacheAndReset();
      await searchCacheService.clearCache();
      const user   = username || localStorage.getItem('username') || 'unknown';
      const server = localStorage.getItem('serverUrl') || 'unknown';
      clearPrecacheFlags(user, server);
      window.location.reload();
    } catch (error) {
      alert(`Cache rebuild failed: ${(error as Error).message}`);
      setIsRebuildingCache(false);
    }
  };

  const handleClearAllCaches = async () => {
    if (isClearingCaches) return;
    if (!window.confirm(
      '⚠️ Clear All Caches?\n\nThis will:\n• Delete all cached album artwork\n• Delete all offline cache data\n• Reset all precache flags\n\nThe cache will rebuild automatically on next launch.\n\nContinue?'
    )) return;
    setIsClearingCaches(true);
    try {
      await offlineCacheService.clearAllCache();
      await imageCacheService.clearAllCacheAndReset();
      await searchCacheService.clearCache();
      const user   = username || localStorage.getItem('username') || 'unknown';
      const server = localStorage.getItem('serverUrl') || 'unknown';
      clearPrecacheFlags(user, server);
      alert('All caches cleared. The app will now reload to rebuild.');
      window.location.reload();
    } catch (error) {
      alert(`Failed to clear caches: ${(error as Error).message}`);
      setIsClearingCaches(false);
    }
  };

  const handleClearAllData = async () => {
    if (isClearingAllData) return;
    if (!window.confirm(
      'Clear ALL app data?\n\n' +
      'This will permanently delete:\n' +
      '  • All cached and downloaded songs\n' +
      '  • All cover art\n' +
      '  • Your login credentials\n' +
      '  • All settings and preferences\n' +
      '  • Download queue and history\n\n' +
      'There is no way to undo this.\n' +
      'You will be logged out and the app will restart.'
    )) return;
    setIsClearingAllData(true);
    try {
      downloadManager.clearQueue();
      // JS-layer caches
      await offlineCacheService.clearAllCache();
      await imageCacheService.clearAllCacheAndReset();
      await searchCacheService.clearCache();
      // Android OS-level wipe: WebView cache/cookies/storage, SharedPreferences,
      // and the entire permanent_cache directory (catches orphaned files and
      // other-user audio that ref-counting wouldn't remove)
      if (Capacitor.isNativePlatform()) {
        await downloadManager.clearAllNativeData();
      }
      localStorage.clear();
    } finally {
      window.location.reload();
    }
  };

  const handleOpenGitHub = () => {
    const url = 'https://github.com/BeanGreen247/xylonic';
    if ((window as any).require) {
      const { shell } = (window as any).require('electron');
      shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenSupport = () => {
    const url = 'https://github.com/sponsors/BeanGreen247';
    if ((window as any).require) {
      const { shell } = (window as any).require('electron');
      shell.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="settings-view">
      <div className="library-header">
        <h2 className="library-title">
          <i className="fas fa-cog" />
          Settings
        </h2>
      </div>

      {/* ── Thank You (app store build only) ───────────────── */}
      {isAppStoreBuild && (
        <section className="settings-section">
          <div className="settings-card settings-thankyou-card">
            <div className="settings-thankyou-banner">
              <span className="settings-thankyou-icon"><i className="fas fa-heart" /></span>
              <p className="settings-thankyou-title">Thank you for supporting Xylonic!</p>
              <p className="settings-thankyou-text">
                Your purchase helps keep this project alive and growing.
                You're awesome — thank you for being part of this journey.
              </p>
              <button className="settings-thankyou-github" onClick={handleOpenGitHub}>
                <i className="fab fa-github" /> View source on GitHub
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── Appearance ─────────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Appearance</h3>
        <div className="settings-card">
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-moon" /></span>
            <span className="settings-row-label">
              Mode
              <span className="settings-row-sub">Light / dark — follows your system by default</span>
            </span>
            <span className="settings-row-action">
              <select
                className="settings-select"
                value={themeMode}
                onChange={e => setThemeMode(e.target.value as ThemeMode)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </span>
          </div>
          <div className="settings-divider" />
          <button className="settings-row" onClick={() => setShowThemeSelector(true)}>
            <span className="settings-row-icon"><i className="fas fa-palette" /></span>
            <span className="settings-row-label">Accent Theme</span>
            <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
          </button>
        </div>
      </section>

      {/* ── Playback ───────────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Playback</h3>
        <div className="settings-card">
          <SleepTimerPicker triggerClassName="settings-row">
            <span className="settings-row-icon"><i className="fas fa-moon" /></span>
            <span className="settings-row-label">
              Sleep Timer
              {sleepTimerRemaining !== null && (
                <span className="settings-row-sub">Stops in {fmtSleepRemaining(sleepTimerRemaining)}</span>
              )}
            </span>
            <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
          </SleepTimerPicker>
        </div>
      </section>

      {/* ── Account ────────────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Account</h3>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-icon"><i className="fab fa-lastfm" /></span>
            <span className="settings-row-label">
              Last.fm
              <span className="settings-row-sub">Scrobbling is handled by your server — enable Last.fm in your server's admin panel</span>
            </span>
            <span className="settings-row-action">
              <span className="settings-badge off">Server</span>
            </span>
          </div>
          <div className="settings-divider" />
          <button className="settings-row" onClick={handleOpenSwitchPicker} disabled={switching}>
            <span className="settings-row-icon">
              <i className={`fas fa-${switching ? 'spinner fa-spin' : 'exchange-alt'}`} />
            </span>
            <span className="settings-row-label">{switching ? 'Switching…' : 'Switch Server'}</span>
            <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
          </button>
        </div>
      </section>

      {/* ── Performance Cache ─────────────────────────────── */}
      <PerformanceCacheSection
        stats={perfCacheStats}
        onRefresh={() => setPerfCacheRefreshTick(t => t + 1)}
      />

      {/* ── Offline & Cache ────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Offline &amp; Cache</h3>
        <div className="settings-card">
          <button
            className={`settings-row${offlineModeEnabled ? ' active' : ''}`}
            onClick={toggleOfflineMode}
          >
            <span className="settings-row-icon">
              <i className={`fas fa-${offlineModeEnabled ? 'plane' : 'cloud'}`} />
            </span>
            <span className="settings-row-label">
              Offline Mode
              <span className="settings-row-sub">{offlineModeEnabled ? 'No network requests will be made' : 'Streaming from server'}</span>
            </span>
            <span className="settings-row-action">
              <span className={`settings-badge ${offlineModeEnabled ? 'on' : 'off'}`}>
                {offlineModeEnabled ? 'On' : 'Off'}
              </span>
            </span>
          </button>
          <div className="settings-divider" />
          {(() => {
            const hasSongs = offlineCacheService.getCacheStats().totalSongs > 0;
            return (
              <button
                className={`settings-row${offlineConfig.autoOfflineOnCellular ? ' active' : ''}${!hasSongs ? ' disabled' : ''}`}
                onClick={() => hasSongs && updateOfflineConfig({ autoOfflineOnCellular: !offlineConfig.autoOfflineOnCellular })}
              >
                <span className="settings-row-icon"><i className="fas fa-signal" /></span>
                <span className="settings-row-label">
                  Auto-offline on mobile data
                  <span className="settings-row-sub">
                    {hasSongs ? 'Switch to offline automatically on cellular' : 'Download songs first to enable'}
                  </span>
                </span>
                <span className="settings-row-action">
                  <span className={`settings-badge ${offlineConfig.autoOfflineOnCellular && hasSongs ? 'on' : 'off'}`}>
                    {offlineConfig.autoOfflineOnCellular && hasSongs ? 'On' : 'Off'}
                  </span>
                </span>
              </button>
            );
          })()}
          <div className="settings-divider" />
          <button className="settings-row" onClick={() => setShowDownloadManager(true)}>
            <span className="settings-row-icon"><i className="fas fa-download" /></span>
            <span className="settings-row-label">Downloads</span>
            <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
          </button>
          <div className="settings-divider" />
          <button
            className="settings-row"
            onClick={handleRebuildCache}
            disabled={isRebuildingCache}
            title="Re-fetch library index without deleting downloaded files"
          >
            <span className="settings-row-icon">
              <i className={`fas fa-${isRebuildingCache ? 'spinner fa-spin' : 'sync-alt'}`} />
            </span>
            <span className="settings-row-label">
              {isRebuildingCache ? 'Rebuilding…' : 'Rebuild Cache'}
              <span className="settings-row-sub">Re-fetches library index; keeps downloaded files</span>
            </span>
          </button>
          <div className="settings-divider" />
          <button
            className="settings-row danger"
            onClick={handleClearAllCaches}
            disabled={isClearingCaches}
            title="Delete all caches — rebuild happens on next launch"
          >
            <span className="settings-row-icon">
              <i className={`fas fa-${isClearingCaches ? 'spinner fa-spin' : 'trash-alt'}`} />
            </span>
            <span className="settings-row-label">
              {isClearingCaches ? 'Clearing…' : 'Clear All Caches'}
              <span className="settings-row-sub">Deletes artwork, offline data, and precache flags</span>
            </span>
          </button>
        </div>
      </section>

      {/* ── Remote ────────────────────────────────────────── */}
      {isRemoteModeAvailable && (
        <section className="settings-section">
          <h3 className="settings-section-title">Remote</h3>
          <div className="settings-card">
            <button
              className={`settings-row${remoteControlEnabled ? ' active' : ''}`}
              onClick={() => setRemoteControlEnabled(!remoteControlEnabled)}
            >
              <span className="settings-row-icon"><i className="fas fa-satellite-dish" /></span>
              <span className="settings-row-label">
                Be Controlled
                <span className="settings-row-sub">Let other Xylonic devices on your network control playback here</span>
              </span>
              <span className="settings-row-action">
                <span className={`settings-badge ${remoteControlEnabled ? 'on' : 'off'}`}>
                  {remoteControlEnabled ? 'On' : 'Off'}
                </span>
              </span>
            </button>

            <>
              <div className="settings-divider" />
              <button
                className={`settings-row${remoteControllerEnabled ? ' active' : ''}`}
                onClick={() => setRemoteControllerEnabled(!remoteControllerEnabled)}
              >
                <span className="settings-row-icon"><i className="fas fa-gamepad" /></span>
                <span className="settings-row-label">
                  Control Others
                  <span className="settings-row-sub">Discover and control other Xylonic devices on your network</span>
                </span>
                <span className="settings-row-action">
                  <span className={`settings-badge ${remoteControllerEnabled ? 'on' : 'off'}`}>
                    {remoteControllerEnabled ? 'On' : 'Off'}
                  </span>
                </span>
              </button>
            </>

            <div className="settings-divider" />
            <button
              className="settings-row"
              onClick={() => window.dispatchEvent(new Event('xylonic-open-remote-picker'))}
            >
              <span className="settings-row-icon">
                <i className="fas fa-network-wired" />
              </span>
              <span className="settings-row-label">
                Remote Devices
                <span className="settings-row-sub">
                  {remoteTarget
                    ? 'Currently controlling a remote device'
                    : availableDevices.length > 0
                      ? `${availableDevices.length} device${availableDevices.length !== 1 ? 's' : ''} found`
                      : isOnWifi ? 'No devices found yet' : 'Requires Wi-Fi / LAN'}
                </span>
              </span>
              <span className="settings-row-action">
                {remoteTarget
                  ? <span className="settings-badge on">Connected</span>
                  : <i className="fas fa-chevron-right" />}
              </span>
            </button>

            {!Capacitor.isNativePlatform() && (
              <>
                <div className="settings-divider" />
                <button
                  className="settings-row"
                  onClick={() => setShowFirewallDialog(true)}
                >
                  <span className="settings-row-icon"><i className="fas fa-fire-alt" /></span>
                  <span className="settings-row-label">
                    Firewall Setup
                    <span className="settings-row-sub">Open ports 7766 (UDP) and 7767 (TCP) for remote discovery</span>
                  </span>
                  <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {/* ── Streaming ─────────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Streaming</h3>
        <div className="settings-card">
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-signal" /></span>
            <span className="settings-row-label">Streaming Quality
              <span className="settings-row-sub">Applies to the next track loaded</span>
            </span>
            <span className="settings-row-action">
              <select
                className="settings-select"
                value={bitrate === null ? '' : String(bitrate)}
                onChange={e => handleStreamingQualityChange(e.target.value)}
              >
                <option value="">Original</option>
                <option value="320">320 kbps</option>
                <option value="256">256 kbps</option>
                <option value="192">192 kbps</option>
                <option value="128">128 kbps</option>
                <option value="64">64 kbps</option>
              </select>
            </span>
          </div>
        </div>
      </section>

      {/* ── Downloads ─────────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Downloads</h3>
        <div className="settings-card">
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-sliders-h" /></span>
            <span className="settings-row-label">Download Quality</span>
            <span className="settings-row-action">
              <select
                className="settings-select"
                value={defaultDlQuality}
                onChange={e => handleQualityChange(e.target.value as DownloadQuality)}
              >
                <option value="original">Original</option>
                <option value="320">320 kbps</option>
                <option value="256">256 kbps</option>
                <option value="128">128 kbps</option>
                <option value="64">64 kbps</option>
              </select>
            </span>
          </div>
          <div className="settings-divider" />
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-layer-group" /></span>
            <span className="settings-row-label">Concurrent Downloads
              <span className="settings-row-sub">
                {maxConcurrentDownloads === 1 ? 'One song at a time' : `Up to ${maxConcurrentDownloads} songs at once`}
                {Capacitor.getPlatform() === 'ios' ? ' — iOS applies this from next app launch' : ''}
              </span>
            </span>
            <span className="settings-row-action">
              <select
                className="settings-select"
                value={maxConcurrentDownloads}
                onChange={e => handleMaxConcurrentChange(Number(e.target.value))}
              >
                {Array.from({ length: MAX_CONCURRENT_DOWNLOADS_LIMIT }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </span>
          </div>
        </div>
      </section>

      {/* ── Library ────────────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Library</h3>
        <div className="settings-card">
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-book-open" /></span>
            <span className="settings-row-label">Default View</span>
            <span className="settings-row-action">
              <select
                className="settings-select"
                value={preferredView}
                onChange={e => handlePreferredViewChange(e.target.value as TopLevelView)}
              >
                {VIEW_OPTIONS.map(({ view, label }) => (
                  <option key={view} value={view}>{label}</option>
                ))}
              </select>
            </span>
          </div>
        </div>
      </section>

      <AdvancedSection />

      {/* ── Danger Zone ────────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section-title settings-section-title--danger">Danger Zone</h3>
        <div className="settings-card settings-card--danger">
          <button
            className="settings-row danger"
            onClick={handleClearAllData}
            disabled={isClearingAllData}
          >
            <span className="settings-row-icon">
              <i className={`fas fa-${isClearingAllData ? 'spinner fa-spin' : 'trash-alt'}`} />
            </span>
            <span className="settings-row-label">
              {isClearingAllData ? 'Clearing…' : 'Clear All App Data'}
              <span className="settings-row-sub">
                Removes downloaded songs, cover art, credentials, and all settings. Cannot be undone.
              </span>
            </span>
          </button>
        </div>
      </section>

      <AboutSection />

      {/* ── Modals ─────────────────────────────────────────── */}
      {showThemeSelector && <ThemeSelector onClose={() => setShowThemeSelector(false)} />}
      {showFirewallDialog && <FirewallSetupDialog onClose={() => setShowFirewallDialog(false)} />}
      <DownloadManagerWindow isOpen={showDownloadManager} onClose={() => setShowDownloadManager(false)} />

      {/* Switch server picker */}
      {showSwitchPicker && ReactDOM.createPortal(
        <>
          <div className="quality-picker-backdrop" onClick={() => setShowSwitchPicker(false)} />
          <div className="quality-picker-modal" role="listbox" aria-label="Switch server">
            <div className="quality-picker-header">
              <span className="quality-picker-title"><i className="fas fa-exchange-alt" /> Switch Server</span>
              <button className="quality-picker-close" onClick={() => setShowSwitchPicker(false)} aria-label="Close">
                <i className="fas fa-times" />
              </button>
            </div>
            <p className="quality-picker-hint">Select a saved connection to switch to.</p>
            <div className="quality-picker-list">
              {connections.length === 0 && (
                <p style={{ padding: '16px 20px', color: 'var(--text-muted)', fontSize: 13 }}>No saved connections yet.</p>
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

      {/* Switch server password prompt */}
      {switchPassConn && ReactDOM.createPortal(
        <>
          <div className="quality-picker-backdrop" onClick={() => setSwitchPassConn(null)} />
          <div className="quality-picker-modal switch-pass-modal" role="dialog">
            <div className="quality-picker-header">
              <span className="quality-picker-title"><i className="fas fa-lock" /> Enter Password</span>
              <button className="quality-picker-close" onClick={() => setSwitchPassConn(null)} aria-label="Close">
                <i className="fas fa-times" />
              </button>
            </div>
            <div className="switch-pass-body">
              <p className="quality-picker-hint">Switching to <strong>{switchPassConn.displayName}</strong></p>
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
                <p className="switch-pass-error"><i className="fas fa-times-circle" /> {switchError}</p>
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

export default SettingsView;
