import React, { useEffect, useState } from 'react';
import { getArtists, getSongCount, getAllSongs, getStreamUrl, getCoverArtUrl } from '../../services/subsonicApi';
import { usePlayer } from '../../context/PlayerContext';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { offlineCacheService } from '../../services/offlineCacheService';
import { Song } from '../../types';
import { CachedSongMetadata } from '../../types/offline';
import AlbumArt from '../common/AlbumArt';
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
}

const ArtistList: React.FC<ArtistListProps> = ({ onArtistClick }) => {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [filteredArtists, setFilteredArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalSongs, setTotalSongs] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const artistsPerPage = 50; // Show 50 artists per page
  const { playPlaylist, toggleShuffle, shuffle } = usePlayer();
  const { offlineModeEnabled, toggleOfflineMode, cacheInitialized } = useOfflineMode();
  const [isShufflingAll, setIsShufflingAll] = useState(false);

  useEffect(() => {
    loadArtists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineModeEnabled]);

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
    try {
      setError(null);
      
      // If offline mode, load from cache only
      if (offlineModeEnabled) {
        logger.log('[ArtistList] Offline mode: loading artists from cache');
        const cacheIndex = offlineCacheService.getCacheIndex();
        
        if (!cacheIndex || Object.keys(cacheIndex.songs || {}).length === 0) {
          setError('No cached songs available. Please download some songs first before using offline mode.');
          setLoading(false);
          return;
        }
        
        // Build artist list from cached songs
        const artistMap = new Map<string, Artist>();
        
        // Helper function to extract main artist name (before separators like •, -, feat., etc.)
        const getMainArtist = (artistName: string): string => {
          // Split by common separators and get the first part
          const separators = [' • ', ' - ', ' feat.', ' feat ', ' ft.', ' ft ', ' with ', ' & '];
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
        
        Object.values((cacheIndex?.songs || {}) as Record<string, CachedSongMetadata>).forEach(metadata => {
          const mainArtist = getMainArtist(metadata.artist);
          
          if (!artistMap.has(mainArtist)) {
            // Determine the best cover art ID to use for the artist
            // Priority: artistCoverArtId > artistId > album coverArtId (as fallback)
            const artistCoverArt = metadata.artistCoverArtId || metadata.artistId || metadata.coverArtId;
            
            artistMap.set(mainArtist, {
              id: metadata.artistId || `cached-${mainArtist}`,
              name: mainArtist,
              albumCount: 0,
              coverArt: artistCoverArt
            });
          }
        });
        
        // Calculate album counts per artist
        artistMap.forEach((artist, artistName) => {
          const albumsForArtist = new Set<string>();
          Object.values((cacheIndex?.songs || {}) as Record<string, CachedSongMetadata>).forEach(metadata => {
            const mainArtist = getMainArtist(metadata.artist);
            if (mainArtist === artistName) {
              albumsForArtist.add(metadata.albumId);
            }
          });
          artist.albumCount = albumsForArtist.size;
        });
        
        setArtists(Array.from(artistMap.values()));
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

      console.log('Fetching artists from:', serverUrl);
      
      // Fetch artists and song count in parallel
      const [artistsResponse, songCount] = await Promise.all([
        getArtists(serverUrl, username, password),
        getSongCount(serverUrl, username, password)
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
      
      setArtists(artistsList);
      setTotalSongs(songCount);
      console.log(`Loaded ${artistsList.length} artists and ${songCount} songs`);
    } catch (error) {
      console.error('Failed to load artists', error);
      setError((error as Error).message || 'Failed to load artists');
    } finally {
      setLoading(false);
    }
  };

  const handleArtistClick = (artist: Artist) => {
    if (onArtistClick) {
      onArtistClick(artist.id, artist.name);
    }
  };

  const handleShuffleAll = async () => {
    setIsShufflingAll(true);
    try {
      const serverUrl = localStorage.getItem('serverUrl') || '';
      const username = localStorage.getItem('username') || '';
      const password = localStorage.getItem('password') || '';

      const rawSongs = await getAllSongs(serverUrl, username, password);
      
      // Transform raw songs to Song format with stream URLs
      const songs: Song[] = rawSongs.map((song: any) => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        url: getStreamUrl(serverUrl, username, password, song.id),
        duration: song.duration,
        coverArt: song.coverArt ? getCoverArtUrl(serverUrl, username, password, song.coverArt, 300) : undefined
      }));

      // Enable shuffle if not already enabled
      if (!shuffle) {
        toggleShuffle();
      }
      
      // Start playing from a RANDOM song index for true shuffle experience
      const randomIndex = Math.floor(Math.random() * songs.length);
      playPlaylist(songs, randomIndex);
    } catch (error) {
      logger.error('Failed to shuffle all songs:', error);
      setError('Failed to load songs for shuffle');
    } finally {
      setIsShufflingAll(false);
    }
  };

  // Calculate totals
 const totalAlbums = filteredArtists.reduce((sum, artist) => sum + (artist.albumCount || 0), 0);

  // Pagination calculations
  const totalPages = Math.ceil(filteredArtists.length / artistsPerPage);
  const startIndex = (currentPage - 1) * artistsPerPage;
  const endIndex = Math.min(startIndex + artistsPerPage, filteredArtists.length);
  const paginatedArtists = filteredArtists.slice(startIndex, endIndex);

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePageClick = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        <div className="library-title">
          <i className="fas fa-users"></i>
          <span>Your Artists</span>
        </div>
        <div className="library-header-right">
          <div className="library-stats">
            <i className="fas fa-user-friends"></i>
            <span>{filteredArtists.length} {offlineModeEnabled ? 'cached ' : ''}artists</span>
          </div>
          {filteredArtists.length > artistsPerPage && (
            <div className="library-stats" style={{ color: 'var(--text-secondary)' }}>
              <span>Showing {startIndex + 1}-{endIndex} of {filteredArtists.length}</span>
            </div>
          )}
          <div className="library-stats">
            <i className="fas fa-record-vinyl"></i>
            <span>{totalAlbums} albums</span>
          </div>
          <div className="library-stats">
            <i className="fas fa-music"></i>
            <span>{totalSongs} songs</span>
          </div>
          <button 
            className="shuffle-all-button"
            onClick={handleShuffleAll}
            disabled={isShufflingAll || loading}
          >
            <i className="fas fa-random"></i>
            {isShufflingAll ? 'Loading...' : 'Shuffle All'}
          </button>
        </div>
      </div>

      <div className="artists-grid">
        {paginatedArtists.map((artist) => {
          // Check if artist has cached content (only for current user)
          const artistCacheIndex = cacheInitialized ? offlineCacheService.getCacheIndex() : null;
          const artistCachedSongs = artistCacheIndex ? (Object.values(artistCacheIndex.songs || {}) as CachedSongMetadata[])
            .filter(s => s.artist.includes(artist.name) || artist.name.includes(s.artist.split(' • ')[0])) : [];
          const hasCachedContent = artistCachedSongs.length > 0;
          
          return (
            <div 
              className="artist-card" 
              key={artist.id}
              onClick={() => handleArtistClick(artist)}
            >
              <div className="artist-cover" style={{ position: 'relative' }}>
                {artist.coverArt ? (
                  <AlbumArt 
                    coverArtId={artist.coverArt}
                    alt={artist.name}
                    size={300}
                  />
                ) : (
                  <div className="album-art-fallback">
                    <i className="fas fa-user-circle"></i>
                  </div>
                )}
                {hasCachedContent && (
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
                    title={`${artistCachedSongs.length} cached songs`}
                  >
                    <i className="fas fa-circle-check" style={{ color: 'var(--primary-color)', fontSize: '16px' }}></i>
                  </div>
                )}
              </div>
              <div className="artist-name">{artist.name}</div>
              <div className="artist-album-count">
                {artist.albumCount || 0} albums
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="pagination-controls">
          <button 
            className="pagination-button"
            onClick={handlePreviousPage}
            disabled={currentPage === 1}
            title="Previous page"
          >
            <i className="fas fa-chevron-left"></i>
            Previous
          </button>

          <div className="pagination-pages">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              // Show first 3, current page with neighbors, and last 3
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i + 1;
              } else if (currentPage <= 4) {
                pageNum = i + 1;
              } else if (currentPage >= totalPages - 3) {
                pageNum = totalPages - 6 + i;
              } else {
                if (i === 0) pageNum = 1;
                else if (i === 1) pageNum = currentPage - 1;
                else if (i === 2) pageNum = currentPage;
                else if (i === 3) pageNum = currentPage + 1;
                else pageNum = totalPages;
              }

              return (
                <button
                  key={pageNum}
                  className={`pagination-page ${currentPage === pageNum ? 'active' : ''}`}
                  onClick={() => handlePageClick(pageNum)}
                >
                  {pageNum}
                </button>
              );
            })}
          </div>

          <button 
            className="pagination-button"
            onClick={handleNextPage}
            disabled={currentPage === totalPages}
            title="Next page"
          >
            Next
            <i className="fas fa-chevron-right"></i>
          </button>
        </div>
      )}
    </div>
  );
};

export default ArtistList;