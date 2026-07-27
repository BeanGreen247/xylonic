import React, { useEffect, useState, useCallback } from 'react';
import { List, RowComponentProps } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { getAlbum, getArtist, getStreamUrl } from '../../services/subsonicApi';
import { metadataCache } from '../../services/metadataCache';
import { usePlayer } from '../../context/PlayerContext';
import { useRemoteMode } from '../../context/RemoteModeContext';
import { downloadManager } from '../../services/downloadManagerService';
import { offlineCacheService } from '../../services/offlineCacheService';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { logger } from '../../utils/logger';
import { DownloadQuality, CachedSongMetadata } from '../../types/offline';
import { getDefaultDownloadQuality } from '../../utils/settingsManager';
import AlbumArt from '../common/AlbumArt';
import DownloadManagerWindow from './DownloadManagerWindow';
import DownloadQualityPicker from './DownloadQualityPicker';
import SongContextMenu, { ContextMenuSong } from '../common/SongContextMenu';
import AddToPlaylistDialog from '../common/AddToPlaylistDialog';
import './SongList.css';

const SONG_ITEM_HEIGHT = 56;

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

interface VirtualRowData {
  songs: Song[];
  currentSongId?: string;
  onPlay: (index: number) => void;
  onContext: (e: React.MouseEvent, song: Song) => void;
  formatDuration: (seconds?: number) => string;
}

// react-window v2: rowProps are spread directly into row component props alongside {index, style, ariaAttributes}
const VirtualSongRow = React.memo((props: RowComponentProps<VirtualRowData>) => {
  const { index, style, songs, currentSongId, onPlay, onContext, formatDuration } = props as typeof props & VirtualRowData;
  const song = songs[index];
  return (
    <div
      style={style}
      className={`song-item ${currentSongId === song.id ? 'active' : ''}`}
      onClick={() => onPlay(index)}
      onContextMenu={e => onContext(e, song)}
    >
      <div className="song-info">
        <div className="song-title">{song.title}</div>
        <div className="song-artist">{song.artist}</div>
      </div>
      <div className="song-meta">
        <span className="song-duration">{formatDuration(song.duration)}</span>
      </div>
    </div>
  );
});

interface SongListProps {
  albumId: string;
  albumName: string;
  artistName: string;
  onBack: () => void;
  fromSearch?: boolean;
  backLabel?: string;
  onArtistClick?: (artistId: string, artistName: string) => void;
}

const SongList: React.FC<SongListProps> = ({ albumId, albumName, artistName, onBack, fromSearch = false, backLabel, onArtistClick }) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [albumCoverArtId, setAlbumCoverArtId] = useState<string | null>(null);
  const [artistId, setArtistId] = useState<string | null>(null);
  const [artistCoverArtId, setArtistCoverArtId] = useState<string | null>(null);
  const [showDownloadManager, setShowDownloadManager] = useState(false);
  const [downloadQuality, setDownloadQuality] = useState<DownloadQuality>(getDefaultDownloadQuality);
  const [isAlbumCached, setIsAlbumCached] = useState(false);
  const [filteredSongs, setFilteredSongs] = useState<Song[]>([]);
  const { playPlaylist, currentSong, isPlaying, toggleShuffle, shuffle, addToQueue, insertNext, bitrate } = usePlayer();
  const { isRemoteMode, sendRemoteCommand } = useRemoteMode();
  const { offlineModeEnabled, toggleOfflineMode } = useOfflineMode();
  const [contextMenu, setContextMenu] = useState<{ song: ContextMenuSong; x: number; y: number } | null>(null);
  const [playlistDialogSong, setPlaylistDialogSong] = useState<ContextMenuSong | null>(null);

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

      const albumCacheKey = `album_${albumId}`;
      // eslint-disable-next-line prefer-const
      let album = metadataCache.get<any>(albumCacheKey);

      if (!album) {
        console.log('Fetching songs for album:', albumId);
        const response = await getAlbum(serverUrl, username, password, albumId);
        const subsonicResponse = response.data['subsonic-response'];

        if (subsonicResponse?.status === 'failed') {
          setError(subsonicResponse.error?.message || 'Failed to fetch songs');
          setLoading(false);
          return;
        }

        album = subsonicResponse?.album;
        metadataCache.set(albumCacheKey, album);
      }

      const songsList: Song[] = album?.song || [];

      // Store artist information — fetch the artist's cover art ID (ar-xxx)
      // so it matches what the preload dialog cached in IDB for offline display.
      if (album?.artistId) {
        setArtistId(album.artistId);
        const artistCacheKey = `artist_${album.artistId}`;
        const cachedArtist = metadataCache.get<{ albums: any[]; coverArt?: string }>(artistCacheKey);
        if (cachedArtist) {
          setArtistCoverArtId(cachedArtist.coverArt || album.artistId);
        } else {
          try {
            const artistResp = await getArtist(serverUrl, username, password, album.artistId);
            const artistData = artistResp.data['subsonic-response']?.artist;
            setArtistCoverArtId(artistData?.coverArt || album.artistId);
            if (artistData) {
              metadataCache.set(artistCacheKey, { albums: artistData.album || [], coverArt: artistData.coverArt });
            }
          } catch {
            setArtistCoverArtId(album.artistId);
          }
        }
      } else {
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
      url: offlineModeEnabled ? '' : getStreamUrl(serverUrl, username, password, song.id),
      duration: song.duration,
      coverArt: song.coverArt || albumCoverArtId || undefined,
      bitRate: (song as any).bitRate,
      suffix: (song as any).suffix,
      size: (song as any).size,
      samplingRate: (song as any).samplingRate,
      channelCount: (song as any).channelCount,
      bitDepth: (song as any).bitDepth,
      year: (song as any).year,
      track: (song as any).track,
      discNumber: (song as any).discNumber,
    }));

    if (isRemoteMode) {
      sendRemoteCommand('playPlaylist', { songs: songsWithUrls, startIndex: index });
    } else {
      playPlaylist(songsWithUrls, index);
    }
  };

  const handlePlayAll = () => {
    handlePlaySong(0);
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
      song: { id: song.id, title: song.title, artist: song.artist, album: song.album, albumId, url: buildSongUrl(song.id), duration: song.duration, coverArt: song.coverArt ?? albumCoverArtId ?? undefined },
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleDownloadAlbum = () => {
    if (isAlbumCached) {
      if (window.confirm('This album is already downloaded. Remove from cache?')) {
        offlineCacheService.removeAlbumFromCache(albumId);
        setIsAlbumCached(false);
      }
      return;
    }

  };

  const handleConfirmDownload = () => {
    const songsToDownload = songs.map(song => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      coverArt: song.coverArt || albumCoverArtId || undefined,
      albumId: albumId,
    }));

    downloadManager.addAlbumToQueue({
      albumId,
      albumName,
      artistName,
      artistId: artistId || undefined,
      artistCoverArtId: artistCoverArtId || undefined,
      songs: songsToDownload,
      quality: downloadQuality,
    });

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
      url: offlineModeEnabled ? '' : getStreamUrl(serverUrl, username, password, song.id),
      duration: song.duration,
      coverArt: song.coverArt || albumCoverArtId || undefined,
      bitRate: (song as any).bitRate,
      suffix: (song as any).suffix,
      size: (song as any).size,
      samplingRate: (song as any).samplingRate,
      channelCount: (song as any).channelCount,
      bitDepth: (song as any).bitDepth,
    }));

    const randomIndex = Math.floor(Math.random() * songsWithUrls.length);

    if (isRemoteMode) {
      sendRemoteCommand('toggleShuffle');
      sendRemoteCommand('playPlaylist', { songs: songsWithUrls, startIndex: randomIndex });
    } else {
      if (!shuffle) toggleShuffle();
      playPlaylist(songsWithUrls, randomIndex);
    }
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
      {/* Album Hero */}
      <div className="album-hero">
        <button className="album-hero-back" onClick={onBack}>
          <i className="fas fa-arrow-left" />
          {fromSearch ? 'Back to Search Results' : (backLabel ?? 'Back to Albums')}
        </button>

        <div className="album-hero-main">
          <div className="album-hero-art-wrap">
            {albumCoverArtId ? (
              <AlbumArt
                coverArtId={albumCoverArtId}
                albumId={albumId}
                alt={albumName}
                size={240}
                className="album-hero-art"
              />
            ) : (
              <div className="album-art-fallback album-hero-art">
                <i className="fas fa-compact-disc" />
              </div>
            )}
          </div>

          <div className="album-hero-info">
            <span className="album-hero-label">Album</span>
            <h1 className="album-hero-title">{albumName}</h1>
            <div className="album-hero-meta">
              {onArtistClick && artistId ? (
                <button
                  className="album-artist-link"
                  onClick={() => onArtistClick(artistId, artistName)}
                  title={`More by ${artistName}`}
                >
                  {artistName}
                </button>
              ) : (
                <span>{artistName}</span>
              )}
              {songs[0]?.year && <><span className="album-hero-dot">•</span><span>{songs[0].year}</span></>}
              <span className="album-hero-dot">•</span>
              <span>{filteredSongs.length} {offlineModeEnabled ? 'cached ' : ''}song{filteredSongs.length !== 1 ? 's' : ''}</span>
              <span className="album-hero-dot">•</span>
              <span>{getTotalDuration()}</span>
              {!offlineModeEnabled && (() => {
                const cachedCount = filteredSongs.filter(s => offlineCacheService.isCached(s.id)).length;
                return cachedCount > 0
                  ? <><span className="album-hero-dot">•</span><span style={{ color: 'var(--primary-color)' }}>{cachedCount} cached</span></>
                  : null;
              })()}
            </div>
          </div>
        </div>

        <div className="album-action-bar">
          <button
            className="album-play-circle"
            onClick={handlePlayAll}
            disabled={filteredSongs.length === 0}
            title="Play album"
          >
            <i className="fas fa-play" />
          </button>
          <button
            className="album-action-icon"
            onClick={handleShuffleAlbum}
            disabled={filteredSongs.length === 0}
            title="Shuffle"
          >
            <i className="fas fa-random" />
          </button>
          {isAlbumCached ? (
            <button
              className="album-action-icon album-action-icon--active"
              onClick={handleDownloadAlbum}
              disabled={songs.length === 0}
              title="Cached — click to remove"
            >
              <i className="fas fa-check-circle" />
            </button>
          ) : (
            <DownloadQualityPicker
              value={downloadQuality}
              onChange={setDownloadQuality}
              onConfirm={handleConfirmDownload}
              confirmLabel={`Download ${songs.length} Song${songs.length !== 1 ? 's' : ''}`}
              triggerClassName="album-action-icon"
              triggerContent={<i className="fas fa-download" />}
            />
          )}
        </div>
      </div>


      {/* Download Manager Window */}
      <DownloadManagerWindow 
        isOpen={showDownloadManager}
        onClose={() => setShowDownloadManager(false)}
      />

      {/* Songs List */}
      {offlineModeEnabled && filteredSongs.length === 0 && songs.length > 0 ? (
        <div className="no-songs" style={{ padding: '60px 20px', textAlign: 'center' }}>
          <i className="fas fa-ban" style={{ fontSize: '64px', color: 'var(--text-secondary)', marginBottom: '20px' }}></i>
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
      ) : filteredSongs.length <= 60 ? (
        <div className="songs-list">
          {filteredSongs.map((song, index) => (
            <div
              key={song.id}
              className={`song-item ${currentSong?.id === song.id ? 'active' : ''}`}
              onClick={() => handlePlaySong(index)}
              onContextMenu={e => handleContextMenu(e, song)}
            >
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
      ) : (
        <div
          className="songs-list"
          style={{ height: Math.min(filteredSongs.length * SONG_ITEM_HEIGHT, 600), overflowY: 'hidden' }}
        >
          <AutoSizer renderProp={({ height, width }: { height: number | undefined; width: number | undefined }) => (
            <List
              rowCount={filteredSongs.length}
              rowHeight={SONG_ITEM_HEIGHT}
              rowComponent={VirtualSongRow}
              rowProps={{ songs: filteredSongs, currentSongId: currentSong?.id, onPlay: handlePlaySong, onContext: handleContextMenu, formatDuration }}
              style={{ height: height ?? 600, width: width ?? '100%' }}
            />
          )} />
        </div>
      )}
      {contextMenu && (
        <SongContextMenu
          song={contextMenu.song}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPlayNow={() => { handlePlaySong(filteredSongs.findIndex(s => s.id === contextMenu.song.id)); setContextMenu(null); }}
          onPlayNext={() => { insertNext(contextMenu.song); setContextMenu(null); }}
          onAddToQueue={() => { addToQueue(contextMenu.song); setContextMenu(null); }}
          onAddToPlaylist={() => { setPlaylistDialogSong(contextMenu.song); setContextMenu(null); }}
          onDownload={() => {
            const s = contextMenu.song;
            downloadManager.addSongToQueue(
              { id: s.id, title: s.title, artist: s.artist, album: s.album, duration: s.duration, coverArt: s.coverArt, albumId: s.albumId },
              s.albumId ?? albumId, s.album, s.artist, downloadQuality,
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

export default SongList;