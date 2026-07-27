import React, { useEffect, useMemo, useState } from 'react';
import { getArtist, getAlbum, getCoverArtUrl } from '../../services/subsonicApi';
import { metadataCache } from '../../services/metadataCache';
import { usePlayback } from '../../hooks/usePlayback';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { offlineCacheService } from '../../services/offlineCacheService';
import { downloadManager } from '../../services/downloadManagerService';
import { logger } from '../../utils/logger';
import { Song } from '../../types';
import { CachedSongMetadata, DownloadQuality } from '../../types/offline';
import { getDefaultDownloadQuality } from '../../utils/settingsManager';
import AlbumArt from '../common/AlbumArt';
import Pagination from '../common/Pagination';
import { imageCacheService } from '../../services/imageCacheService';
import { useImageCache } from '../../context/ImageCacheContext';
import DownloadQualityPicker from './DownloadQualityPicker';
import DownloadManagerWindow from './DownloadManagerWindow';
import './AlbumList.css';

interface Album {
  id: string;
  name: string;
  artist: string;
  year?: number;
  songCount?: number;
  duration?: number;
  coverArt?: string;
}

interface AlbumListProps {
  artistId: string;
  artistName: string;
  onBack: () => void;
  onAlbumClick?: (albumId: string, albumName: string) => void;
  fromSearch?: boolean;
}

const AlbumList: React.FC<AlbumListProps> = ({ artistId, artistName, onBack, onAlbumClick, fromSearch = false }) => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [filteredAlbums, setFilteredAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const albumsPerPage = 50; // Show 50 albums per page
  const { playPlaylist, toggleShuffle, shuffle } = usePlayback();
  const { offlineModeEnabled, toggleOfflineMode } = useOfflineMode();
  const { isInitialized: imageCacheReady } = useImageCache();
  const [bulkDownloadQuality, setBulkDownloadQuality] = useState<DownloadQuality>(getDefaultDownloadQuality);
  const [isBulkDownloading, setIsBulkDownloading] = useState(false);
  const [showDownloadManager, setShowDownloadManager] = useState(false);
  const [artistCoverArtId, setArtistCoverArtId] = useState<string | undefined>(undefined);

  useEffect(() => {
    loadAlbums();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId, offlineModeEnabled]);


  // Filter albums based on offline mode
  useEffect(() => {
    filterAlbumsByOfflineMode();
    setCurrentPage(1); // Reset to first page when albums change
  }, [albums, offlineModeEnabled]);

  const filterAlbumsByOfflineMode = () => {
    if (offlineModeEnabled) {
      // When offline, albums are already loaded from cache only
      // No additional filtering needed
      setFilteredAlbums(albums);
      logger.log('[AlbumList] Offline mode: showing all', albums.length, 'cached albums');
    } else {
      // Online mode, show all albums
      setFilteredAlbums(albums);
    }
  };

  const loadAlbums = async () => {
    try {
      setError(null);
      setLoading(true);
      
      // Check if we have a cached artist ID (from offline mode) but are now online
      const isCachedArtistId = artistId.startsWith('cached-');
      
      if (isCachedArtistId && !offlineModeEnabled) {
        // Switched from offline to online with a cached artist ID
        // Automatically navigate back to artist list
        logger.log('[AlbumList] Cached artist ID detected in online mode, navigating back');
        setLoading(false);
        onBack();
        return;
      }
      
      // If offline mode, load from cache only
      if (offlineModeEnabled) {
        logger.log('[AlbumList] Offline mode: loading albums from cache');
        const cacheIndex = offlineCacheService.getCacheIndex();
        
        if (!cacheIndex || Object.keys(cacheIndex.songs || {}).length === 0) {
          setError('No cached songs available. Please download some songs first before using offline mode.');
          setLoading(false);
          return;
        }
        
        // Build album list from cached songs for this artist
        const albumMap = new Map<string, Album>();
        
        // Helper function to extract main artist name (before separators like •, -, feat., etc.)
        const getMainArtist = (artistName: string): string => {
          const separators = [', ', ' • ', ' - ', ' feat.', ' feat ', ' ft.', ' ft ', ' with ', ' & '];
          let mainArtist = artistName;
          for (const sep of separators) {
            const index = artistName.indexOf(sep);
            if (index > 0) {
              mainArtist = artistName.substring(0, index);
              break;
            }
          }
          return mainArtist.trim();
        };
        
        Object.values((cacheIndex?.songs || {}) as Record<string, CachedSongMetadata>)
          .filter(metadata => getMainArtist(metadata.artist) === artistName)
          .forEach(metadata => {
            if (!albumMap.has(metadata.albumId)) {
              albumMap.set(metadata.albumId, {
                id: metadata.albumId,
                name: metadata.album,
                artist: metadata.artist,
                coverArt: metadata.coverArtId,
                songCount: 0
              });
            }
            const album = albumMap.get(metadata.albumId)!;
            album.songCount = (album.songCount || 0) + 1;
          });
        
        setAlbums(Array.from(albumMap.values()));
        setLoading(false);
        return;
      }
      
      const serverUrl = localStorage.getItem('serverUrl');
      const username = localStorage.getItem('username');
      const password = localStorage.getItem('password');
      
      if (!serverUrl || !username || !password) {
        setError('Missing server credentials. Please log in again.');
        setLoading(false);
        return;
      }

      const artistCacheKey = `artist_${artistId}`;
      const cachedArtist = metadataCache.get<{ albums: Album[]; coverArt?: string }>(artistCacheKey);
      if (cachedArtist) {
        setAlbums(cachedArtist.albums);
        if (cachedArtist.coverArt) setArtistCoverArtId(cachedArtist.coverArt);
        setLoading(false);
        return;
      }

      console.log('Fetching albums for artist:', artistId);

      const response = await getArtist(serverUrl, username, password, artistId);
      const subsonicResponse = response.data['subsonic-response'];

      if (subsonicResponse?.status === 'failed') {
        setError(subsonicResponse.error?.message || 'Failed to fetch albums');
        setLoading(false);
        return;
      }

      const albumsList: Album[] = subsonicResponse?.artist?.album || [];
      const coverArt: string | undefined = subsonicResponse?.artist?.coverArt;
      metadataCache.set(artistCacheKey, { albums: albumsList, coverArt });
      setAlbums(albumsList);
      if (coverArt) setArtistCoverArtId(coverArt);

      console.log(`Loaded ${albumsList.length} albums`);
    } catch (error) {
      console.error('Failed to load albums', error);
      setError((error as Error).message || 'Failed to load albums');
    } finally {
      setLoading(false);
    }
  };

  const handleAlbumClick = (album: Album) => {
    if (onAlbumClick) {
      onAlbumClick(album.id, album.name);
    }
  };

  // ── Hooks that must be declared unconditionally (Rules of Hooks) ──────────
  // Pagination — computed before early returns so useEffect below can reference
  // paginatedAlbums on every render (even while loading, filteredAlbums is []).
  const totalPages = Math.ceil(filteredAlbums.length / albumsPerPage);
  const startIndex = (currentPage - 1) * albumsPerPage;
  const endIndex = Math.min(startIndex + albumsPerPage, filteredAlbums.length);
  const paginatedAlbums = filteredAlbums.slice(startIndex, endIndex);

  // O(songs) once, not on every render
  const cachedSongsForArtist = useMemo(() => {
    const cacheIndex = offlineCacheService.getCacheIndex();
    if (!cacheIndex) return 0;
    return (Object.values(cacheIndex.songs || {}) as CachedSongMetadata[]).filter(s => {
      const mainArtist = s.artist.split(' • ')[0].split(' - ')[0];
      return mainArtist.includes(artistName) || artistName.includes(mainArtist);
    }).length;
  }, [artistName, filteredAlbums]);

  // Batch-warm IDB images into memory before rendering the current page
  useEffect(() => {
    if (!imageCacheReady) return;
    const ids = paginatedAlbums.map(a => a.coverArt).filter(Boolean) as string[];
    if (ids.length > 0) imageCacheService.prewarmBatch(ids);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginatedAlbums, imageCacheReady]);
  // ─────────────────────────────────────────────────────────────────────────

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
        {offlineModeEnabled && error.includes('No cached songs') ? (
          <button
            onClick={toggleOfflineMode}
            className="test-button"
            style={{ marginTop: '20px' }}
          >
            <i className="fas fa-cloud"></i>
            Switch to Online Mode
          </button>
        ) : (
          <button onClick={loadAlbums} className="test-button" style={{ marginTop: '20px' }}>
            <i className="fas fa-redo"></i>
            Retry
          </button>
        )}
      </div>
    );
  }

  const serverUrl = localStorage.getItem('serverUrl') || '';
  const username = localStorage.getItem('username') || '';
  const password = localStorage.getItem('password') || '';
  const totalSongs = filteredAlbums.reduce((sum, album) => sum + (album.songCount || 0), 0);

  const downloadBtnState: 'download-all' | 'download-missing' | 'hidden' =
    (cachedSongsForArtist > 0 && cachedSongsForArtist >= totalSongs) ? 'hidden' :
    cachedSongsForArtist > 0 ? 'download-missing' :
    'download-all';

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePageClick = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleConfirmDownloadAll = async () => {
    setIsBulkDownloading(true);
    try {
      const serverUrl = localStorage.getItem('serverUrl') || '';
      const username = localStorage.getItem('username') || '';
      const password = localStorage.getItem('password') || '';
      for (const album of filteredAlbums) {
        const albumResponse = await getAlbum(serverUrl, username, password, album.id);
        const albumData = albumResponse.data['subsonic-response']?.album;
        const songs = (albumData?.song || [])
          .filter((song: any) => !offlineCacheService.isCached(song.id))
          .map((song: any) => ({
            id: song.id,
            title: song.title,
            artist: song.artist || artistName,
            album: song.album || album.name,
            duration: song.duration,
            coverArt: song.coverArt,
            albumId: album.id,
          }));
        if (songs.length > 0) {
          downloadManager.addAlbumToQueue({ albumId: album.id, albumName: album.name, artistName, artistId, artistCoverArtId, songs, quality: bulkDownloadQuality });
        }
      }
      setShowDownloadManager(true);
    } catch (err) {
      logger.error('Download artist failed:', err);
    } finally {
      setIsBulkDownloading(false);
    }
  };

  return (
    <div className="album-list">
      <div className="library-header">
        <button className="back-button" onClick={onBack}>
          <i className="fas fa-arrow-left"></i>
          {fromSearch ? 'Back to Search Results' : 'Back to Artists'}
        </button>
        <h2 className="library-title">
          <i className="fas fa-compact-disc"></i>
          {artistName}
        </h2>
        <div className="library-header-right">
          <div className="library-stats">
            <i className="fas fa-compact-disc"></i>
            <span>{filteredAlbums.length} {offlineModeEnabled ? 'cached ' : ''}albums</span>
          </div>
          {filteredAlbums.length > albumsPerPage && (
            <div className="library-stats stat-secondary">
              <span>Showing {startIndex + 1}-{endIndex} of {filteredAlbums.length}</span>
            </div>
          )}
          <div className="library-stats stat-secondary">
            <i className="fas fa-music"></i>
            <span>{totalSongs} songs</span>
          </div>
          {cachedSongsForArtist > 0 && (
            <div className="library-stats stat-secondary" style={{ color: 'var(--primary-color)' }}>
              <i className="fas fa-download"></i>
              <span>{cachedSongsForArtist} cached</span>
            </div>
          )}
          {!offlineModeEnabled && downloadBtnState !== 'hidden' && (
            <DownloadQualityPicker
              value={bulkDownloadQuality}
              onChange={setBulkDownloadQuality}
              onConfirm={handleConfirmDownloadAll}
              confirmLabel={isBulkDownloading ? 'Queuing…' : downloadBtnState === 'download-missing' ? 'Download Missing' : 'Download Artist'}
              triggerClassName="shuffle-all-button"
              triggerContent={<><i className={isBulkDownloading ? 'fas fa-spinner fa-spin' : 'fas fa-download'} />{isBulkDownloading ? 'Queuing…' : downloadBtnState === 'download-missing' ? 'Download Missing' : 'Download Artist'}</>}
              disabled={isBulkDownloading}
            />
          )}
        </div>
      </div>

      {filteredAlbums.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <i className="fas fa-compact-disc" style={{ fontSize: '48px', marginBottom: '16px' }}></i>
          <h3>{offlineModeEnabled ? 'No Cached Albums' : 'No Albums Found'}</h3>
          <p>{offlineModeEnabled ? 'Download some songs from this artist to listen offline.' : 'This artist has no albums.'}</p>
        </div>
      ) : (
        <>
          <div className="albums-grid">
            {paginatedAlbums.map((album) => {
            // Check if album is fully cached
            const albumCacheIndex = offlineCacheService.getCacheIndex();
            const albumSongs = albumCacheIndex ? (Object.values(albumCacheIndex.songs || {}) as CachedSongMetadata[])
              .filter(s => s.albumId === album.id) : [];
            const isAlbumFullyCached = album.songCount ? albumSongs.length >= album.songCount : albumSongs.length > 0;
            const isCoverArtCached = album.coverArt ? offlineCacheService.isCoverArtCached(album.coverArt) : false;
            
            return (
              <div 
                className="album-card" 
                key={album.id}
                onClick={() => handleAlbumClick(album)}
              >
                <div className="album-cover" style={{ position: 'relative' }}>
                  <AlbumArt coverArtId={album.coverArt} albumId={album.id} alt={album.name} size={300} artist={album.artist} album={album.name} />
                  {isAlbumFullyCached && (
                    <div 
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        background: 'rgba(0, 0, 0, 0.7)',
                        borderRadius: '50%',
                        width: '28px',
                        height: '28px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      title="Album cached"
                    >
                      <i className="fas fa-circle-check" style={{ color: 'var(--primary-color)', fontSize: '16px' }}></i>
                    </div>
                  )}
                  {isCoverArtCached && (
                    <div 
                      style={{
                        position: 'absolute',
                        top: '8px',
                        left: '8px',
                        background: 'rgba(0, 0, 0, 0.7)',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                      title="Cover art cached"
                    >
                      <i className="fas fa-image" style={{ color: 'var(--primary-color)', fontSize: '12px' }}></i>
                    </div>
                  )}
                </div>
                <div className="album-name">{album.name}</div>
                <div className="album-artist">
                  {album.year && `${album.year} • `}
                  {album.songCount} songs
                </div>
              </div>
            );
          })}
        </div>

        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageClick} />
      </>
      )}
      <DownloadManagerWindow isOpen={showDownloadManager} onClose={() => setShowDownloadManager(false)} />
    </div>
  );
};

export default AlbumList;
