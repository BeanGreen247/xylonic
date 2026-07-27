import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useOfflineMode } from '../context/OfflineModeContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { getSongCount, getAllSongs } from '../services/subsonicApi';
import { searchCacheService } from '../services/searchCacheService';
import { offlineCacheService } from '../services/offlineCacheService';
import { downloadManager } from '../services/downloadManagerService';
import { DownloadQuality } from '../types/offline';
import { getDefaultDownloadQuality } from '../utils/settingsManager';
import LoginForm from './Auth/LoginForm';
import Header from './Layout/Header';
import ArtistList from './Library/ArtistList';
import AlbumList from './Library/AlbumList';
import SongList from './Library/SongList';
import AllAlbumsGrid from './Library/AllAlbumsGrid';
import AllSongsGrid from './Library/AllSongsGrid';
import LikedSongsView from './Library/LikedSongsView';
import LibraryViewToggle, { TopLevelView } from './Library/LibraryViewToggle';
import DownloadQualityPicker from './Library/DownloadQualityPicker';
import DownloadManagerWindow from './Library/DownloadManagerWindow';
import PlaybackControls from './Player/PlaybackControls';

type DrillView = 'artistAlbums' | 'songList';

const PREF_KEY = (username: string) => `xylonic_library_view_${username}`;

const MainApp: React.FC = () => {
  const { isAuthenticated, logout, username } = useAuth();
  const { offlineModeEnabled, toggleOfflineMode, cacheInitialized } = useOfflineMode();

  const [topView, setTopView] = useState<TopLevelView>('artists');
  const [drillView, setDrillView] = useState<DrillView | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<{ id: string; name: string } | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<{ id: string; name: string; artistName: string } | null>(null);

  // Missing songs detection
  const [missingSongsCount, setMissingSongsCount] = useState(0);
  const [showMissingBanner, setShowMissingBanner] = useState(false);
  const [missingChecked, setMissingChecked] = useState(false);
  const [downloadMissingQuality, setDownloadMissingQuality] = useState<DownloadQuality>(getDefaultDownloadQuality);
  const [isQueueingMissing, setIsQueueingMissing] = useState(false);
  const [showDownloadManager, setShowDownloadManager] = useState(false);

  useKeyboardShortcuts();

  // Load preferred view for current user
  useEffect(() => {
    if (!username) return;
    const saved = localStorage.getItem(PREF_KEY(username)) as TopLevelView | null;
    if (saved && ['artists', 'allAlbums', 'allSongs', 'likedSongs'].includes(saved)) {
      setTopView(saved);
    }
  }, [username]);

  // Reset missing-songs check when user changes or goes offline
  useEffect(() => {
    setMissingChecked(false);
    setShowMissingBanner(false);
  }, [username, offlineModeEnabled]);

  // Resume persisted download queue after auth + cache are ready.
  // Reconcile orphaned songs first — these are songs downloaded natively in a
  // previous session whose songDownloaded events were lost to a renderer crash.
  useEffect(() => {
    if (isAuthenticated && cacheInitialized) {
      downloadManager.reconcileOrphans()
        .catch(e => console.warn('[MainApp] reconcileOrphans error:', e))
        .finally(() => downloadManager.tryResumeQueue());
    }
  }, [isAuthenticated, cacheInitialized]);

  // Check for missing songs once: online + authenticated + cache ready
  useEffect(() => {
    if (offlineModeEnabled || !isAuthenticated || !cacheInitialized || missingChecked) return;

    const check = async () => {
      setMissingChecked(true);
      try {
        const serverUrl = localStorage.getItem('serverUrl') || '';
        const user = localStorage.getItem('username') || '';
        const pass = localStorage.getItem('password') || '';
        const searchIdx = searchCacheService.getSearchIndex();
        const serverCount = searchIdx ? searchIdx.songs.length : await getSongCount(serverUrl, user, pass);
        const cacheIndex = offlineCacheService.getCacheIndex();
        const cachedCount = Object.keys(cacheIndex?.songs || {}).length;
        const missing = serverCount - cachedCount;
        if (missing > 0) {
          setMissingSongsCount(missing);
          setShowMissingBanner(true);
        }
      } catch {
        // non-critical — silently ignore
      }
    };

    check();
  }, [offlineModeEnabled, isAuthenticated, cacheInitialized, missingChecked]);

  const handleDownloadMissing = useCallback(async () => {
    setIsQueueingMissing(true);
    try {
      const serverUrl = localStorage.getItem('serverUrl') || '';
      const user = localStorage.getItem('username') || '';
      const pass = localStorage.getItem('password') || '';

      const allSongs = await getAllSongs(serverUrl, user, pass);
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
      setShowDownloadManager(true);
    } catch {
      // silently ignore
    } finally {
      setIsQueueingMissing(false);
    }
  }, [downloadMissingQuality]);

  const handleTopViewChange = (view: TopLevelView) => {
    setTopView(view);
    setDrillView(null);
    setSelectedArtist(null);
    setSelectedAlbum(null);
    if (username) localStorage.setItem(PREF_KEY(username), view);
  };

  const handleArtistClick = (artistId: string, artistName: string) => {
    setSelectedArtist({ id: artistId, name: artistName });
    setDrillView('artistAlbums');
  };

  const handleAlbumClick = (albumId: string, albumName: string, artistName: string, artistId?: string) => {
    if (artistId && !selectedArtist) setSelectedArtist({ id: artistId, name: artistName });
    setSelectedAlbum({ id: albumId, name: albumName, artistName });
    setDrillView('songList');
  };

  const handleBackToTopView = () => {
    setDrillView(null);
    setSelectedArtist(null);
    setSelectedAlbum(null);
  };

  const handleBackToArtistAlbums = () => {
    setDrillView('artistAlbums');
    setSelectedAlbum(null);
  };

  const handleLogout = () => {
    logout();
    setTopView('artists');
    setDrillView(null);
    setSelectedArtist(null);
    setSelectedAlbum(null);
  };

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  const showToggle = drillView === null;

  return (
    <div className="app">
      <Header />

      {/* ── Offline mode banner ─────────────────────────────────── */}
      {offlineModeEnabled && (
        <div className="offline-mode-banner" role="status" aria-live="polite">
          <div className="offline-banner-left">
            <i className="fas fa-ban offline-banner-icon" />
            <div className="offline-banner-text">
              <span className="offline-banner-title">Offline Mode</span>
              <span className="offline-banner-sub">No internet connections will be made</span>
            </div>
          </div>
          <button className="offline-banner-go-online" onClick={toggleOfflineMode} title="Switch to online mode">
            <i className="fas fa-wifi" />
            Go Online
          </button>
        </div>
      )}

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

      <main className="main-content">
        {showToggle && (
          <div style={{ marginBottom: '24px' }}>
            <LibraryViewToggle currentView={topView} onChange={handleTopViewChange} />
          </div>
        )}

        {/* Drill-down views */}
        {drillView === 'artistAlbums' && selectedArtist && (
          <AlbumList
            artistId={selectedArtist.id}
            artistName={selectedArtist.name}
            onBack={handleBackToTopView}
            onAlbumClick={(albumId, albumName) =>
              handleAlbumClick(albumId, albumName, selectedArtist.name, selectedArtist.id)
            }
          />
        )}
        {drillView === 'songList' && selectedAlbum && (
          <SongList
            albumId={selectedAlbum.id}
            albumName={selectedAlbum.name}
            artistName={selectedAlbum.artistName}
            onBack={selectedArtist ? handleBackToArtistAlbums : handleBackToTopView}
            onArtistClick={handleArtistClick}
          />
        )}

        {/* Top-level views */}
        {drillView === null && topView === 'artists' && (
          <ArtistList onArtistClick={handleArtistClick} />
        )}
        {drillView === null && topView === 'allAlbums' && (
          <AllAlbumsGrid
            onAlbumClick={handleAlbumClick}
            onArtistClick={handleArtistClick}
          />
        )}
        {drillView === null && topView === 'allSongs' && (
          <AllSongsGrid
            onArtistClick={handleArtistClick}
            onAlbumClick={(albumId, albumName, artistName) =>
              handleAlbumClick(albumId, albumName, artistName)
            }
          />
        )}
        {drillView === null && topView === 'likedSongs' && (
          <LikedSongsView />
        )}
      </main>

      <PlaybackControls />
      <DownloadManagerWindow isOpen={showDownloadManager} onClose={() => setShowDownloadManager(false)} />
    </div>
  );
};

export default MainApp;
