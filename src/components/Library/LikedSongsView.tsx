import React, { useEffect, useState, useCallback, useRef } from 'react';
import { getStarred, getStreamUrl } from '../../services/subsonicApi';
import { toggleLike } from '../../services/likedSongsService';
import { usePlayback } from '../../hooks/usePlayback';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { offlineCacheService } from '../../services/offlineCacheService';
import { CachedSongMetadata } from '../../types/offline';
import { Song as PlayerSong } from '../../types';
import AlbumArt from '../common/AlbumArt';
import LibraryViewToggle, { TopLevelView } from './LibraryViewToggle';
import Pagination from '../common/Pagination';
import { imageCacheService } from '../../services/imageCacheService';
import { logger } from '../../utils/logger';
import SongContextMenu, { ContextMenuSong } from '../common/SongContextMenu';
import AddToPlaylistDialog from '../common/AddToPlaylistDialog';
import { downloadManager } from '../../services/downloadManagerService';

interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  coverArt?: string;
  duration?: number;
}

interface LikedSongsViewProps {
  topView?: TopLevelView;
  onTopViewChange?: (view: TopLevelView) => void;
}

const PAGE_SIZE = 100;

const LikedSongsView: React.FC<LikedSongsViewProps> = ({ topView = 'likedSongs', onTopViewChange }) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isShuffling, setIsShuffling] = useState(false);
  const [confirmShuffle, setConfirmShuffle] = useState(false);
  const confirmShuffleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [unlikingId, setUnlikingId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const { playPlaylist, currentSong, isPlaying, toggleShuffle, shuffle, addToQueue, insertNext, bitrate } = usePlayback();
  const { offlineModeEnabled, cacheInitialized } = useOfflineMode();
  const [contextMenu, setContextMenu] = useState<{ song: ContextMenuSong; x: number; y: number } | null>(null);
  const [playlistDialogSong, setPlaylistDialogSong] = useState<ContextMenuSong | null>(null);

  const loadSongs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const serverUrl = localStorage.getItem('serverUrl') || '';
      const username = localStorage.getItem('username') || '';
      const password = localStorage.getItem('password') || '';

      if (offlineModeEnabled) {
        if (!cacheInitialized) return;
        const likedIds = offlineCacheService.getLikedSongs();
        logger.log(`[LikedSongsView] offline mode — ${likedIds.length} liked IDs in cache`);
        const cacheIndex = offlineCacheService.getCacheIndex();
        const cachedSongs = cacheIndex?.songs as Record<string, CachedSongMetadata> | undefined;
        const cachedCount = Object.keys(cachedSongs || {}).length;
        logger.log(`[LikedSongsView] audio cache has ${cachedCount} songs`);

        const fromCache: Song[] = likedIds
          .flatMap(id => {
            const m = cachedSongs?.[id];
            if (!m) return [];
            return [{
              id: m.songId,
              title: m.title,
              artist: m.artist,
              album: m.album,
              albumId: m.albumId,
              coverArt: m.coverArtId,
              duration: m.duration,
            }];
          });

        logger.log(`[LikedSongsView] matched ${fromCache.length} cached songs`);
        setSongs(fromCache);
        return;
      }

      logger.log('[LikedSongsView] fetching starred songs from server...');
      const response = await getStarred(serverUrl, username, password);
      const subsonicResponse = response.data['subsonic-response'];
      logger.log(`[LikedSongsView] response status: ${subsonicResponse?.status}`);
      const starred = subsonicResponse?.starred2;
      const raw: any[] = starred?.song || [];
      raw.sort((a, b) => new Date(b.starred || 0).getTime() - new Date(a.starred || 0).getTime());
      logger.log(`[LikedSongsView] starred2.song count: ${raw.length}`);
      const mapped = raw.map(s => ({
        id: s.id,
        title: s.title,
        artist: s.artist,
        album: s.album,
        albumId: s.albumId,
        coverArt: s.coverArt,
        duration: s.duration,
      }));
      // Pre-warm the memory cache so AlbumArt renders with blob URLs immediately
      const coverArtIds = mapped.map(s => s.coverArt).filter((id): id is string => !!id);
      await imageCacheService.prewarmBatch(coverArtIds);
      setSongs(mapped);
    } catch (err) {
      logger.error(`[LikedSongsView] error loading: ${(err as Error).message}`);
      setError((err as Error).message || 'Failed to load liked songs');
    } finally {
      setLoading(false);
    }
  }, [offlineModeEnabled, cacheInitialized]);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  // Reload when another device changes liked songs (cross-device periodic sync)
  useEffect(() => {
    const handler = () => loadSongs();
    window.addEventListener('likedSongsUpdated', handler);
    return () => window.removeEventListener('likedSongsUpdated', handler);
  }, [loadSongs]);

  const buildPlaylist = (): PlayerSong[] => {
    const serverUrl = localStorage.getItem('serverUrl') || '';
    const username = localStorage.getItem('username') || '';
    const password = localStorage.getItem('password') || '';
    return songs.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      url: offlineModeEnabled ? '' : getStreamUrl(serverUrl, username, password, s.id),
      duration: s.duration,
      coverArt: s.coverArt,
    }));
  };

  const handlePageClick = (page: number) => {
    setCurrentPage(page);
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePlaySong = (pageIndex: number) => {
    playPlaylist(buildPlaylist(), (currentPage - 1) * PAGE_SIZE + pageIndex);
  };

  const handleShuffleAll = async () => {
    if (songs.length === 0) return;
    if (currentSong && !confirmShuffle) {
      setConfirmShuffle(true);
      if (confirmShuffleTimerRef.current) clearTimeout(confirmShuffleTimerRef.current);
      confirmShuffleTimerRef.current = setTimeout(() => setConfirmShuffle(false), 3000);
      return;
    }
    if (confirmShuffleTimerRef.current) { clearTimeout(confirmShuffleTimerRef.current); confirmShuffleTimerRef.current = null; }
    setConfirmShuffle(false);
    setIsShuffling(true);
    try {
      const playlist = buildPlaylist();
      if (!shuffle) toggleShuffle();
      playPlaylist(playlist, Math.floor(Math.random() * playlist.length));
    } finally {
      setIsShuffling(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, song: Song) => {
    e.preventDefault();
    e.stopPropagation();
    const serverUrl = localStorage.getItem('serverUrl') || '';
    const username  = localStorage.getItem('username')  || '';
    const password  = localStorage.getItem('password')  || '';
    setContextMenu({
      song: { id: song.id, title: song.title, artist: song.artist, album: song.album, albumId: song.albumId, url: getStreamUrl(serverUrl, username, password, song.id, bitrate ?? undefined), duration: song.duration, coverArt: song.coverArt },
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleUnlike = async (e: React.MouseEvent, song: Song) => {
    e.stopPropagation();
    setUnlikingId(song.id);
    try {
      await toggleLike({ id: song.id, title: song.title, artist: song.artist, album: song.album });
      setSongs(prev => {
        const next = prev.filter(s => s.id !== song.id);
        const newTotalPages = Math.ceil(next.length / PAGE_SIZE);
        setCurrentPage(p => Math.min(p, Math.max(1, newTotalPages)));
        return next;
      });
    } finally {
      setUnlikingId(null);
    }
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="loading">
        <i className="fas fa-spinner" />
        <span>Loading liked songs...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-message" style={{ padding: '40px', textAlign: 'center' }}>
        <i className="fas fa-exclamation-circle" style={{ fontSize: '48px', color: '#ff3b30', marginBottom: '16px' }} />
        <h3>Error Loading Liked Songs</h3>
        <p>{error}</p>
        <button onClick={loadSongs} className="test-button" style={{ marginTop: '20px' }}>
          <i className="fas fa-redo" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="library-header">
        {onTopViewChange ? (
          <LibraryViewToggle currentView={topView} onChange={onTopViewChange} />
        ) : (
          <h2 className="library-title">Liked Songs</h2>
        )}
        <div className="library-header-right">
          <div className="library-stats">
            <i className="fas fa-heart" />
            <span>{songs.length} song{songs.length !== 1 ? 's' : ''}</span>
          </div>
          {songs.length > 0 && (
            <button
              className={`shuffle-all-button${confirmShuffle ? ' confirming' : ''}`}
              onClick={handleShuffleAll}
              disabled={isShuffling}
            >
              <i className={isShuffling ? 'fas fa-spinner fa-spin' : confirmShuffle ? 'fas fa-exclamation-triangle' : 'fas fa-random'} />
              {isShuffling ? 'Loading...' : confirmShuffle ? 'Confirm?' : 'Shuffle All'}
            </button>
          )}
        </div>
      </div>

      {songs.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <i className="fas fa-heart" style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.4 }} />
          <h3>No Liked Songs</h3>
          <p>Star songs on your server to see them here.</p>
        </div>
      ) : (() => {
        const totalPages = Math.ceil(songs.length / PAGE_SIZE);
        const displayedSongs = songs.length > PAGE_SIZE
          ? songs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
          : songs;
        return (
          <>
            <div className="songs-list">
              {displayedSongs.map((song, index) => (
                <div
                  key={song.id}
                  className={`song-item all-songs-item ${currentSong?.id === song.id ? 'active' : ''}`}
                  onClick={() => handlePlaySong(index)}
                  onContextMenu={e => handleContextMenu(e, song)}
                >
                  <div className="all-songs-art">
                    <AlbumArt
                      coverArtId={song.coverArt}
                      albumId={song.albumId}
                      alt={song.album}
                      size={48}
                      className="all-songs-thumbnail"
                      artist={song.artist}
                      album={song.album}
                    />
                    <div className="song-art-overlay">
                      {currentSong?.id === song.id && isPlaying ? (
                        <>
                          <div className="equalizer-bars song-art-eq" aria-label="Now playing"><span /><span /><span /></div>
                          <i className="fas fa-pause song-art-icon" />
                        </>
                      ) : (
                        <i className="fas fa-play song-art-icon" />
                      )}
                    </div>
                  </div>

                  <div className="song-info">
                    <div className="song-title">{song.title}</div>
                    <div className="song-artist">
                      {song.artist}
                      {song.album && <span className="all-songs-album"> · {song.album}</span>}
                    </div>
                  </div>

                  <div className="song-meta">
                    <span className="song-duration">{formatDuration(song.duration)}</span>
                  </div>

                  <button
                    className="song-item-action-btn"
                    title="Unlike"
                    disabled={unlikingId === song.id}
                    onClick={e => handleUnlike(e, song)}
                    style={{ color: 'var(--primary-color)', marginRight: '8px' }}
                  >
                    <i className={unlikingId === song.id ? 'fas fa-spinner' : 'fas fa-heart'} />
                  </button>
                </div>
              ))}
            </div>

            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageClick} />
          </>
        );
      })()}
      {contextMenu && (
        <SongContextMenu
          song={contextMenu.song}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPlayNow={() => { handlePlaySong(songs.findIndex(s => s.id === contextMenu.song.id) % PAGE_SIZE); setContextMenu(null); }}
          onPlayNext={() => { insertNext(contextMenu.song); setContextMenu(null); }}
          onAddToQueue={() => { addToQueue(contextMenu.song); setContextMenu(null); }}
          onAddToPlaylist={() => { setPlaylistDialogSong(contextMenu.song); setContextMenu(null); }}
          onDownload={() => {
            const s = contextMenu.song;
            downloadManager.addSongToQueue(
              { id: s.id, title: s.title, artist: s.artist, album: s.album, duration: s.duration, coverArt: s.coverArt, albumId: s.albumId },
              s.albumId ?? s.id, s.album, s.artist, '320',
            );
            setContextMenu(null);
          }}
        />
      )}
      {playlistDialogSong && (
        <AddToPlaylistDialog song={playlistDialogSong} onClose={() => setPlaylistDialogSong(null)} />
      )}
    </div>
  );
};

export default LikedSongsView;
