import React, { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { OfflineModeProvider, useOfflineMode } from './context/OfflineModeContext';
import { PlayerProvider } from './context/PlayerContext';
import { ThemeProvider } from './context/ThemeContext';
import { SearchProvider, useSearch } from './context/SearchContext';
import { ImageCacheProvider } from './context/ImageCacheContext';
import { useAuth } from './context/AuthContext';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import LoginForm from './components/Auth/LoginForm';
import Header from './components/Layout/Header';
import ArtistList from './components/Library/ArtistList';
import AlbumList from './components/Library/AlbumList';
import SongList from './components/Library/SongList';
import PlaybackControls from './components/Player/PlaybackControls';
import MiniPlayer from './components/Player/MiniPlayer';
import SearchResults from './components/Library/SearchResults';
import { CachePreloadDialog } from './components/common/CachePreloadDialog';
import './styles/index.css';

type View = 'artists' | 'albums' | 'songs';

interface NavigationState {
  view: View;
  artistId?: string;
  artistName?: string;
  albumId?: string;
  albumName?: string;
}

const AppContent: React.FC = () => {
  const { isAuthenticated, logout, username, serverUrl } = useAuth();
  const { isSearching, navigatedFromSearch, returnToSearch, setOnClearCallback } = useSearch();
  const { isOnline, offlineModeEnabled, toggleOfflineMode, checkConnectivity } = useOfflineMode();
  const [navigation, setNavigation] = useState<NavigationState>({ view: 'artists' });
  const [showOfflinePrompt, setShowOfflinePrompt] = useState(false);
  const [showCachePreload, setShowCachePreload] = useState(false);
  const [showNewContentPrompt, setShowNewContentPrompt] = useState(false);
  const [newContentCounts, setNewContentCounts] = useState({ artists: 0, albums: 0, songs: 0 });

  // Helper function to generate user+server specific cache keys
  const getCacheKey = (key: string): string => {
    const user = username || localStorage.getItem('username') || 'unknown';
    const server = serverUrl || localStorage.getItem('serverUrl') || 'unknown';
    // Create a simple hash from server URL to keep key shorter
    const serverHash = server.split('').reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0);
    return `${key}_${user}_${Math.abs(serverHash)}`;
  };

  // Check if this is mini player mode
  const isMiniPlayer = new URLSearchParams(window.location.search).get('mini') === 'true';

  // Enable keyboard shortcuts
  useKeyboardShortcuts();

  // Check if this is first launch and show cache preload dialog
  React.useEffect(() => {
    if (isAuthenticated && !isMiniPlayer && (username || serverUrl)) {
      const cacheKey = getCacheKey('cachePreloaded');
      const hasPreCached = localStorage.getItem(cacheKey);
      if (!hasPreCached) {
        console.log(`First launch detected for ${username}@${serverUrl} - showing cache preload dialog`);
        setShowCachePreload(true);
      } else {
        console.log(`Cache already exists for ${username}@${serverUrl}`);
      }
    }
  }, [isAuthenticated, isMiniPlayer, username, serverUrl]);

  const handleCachePreloadComplete = () => {
    console.log(`Cache preload complete for ${username}@${serverUrl}`);
    const timestamp = Date.now();
    const cacheKey = getCacheKey('cachePreloaded');
    const timestampKey = getCacheKey('cachePreloadTimestamp');
    localStorage.setItem(cacheKey, 'true');
    localStorage.setItem(timestampKey, timestamp.toString());
    setShowCachePreload(false);
    
    // Auto-restart app after cache rebuild to ensure everything uses new cache
    console.log('Cache rebuilt successfully! Restarting app in 2 seconds...');
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  };

  const handleCachePreloadSkip = () => {
    console.log(`Cache preload skipped for ${username}@${serverUrl}`);
    const timestamp = Date.now();
    const cacheKey = getCacheKey('cachePreloaded');
    const timestampKey = getCacheKey('cachePreloadTimestamp');
    localStorage.setItem(cacheKey, 'true');
    localStorage.setItem(timestampKey, timestamp.toString());
    setShowCachePreload(false);
  };

  // Check cache age and auto-refresh if needed (6 days = 518400000 ms)
  React.useEffect(() => {
    const checkCacheAge = async () => {
      if (!isAuthenticated || isMiniPlayer || !username || !serverUrl) return;

      const timestampKey = getCacheKey('cachePreloadTimestamp');
      const cacheTimestamp = localStorage.getItem(timestampKey);
      if (!cacheTimestamp) return;

      const age = Date.now() - parseInt(cacheTimestamp);
      const SIX_DAYS = 6 * 24 * 60 * 60 * 1000; // 518400000 ms

      if (age > SIX_DAYS) {
        const daysOld = Math.round(age / (24 * 60 * 60 * 1000));
        console.log(`[CACHE] Cache for ${username}@${serverUrl} is ${daysOld} days old - triggering auto-refresh...`);
        
        // Trigger a refresh by showing the pre-cache dialog
        setShowCachePreload(true);
      } else {
        const daysRemaining = Math.round((SIX_DAYS - age) / (24 * 60 * 60 * 1000));
        console.log(`Cache for ${username}@${serverUrl} is fresh (${daysRemaining} days until next refresh)`);
      }
    };

    checkCacheAge();
  }, [isAuthenticated, isMiniPlayer, username, serverUrl]);

  // Check for new content on server (every app launch)
  React.useEffect(() => {
    const checkForNewContent = async () => {
      if (!isAuthenticated || isMiniPlayer || !username || !serverUrl) return;

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

        // Get current counts from server
        const { getArtists, getSongCount } = await import('./services/subsonicApi');
        const { searchCacheService } = await import('./services/searchCacheService');
        
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

        // Get cached counts
        const cachedIndex = searchCacheService.getSearchIndex();
        if (!cachedIndex) return;

        const cachedArtistCount = cachedIndex.artists.length;
        const cachedSongCount = cachedIndex.songs.length;

        // Compare counts
        const artistDiff = serverArtistCount - cachedArtistCount;
        const songDiff = serverSongCount - cachedSongCount;

        if (artistDiff > 0 || songDiff > 0) {
          console.log(`[NEW CONTENT] New content detected! Artists: +${artistDiff}, Songs: +${songDiff}`);
          setNewContentCounts({ 
            artists: artistDiff > 0 ? artistDiff : 0, 
            albums: 0, // We don't have an easy album count API
            songs: songDiff > 0 ? songDiff : 0 
          });
          setShowNewContentPrompt(true);
        } else {
          console.log('No new content on server - cache is up to date');
        }
      } catch (error) {
        console.warn('Failed to check for new content:', error);
      }
    };

    // Check after a short delay to avoid blocking app startup
    const timeoutId = setTimeout(checkForNewContent, 3000);
    return () => clearTimeout(timeoutId);
  }, [isAuthenticated, isMiniPlayer, username, serverUrl]);

  // Reset navigation to artists list on logout
  React.useEffect(() => {
    const handleLogout = () => {
      console.log('Logout detected, resetting navigation to artists');
      setNavigation({ view: 'artists' });
      setShowOfflinePrompt(false);
    };

    window.addEventListener('logout', handleLogout);
    return () => window.removeEventListener('logout', handleLogout);
  }, []);

  // Check internet connectivity on app launch
  React.useEffect(() => {
    const checkOnLaunch = async () => {
      if (isAuthenticated && !isMiniPlayer) {
        const online = await checkConnectivity();
        
        // If offline and offline mode is not enabled, prompt user
        if (!online && !offlineModeEnabled) {
          setShowOfflinePrompt(true);
        }
      }
    };

    checkOnLaunch();
  }, [isAuthenticated, isMiniPlayer]); // Only run on mount when authenticated

  const handleEnableOfflineMode = () => {
    toggleOfflineMode();
    setShowOfflinePrompt(false);
  };

  const handleDismissPrompt = () => {
    setShowOfflinePrompt(false);
  };

  const handleRefreshCache = () => {
    console.log('User requested cache refresh for new content');
    setShowNewContentPrompt(false);
    // Trigger cache rebuild by showing pre-cache dialog
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

  const handleArtistClick = (artistId: string, artistName: string = 'Unknown Artist') => {
    setNavigation({ view: 'albums', artistId, artistName });
  };

  const handleAlbumClick = (albumId: string, albumName: string = 'Unknown Album') => {
    setNavigation({ 
      ...navigation, 
      view: 'songs', 
      albumId, 
      albumName 
    });
  };

  // For search results - wrap with default names and preserve context
  const handleSearchArtistClick = (artistId: string) => {
    handleArtistClick(artistId, 'Artist');
  };

  const handleSearchAlbumClick = (albumId: string) => {
    // When clicking album from search, we need to set the full navigation state
    setNavigation({
      view: 'songs',
      artistId: undefined, // Don't know artist from search
      artistName: 'Unknown Artist',
      albumId,
      albumName: 'Album'
    });
  };

  const handleBackToArtists = () => {
    if (navigatedFromSearch) {
      returnToSearch();
    } else {
      setNavigation({ view: 'artists' });
    }
  };

  const handleBackToAlbums = () => {
    if (navigatedFromSearch) {
      returnToSearch();
    } else {
      setNavigation({ 
        view: 'albums', 
        artistId: navigation.artistId, 
        artistName: navigation.artistName 
      });
    }
  };

  const handleLogout = () => {
    logout();
    setNavigation({ view: 'artists' });
  };

  // Mini player doesn't need authentication - render it directly
  if (isMiniPlayer) {
    return <MiniPlayer />;
  }

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return (
    <div className="app">
      {/* Cache Preload Dialog - First Launch Only */}
      {showCachePreload && (
        <CachePreloadDialog 
          onComplete={handleCachePreloadComplete}
          onSkip={handleCachePreloadSkip}
        />
      )}

      {/* Offline Connectivity Prompt */}
      {showOfflinePrompt && (
        <div className="offline-prompt-overlay">
          <div className="offline-prompt">
            <div className="offline-prompt-icon">
              <i className="fas fa-wifi-slash"></i>
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

      {/* New Content Detected Prompt */}
      {showNewContentPrompt && (
        <div className="offline-prompt-overlay">
          <div className="offline-prompt">
            <div className="offline-prompt-icon" style={{ color: '#1db954' }}>
              <i className="fas fa-plus-circle"></i>
            </div>
            <h3>New Content Detected!</h3>
            <p>
              Your server has new content that's not in your cache yet:
            </p>
            <div style={{ margin: '15px 0', fontSize: '14px', textAlign: 'left' }}>
              {newContentCounts.artists > 0 && <div><strong>+{newContentCounts.artists}</strong> new artists</div>}
              {newContentCounts.songs > 0 && <div><strong>+{newContentCounts.songs}</strong> new songs</div>}
            </div>
            <p style={{ fontSize: '13px', color: '#888' }}>
              Refresh the cache to search and access the new content.
            </p>
            <div className="offline-prompt-actions">
              <button className="prompt-btn dismiss" onClick={handleDismissNewContent}>
                Later
              </button>
              <button className="prompt-btn enable" onClick={handleRefreshCache} style={{ background: '#1db954' }}>
                <i className="fas fa-sync-alt"></i>
                Refresh Cache Now
              </button>
            </div>
          </div>
        </div>
      )}

      <Header onLogout={handleLogout} />
      <main className="main-content">
        {isSearching ? (
          <SearchResults 
            onArtistClick={handleSearchArtistClick}
            onAlbumClick={handleSearchAlbumClick}
          />
        ) : (
          <>
            {navigation.view === 'artists' && (
              <ArtistList onArtistClick={handleArtistClick} />
            )}
            {navigation.view === 'albums' && navigation.artistId && (
              <AlbumList
                artistId={navigation.artistId}
                artistName={navigation.artistName || 'Unknown Artist'}
                onBack={handleBackToArtists}
                onAlbumClick={handleAlbumClick}
                fromSearch={navigatedFromSearch}
              />
            )}
            {navigation.view === 'songs' && navigation.albumId && (
              <SongList
                albumId={navigation.albumId}
                albumName={navigation.albumName || 'Unknown Album'}
                artistName={navigation.artistName || 'Unknown Artist'}
                onBack={handleBackToAlbums}
                fromSearch={navigatedFromSearch}
              />
            )}
          </>
        )}
      </main>
      <PlaybackControls />
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <OfflineModeProvider>
        <PlayerProvider>
          <ThemeProvider>
            <ImageCacheProvider>
              <SearchProvider>
                <AppContent />
              </SearchProvider>
            </ImageCacheProvider>
          </ThemeProvider>
        </PlayerProvider>
      </OfflineModeProvider>
    </AuthProvider>
  );
}

export default App;