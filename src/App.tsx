import React, { useState, useCallback, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { AuthProvider } from './context/AuthContext';
import { OfflineModeProvider, useOfflineMode } from './context/OfflineModeContext';
import { PlayerProvider } from './context/PlayerContext';
import { ThemeProvider } from './context/ThemeContext';
import { SearchProvider, useSearch } from './context/SearchContext';
import { ImageCacheProvider } from './context/ImageCacheContext';
import { UIProvider } from './context/UIContext';
import { useAuth } from './context/AuthContext';
import { RemoteModeProvider, useRemoteMode } from './context/RemoteModeContext';
import RemoteDevicePicker from './components/common/RemoteDevicePicker';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useScrobbler } from './hooks/useScrobbler';
import { getAllSongs, getArtists, getSongCount } from './services/subsonicApi';
import { offlineCacheService } from './services/offlineCacheService';
import { downloadManager } from './services/downloadManagerService';
import { DownloadQuality } from './types/offline';
import { getDefaultDownloadQuality } from './utils/settingsManager';
import LoginForm from './components/Auth/LoginForm';
import Header from './components/Layout/Header';
import AppNav, { AppSection } from './components/Layout/AppNav';
import ArtistList from './components/Library/ArtistList';
import AlbumList from './components/Library/AlbumList';
import SongList from './components/Library/SongList';
import AllAlbumsGrid from './components/Library/AllAlbumsGrid';
import AllSongsGrid from './components/Library/AllSongsGrid';
import DiscoverView from './components/Library/DiscoverView';
import LibraryViewToggle, { TopLevelView } from './components/Library/LibraryViewToggle';
import DownloadQualityPicker from './components/Library/DownloadQualityPicker';
import DownloadManagerWindow from './components/Library/DownloadManagerWindow';
import PlaybackControls from './components/Player/PlaybackControls';
import MiniPlayer from './components/Player/MiniPlayer';
import SearchResults from './components/Library/SearchResults';
import RightPanel from './components/RightPanel/RightPanel';
import MobileBottomNav from './components/Player/MobileBottomNav';
import NowPlayingOverlay from './components/Player/NowPlayingOverlay';
import DesktopNowPlaying from './components/Player/DesktopNowPlaying';
import { CachePreloadDialog } from './components/common/CachePreloadDialog';
import SplashScreen from './components/common/SplashScreen';
import RenderTimerHUD from './components/common/RenderTimerHUD';
import SettingsView from './components/common/SettingsView';
import { isReleaseBuild } from './config/buildVariant';
import { isPowerSaverEnabled } from './services/powerSaverService';
import { isPerformanceModeEnabled } from './services/performanceModeService';
import { getBridge } from './platform/bridge';
import LikedSongsView from './components/Library/LikedSongsView';
import './styles/index.css';

type View = 'artists' | 'albums' | 'songs';

const PREF_VIEW_KEY = (username: string) => `xylonic_library_view_${username}`;

// Reuses the already-registered NativeDownloader plugin for minimizeApp().
// MainActivity.onBackPressed() fires window event "backbutton" which JS catches below.
interface NavBridgePlugin {
  minimizeApp(): Promise<void>;
}
const NavBridge: NavBridgePlugin | null = Capacitor.isNativePlatform()
  ? registerPlugin<NavBridgePlugin>('NativeDownloader')
  : null;

interface NavigationState {
  view: View;
  artistId?: string;
  artistName?: string;
  albumId?: string;
  albumName?: string;
  sourceView?: TopLevelView;
  sourceSection?: AppSection; // top-level section that originated this navigation
}

// Isolated component so that currentTime-driven re-renders from useScrobbler /
// useKeyboardShortcuts never propagate up into AppContent (which owns
// RenderTimerWrapper). Renders nothing.
const AppHooksMount: React.FC = () => {
  useKeyboardShortcuts();
  useScrobbler();
  return null;
};

const AppContent: React.FC = () => {
  const { isAuthenticated, isLoading, logout, username, serverUrl } = useAuth();
  const { isSearching, navigatedFromSearch, returnToSearch, setOnClearCallback, activateSearch, clearSearch } = useSearch();
  const { isOnline, offlineModeEnabled, isCellular, toggleOfflineMode, checkConnectivity, cacheInitialized, config } = useOfflineMode();
  const {
    isRemoteModeAvailable,
    isOnWifi,
    availableDevices,
    remoteTarget,
    isRemoteMode,
    connectToDevice,
    disconnectRemote,
    pairingError,
    clearPairingError,
    myAccountId,
  } = useRemoteMode();
  const [showRemotePicker, setShowRemotePicker] = useState(false);
  const remoteDeviceId = React.useMemo(
    () => typeof localStorage !== 'undefined' ? (localStorage.getItem('_xylonic_remote_device_id') || '') : '',
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [navigation, setNavigation] = useState<NavigationState>({ view: 'artists' });
  const [topView, setTopView] = useState<TopLevelView>('artists');
  const [appSection, setAppSection] = useState<AppSection>('home');
  const [showOfflinePrompt, setShowOfflinePrompt] = useState(false);
  const [showCellularModePrompt, setShowCellularModePrompt] = useState(false);
  const cellularPromptShownRef = React.useRef(false);
  const [showCachePreload, setShowCachePreload] = useState(false);
  const [cachePreloadReason, setCachePreloadReason] = useState<'first-run' | 'library-change'>('first-run');
  const [showNewContentPrompt, setShowNewContentPrompt] = useState(false);
  const [newContentCounts, setNewContentCounts] = useState({ artists: 0, albums: 0, songs: 0 });

  // Missing songs (download cache) detection
  const [missingSongsCount, setMissingSongsCount] = useState(0);
  const [showMissingBanner, setShowMissingBanner] = useState(false);
  const [missingChecked, setMissingChecked] = useState(false);
  const [downloadMissingQuality, setDownloadMissingQuality] = useState<DownloadQuality>(getDefaultDownloadQuality);
  const [isQueueingMissing, setIsQueueingMissing] = useState(false);
  const [showDownloadManagerGlobal, setShowDownloadManagerGlobal] = useState(false);

  // Tracks which section to return to when pressing back from settings/downloads.
  // Pushed on entering those sections; popped on back/close. Home and library are
  // root sections and clear the stack when navigated to directly.
  const [sectionHistory, setSectionHistory] = useState<AppSection[]>([]);

  // ── Android back button ──────────────────────────────────────────────────────
  // backHandlerRef is updated directly in the render body (below, after all nav
  // functions are defined) so it is always a fresh closure on every render.
  const backHandlerRef = useRef<() => void>(() => {});
  const startupCompleteRef = React.useRef(false);

  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // MainActivity registers an OnBackPressedCallback that fires triggerWindowJSEvent
    // ("backbutton"), which dispatches a CustomEvent on window.
    const handler = () => backHandlerRef.current();
    window.addEventListener('backbutton', handler);
    return () => window.removeEventListener('backbutton', handler);
  }, []);
  // ─────────────────────────────────────────────────────────────────────────────

  // Helper function to generate user+server specific cache keys
  const getCacheKey = (key: string): string => {
    const user = username || localStorage.getItem('username') || 'unknown';
    const server = serverUrl || localStorage.getItem('serverUrl') || 'unknown';
    // Create a simple hash from server URL to keep key shorter
    const serverHash = server.split('').reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
    return `${key}_${user}_${Math.abs(serverHash)}`;
  };

  const isFirstTimeUser = (): boolean => {
    if (!username || !serverUrl) return true;
    return localStorage.getItem(getCacheKey('cachePreloaded')) === null;
  };

  const hasCachedSongs = (): boolean =>
    offlineCacheService.getCacheStats().totalSongs > 0;

  // Apply mode-specific core affinity after the bridge (IPC) is available
  React.useEffect(() => {
    const bridge = getBridge();
    if (isPowerSaverEnabled()) {
      bridge.setPowerSaverPriority(true).catch(() => {});    // half cores
    } else if (isPerformanceModeEnabled()) {
      bridge.setPerformancePriority().catch(() => {});        // all cores
    } else {
      bridge.setPowerSaverPriority(false).catch(() => {});    // normal = 3/4 cores
    }
  }, []);

  // Load preferred library view for current user
  React.useEffect(() => {
    if (!username) return;
    const saved = localStorage.getItem(PREF_VIEW_KEY(username)) as TopLevelView | null;
    if (saved && ['artists', 'allAlbums', 'allSongs', 'likedSongs'].includes(saved)) {
      setTopView(saved);
    }
  }, [username]);

  // Check if this is first launch and show cache preload dialog
  React.useEffect(() => {
    if (isAuthenticated && (username || serverUrl)) {
      const cacheKey = getCacheKey('cachePreloaded');
      const hasPreCached = localStorage.getItem(cacheKey);
      if (!hasPreCached) {
        console.log(`First launch detected for ${username}@${serverUrl} - showing cache preload dialog`);
        setShowCachePreload(true);
      } else {
        console.log(`Cache already exists for ${username}@${serverUrl}`);
      }
    }
  }, [isAuthenticated, username, serverUrl]);

  const handleCachePreloadComplete = () => {
    console.log(`Cache preload complete for ${username}@${serverUrl}`);
    const timestamp = Date.now();
    const cacheKey = getCacheKey('cachePreloaded');
    const timestampKey = getCacheKey('cachePreloadTimestamp');
    localStorage.setItem(cacheKey, 'true');
    localStorage.setItem(timestampKey, timestamp.toString());
    // Clear stored server counts so the next launch stores a fresh baseline without triggering a rebuild
    try { localStorage.removeItem(getCacheKey('lastKnownServerCounts')); } catch {}
    // Keep dialog open during the settle period; reload clears it
    setTimeout(() => window.location.reload(), 15000);
  };

  const handleCachePreloadSkip = () => {
    console.log(`Cache preload skipped for ${username}@${serverUrl}`);
    const timestamp = Date.now();
    const cacheKey = getCacheKey('cachePreloaded');
    const timestampKey = getCacheKey('cachePreloadTimestamp');
    localStorage.setItem(cacheKey, 'true');
    localStorage.setItem(timestampKey, timestamp.toString());
    // Clear stored server counts so the next launch stores a fresh baseline without triggering a rebuild
    try { localStorage.removeItem(getCacheKey('lastKnownServerCounts')); } catch {}
    // Keep dialog open during the settle period; reload clears it
    setTimeout(() => window.location.reload(), 15000);
  };

  // Check cache age and auto-refresh if needed (6 days = 518400000 ms)
  React.useEffect(() => {
    const checkCacheAge = async () => {
      if (!isAuthenticated || !username || !serverUrl) return;

      const timestampKey = getCacheKey('cachePreloadTimestamp');
      const cacheTimestamp = localStorage.getItem(timestampKey);
      if (!cacheTimestamp) return;

      const age = Date.now() - parseInt(cacheTimestamp);
      const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

      if (age > ONE_YEAR) {
        const daysOld = Math.round(age / (24 * 60 * 60 * 1000));
        console.log(`[CACHE] Cache for ${username}@${serverUrl} is ${daysOld} days old - prompting user to refresh`);
        setCachePreloadReason('library-change');
        setNewContentCounts({ artists: 0, albums: 0, songs: 0 });
        setShowNewContentPrompt(true);
      } else {
        const daysRemaining = Math.round((ONE_YEAR - age) / (24 * 60 * 60 * 1000));
        console.log(`Cache for ${username}@${serverUrl} is fresh (${daysRemaining} days until next refresh)`);
      }
    };

    checkCacheAge();
  }, [isAuthenticated, username, serverUrl]);

  // Check for new content on server (every app launch)
  React.useEffect(() => {
    const checkForNewContent = async () => {
      if (!isAuthenticated || !username || !serverUrl) return;

      // Only check if cache exists (skip on first launch)
      const timestampKey = getCacheKey('cachePreloadTimestamp');
      const cacheTimestamp = localStorage.getItem(timestampKey);
      if (!cacheTimestamp) return;

      try {
        console.log('Checking server for new content...');
        
        const serverUrl = localStorage.getItem('serverUrl');
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');

        if (!serverUrl || !username || !password) return;

        // Get server counts
        const artistsResponse = await getArtists(serverUrl, username, password);
        let serverArtistCount = 0;
        const subsonicResponse = artistsResponse.data['subsonic-response'];
        if (subsonicResponse?.status === 'ok' && subsonicResponse.artists?.index) {
          subsonicResponse.artists.index.forEach((index: any) => {
            if (index.artist) serverArtistCount += index.artist.length;
          });
        }

        const songCountResponse = await getSongCount(serverUrl, username, password);
        const serverSongCount = songCountResponse; // getSongCount returns number directly

        // Compare against stored server counts from the previous launch (not cached index).
        // Comparing server vs index counts caused a rebuild loop because the two methods
        // count songs differently (getSongCount sums album metadata; index counts fetched songs).
        const countsKey = getCacheKey('lastKnownServerCounts');
        const stored: { artists: number; songs: number } | null =
          JSON.parse(localStorage.getItem(countsKey) || 'null');

        // Always refresh the baseline so next launch has current values to compare against
        localStorage.setItem(countsKey, JSON.stringify({ artists: serverArtistCount, songs: serverSongCount }));

        if (!stored) {
          // First check after a fresh preload — baseline just written, nothing to compare
          console.log('No server count baseline yet - storing current counts for next launch');
          return;
        }

        const artistDiff = serverArtistCount - stored.artists;
        const songDiff = serverSongCount - stored.songs;

        if (artistDiff !== 0 || songDiff !== 0) {
          console.log(`[NEW CONTENT] Library change detected! Artists: ${artistDiff > 0 ? '+' : ''}${artistDiff}, Songs: ${songDiff > 0 ? '+' : ''}${songDiff}`);
          setNewContentCounts({
            artists: artistDiff,
            albums: 0,
            songs: songDiff
          });
          setShowNewContentPrompt(true);
        } else {
          console.log('No library changes on server - cache is up to date');
        }
      } catch (error) {
        console.warn('Failed to check for new content:', error);
      }
    };

    // Check after a short delay to avoid blocking app startup
    const timeoutId = setTimeout(checkForNewContent, 3000);
    return () => clearTimeout(timeoutId);
  }, [isAuthenticated, username, serverUrl]);

  // Reset missing-songs check when user/mode changes
  React.useEffect(() => {
    setMissingChecked(false);
    setShowMissingBanner(false);
  }, [username, offlineModeEnabled]);

  // Check how many songs on server are not in the download cache
  React.useEffect(() => {
    if (offlineModeEnabled || !isAuthenticated || !cacheInitialized || missingChecked) return;

    const check = async () => {
      setMissingChecked(true);
      try {
        const serverUrlVal = localStorage.getItem('serverUrl') || '';
        const usernameVal = localStorage.getItem('username') || '';
        const passwordVal = localStorage.getItem('password') || '';
        const serverCount = await getSongCount(serverUrlVal, usernameVal, passwordVal);
        const cacheIndex = offlineCacheService.getCacheIndex();
        const cachedCount = Object.keys(cacheIndex?.songs || {}).length;
        const missing = serverCount - cachedCount;
        if (missing > 0 && cachedCount > 0) {
          // Only show banner when SOME songs are cached (permanent cache in use)
          setMissingSongsCount(missing);
          setShowMissingBanner(true);
        } else if (missing === 0 && cachedCount > 0) {
          setMissingSongsCount(0); // Signal: all downloaded
        }
      } catch {
        // non-critical
      }
    };

    // Small delay so it doesn't race with the new-content check
    const id = setTimeout(check, 5000);
    return () => clearTimeout(id);
  }, [offlineModeEnabled, isAuthenticated, cacheInitialized, missingChecked]);

  const handleDownloadMissing = useCallback(async () => {
    setIsQueueingMissing(true);
    try {
      const serverUrlVal = localStorage.getItem('serverUrl') || '';
      const usernameVal = localStorage.getItem('username') || '';
      const passwordVal = localStorage.getItem('password') || '';
      const allSongs = await getAllSongs(serverUrlVal, usernameVal, passwordVal);
      const albumGroups = new Map<string, { albumName: string; artistName: string; artistId?: string; songs: any[] }>();
      for (const song of allSongs) {
        if (offlineCacheService.isCached(song.id)) continue;
        const key = song.albumId || song.album;
        if (!albumGroups.has(key)) {
          albumGroups.set(key, { albumName: song.album, artistName: song.artist, artistId: song.artistId, songs: [] });
        }
        albumGroups.get(key)!.songs.push({
          id: song.id, title: song.title, artist: song.artist,
          album: song.album, duration: song.duration, coverArt: song.coverArt, albumId: song.albumId,
        });
      }
      for (const [albumId, group] of albumGroups) {
        if (group.songs.length > 0) {
          downloadManager.addAlbumToQueue({
            albumId, albumName: group.albumName, artistName: group.artistName,
            artistId: group.artistId, songs: group.songs, quality: downloadMissingQuality,
          });
        }
      }
      setShowMissingBanner(false);
      setShowDownloadManagerGlobal(true);
    } catch {
      // silently ignore
    } finally {
      setIsQueueingMissing(false);
    }
  }, [downloadMissingQuality]);

  // Reset navigation to artists list on logout
  React.useEffect(() => {
    const handleLogout = () => {
      console.log('Logout detected, resetting navigation to artists');
      setNavigation({ view: 'artists' });
      setShowOfflinePrompt(false);
      setShowCellularModePrompt(false);
      cellularPromptShownRef.current = false;
    };

    window.addEventListener('logout', handleLogout);
    return () => window.removeEventListener('logout', handleLogout);
  }, []);

  // Allow any component (e.g. HamburgerMenu on desktop) to open the remote picker
  React.useEffect(() => {
    const handler = () => setShowRemotePicker(true);
    window.addEventListener('xylonic-open-remote-picker', handler);
    return () => window.removeEventListener('xylonic-open-remote-picker', handler);
  }, []);

  // Check internet connectivity on app launch
  React.useEffect(() => {
    startupCompleteRef.current = false;
    const checkOnLaunch = async () => {
      if (!isAuthenticated) return;
      try {
        const online = await checkConnectivity();
        // Read from localStorage directly as a fallback — the OfflineModeContext
        // initCache effect is async and may not have updated React state yet.
        const isAlreadyOffline = offlineModeEnabled || localStorage.getItem('offlineMode') === 'true';
        if (!online && !isAlreadyOffline) {
          toggleOfflineMode();
          return;
        }
        if (online && isCellular && !isAlreadyOffline
            && config.autoOfflineOnCellular && hasCachedSongs()
            && !cellularPromptShownRef.current) {
          toggleOfflineMode();
          cellularPromptShownRef.current = true;
          setShowCellularModePrompt(true);
          setShowOfflinePrompt(false);
        }
      } finally {
        startupCompleteRef.current = true;
      }
    };

    checkOnLaunch();
  }, [isAuthenticated, cacheInitialized]); // eslint-disable-line react-hooks/exhaustive-deps

  // React when the browser fires the native offline event (clean disconnect).
  const prevOnlineRef = React.useRef(isOnline);
  React.useEffect(() => {
    const wasOnline = prevOnlineRef.current;
    prevOnlineRef.current = isOnline;
    if (!startupCompleteRef.current) return;
    if (wasOnline && !isOnline && isAuthenticated && !offlineModeEnabled && !isCellular) {
      setShowOfflinePrompt(true);
    }
  }, [isOnline, isAuthenticated, offlineModeEnabled, isCellular]);

  // React when any API call signals a network error (catches "limited connectivity"
  // where navigator.onLine stays true but fetches fail). checkConnectivity() will
  // update isOnline in the context, which the effect above then picks up.
  React.useEffect(() => {
    if (!isAuthenticated) return;
    const onConnErr = () => { checkConnectivity(); };
    window.addEventListener('app:connectivity-error', onConnErr);
    return () => window.removeEventListener('app:connectivity-error', onConnErr);
  }, [isAuthenticated, checkConnectivity]);

  // When offline mode activates while the user is on Home, redirect to Library
  // since DiscoverView requires a server connection.
  React.useEffect(() => {
    if (offlineModeEnabled && appSection === 'home') {
      setAppSection('library');
    }
  }, [offlineModeEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mid-session cellular switch: auto-switch to offline for returning users.
  React.useEffect(() => {
    if (!isAuthenticated || !isCellular) return;
    if (offlineModeEnabled) return;
    if (cellularPromptShownRef.current) return;
    if (!config.autoOfflineOnCellular || !hasCachedSongs()) return;
    toggleOfflineMode();
    cellularPromptShownRef.current = true;
    setShowCellularModePrompt(true);
    setShowOfflinePrompt(false);
  }, [isCellular, isAuthenticated, offlineModeEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnableOfflineMode = () => {
    toggleOfflineMode();
    setShowOfflinePrompt(false);
  };

  const handleDismissPrompt = () => {
    setShowOfflinePrompt(false);
  };

  const handleStayOfflineFromCellular = () => {
    setShowOfflinePrompt(false);
    setShowCellularModePrompt(false);
  };

  const handleGoOnlineFromCellular = () => {
    setShowOfflinePrompt(false);
    if (offlineModeEnabled) toggleOfflineMode();
    setShowCellularModePrompt(false);
    cellularPromptShownRef.current = true;
  };

  const handleRefreshCache = () => {
    console.log('User requested cache refresh for new content');
    setShowNewContentPrompt(false);
    setCachePreloadReason('library-change');
    setShowCachePreload(true);
  };

  const handleDismissNewContent = () => {
    setShowNewContentPrompt(false);
  };

  // Set callback to reset navigation when search is cleared
  React.useEffect(() => {
    setOnClearCallback(() => () => {
      setNavigation({ view: 'artists' });
    });
  }, [setOnClearCallback]);

  const handleTopViewChange = (view: TopLevelView) => {
    setTopView(view);
    setNavigation({ view: 'artists' }); // reset drill-down
    if (username) {
      localStorage.setItem(PREF_VIEW_KEY(username), view);
    }
  };

  const handleArtistClick = (artistId: string, artistName: string = 'Unknown Artist') => {
    setNavigation({ view: 'albums', artistId, artistName, sourceView: topView });
  };

  const handleAlbumClick = (albumId: string, albumName: string = 'Unknown Album') => {
    setNavigation(prev => ({
      ...prev,
      view: 'songs',
      albumId,
      albumName,
      sourceView: prev.sourceView ?? topView,
      // preserve sourceSection so back knows where to return all the way to
    }));
  };

  // For search results — switch to library section so the drill-down views render
  const handleSearchArtistClick = (artistId: string, artistName: string) => {
    setAppSection('library');
    handleArtistClick(artistId, artistName);
  };

  const handleSearchAlbumClick = (albumId: string, albumName: string, artistName: string) => {
    setAppSection('library');
    setNavigation(prev => ({
      ...prev,
      view: 'songs',
      albumId,
      albumName,
      artistName,
      sourceView: topView,
      sourceSection: undefined,
    }));
  };

  const handleBackToArtists = () => {
    if (navigatedFromSearch) {
      returnToSearch();
    } else if (navigation.sourceSection === 'home') {
      setAppSection('home');
      setNavigation({ view: 'artists' });
    } else {
      setNavigation({ view: 'artists' });
    }
  };

  const handleBackToAlbums = () => {
    if (navigatedFromSearch) {
      returnToSearch();
    } else if ((navigation.sourceView ?? topView) === 'artists' && navigation.artistId) {
      // Came through artist → album list → songs: go back to that artist's albums,
      // keeping sourceSection so the next back still returns to the right place.
      setNavigation({
        view: 'albums',
        artistId: navigation.artistId,
        artistName: navigation.artistName,
        sourceView: 'artists',
        sourceSection: navigation.sourceSection,
      });
    } else if (navigation.sourceSection === 'home') {
      // Came directly from Home (no artist step in between)
      setAppSection('home');
      setNavigation({ view: 'artists' });
    } else {
      // Came from a flat library view (allAlbums / allSongs)
      setNavigation({ view: 'artists' });
    }
  };

  // Render-body assignment — runs on every render so the ref always has the latest
  // closure over navigation, appSection, overlays, and nav functions.
  backHandlerRef.current = () => {
    if (showCachePreload) return;
    if (showNewContentPrompt) { setShowNewContentPrompt(false); return; }
    if (showOfflinePrompt)    { setShowOfflinePrompt(false);    return; }
    if (showCellularModePrompt) { setShowCellularModePrompt(false); return; }
    if (showRemotePicker)     { setShowRemotePicker(false);     return; }
    if (showDownloadManagerGlobal) { setShowDownloadManagerGlobal(false); return; }
    if (isSearching) { clearSearch(); return; }
    if (appSection === 'settings' || appSection === 'downloads') {
      const prev = sectionHistory[sectionHistory.length - 1] ?? 'home';
      setSectionHistory(h => h.slice(0, -1));
      setAppSection(prev);
      return;
    }
    if (navigation.view === 'songs')  { handleBackToAlbums();  return; }
    if (navigation.view === 'albums') { handleBackToArtists(); return; }
    NavBridge?.minimizeApp().catch(() => {});
  };

  const handleLogout = () => {
    logout();
    setNavigation({ view: 'artists' });
    setShowCellularModePrompt(false);
    cellularPromptShownRef.current = false;
  };

  return (
    <>
      <SplashScreen visible={isLoading} />
      {!isAuthenticated ? <LoginForm /> : <div className="app">
      {/* Cache Preload Dialog - First Launch Only */}
      {showCachePreload && (
        <CachePreloadDialog
          onComplete={handleCachePreloadComplete}
          onSkip={handleCachePreloadSkip}
          reason={cachePreloadReason}
          changeDetails={cachePreloadReason === 'library-change' ? newContentCounts : undefined}
        />
      )}

      {/* Offline Connectivity Prompt */}
      {showOfflinePrompt && (
        <div className="offline-prompt-overlay">
          <div className="offline-prompt">
            <div className="offline-prompt-icon">
              <i className="fas fa-exclamation-triangle"></i>
            </div>
            <h3>No Internet Connection</h3>
            <p>You appear to be offline. Would you like to enable Offline Mode to use cached songs?</p>
            <div className="offline-prompt-actions">
              <button className="prompt-btn dismiss" onClick={handleDismissPrompt}>
                Continue Online Mode
              </button>
              <button className="prompt-btn enable" onClick={handleEnableOfflineMode}>
                <i className="fas fa-plane"></i>
                Enable Offline Mode
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Data Prompt */}
      {showCellularModePrompt && (
        <div className="offline-prompt-overlay">
          <div className="offline-prompt">
            <div className="offline-prompt-icon">
              <i className="fas fa-signal"></i>
            </div>
            <h3>Mobile Data Detected</h3>
            <p>Offline mode has been enabled to protect your data. Your cached library is available without using any data.</p>
            <div className="offline-prompt-actions">
              <button className="prompt-btn dismiss" onClick={handleStayOfflineFromCellular}>
                Stay Offline
              </button>
              <button className="prompt-btn enable" onClick={handleGoOnlineFromCellular}>
                <i className="fas fa-wifi"></i>
                Go Online
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Content Detected Prompt */}
      {showNewContentPrompt && (
        <div className="offline-prompt-overlay">
          <div className="offline-prompt">
            <div className="offline-prompt-icon" style={{ color: 'var(--primary-color)' }}>
              <i className={`fas fa-${newContentCounts.artists < 0 || newContentCounts.songs < 0 ? 'minus' : 'sync-alt'}`}></i>
            </div>
            {newContentCounts.artists === 0 && newContentCounts.songs === 0 ? (
              <>
                <h3>Cache Is Outdated</h3>
                <p>Your local cache is over a year old. Rebuilding it will keep search results and images up to date.</p>
              </>
            ) : (
              <>
                <h3>Library Change Detected!</h3>
                <p>Your server library has changed since the cache was built:</p>
                <div style={{ margin: '15px 0', fontSize: '14px', textAlign: 'left' }}>
                  {newContentCounts.artists !== 0 && <div><strong>{newContentCounts.artists > 0 ? '+' : ''}{newContentCounts.artists}</strong> artists</div>}
                  {newContentCounts.songs !== 0 && <div><strong>{newContentCounts.songs > 0 ? '+' : ''}{newContentCounts.songs}</strong> songs</div>}
                </div>
              </>
            )}
            <p style={{ fontSize: '13px', color: '#888' }}>
              Rebuild the cache to keep search results accurate.
            </p>
            <div className="offline-prompt-actions">
              <button className="prompt-btn dismiss" onClick={handleDismissNewContent}>
                Later
              </button>
              <button className="prompt-btn enable" onClick={handleRefreshCache}>
                <i className="fas fa-sync-alt"></i>
                Rebuild Cache Now
              </button>
            </div>
          </div>
        </div>
      )}

      <NowPlayingOverlay />
      <RightPanel />
      <Header />


      {/* ── Missing songs banner ────────────────────────────────── */}
      {showMissingBanner && !offlineModeEnabled && (
        <div className="missing-songs-banner" role="status">
          <div className="missing-banner-left">
            <i className="fas fa-cloud-download-alt missing-banner-icon" />
            <div className="missing-banner-text">
              <span className="missing-banner-title">{missingSongsCount} song{missingSongsCount !== 1 ? 's' : ''} not downloaded</span>
              <span className="missing-banner-sub">Your library has songs not yet saved for offline use</span>
            </div>
          </div>
          <div className="missing-banner-actions">
            <DownloadQualityPicker
              value={downloadMissingQuality}
              onChange={setDownloadMissingQuality}
              onConfirm={handleDownloadMissing}
              confirmLabel={isQueueingMissing ? 'Queuing…' : 'Download Missing'}
              triggerClassName="missing-banner-download-btn"
              triggerContent={
                <>
                  <i className="fas fa-download" />
                  {isQueueingMissing ? 'Queuing…' : 'Download Missing'}
                  <i className="fas fa-chevron-down" style={{ fontSize: 10, opacity: 0.6 }} />
                </>
              }
            />
            <button className="missing-banner-dismiss" onClick={() => setShowMissingBanner(false)} title="Dismiss">
              <i className="fas fa-times" />
            </button>
          </div>
        </div>
      )}

      <div className="app-body">
        <AppNav
          current={appSection}
          onChange={section => {
            if (section === 'settings' || section === 'downloads') {
              setSectionHistory(h => [...h, appSection]);
            } else {
              setSectionHistory([]);
            }
            setAppSection(section);
            if (section === 'library') clearSearch();
          }}
          onLogout={handleLogout}
        />

        <div className="app-right">
        <main className="main-content">
          {isSearching ? (
            <SearchResults
              onArtistClick={handleSearchArtistClick}
              onAlbumClick={handleSearchAlbumClick}
            />
          ) : appSection === 'home' ? (
            <DiscoverView
              onAlbumClick={(albumId, albumName, artistName, artistId) => {
                setNavigation({ view: 'songs', albumId, albumName, artistId, artistName, sourceView: 'allAlbums', sourceSection: 'home' });
                setAppSection('library');
              }}
              onArtistClick={(artistId, artistName) => {
                setNavigation({ view: 'albums', artistId, artistName, sourceView: 'artists', sourceSection: 'home' });
                setAppSection('library');
              }}
            />
          ) : appSection === 'downloads' ? (
            <DownloadManagerWindow isOpen inline onClose={() => {
              const prev = sectionHistory[sectionHistory.length - 1] ?? 'home';
              setSectionHistory(h => h.slice(0, -1));
              setAppSection(prev);
            }} />
          ) : appSection === 'settings' ? (
            <SettingsView />
          ) : (
            <>
              {/* Drill-down: artist → albums */}
              {navigation.view === 'albums' && navigation.artistId && (
                <AlbumList
                  artistId={navigation.artistId}
                  artistName={navigation.artistName || 'Unknown Artist'}
                  onBack={handleBackToArtists}
                  onAlbumClick={handleAlbumClick}
                  fromSearch={navigatedFromSearch}
                />
              )}

              {/* Drill-down: album → songs */}
              {navigation.view === 'songs' && navigation.albumId && (
                <SongList
                  albumId={navigation.albumId}
                  albumName={navigation.albumName || 'Unknown Album'}
                  artistName={navigation.artistName || 'Unknown Artist'}
                  onBack={handleBackToAlbums}
                  fromSearch={navigatedFromSearch}
                  backLabel={
                    navigation.sourceSection === 'home' && navigation.sourceView !== 'artists' ? 'Back to Home' :
                    navigation.sourceSection === 'home' ? 'Back to Albums' :
                    navigation.sourceView === 'allAlbums' ? 'Back to Albums' :
                    navigation.sourceView === 'allSongs'  ? 'Back to All Songs' :
                    'Back to Albums'
                  }
                  onArtistClick={handleArtistClick}
                />
              )}

              {/* Top-level library views */}
              {navigation.view === 'artists' && topView === 'artists' && (
                <ArtistList
                  onArtistClick={handleArtistClick}
                  topView={topView}
                  onTopViewChange={handleTopViewChange}
                  missingSongsCount={missingChecked ? missingSongsCount : undefined}
                />
              )}
              {navigation.view === 'artists' && topView === 'allAlbums' && (
                <AllAlbumsGrid
                  onAlbumClick={(albumId, albumName, artistName, artistId) => {
                    setNavigation({ view: 'songs', albumId, albumName, artistId, artistName, sourceView: 'allAlbums' });
                  }}
                  onArtistClick={handleArtistClick}
                  topView={topView}
                  onTopViewChange={handleTopViewChange}
                  missingSongsCount={missingChecked ? missingSongsCount : undefined}
                />
              )}
              {navigation.view === 'artists' && topView === 'allSongs' && (
                <AllSongsGrid
                  onArtistClick={handleArtistClick}
                  onAlbumClick={(albumId, albumName, artistName) => {
                    setNavigation({ view: 'songs', albumId, albumName, artistName, sourceView: 'allSongs' });
                  }}
                  topView={topView}
                  onTopViewChange={handleTopViewChange}
                  missingSongsCount={missingChecked ? missingSongsCount : undefined}
                />
              )}
              {navigation.view === 'artists' && topView === 'likedSongs' && (
                <LikedSongsView topView={topView} onTopViewChange={handleTopViewChange} />
              )}
            </>
          )}
        </main>
        <PlaybackControls />
        <DesktopNowPlaying />
        </div>
      </div>
      {!isReleaseBuild && <RenderTimerHUD />}
      <MobileBottomNav
        appSection={appSection}
        isSearching={isSearching}
        onSectionChange={section => {
          if (section === 'settings' || section === 'downloads') {
            setSectionHistory(h => [...h, appSection]);
          } else {
            setSectionHistory([]);
          }
          setAppSection(section);
          clearSearch();
          if (section === 'library') setNavigation({ view: 'artists' });
        }}
        onSearch={() => activateSearch()}
        onRemote={() => setShowRemotePicker(true)}
        remoteActive={isRemoteMode}
        remoteEnabled={isRemoteModeAvailable && isOnWifi && availableDevices.length > 0}
      />
      {showRemotePicker && (
        <RemoteDevicePicker
          devices={availableDevices}
          activeTarget={remoteTarget}
          myDeviceId={remoteDeviceId}
          myAccountId={myAccountId}
          isOnWifi={isOnWifi}
          pairingError={pairingError}
          onSelect={async (dev) => {
            const ok = await connectToDevice(dev);
            if (ok) setShowRemotePicker(false);
          }}
          onDisconnect={async () => { await disconnectRemote(); setShowRemotePicker(false); }}
          onClose={() => setShowRemotePicker(false)}
          onClearError={clearPairingError}
        />
      )}
      <DownloadManagerWindow isOpen={showDownloadManagerGlobal} onClose={() => setShowDownloadManagerGlobal(false)} />
    </div>}
    </>
  );
};

function App() {
  // Check BEFORE any providers mount so the mini player window never initialises
  // AuthProvider, PlayerProvider, OfflineModeProvider etc. Those providers interact
  // with shared localStorage and can corrupt credentials for the main window.
  const isMiniPlayerWindow = new URLSearchParams(window.location.search).get('mini') === 'true';
  if (isMiniPlayerWindow) {
    return <MiniPlayer />;
  }

  return (
    <AuthProvider>
      <OfflineModeProvider>
        <PlayerProvider>
          <RemoteModeProvider>
            <ThemeProvider>
              <ImageCacheProvider>
                <UIProvider>
                  <SearchProvider>
                    <AppHooksMount />
                    <AppContent />
                  </SearchProvider>
                </UIProvider>
              </ImageCacheProvider>
            </ThemeProvider>
          </RemoteModeProvider>
        </PlayerProvider>
      </OfflineModeProvider>
    </AuthProvider>
  );
}

export default App;