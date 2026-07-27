import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getArtists, getSongCount, getAllSongs, getStreamUrl, getCoverArtUrl } from '../../services/subsonicApi';
import { metadataCache } from '../../services/metadataCache';
import { searchCacheService } from '../../services/searchCacheService';
import { usePlayback } from '../../hooks/usePlayback';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { offlineCacheService } from '../../services/offlineCacheService';
import { downloadManager } from '../../services/downloadManagerService';
import { Song } from '../../types';
import { CachedSongMetadata, DownloadQuality } from '../../types/offline';
import { getDefaultDownloadQuality } from '../../utils/settingsManager';
import AlbumArt from '../common/AlbumArt';
import LibraryViewToggle, { TopLevelView } from './LibraryViewToggle';
import Pagination from '../common/Pagination';
import { imageCacheService } from '../../services/imageCacheService';
import { useImageCache } from '../../context/ImageCacheContext';
import DownloadQualityPicker from './DownloadQualityPicker';
import DownloadManagerWindow from './DownloadManagerWindow';
import './ArtistList.css';
import { logger } from '../../utils/logger';

interface Artist {
  id: string;
  name: string;
  albumCount?: number;
  coverArt?: string;
}

interface ArtistListProps {
  onArtistClick?: (artistId: string, artistName: string) => void;
  topView?: TopLevelView;
  onTopViewChange?: (view: TopLevelView) => void;
  missingSongsCount?: number;
}

interface ArtistCardProps {
  artist: Artist;
  hasCachedContent: boolean;
  onArtistClick: (artist: Artist) => void;
}

const ArtistCard = React.memo(({ artist, hasCachedContent, onArtistClick }: ArtistCardProps) => {

  return (
    <div className="artist-card" onClick={() => onArtistClick(artist)}>
      <div className="artist-cover" style={{ position: 'relative' }}>
        {artist.coverArt ? (
          <AlbumArt coverArtId={artist.coverArt} alt={artist.name} size={300} artist={artist.name} />
        ) : (
          <div className="album-art-fallback">
            <i className="fas fa-user-circle"></i>
          </div>
        )}
        {hasCachedContent && (
          <div
            style={{
              position: 'absolute', top: '8px', right: '8px',
              background: 'rgba(0, 0, 0, 0.7)', borderRadius: '50%',
              width: '28px', height: '28px', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
            }}
            title="Has cached songs"
          >
            <i className="fas fa-circle-check" style={{ color: 'var(--primary-color)', fontSize: '16px' }} />
          </div>
        )}
      </div>
      <div className="artist-name">{artist.name}</div>
      <div className="artist-album-count">{artist.albumCount || 0} albums</div>
    </div>
  );
});

const ArtistList: React.FC<ArtistListProps> = ({ onArtistClick, topView = 'artists', onTopViewChange, missingSongsCount }) => {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [filteredArtists, setFilteredArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalSongs, setTotalSongs] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const artistsPerPage = 50; // Show 50 artists per page
  const { playPlaylist, toggleShuffle, shuffle, currentSong } = usePlayback();
  const { offlineModeEnabled, toggleOfflineMode, cacheInitialized, isOnline } = useOfflineMode();
  const { isInitialized: imageCacheReady } = useImageCache();
  const [isShufflingAll, setIsShufflingAll] = useState(false);
  const [shuffleError, setShuffleError] = useState<string | null>(null);
  const [confirmShuffle, setConfirmShuffle] = useState(false);
  const confirmShuffleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadIdRef = useRef(0);
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

  // Compute once which artist names have any cached content — O(songs) not O(songs × artists)
  const cachedArtistNames = useMemo<Set<string>>(() => {
    if (!cacheInitialized) return new Set();
    const cacheIndex = offlineCacheService.getCacheIndex();
    if (!cacheIndex) return new Set();
    const names = new Set<string>();
    const separators = [', ', ' • ', ' - ', ' feat.', ' feat ', ' ft.', ' ft ', ' with ', ' & '];
    for (const song of Object.values(cacheIndex.songs || {}) as CachedSongMetadata[]) {
      let main = song.artist;
      for (const sep of separators) {
        const idx = song.artist.indexOf(sep);
        if (idx > 0) { main = song.artist.substring(0, idx); break; }
      }
      names.add(main.trim().toLowerCase().replace(/\s+/g, ' '));
    }
    return names;
  }, [cacheInitialized]);

  useEffect(() => {
    loadArtists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineModeEnabled, cacheInitialized]);


  // Filter artists based on offline mode
  useEffect(() => {
    filterArtistsByOfflineMode();
    setCurrentPage(1); // Reset to first page when artists change
  }, [artists, offlineModeEnabled]);

  const filterArtistsByOfflineMode = () => {
    if (offlineModeEnabled) {
      // When offline, artists are already loaded from cache only
      // No additional filtering needed
      setFilteredArtists(artists);
      logger.log('[ArtistList] Offline mode: showing all', artists.length, 'cached artists');
    } else {
      // Online mode, show all artists
      setFilteredArtists(artists);
    }
  };

  const loadArtists = async () => {
    const myId = ++loadIdRef.current;
    setLoading(true);
    try {
      setError(null);

      // If offline mode OR no internet, load from cache only
      if (offlineModeEnabled || !isOnline) {
        if (!cacheInitialized) return; // keep spinner; re-runs when cache is ready
        logger.log('[ArtistList] Loading artists from cache (offlineMode=%s, isOnline=%s)', offlineModeEnabled, isOnline);
        const cacheIndex = offlineCacheService.getCacheIndex();
        
        if (!cacheIndex || Object.keys(cacheIndex.songs || {}).length === 0) {
          setError(
            offlineModeEnabled
              ? 'No cached songs available. Please download some songs first before using offline mode.'
              : 'No internet connection and no downloaded songs. Go online or download songs for offline use.'
          );
          setLoading(false);
          return;
        }
        
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

        // Pass 1: collect all songs per main artist (case-insensitive key)
        const artistSongsMap = new Map<string, { displayName: string; songs: CachedSongMetadata[] }>();
        Object.values((cacheIndex?.songs || {}) as Record<string, CachedSongMetadata>).forEach(metadata => {
          const mainArtist = getMainArtist(metadata.artist);
          const key = mainArtist.toLowerCase().replace(/\s+/g, ' ');
          if (!artistSongsMap.has(key)) artistSongsMap.set(key, { displayName: mainArtist, songs: [] });
          artistSongsMap.get(key)!.songs.push(metadata);
        });

        // Pass 2: build Artist objects with best available cover art.
        // Priority: artistCoverArtId (ar-xxx from IDB preload) > solo-song coverArtId
        // (avoids showing a collaborating artist's album cover for the wrong artist)
        const artistMap = new Map<string, Artist>();
        const albumsForArtistMap = new Map<string, Set<string>>();

        for (const [key, { displayName, songs }] of artistSongsMap) {
          // Solo songs: full artist field is exactly the main artist (no feat./duet)
          const soloSongs = songs.filter(s => s.artist.trim().toLowerCase() === key);
          // Near-solo: artist field starts with the main artist (e.g. "MIKA • feat. X")
          const leadSongs = songs.filter(s => s.artist.toLowerCase().startsWith(key + ' '));
          const primarySong = soloSongs[0] ?? leadSongs[0] ?? songs[0];

          // Build ordered list of candidate cover art IDs.
          // artistCoverArtId (ar-xxx) was stored if downloaded via the artist view.
          const artistCoverArtIds = songs.map(s => s.artistCoverArtId).filter(Boolean) as string[];
          const soloCoverArtIds   = soloSongs.map(s => s.coverArtId).filter(Boolean) as string[];
          const leadCoverArtIds   = leadSongs.map(s => s.coverArtId).filter(Boolean) as string[];
          const anyCoverArtIds    = songs.map(s => s.coverArtId).filter(Boolean) as string[];

          const ordered = [...artistCoverArtIds, ...soloCoverArtIds, ...leadCoverArtIds, ...anyCoverArtIds];
          const coverArt =
            ordered.find(id => offlineCacheService.isCoverArtCached(id)) ??
            ordered[0];

          artistMap.set(key, {
            id: primarySong.artistId || `cached-${key}`,
            name: displayName,
            albumCount: 0,
            coverArt,
          });

          albumsForArtistMap.set(key, new Set(songs.map(s => s.albumId)));
        }

        // Apply album counts (already collected above)
        artistMap.forEach((artist, key) => {
          artist.albumCount = albumsForArtistMap.get(key)?.size ?? 0;
        });
        
        setArtists(Array.from(artistMap.values()).sort((a, b) => a.name.localeCompare(b.name)));
        setTotalSongs(Object.keys(cacheIndex?.songs || {}).length);
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

      const artistsCacheKey = `artists_${serverUrl}`;
      const cachedArtistsData = metadataCache.get<{ artists: Artist[]; songCount: number }>(artistsCacheKey);
      if (cachedArtistsData) {
        if (myId !== loadIdRef.current) return;
        setArtists(cachedArtistsData.artists);
        setTotalSongs(cachedArtistsData.songCount);
        setLoading(false);
        return;
      }

      console.log('Fetching artists from:', serverUrl);

      // Use search index song count when available — avoids an extra getAlbumList2 call
      const searchIdx = searchCacheService.getSearchIndex();
      const [artistsResponse, songCount] = await Promise.all([
        getArtists(serverUrl, username, password),
        searchIdx ? Promise.resolve(searchIdx.songs.length) : getSongCount(serverUrl, username, password),
      ]);

      const subsonicResponse = artistsResponse.data['subsonic-response'];

      if (subsonicResponse?.status === 'failed') {
        setError(subsonicResponse.error?.message || 'Failed to fetch artists');
        setLoading(false);
        return;
      }

      const artistsList: Artist[] = [];

      if (subsonicResponse?.artists?.index) {
        subsonicResponse.artists.index.forEach((index: any) => {
          if (index.artist) {
            // Map artists and use artist ID as coverArt if not provided
            const mappedArtists = index.artist.map((artist: any) => ({
              ...artist,
              // If coverArt is not provided, use the artist ID itself
              // Subsonic API often supports using artist ID with getCoverArt endpoint
              coverArt: artist.coverArt || artist.id
            }));
            artistsList.push(...mappedArtists);
          }
        });
      }

      metadataCache.set(artistsCacheKey, { artists: artistsList, songCount });
      if (myId !== loadIdRef.current) return;
      setArtists(artistsList);
      setTotalSongs(songCount);
      console.log(`Loaded ${artistsList.length} artists and ${songCount} songs`);
    } catch (error) {
      if (myId !== loadIdRef.current) return;
      console.error('Failed to load artists', error);
      setError((error as Error).message || 'Failed to load artists');
    } finally {
      if (myId === loadIdRef.current) setLoading(false);
    }
  };

  const handleArtistClick = useCallback((artist: Artist) => {
    if (onArtistClick) {
      onArtistClick(artist.id, artist.name);
    }
  }, [onArtistClick]);

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
    } catch (error) {
      logger.error('Failed to shuffle all songs:', error);
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
      // Build artist ID → ar-xxx cover art ID lookup from the already-loaded artist list
      const artistCoverArtById = new Map(artists.map(a => [a.id, a.coverArt]));
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
        const artistCoverArtId = group.artistId ? (artistCoverArtById.get(group.artistId) ?? group.artistId) : undefined;
        downloadManager.addAlbumToQueue({ albumId, albumName: group.albumName, artistName: group.artistName, artistId: group.artistId, artistCoverArtId, songs: group.songs, quality: bulkDownloadQuality });
      }
      setShowDownloadManager(true);
    } catch (err) {
      logger.error('Download all failed:', err);
    } finally {
      setIsBulkDownloading(false);
    }
  };

  // Calculate totals
  const totalAlbums = filteredArtists.reduce((sum, artist) => sum + (artist.albumCount || 0), 0);

  // Pagination calculations
  const totalPages = Math.ceil(filteredArtists.length / artistsPerPage);
  const startIndex = (currentPage - 1) * artistsPerPage;
  const endIndex = Math.min(startIndex + artistsPerPage, filteredArtists.length);
  const paginatedArtists = filteredArtists.slice(startIndex, endIndex);

  // Batch-warm IDB images into memory before rendering the current page
  useEffect(() => {
    if (!imageCacheReady) return;
    const ids = paginatedArtists.map(a => a.coverArt).filter(Boolean) as string[];
    if (ids.length > 0) imageCacheService.prewarmBatch(ids);
  // paginatedArtists changes when page or filter changes; imageCacheReady changes once on init
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginatedArtists, imageCacheReady]);

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
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading) {
    return (
      <div className="loading">
        <i className="fas fa-spinner"></i>
        <span>Loading artists...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-message" style={{ padding: '40px', textAlign: 'center' }}>
        <i className="fas fa-exclamation-circle" style={{ fontSize: '48px', color: '#ff3b30', marginBottom: '16px' }}></i>
        <h3>Error Loading Artists</h3>
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
          <button 
            onClick={loadArtists} 
            className="test-button"
            style={{ marginTop: '20px' }}
          >
            <i className="fas fa-redo"></i>
            Retry
          </button>
        )}
      </div>
    );
  }

  if (filteredArtists.length === 0 && !loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <i className="fas fa-music" style={{ fontSize: '48px', marginBottom: '16px' }}></i>
        <h3>{offlineModeEnabled ? 'No Cached Artists' : 'No Artists Found'}</h3>
        <p>{offlineModeEnabled ? 'Download some songs to listen offline.' : 'Your music library appears to be empty.'}</p>
      </div>
    );
  }

  return (
    <div className="artist-list">
      <div className="library-header">
        {onTopViewChange ? (
          <LibraryViewToggle currentView={topView} onChange={onTopViewChange} />
        ) : (
          <div className="library-title">
            <i className="fas fa-users"></i>
            <span>Your Artists</span>
          </div>
        )}
        <div className="library-header-right">
          <div className="library-stats">
            <i className="fas fa-user-friends"></i>
            <span>{filteredArtists.length} {offlineModeEnabled ? 'cached ' : ''}artists</span>
          </div>
          {filteredArtists.length > artistsPerPage && (
            <div className="library-stats stat-secondary">
              <span>Showing {startIndex + 1}-{endIndex} of {filteredArtists.length}</span>
            </div>
          )}
          <div className="library-stats stat-secondary">
            <i className="fas fa-record-vinyl"></i>
            <span>{totalAlbums} albums</span>
          </div>
          <div className="library-stats stat-secondary">
            <i className="fas fa-music"></i>
            <span>{totalSongs} songs</span>
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

      <div className="artists-grid">
        {paginatedArtists.map((artist) => (
          <ArtistCard
            key={artist.id}
            artist={artist}
            hasCachedContent={cachedArtistNames.has(artist.name.toLowerCase().replace(/\s+/g, ' '))}
            onArtistClick={handleArtistClick}
          />
        ))}
      </div>

      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageClick} />
      <DownloadManagerWindow isOpen={showDownloadManager} onClose={() => setShowDownloadManager(false)} />
    </div>
  );
};

export default ArtistList;