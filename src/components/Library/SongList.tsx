import React, { useEffect, useState } from 'react';
import { getAlbum, getStreamUrl, getCoverArtUrl } from '../../services/subsonicApi';
import { usePlayer } from '../../context/PlayerContext';
import './SongList.css';

interface Song {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration?: number;
  track?: number;
  coverArt?: string;
  year?: number;
}

interface SongListProps {
  albumId: string;
  albumName: string;
  artistName: string;
  onBack: () => void;
}

const SongList: React.FC<SongListProps> = ({ albumId, albumName, artistName, onBack }) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [albumCover, setAlbumCover] = useState<string | null>(null);
  const { playPlaylist, currentSong, isPlaying, toggleShuffle, shuffle } = usePlayer();

  useEffect(() => {
    loadSongs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId]);

  const loadSongs = async () => {
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

      console.log('Fetching songs for album:', albumId);
      
      const response = await getAlbum(serverUrl, username, password, albumId);
      const subsonicResponse = response.data['subsonic-response'];
      
      if (subsonicResponse?.status === 'failed') {
        setError(subsonicResponse.error?.message || 'Failed to fetch songs');
        setLoading(false);
        return;
      }
      
      const album = subsonicResponse?.album;
      const songsList: Song[] = album?.song || [];
      
      // Sort by track number
      songsList.sort((a, b) => (a.track || 0) - (b.track || 0));
      
      setSongs(songsList);
      
      // Get album cover
      if (album?.coverArt) {
        setAlbumCover(getCoverArtUrl(serverUrl, username, password, album.coverArt, 300));
      }
      
      console.log(`Loaded ${songsList.length} songs`);
    } catch (error) {
      console.error('Failed to load songs', error);
      setError((error as Error).message || 'Failed to load songs');
    } finally {
      setLoading(false);
    }
  };

  const handlePlaySong = (index: number) => {
    const serverUrl = localStorage.getItem('serverUrl') || '';
    const username = localStorage.getItem('username') || '';
    const password = localStorage.getItem('password') || '';

    // Map songs to include streaming URLs
    const songsWithUrls = songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      url: getStreamUrl(serverUrl, username, password, song.id),
      duration: song.duration,
      coverArt: albumCover || undefined,
    }));

    // Play the entire album starting from the clicked song
    playPlaylist(songsWithUrls, index);
  };

  const handlePlayAll = () => {
    handlePlaySong(0);
  };

  const handleShuffleAlbum = () => {
    const serverUrl = localStorage.getItem('serverUrl') || '';
    const username = localStorage.getItem('username') || '';
    const password = localStorage.getItem('password') || '';

    // Map songs to include streaming URLs
    const songsWithUrls = songs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      url: getStreamUrl(serverUrl, username, password, song.id),
      duration: song.duration,
      coverArt: albumCover || undefined,
    }));

    // Enable shuffle if not already enabled
    if (!shuffle) {
      toggleShuffle();
    }

    // Start playing from a RANDOM song index for true shuffle experience
    const randomIndex = Math.floor(Math.random() * songsWithUrls.length);
    playPlaylist(songsWithUrls, randomIndex);
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTotalDuration = (): string => {
    const total = songs.reduce((sum, song) => sum + (song.duration || 0), 0);
    const hours = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    
    if (hours > 0) {
      return `${hours} hr ${mins} min`;
    }
    return `${mins} min`;
  };

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
        <button onClick={loadSongs} className="test-button" style={{ marginTop: '20px' }}>
          <i className="fas fa-redo"></i>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Back Button - Moved to top level */}
      <button className="back-button" onClick={onBack} style={{ marginBottom: '24px' }}>
        <i className="fas fa-arrow-left"></i>
        Back to Albums
      </button>

      {/* Album Header */}
      <div className="album-header">
        <div className="album-header-content">
          <div className="album-header-art-container">
            {albumCover ? (
              <img 
                src={albumCover} 
                alt={albumName}
                className="album-header-art"
              />
            ) : (
              <div className="album-art-fallback album-header-art">
                <i className="fas fa-compact-disc"></i>
              </div>
            )}
          </div>
          <div className="album-header-info">
            <h2>
              <i className="fas fa-compact-disc"></i>
              {albumName}
            </h2>
            <p className="album-artist">{artistName}</p>
            <p className="album-year">
              {songs[0]?.year && `${songs[0].year} • `}
              {songs.length} songs • {getTotalDuration()}
            </p>
          </div>
        </div>
        
        <div className="album-header-actions">
          <button 
            className="play-album-button"
            onClick={handlePlayAll}
            disabled={songs.length === 0}
          >
            <i className="fas fa-play"></i>
            Play Album
          </button>
          <button 
            className="shuffle-album-button"
            onClick={handleShuffleAlbum}
            disabled={songs.length === 0}
          >
            <i className="fas fa-random"></i>
            Shuffle
          </button>
        </div>
      </div>

      {/* Songs List */}
      {songs.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <i className="fas fa-music" style={{ fontSize: '48px', marginBottom: '16px' }}></i>
          <h3>No Songs Found</h3>
          <p>This album has no songs.</p>
        </div>
      ) : (
        <div className="songs-list">
          {songs.map((song, index) => (
            <div 
              key={song.id}
              className={`song-item ${currentSong?.id === song.id ? 'active' : ''}`}
              onClick={() => handlePlaySong(index)}
            >
              <div className="song-track-number">
                {currentSong?.id === song.id && isPlaying ? (
                  <i className="fas fa-volume-up" style={{ color: 'var(--primary-color)' }}></i>
                ) : (
                  <span>{song.track || index + 1}</span>
                )}
              </div>
              
              <button className="play-button">
                <i className={`fas fa-${currentSong?.id === song.id && isPlaying ? 'pause' : 'play'}`}></i>
              </button>

              <div className="song-info">
                <div className="song-title">{song.title}</div>
                <div className="song-artist">{song.artist}</div>
              </div>

              <div className="song-meta">
                <span className="song-duration">{formatDuration(song.duration)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SongList;