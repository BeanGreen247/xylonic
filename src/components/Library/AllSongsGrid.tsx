import React, { useEffect, useState, useCallback, useRef } from 'react';
import { searchSongsPaginated, getStreamUrl, getAllSongs } from '../../services/subsonicApi';
import { usePlayback } from '../../hooks/usePlayback';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { offlineCacheService } from '../../services/offlineCacheService';
import { downloadManager } from '../../services/downloadManagerService';
import { CachedSongMetadata, DownloadQuality } from '../../types/offline';
import { getDefaultDownloadQuality } from '../../utils/settingsManager';
import { Song as PlayerSong } from '../../types';
import AlbumArt from '../common/AlbumArt';
import LibraryViewToggle, { TopLevelView } from './LibraryViewToggle';
import Pagination from '../common/Pagination';
import { imageCacheService } from '../../services/imageCacheService';
import DownloadQualityPicker from './DownloadQualityPicker';
import DownloadManagerWindow from './DownloadManagerWindow';
import SongContextMenu, { ContextMenuSong } from '../common/SongContextMenu';
import AddToPlaylistDialog from '../common/AddToPlaylistDialog';

const PAGE_SIZE = 50;

interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  coverArt?: string;
  duration?: number;
}

interface AllSongsGridProps {
  onArtistClick?: (artistId: string, artistName: string) => void;
  onAlbumClick?: (albumId: string, albumName: string, artistName: string) => void;
  topView?: TopLevelView;
  onTopViewChange?: (view: TopLevelView) => void;
  missingSongsCount?: number;
}

const AllSongsGrid: React.FC<AllSongsGridProps> = ({ onArtistClick, onAlbumClick, topView = 'allSongs', onTopViewChange, missingSongsCount }) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isShufflingAll, setIsShufflingAll] = useState(false);
  const [confirmShuffle, setConfirmShuffle] = useState(false);
  const confirmShuffleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bulkDownloadQuality, setBulkDownloadQuality] = useState<DownloadQuality>(getDefaultDownloadQuality);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [showDownloadManager, setShowDownloadManager] = useState(false);
  const { playPlaylist, currentSong, isPlaying, toggleShuffle, shuffle, addToQueue, insertNext, bitrate } = usePlayback();
  const [contextMenu, setContextMenu] = useState<{ song: ContextMenuSong; x: number; y: number } | null>(null);
  const [playlistDialogSong, setPlaylistDialogSong] = useState<ContextMenuSong | null>(null);
  const { offlineModeEnabled, toggleOfflineMode, cacheInitialized } = useOfflineMode();

  const cachedCount = cacheInitialized
    ? Object.keys(offlineCacheService.getCacheIndex()?.songs || {}).length
    : 0;
  const downloadBtnState: 'download-all' | 'download-missing' | 'hidden' =
    (missingSongsCount === 0 && cachedCount > 0) ? 'hidden' :
    cachedCount > 0 ? 'download-missing' :
    'download-all';

  const loadSongs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (offlineModeEnabled) {
        if (!cacheInitialized) return;
        const cacheIndex = offlineCacheService.getCacheIndex();
        if (!cacheIndex || Object.keys(cacheIndex.songs || {}).length === 0) {
          setError('No cached songs available.');
          setLoading(false);
          return;
        }
        const all = Object.values((cacheIndex.songs || {}) as Record<string, CachedSongMetadata>)
          .map(m => ({
            id: m.songId,
            title: m.title,
            artist: m.artist,
            album: m.album,
            albumId: m.albumId,
            coverArt: m.coverArtId,
            duration: m.duration,
          }))
          .sort((a, b) => a.title.localeCompare(b.title));
        const offlineCoverArtIds = all.map(s => s.coverArt).filter((id): id is string => !!id);
        await imageCacheService.prewarmBatch(offlineCoverArtIds);
        setSongs(all);
        setHasMore(false);
        setLoading(false);
        return;
      }

      const serverUrl = localStorage.getItem('serverUrl') || '';
      const username = localStorage.getItem('username') || '';
      const password = localStorage.getItem('password') || '';

      const offset = (currentPage - 1) * PAGE_SIZE;
      const data = await searchSongsPaginated(serverUrl, username, password, '', offset, PAGE_SIZE);
      const coverArtIds = data.map((s: any) => s.coverArt).filter((id: any): id is string => !!id);
      await imageCacheService.prewarmBatch(coverArtIds);
      setSongs(data);
      setHasMore(data.length === PAGE_SIZE);
    } catch (err) {
      setError((err as Error).message || 'Failed to load songs');
    } finally {
      setLoading(false);
    }
  }, [currentPage, offlineModeEnabled, cacheInitialized]);

  useEffect(() => {
    loadSongs();
  }, [loadSongs]);

  const handleShuffleAll = async () => {
    if (currentSong && !confirmShuffle) {
      setConfirmShuffle(true);
      if (confirmShuffleTimerRef.current) clearTimeout(confirmShuffleTimerRef.current);
      confirmShuffleTimerRef.current = setTimeout(() => setConfirmShuffle(false), 3000);
      return;
    }
    if (confirmShuffleTimerRef.current) { clearTimeout(confirmShuffleTimerRef.current); confirmShuffleTimerRef.current = null; }
    setConfirmShuffle(false);
    setIsShufflingAll(true);
    try {
      const serverUrl = localStorage.getItem('serverUrl') || '';
      const username = localStorage.getItem('username') || '';
      const password = localStorage.getItem('password') || '';

      if (offlineModeEnabled) {
        const cacheIndex = offlineCacheService.getCacheIndex();
        const all = Object.values((cacheIndex?.songs || {}) as Record<string, CachedSongMetadata>).map(m => ({
          id: m.songId,
          title: m.title,
          artist: m.artist,
          album: m.album,
          url: '',
          duration: m.duration,
          coverArt: m.coverArtId,
        }));
        if (!shuffle) toggleShuffle();
        playPlaylist(all, Math.floor(Math.random() * all.length));
      } else {
        const rawSongs = await getAllSongs(serverUrl, username, password);
        const playlist: PlayerSong[] = rawSongs.map((s: any) => ({
          id: s.id,
          title: s.title,
          artist: s.artist,
          album: s.album,
          url: getStreamUrl(serverUrl, username, password, s.id),
          duration: s.duration,
          coverArt: s.coverArt,
          bitRate: s.bitRate,
          suffix: s.suffix,
          size: s.size,
          samplingRate: s.samplingRate,
          channelCount: s.channelCount,
        }));
        if (!shuffle) toggleShuffle();
        playPlaylist(playlist, Math.floor(Math.random() * playlist.length));
      }
    } catch (err) {
      console.error('Shuffle all failed:', err);
    } finally {
      setIsShufflingAll(false);
    }
  };

  const handleConfirmDownloadAll = async () => {
    setIsBulkDownloading(true);
    try {
      const serverUrl = localStorage.getItem('serverUrl') || '';
      const username = localStorage.getItem('username') || '';
      const password = localStorage.getItem('password') || '';
      const allSongs = await getAllSongs(serverUrl, username, password);
      const albumGroups = new Map<string, { albumName: string; artistName: string; artistId?: string; songs: any[] }>();
      for (const song of allSongs) {
        if (offlineCacheService.isCached(song.id)) continue;
        const key = song.albumId || song.album;
        if (!albumGroups.has(key)) {
          albumGroups.set(key, { albumName: song.album, artistName: song.artist, artistId: song.artistId, songs: [] });
        }
        albumGroups.get(key)!.songs.push({ id: song.id, title: song.title, artist: song.artist, album: song.album, duration: song.duration, coverArt: song.coverArt, albumId: song.albumId });
      }
      for (const [albumId, group] of albumGroups) {
        downloadManager.addAlbumToQueue({ albumId, albumName: group.albumName, artistName: group.artistName, artistId: group.artistId, songs: group.songs, quality: bulkDownloadQuality });
      }
      setShowDownloadManager(true);
    } catch (err) {
      console.error('Download all failed:', err);
    } finally {
      setIsBulkDownloading(false);
    }
  };

  const handlePlaySong = (index: number) => {
    const serverUrl = localStorage.getItem('serverUrl') || '';
    const username = localStorage.getItem('username') || '';
    const password = localStorage.getItem('password') || '';

    const playlist = songs.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      album: s.album,
      url: offlineModeEnabled ? '' : getStreamUrl(serverUrl, username, password, s.id),
      duration: s.duration,
      coverArt: s.coverArt,
      bitRate: (s as any).bitRate,
      suffix: (s as any).suffix,
      size: (s as any).size,
      samplingRate: (s as any).samplingRate,
      channelCount: (s as any).channelCount,
    }));
    playPlaylist(playlist, index);
  };

  const formatDuration = (seconds?: number) => {
    if (!seconds) return '--:--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const buildSongUrl = (songId: string) => {
    const serverUrl = localStorage.getItem('serverUrl') || '';
    const username  = localStorage.getItem('username')  || '';
    const password  = localStorage.getItem('password')  || '';
    return getStreamUrl(serverUrl, username, password, songId, bitrate ?? undefined);
  };

  const handleContextMenu = (e: React.MouseEvent, song: Song) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      song: { id: song.id, title: song.title, artist: song.artist, album: song.album, albumId: song.albumId, url: buildSongUrl(song.id), duration: song.duration, coverArt: song.coverArt },
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handlePageClick = (page: number) => {
    setCurrentPage(page);
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const displayedSongs = offlineModeEnabled
    ? songs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : songs;

  const totalPages = offlineModeEnabled ? Math.ceil(songs.length / PAGE_SIZE) : 0;

  if (loading) {
    return (
      <div className="loading">
        <i className="fas fa-spinner"></i>
        <span>Loading songs...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-message" style={{ padding: '40px', textAlign: 'center' }}>
        <i className="fas fa-exclamation-circle" style={{ fontSize: '48px', color: '#ff3b30', marginBottom: '16px' }}></i>
        <h3>Error Loading Songs</h3>
        <p>{error}</p>
        {offlineModeEnabled ? (
          <button onClick={toggleOfflineMode} className="test-button" style={{ marginTop: '20px' }}>
            <i className="fas fa-cloud"></i> Switch to Online Mode
          </button>
        ) : (
          <button onClick={loadSongs} className="test-button" style={{ marginTop: '20px' }}>
            <i className="fas fa-redo"></i> Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="library-header">
        {onTopViewChange ? (
          <LibraryViewToggle currentView={topView} onChange={onTopViewChange} />
        ) : (
          <h2 className="library-title">
            <i className="fas fa-music"></i>
            All Songs
          </h2>
        )}
        <div className="library-header-right">
          <div className="library-stats">
            <i className="fas fa-music"></i>
            <span>
              {offlineModeEnabled
                ? `${songs.length} cached songs`
                : `${(currentPage - 1) * PAGE_SIZE + 1}–${(currentPage - 1) * PAGE_SIZE + displayedSongs.length}`}
            </span>
          </div>
          <button
            className={`shuffle-all-button${confirmShuffle ? ' confirming' : ''}`}
            onClick={handleShuffleAll}
            disabled={isShufflingAll || loading}
          >
            <i className={isShufflingAll ? 'fas fa-spinner fa-spin' : confirmShuffle ? 'fas fa-exclamation-triangle' : 'fas fa-random'} />
            {isShufflingAll ? 'Loading...' : confirmShuffle ? 'Confirm?' : 'Shuffle All'}
          </button>
          {!offlineModeEnabled && downloadBtnState !== 'hidden' && (
            <DownloadQualityPicker
              value={bulkDownloadQuality}
              onChange={setBulkDownloadQuality}
              onConfirm={handleConfirmDownloadAll}
              confirmLabel={isBulkDownloading ? 'Queuing…' : downloadBtnState === 'download-missing' ? 'Download Missing' : 'Download All'}
              triggerClassName="shuffle-all-button"
              triggerContent={<><i className={isBulkDownloading ? 'fas fa-spinner fa-spin' : 'fas fa-download'} />{isBulkDownloading ? 'Queuing…' : downloadBtnState === 'download-missing' ? 'Download Missing' : 'Download All'}</>}
              disabled={isBulkDownloading}
            />
          )}
        </div>
      </div>

      {displayedSongs.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <i className="fas fa-music" style={{ fontSize: '48px', marginBottom: '16px' }}></i>
          <h3>No Songs Found</h3>
        </div>
      ) : (
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
              </div>
            ))}
          </div>

          <Pagination
            currentPage={currentPage}
            totalPages={offlineModeEnabled ? totalPages : 0}
            hasMore={hasMore}
            onPageChange={handlePageClick}
          />
        </>
      )}
      <DownloadManagerWindow isOpen={showDownloadManager} onClose={() => setShowDownloadManager(false)} />
      {contextMenu && (
        <SongContextMenu
          song={contextMenu.song}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPlayNow={() => { handlePlaySong(songs.findIndex(s => s.id === contextMenu.song.id)); setContextMenu(null); }}
          onPlayNext={() => { insertNext(contextMenu.song); setContextMenu(null); }}
          onAddToQueue={() => { addToQueue(contextMenu.song); setContextMenu(null); }}
          onAddToPlaylist={() => { setPlaylistDialogSong(contextMenu.song); setContextMenu(null); }}
          onDownload={() => {
            const s = contextMenu.song;
            downloadManager.addSongToQueue(
              { id: s.id, title: s.title, artist: s.artist, album: s.album, duration: s.duration, coverArt: s.coverArt, albumId: s.albumId },
              s.albumId ?? s.id, s.album, s.artist, bulkDownloadQuality,
            );
            setShowDownloadManager(true);
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

export default AllSongsGrid;
