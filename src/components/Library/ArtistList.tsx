import React, { useEffect, useState } from 'react';
import { getArtists, getSongCount, getAllSongs, getStreamUrl, getCoverArtUrl } from '../../services/subsonicApi';
import { usePlayer } from '../../context/PlayerContext';
import { Song } from '../../types';
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalSongs, setTotalSongs] = useState(0);
  const { playPlaylist, toggleShuffle, shuffle } = usePlayer();
  const [isShufflingAll, setIsShufflingAll] = useState(false);

  useEffect(() => {
    loadArtists();
  }, []);

  const loadArtists = async () => {
    try {
      setError(null);
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
            artistsList.push(...index.artist);
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
  const totalAlbums = artists.reduce((sum, artist) => sum + (artist.albumCount || 0), 0);

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
        <button 
          onClick={loadArtists} 
          className="test-button"
          style={{ marginTop: '20px' }}
        >
          <i className="fas fa-redo"></i>
          Retry
        </button>
      </div>
    );
  }

  if (artists.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
        <i className="fas fa-music" style={{ fontSize: '48px', marginBottom: '16px' }}></i>
        <h3>No Artists Found</h3>
        <p>Your music library appears to be empty.</p>
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
            <span>{artists.length} artists</span>
          </div>
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
        {artists.map((artist) => (
          <div 
            className="artist-card" 
            key={artist.id}
            onClick={() => handleArtistClick(artist)}
          >
            <div className="artist-cover">
              {artist.coverArt ? (
                <img 
                  src={`${localStorage.getItem('serverUrl')}/rest/getCoverArt.view?id=${artist.coverArt}&u=${localStorage.getItem('username')}`} 
                  alt={artist.name}
                  onError={(e) => {
                    // Fallback to placeholder on image load error
                    e.currentTarget.style.display = 'none';
                    e.currentTarget.parentElement!.innerHTML = '<div class="album-art-fallback"><i class="fas fa-user-circle"></i></div>';
                  }}
                />
              ) : (
                <div className="album-art-fallback">
                  <i className="fas fa-user-circle"></i>
                </div>
              )}
            </div>
            <div className="artist-name">{artist.name}</div>
            <div className="artist-album-count">
              {artist.albumCount || 0} albums
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ArtistList;