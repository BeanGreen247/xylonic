import React, { useEffect, useState, useCallback, useRef } from 'react';
import { getAllAlbumsPaginated, getAllSongs, getStreamUrl, getCoverArtUrl } from '../../services/subsonicApi';
import { metadataCache } from '../../services/metadataCache';
import { usePlayback } from '../../hooks/usePlayback';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { offlineCacheService } from '../../services/offlineCacheService';
import { downloadManager } from '../../services/downloadManagerService';
import { CachedSongMetadata, DownloadQuality } from '../../types/offline';
import { Song } from '../../types';
import { logger } from '../../utils/logger';
import { getDefaultDownloadQuality } from '../../utils/settingsManager';
import AlbumArt from '../common/AlbumArt';
import LibraryViewToggle, { TopLevelView } from './LibraryViewToggle';
import Pagination from '../common/Pagination';
import DownloadQualityPicker from './DownloadQualityPicker';
import DownloadManagerWindow from './DownloadManagerWindow';

const PAGE_SIZE = 50;

interface Album {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  year?: number;
}

interface AllAlbumsGridProps {
  onAlbumClick: (albumId: string, albumName: string, artistName: string, artistId?: string) => void;
  onArtistClick?: (artistId: string, artistName: string) => void;
  topView?: TopLevelView;
  onTopViewChange?: (view: TopLevelView) => void;
  missingSongsCount?: number;
}

const AllAlbumsGrid: React.FC<AllAlbumsGridProps> = ({ onAlbumClick, onArtistClick, topView = 'allAlbums', onTopViewChange, missingSongsCount }) => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalEstimated, setTotalEstimated] = useState(0);
  const [isShufflingAll, setIsShufflingAll] = useState(false);
  const [shuffleError, setShuffleError] = useState<string | null>(null);
  const [confirmShuffle, setConfirmShuffle] = useState(false);
  const confirmShuffleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { offlineModeEnabled, toggleOfflineMode, cacheInitialized } = useOfflineMode();
  const { playPlaylist, toggleShuffle, shuffle, currentSong } = usePlayback();
  const [bulkDownloadQuality, setBulkDownloadQuality] = useState<DownloadQuality>(getDefaultDownloadQuality);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [showDownloadManager, setShowDownloadManager] = useState(false);

  const cachedCount = cacheInitialized
    ? Object.keys(offlineCacheService.getCacheIndex()?.songs || {}).length
    : 0;
  const downloadBtnState: 'download-all' | 'download-missing' | 'hidden' =
    (missingSongsCount === 0 && cachedCount > 0) ? 'hidden' :
    cachedCount > 0 ? 'download-missing' :
    'download-all';

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
    setShuffleError(null);
    try {
      let songs: Song[];

      if (offlineModeEnabled) {
        const cacheIndex = offlineCacheService.getCacheIndex();
        if (!cacheIndex || Object.keys(cacheIndex.songs || {}).length === 0) {
          throw new Error('No cached songs available');
        }
        songs = Object.values(cacheIndex.songs as Record<string, CachedSongMetadata>).map(metadata => ({
          id: metadata.songId,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          url: '',
          duration: metadata.duration,
          coverArt: metadata.coverArtId,
        }));
      } else {
        const serverUrl = localStorage.getItem('serverUrl') || '';
        const username = localStorage.getItem('username') || '';
        const password = localStorage.getItem('password') || '';
        const rawSongs = await getAllSongs(serverUrl, username, password);
        songs = rawSongs.map((song: any) => ({
          id: song.id,
          title: song.title,
          artist: song.artist,
          album: song.album,
          url: getStreamUrl(serverUrl, username, password, song.id),
          duration: song.duration,
          coverArt: song.coverArt ? getCoverArtUrl(serverUrl, username, password, song.coverArt, 300) : undefined,
          bitRate: song.bitRate,
          suffix: song.suffix,
          size: song.size,
          samplingRate: song.samplingRate,
          channelCount: song.channelCount,
          bitDepth: song.bitDepth,
        }));
      }

      if (!shuffle) toggleShuffle();
      const randomIndex = Math.floor(Math.random() * songs.length);
      playPlaylist(songs, randomIndex);
    } catch (err) {
      logger.error('Failed to shuffle albums:', err);
      setShuffleError('Could not load songs for shuffle');
      setTimeout(() => setShuffleError(null), 4000);
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

  const loadAlbums = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (offlineModeEnabled) {
        if (!cacheInitialized) return;
        const cacheIndex = offlineCacheService.getCacheIndex();
        if (!cacheIndex || Object.keys(cacheIndex.songs || {}).length === 0) {
          setError('No cached songs available. Please download some songs first.');
          setLoading(false);
          return;
        }
        const albumMap = new Map<string, Album>();
        Object.values((cacheIndex.songs || {}) as Record<string, CachedSongMetadata>).forEach(m => {
          if (!albumMap.has(m.albumId)) {
            albumMap.set(m.albumId, {
              id: m.albumId,
              name: m.album,
              artist: m.artist,
              coverArt: m.coverArtId,
              songCount: 0,
            });
          }
          albumMap.get(m.albumId)!.songCount! += 1;
        });
        const all = Array.from(albumMap.values())
          .sort((a, b) => a.artist.localeCompare(b.artist) || a.name.localeCompare(b.name));
        setTotalEstimated(all.length);
        setAlbums(all);
        setLoading(false);
        return;
      }

      const serverUrl = localStorage.getItem('serverUrl') || '';
      const username = localStorage.getItem('username') || '';
      const password = localStorage.getItem('password') || '';

      const pageCacheKey = `albumsPage_${serverUrl}_${currentPage}`;
      const cachedPage = metadataCache.get<Album[]>(pageCacheKey);
      let data: Album[];
      if (cachedPage) {
        data = cachedPage;
      } else {
        const offset = (currentPage - 1) * PAGE_SIZE;
        data = await getAllAlbumsPaginated(serverUrl, username, password, offset, PAGE_SIZE);
        metadataCache.set(pageCacheKey, data);
      }
      setAlbums(data);
      // If we got a full page, there may be more
      if (data.length === PAGE_SIZE) {
        setTotalEstimated((currentPage * PAGE_SIZE) + 1);
      } else {
        setTotalEstimated((currentPage - 1) * PAGE_SIZE + data.length);
      }
    } catch (err) {
      setError((err as Error).message || 'Failed to load albums');
    } finally {
      setLoading(false);
    }
  }, [currentPage, offlineModeEnabled, cacheInitialized]);

  useEffect(() => {
    loadAlbums();
  }, [loadAlbums]);

  const totalPages = offlineModeEnabled
    ? Math.ceil(albums.length / PAGE_SIZE)
    : Math.ceil(totalEstimated / PAGE_SIZE);

  const displayedAlbums = offlineModeEnabled
    ? albums.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
    : albums;

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = startIndex + displayedAlbums.length;

  const handlePageClick = (page: number) => {
    setCurrentPage(page);
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="loading">
        <i className="fas fa-spinner"></i>
        <span>Loading albums...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-message" style={{ padding: '40px', textAlign: 'center' }}>
        <i className="fas fa-exclamation-circle" style={{ fontSize: '48px', color: '#ff3b30', marginBottom: '16px' }}></i>
        <h3>Error Loading Albums</h3>
        <p>{error}</p>
        {offlineModeEnabled ? (
          <button onClick={toggleOfflineMode} className="test-button" style={{ marginTop: '20px' }}>
            <i className="fas fa-cloud"></i> Switch to Online Mode
          </button>
        ) : (
          <button onClick={loadAlbums} className="test-button" style={{ marginTop: '20px' }}>
            <i className="fas fa-redo"></i> Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="album-list">
      <div className="library-header">
        {onTopViewChange ? (
          <LibraryViewToggle currentView={topView} onChange={onTopViewChange} />
        ) : (
          <h2 className="library-title">
            <i className="fas fa-compact-disc"></i>
            All Albums
          </h2>
        )}
        <div className="library-header-right">
          <div className="library-stats">
            <i className="fas fa-compact-disc"></i>
            <span>
              {offlineModeEnabled
                ? `${albums.length} cached albums`
                : `${startIndex + 1}–${endIndex} of ${totalEstimated}+`}
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

      {shuffleError && (
        <div style={{ padding: '8px 16px', margin: '0 0 8px', background: 'rgba(255,59,48,0.15)', borderRadius: '8px', color: '#ff3b30', fontSize: '14px' }}>
          <i className="fas fa-exclamation-circle" style={{ marginRight: '8px' }} />
          {shuffleError}
        </div>
      )}

      {displayedAlbums.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <i className="fas fa-compact-disc" style={{ fontSize: '48px', marginBottom: '16px' }}></i>
          <h3>No Albums Found</h3>
        </div>
      ) : (
        <>
          <div className="albums-grid">
            {displayedAlbums.map(album => (
              <div
                key={album.id}
                className="album-card"
                onClick={() => onAlbumClick(album.id, album.name, album.artist, album.artistId)}
              >
                <div className="album-cover">
                  <AlbumArt coverArtId={album.coverArt} albumId={album.id} alt={album.name} size={300} artist={album.artist} album={album.name} />
                </div>
                <div className="album-name">{album.name}</div>
                <div className="album-artist" style={{ textAlign: 'center' }}>
                  {album.year && `${album.year} · `}
                  {album.artist}
                </div>
              </div>
            ))}
          </div>

          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageClick} />
        </>
      )}
      <DownloadManagerWindow isOpen={showDownloadManager} onClose={() => setShowDownloadManager(false)} />
    </div>
  );
};

export default AllAlbumsGrid;
