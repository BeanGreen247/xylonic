import React, { useEffect, useState } from 'react';
import { getAlbum, getStreamUrl } from '../../services/subsonicApi';
import { usePlayer } from '../../context/PlayerContext';
import { downloadManager } from '../../services/downloadManagerService';
import { offlineCacheService } from '../../services/offlineCacheService';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { logger } from '../../utils/logger';
import { DownloadQuality, CachedSongMetadata } from '../../types/offline';
import AlbumArt from '../common/AlbumArt';
import DownloadManagerWindow from './DownloadManagerWindow';
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
  fromSearch?: boolean;
}

const SongList: React.FC<SongListProps> = ({ albumId, albumName, artistName, onBack, fromSearch = false }) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [albumCoverArtId, setAlbumCoverArtId] = useState<string | null>(null);
  const [artistId, setArtistId] = useState<string | null>(null);
  const [artistCoverArtId, setArtistCoverArtId] = useState<string | null>(null);
  const [showDownloadManager, setShowDownloadManager] = useState(false);
  const [downloadQuality, setDownloadQuality] = useState<DownloadQuality>('320');
  const [showQualitySelector, setShowQualitySelector] = useState(false);
  const [isAlbumCached, setIsAlbumCached] = useState(false);
  const [filteredSongs, setFilteredSongs] = useState<Song[]>([]);
  const { playPlaylist, currentSong, isPlaying, toggleShuffle, shuffle } = usePlayer();
  const { offlineModeEnabled, toggleOfflineMode } = useOfflineMode();

  useEffect(() => {
    loadSongs();
    checkIfCached();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumId, offlineModeEnabled]);

  const checkIfCached = () => {
    if (songs.length > 0) {
      const allCached = songs.every(song => offlineCacheService.isCached(song.id));
      setIsAlbumCached(allCached);
    }
  };

  useEffect(() => {
    checkIfCached();
    filterSongsByOfflineMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs, offlineModeEnabled]);

  const filterSongsByOfflineMode = () => {
    if (offlineModeEnabled) {
      // When offline, songs are already loaded from cache only
      // No additional filtering needed
      setFilteredSongs(songs);
      logger.log('[SongList] Offline mode: showing all', songs.length, 'cached songs');
    } else {
      // Online mode, show all songs
      setFilteredSongs(songs);
    }
  };

  const loadSongs = async () => {
    try {
      setError(null);
      
      // If offline mode, load from cache only
      if (offlineModeEnabled) {
        logger.log('[SongList] Offline mode: loading songs from cache');
        const cacheIndex = offlineCacheService.getCacheIndex();
        
        if (!cacheIndex || Object.keys(cacheIndex.songs || {}).length === 0) {
          setError('No cached songs available. Please download some songs first before using offline mode.');
          setLoading(false);
          return;
        }
        
        // Build song list from cached songs for this album
        const cachedSongsMetadata = Object.values((cacheIndex?.songs || {}) as Record<string, CachedSongMetadata>)
          .filter(metadata => metadata.albumId === albumId);
        
        const cachedSongs: Song[] = cachedSongsMetadata
          .map(metadata => ({
            id: metadata.songId,
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            duration: metadata.duration,
            url: '', // Will be set to file:// URL when playing
            coverArt: metadata.coverArtId
          }));
        
        if (cachedSongs.length === 0) {
          setError('No cached songs for this album. Please download this album first.');
          setLoading(false);
          return;
        }
        
        // Extract album cover art and artist info from first cached song
        if (cachedSongsMetadata.length > 0) {
          const firstSong = cachedSongsMetadata[0];
          if (firstSong.coverArtId) {
            setAlbumCoverArtId(firstSong.coverArtId);
          }
          if (firstSong.artistId) {
            setArtistId(firstSong.artistId);
          }
          if (firstSong.artistCoverArtId) {
            setArtistCoverArtId(firstSong.artistCoverArtId);
          }
        }
        
        setSongs(cachedSongs);
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
      
      // Store artist information
      if (album?.artistId) {
        setArtistId(album.artistId);
        // Use artist ID as the cover art ID for the artist
        // Subsonic API supports using artist ID with getCoverArt endpoint
        setArtistCoverArtId(album.artistId);
      } else {
        // If album doesn't have artistId, try to use artist name
        // or fall back to using the album's cover art as artist cover art
        logger.warn('[SongList] Album has no artistId, falling back to album cover for artist');
        setArtistCoverArtId(album?.coverArt || null);
      }
      
      // Sort by track number
      songsList.sort((a, b) => (a.track || 0) - (b.track || 0));
      
      setSongs(songsList);
      
      // Store album cover art ID (not URL) for cache-first loading
      if (album?.coverArt) {
        setAlbumCoverArtId(album.coverArt);
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

    // Use filteredSongs for playback (only cached songs in offline mode)
    const songsWithUrls = filteredSongs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      url: getStreamUrl(serverUrl, username, password, song.id),
      duration: song.duration,
      coverArt: song.coverArt || albumCoverArtId || undefined,
    }));

    // Play the filtered list starting from the clicked song
    playPlaylist(songsWithUrls, index);
  };

  const handlePlayAll = () => {
    handlePlaySong(0);
  };

  const handleDownloadAlbum = () => {
    if (isAlbumCached) {
      if (window.confirm('This album is already downloaded. Remove from cache?')) {
        offlineCacheService.removeAlbumFromCache(albumId);
        setIsAlbumCached(false);
      }
      return;
    }

    // Show quality selector
    setShowQualitySelector(true);
  };
      
  const handleConfirmDownload = () => {
    const songsToDownload = songs.map(song => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      coverArt: song.coverArt || albumCoverArtId || undefined,
      albumId: albumId
    }));

    downloadManager.addAlbumToQueue({
      albumId,
      albumName,
      artistName,
      artistId: artistId || undefined,
      artistCoverArtId: artistCoverArtId || undefined,
      songs: songsToDownload,
      quality: downloadQuality
    });

    setShowQualitySelector(false);
    setShowDownloadManager(true);
  };

  const handleShuffleAlbum = () => {
    const serverUrl = localStorage.getItem('serverUrl') || '';
    const username = localStorage.getItem('username') || '';
    const password = localStorage.getItem('password') || '';

    // Use filteredSongs for playback (only cached songs in offline mode)
    const songsWithUrls = filteredSongs.map((song) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      url: getStreamUrl(serverUrl, username, password, song.id),
      duration: song.duration,
      coverArt: song.coverArt || albumCoverArtId || undefined,
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
    const total = filteredSongs.reduce((sum, song) => sum + (song.duration || 0), 0);
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
          <button onClick={loadSongs} className="test-button" style={{ marginTop: '20px' }}>
            <i className="fas fa-redo"></i>
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Back Button - Moved to top level */}
      <button className="back-button" onClick={onBack} style={{ marginBottom: '24px' }}>
        <i className="fas fa-arrow-left"></i>
        {fromSearch ? 'Back to Search Results' : 'Back to Albums'}
      </button>

      {/* Album Header */}
      <div className="album-header">
        <div className="album-header-content">
          <div className="album-header-art-container">
            {albumCoverArtId ? (
              <AlbumArt 
                coverArtId={albumCoverArtId}
                alt={albumName}
                size={300}
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
              {filteredSongs.length} {offlineModeEnabled ? 'cached ' : ''}songs • {getTotalDuration()}
              {!offlineModeEnabled && (() => {
                const cachedCount = filteredSongs.filter(song => offlineCacheService.isCached(song.id)).length;
                return cachedCount > 0 ? (
                  <span style={{ color: 'var(--primary-color)', marginLeft: '8px' }}>
                    • {cachedCount} cached
                  </span>
                ) : null;
              })()}
            </p>
          </div>
        </div>
        
        <div className="album-header-actions">
          <button 
            className="play-album-button"
            onClick={handlePlayAll}
            disabled={filteredSongs.length === 0}
          >
            <i className="fas fa-play"></i>
            Play Album
          </button>
          <button 
            className="shuffle-album-button"
            onClick={handleShuffleAlbum}
            disabled={filteredSongs.length === 0}
          >
            <i className="fas fa-random"></i>
            Shuffle
          </button>
          <button 
            className={`download-album-button ${isAlbumCached ? 'cached' : ''}`}
            onClick={handleDownloadAlbum}
            disabled={songs.length === 0}
            title={isAlbumCached ? 'Album is cached - click to remove' : 'Download album for offline playback'}
          >
            <i className={`fas fa-${isAlbumCached ? 'check-circle' : 'download'}`}></i>
            {isAlbumCached ? 'Cached' : 'Download'}
          </button>
        </div>
      </div>

      {/* Quality Selector Modal */}
      {showQualitySelector && (
        <div className="quality-selector-modal" onClick={() => setShowQualitySelector(false)}>
          <div className="quality-selector-content" onClick={(e) => e.stopPropagation()}>
            <h3>Select Download Quality</h3>
            <p>Choose quality for {songs.length} songs</p>
            <div className="quality-options">
              <label className="quality-option">
                <input 
                  type="radio" 
                  name="quality" 
                  value="original"
                  checked={downloadQuality === 'original'}
                  onChange={(e) => setDownloadQuality(e.target.value as DownloadQuality)}
                />
                <span>Original (Raw)</span>
                <small>Highest quality, larger files</small>
              </label>
              <label className="quality-option">
                <input 
                  type="radio" 
                  name="quality" 
                  value="320"
                  checked={downloadQuality === '320'}
                  onChange={(e) => setDownloadQuality(e.target.value as DownloadQuality)}
                />
                <span>320 kbps</span>
                <small>Excellent quality</small>
              </label>
              <label className="quality-option">
                <input 
                  type="radio" 
                  name="quality" 
                  value="256"
                  checked={downloadQuality === '256'}
                  onChange={(e) => setDownloadQuality(e.target.value as DownloadQuality)}
                />
                <span>256 kbps</span>
                <small>High quality</small>
              </label>
              <label className="quality-option">
                <input 
                  type="radio" 
                  name="quality" 
                  value="128"
                  checked={downloadQuality === '128'}
                  onChange={(e) => setDownloadQuality(e.target.value as DownloadQuality)}
                />
                <span>128 kbps</span>
                <small>Good quality, smaller files</small>
              </label>
              <label className="quality-option">
                <input 
                  type="radio" 
                  name="quality" 
                  value="64"
                  checked={downloadQuality === '64'}
                  onChange={(e) => setDownloadQuality(e.target.value as DownloadQuality)}
                />
                <span>64 kbps</span>
                <small>Lower quality, smallest files</small>
              </label>
            </div>
            <div className="quality-selector-actions">
              <button className="cancel-btn" onClick={() => setShowQualitySelector(false)}>
                Cancel
              </button>
              <button className="confirm-btn" onClick={handleConfirmDownload}>
                <i className="fas fa-download"></i>
                Download {songs.length} Songs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Download Manager Window */}
      <DownloadManagerWindow 
        isOpen={showDownloadManager}
        onClose={() => setShowDownloadManager(false)}
      />

      {/* Songs List */}
      {offlineModeEnabled && filteredSongs.length === 0 && songs.length > 0 ? (
        <div className="no-songs" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <i className="fas fa-wifi-slash" style={{ fontSize: '64px', color: 'var(--text-secondary)', marginBottom: '20px' }}></i>
          <h3 style={{ marginBottom: '12px' }}>No Cached Songs</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            This album isn't downloaded for offline playback.
            <br />
            Go online and click the Download button to cache this album.
          </p>
        </div>
      ) : filteredSongs.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <i className="fas fa-music" style={{ fontSize: '48px', marginBottom: '16px' }}></i>
          <h3>No Songs Found</h3>
          <p>This album has no songs.</p>
        </div>
      ) : (
        <div className="songs-list">
          {filteredSongs.map((song, index) => (
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