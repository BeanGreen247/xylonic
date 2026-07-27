import React, { useRef, useEffect, useState } from 'react';
import { useSearch } from '../../context/SearchContext';
import { usePlayer } from '../../context/PlayerContext';
import { useRemoteMode } from '../../context/RemoteModeContext';
import { getStreamUrl } from '../../services/subsonicApi';
import { getFromStorage } from '../../utils/storage';
import { downloadManager } from '../../services/downloadManagerService';
import AlbumArt from '../common/AlbumArt';
import SongContextMenu, { ContextMenuSong } from '../common/SongContextMenu';
import AddToPlaylistDialog from '../common/AddToPlaylistDialog';
import DownloadManagerWindow from '../Library/DownloadManagerWindow';
import '../../styles/SearchResults.css';

interface SearchResultsProps {
  onArtistClick?: (artistId: string, artistName: string) => void;
  onAlbumClick?: (albumId: string, albumName: string, artistName: string) => void;
}

const fmt = (s?: number) =>
  s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '--:--';

const SearchResults: React.FC<SearchResultsProps> = ({ onArtistClick, onAlbumClick }) => {
  const {
    inputValue,
    handleInputChange,
    clearSearchInput,
    isLoading,
    isIndexing,
    searchQuery,
    searchResults,
    clearSearch,
    setSearching,
    setNavigatedFromSearch,
  } = useSearch();
  const { playSong, playPlaylist, bitrate, addToQueue, insertNext, currentSong, isPlaying } = usePlayer();
  const { isRemoteMode, sendRemoteCommand } = useRemoteMode();
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<{ song: ContextMenuSong; x: number; y: number } | null>(null);
  const [playlistDialogSong, setPlaylistDialogSong] = useState<ContextMenuSong | null>(null);

  const handleContextMenu = (e: React.MouseEvent, s: { id: string; title: string; artist?: string; album?: string; albumId?: string; duration?: number; coverArt?: string }) => {
    e.preventDefault();
    e.stopPropagation();
    const { serverUrl, username, password } = getFromStorage();
    setContextMenu({
      song: { id: s.id, title: s.title, artist: s.artist ?? '', album: s.album ?? '', albumId: s.albumId, url: getStreamUrl(serverUrl, username, password, s.id, bitrate ?? undefined), duration: s.duration, coverArt: s.coverArt },
      x: e.clientX,
      y: e.clientY,
    });
  };
  const [showDownloadManager, setShowDownloadManager] = useState(false);

  // Auto-focus the mobile input when the search view opens
  useEffect(() => {
    const isMobile = window.innerWidth <= 680;
    if (isMobile) {
      setTimeout(() => mobileInputRef.current?.focus(), 80);
    }
  }, []);

  const buildStreamUrl = (songId: string) => {
    const { serverUrl, username, password } = getFromStorage();
    return getStreamUrl(serverUrl, username, password, songId, bitrate || undefined);
  };

  const handleSongPlay = (songId: string, title: string, artist: string, album: string, duration?: number, coverArt?: string) => {
    const song = { id: songId, title, artist, album, url: buildStreamUrl(songId), duration, coverArt };
    if (isRemoteMode) {
      sendRemoteCommand('playSong', song);
    } else {
      playSong(song);
    }
  };

  const handleArtistNav = (artistId: string, artistName: string) => {
    if (!onArtistClick) return;
    setSearching(false);
    setNavigatedFromSearch(true);
    onArtistClick(artistId, artistName);
  };

  const handleAlbumNav = (albumId: string, albumName: string, artistName: string) => {
    if (!onAlbumClick) return;
    setSearching(false);
    setNavigatedFromSearch(true);
    onAlbumClick(albumId, albumName, artistName);
  };

  const handlePlayAllSongs = () => {
    if (!searchResults?.song?.length) return;
    const { serverUrl, username, password } = getFromStorage();
    const songs = searchResults.song.map(s => ({
      id: s.id,
      title: s.title,
      artist: s.artist || '',
      album: s.album || '',
      url: getStreamUrl(serverUrl, username, password, s.id, bitrate || undefined),
      duration: s.duration,
      coverArt: s.coverArt,
      bitRate: s.bitRate,
      suffix: s.suffix,
      size: s.size,
      samplingRate: s.samplingRate,
      channelCount: s.channelCount,
    }));
    if (isRemoteMode) {
      sendRemoteCommand('playPlaylist', { songs, startIndex: 0 });
    } else {
      playPlaylist(songs, 0);
    }
  };

  // ── Empty / initial state ──────────────────────────────────
  const showEmptyState = !searchQuery && !isLoading;
  const showNoResults  = searchQuery && !isLoading && searchResults && !searchResults.artist?.length && !searchResults.album?.length && !searchResults.song?.length;
  const showResults    = searchResults && (searchResults.artist?.length || searchResults.album?.length || searchResults.song?.length);

  const artists = searchResults?.artist ?? [];
  const albums  = searchResults?.album  ?? [];
  const songs   = searchResults?.song   ?? [];

  // Best result: first artist > first album > first song
  const bestArtist = artists[0] ?? null;
  const bestAlbum  = !bestArtist ? (albums[0] ?? null) : null;
  const bestSong   = !bestArtist && !bestAlbum ? (songs[0] ?? null) : null;

  const topSongs    = songs.slice(0, 5);
  const moreSongs   = songs.slice(5);

  return (
    <div className="sr-root">

      {/* ── Mobile search input ─────────────────────────── */}
      <div className="sr-mobile-bar">
        <div className="sr-mobile-input-wrap">
          <i className="fas fa-search sr-mobile-icon"></i>
          <input
            ref={mobileInputRef}
            type="text"
            value={inputValue}
            onChange={e => handleInputChange(e.target.value)}
            placeholder={isIndexing ? 'Indexing…' : 'Artists, albums, songs…'}
            className="sr-mobile-input"
            disabled={isIndexing}
            aria-label="Search"
          />
          {isLoading && <i className="fas fa-circle-notch fa-spin sr-mobile-spinner"></i>}
          {inputValue && !isLoading && (
            <button className="sr-mobile-clear" onClick={clearSearchInput} aria-label="Clear">
              <i className="fas fa-times"></i>
            </button>
          )}
        </div>
      </div>

      {/* ── Desktop back button ─────────────────────────── */}
      <div className="sr-desktop-header">
        <button className="back-button sr-back" onClick={clearSearch}>
          <i className="fas fa-arrow-left"></i>
          Back to Library
        </button>
        {searchQuery && <p className="sr-query-label">Results for <em>"{searchQuery}"</em></p>}
        {isLoading && <i className="fas fa-circle-notch fa-spin sr-desktop-spinner"></i>}
      </div>

      {/* ── Empty / initial state ───────────────────────── */}
      {showEmptyState && (
        <div className="sr-empty">
          <i className="fas fa-search sr-empty-icon"></i>
          <p>What do you want to listen to?</p>
        </div>
      )}

      {/* ── No results ──────────────────────────────────── */}
      {showNoResults && (
        <div className="sr-empty">
          <i className="fas fa-music sr-empty-icon"></i>
          <p>No results found for <strong>"{searchQuery}"</strong></p>
          <span>Try different keywords or check the spelling.</span>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────── */}
      {showResults && (
        <div className="sr-body">

          {/* Top section: Best Result + Top Songs */}
          {(bestArtist || bestAlbum || bestSong || topSongs.length > 0) && (
            <div className="sr-top">

              {/* Best Result */}
              {(bestArtist || bestAlbum || bestSong) && (
                <div className="sr-best">
                  <h2 className="sr-section-title">Best Result</h2>
                  {bestArtist && (
                    <div
                      className="sr-best-card sr-best-artist"
                      onClick={() => handleArtistNav(bestArtist.id, bestArtist.name)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && handleArtistNav(bestArtist.id, bestArtist.name)}
                    >
                      <div className="sr-best-art sr-art-circle">
                        <AlbumArt coverArtId={bestArtist.coverArt} alt={bestArtist.name} size={160} />
                      </div>
                      <div className="sr-best-info">
                        <span className="sr-best-name">{bestArtist.name}</span>
                        <span className="sr-best-type">Artist</span>
                      </div>
                      <button
                        className="sr-best-play"
                        aria-label={`Play ${bestArtist.name}`}
                        onClick={e => { e.stopPropagation(); handleArtistNav(bestArtist.id, bestArtist.name); }}
                      >
                        <i className="fas fa-play"></i>
                      </button>
                    </div>
                  )}
                  {bestAlbum && (
                    <div
                      className="sr-best-card"
                      onClick={() => handleAlbumNav(bestAlbum.id, bestAlbum.name, bestAlbum.artist ?? '')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && handleAlbumNav(bestAlbum.id, bestAlbum.name, bestAlbum.artist ?? '')}
                    >
                      <div className="sr-best-art sr-art-square">
                        <AlbumArt coverArtId={bestAlbum.coverArt} alt={bestAlbum.name} size={160} />
                      </div>
                      <div className="sr-best-info">
                        <span className="sr-best-name">{bestAlbum.name}</span>
                        <span className="sr-best-type">Album · {bestAlbum.artist}</span>
                      </div>
                      <button
                        className="sr-best-play"
                        aria-label={`Open ${bestAlbum.name}`}
                        onClick={e => { e.stopPropagation(); handleAlbumNav(bestAlbum.id, bestAlbum.name, bestAlbum.artist ?? ''); }}
                      >
                        <i className="fas fa-play"></i>
                      </button>
                    </div>
                  )}
                  {bestSong && (
                    <div
                      className="sr-best-card"
                      onClick={() => handleSongPlay(bestSong.id, bestSong.title, bestSong.artist ?? '', bestSong.album ?? '', bestSong.duration, bestSong.coverArt)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && handleSongPlay(bestSong.id, bestSong.title, bestSong.artist ?? '', bestSong.album ?? '', bestSong.duration, bestSong.coverArt)}
                    >
                      <div className="sr-best-art sr-art-square">
                        <AlbumArt coverArtId={bestSong.coverArt} alt={bestSong.title} size={160} />
                      </div>
                      <div className="sr-best-info">
                        <span className="sr-best-name">{bestSong.title}</span>
                        <span className="sr-best-type">Song · {bestSong.artist}</span>
                      </div>
                      <button
                        className="sr-best-play"
                        aria-label={`Play ${bestSong.title}`}
                        onClick={e => { e.stopPropagation(); handleSongPlay(bestSong.id, bestSong.title, bestSong.artist ?? '', bestSong.album ?? '', bestSong.duration, bestSong.coverArt); }}
                      >
                        <i className="fas fa-play"></i>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Top Songs */}
              {topSongs.length > 0 && (
                <div className="sr-top-songs">
                  <div className="sr-section-header">
                    <h2 className="sr-section-title">Songs</h2>
                    {songs.length > 1 && (
                      <button className="sr-play-all" onClick={handlePlayAllSongs}>
                        <i className="fas fa-play"></i> Play all
                      </button>
                    )}
                  </div>
                  <div className="sr-song-list">
                    {topSongs.map((s) => (
                      <div
                        key={s.id}
                        className={`song-item all-songs-item${currentSong?.id === s.id ? ' active' : ''}`}
                        onClick={() => handleSongPlay(s.id, s.title, s.artist ?? '', s.album ?? '', s.duration, s.coverArt)}
                        onContextMenu={e => handleContextMenu(e, s)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && handleSongPlay(s.id, s.title, s.artist ?? '', s.album ?? '', s.duration, s.coverArt)}
                      >
                        <div className="all-songs-art">
                          <AlbumArt coverArtId={s.coverArt} alt={s.title} size={48} className="all-songs-thumbnail" />
                          <div className="song-art-overlay">
                            {currentSong?.id === s.id && isPlaying
                              ? <><div className="equalizer-bars song-art-eq" aria-label="Now playing"><span /><span /><span /></div><i className="fas fa-pause song-art-icon" /></>
                              : <i className="fas fa-play song-art-icon" />
                            }
                          </div>
                        </div>
                        <div className="song-info">
                          <div className="song-title">{s.title}</div>
                          <div className="song-artist">{s.artist}</div>
                        </div>
                        <div className="song-meta">
                          <span className="song-duration">{fmt(s.duration)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Artists row */}
          {artists.length > 0 && (
            <section className="sr-section">
              <h2 className="sr-section-title">Artists</h2>
              <div className="sr-scroll-row">
                {artists.map(a => (
                  <div
                    key={a.id}
                    className="sr-artist-card"
                    onClick={() => handleArtistNav(a.id, a.name)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && handleArtistNav(a.id, a.name)}
                  >
                    <div className="sr-artist-art">
                      <AlbumArt coverArtId={a.coverArt} alt={a.name} size={140} />
                      <div className="sr-artist-overlay"><i className="fas fa-play"></i></div>
                    </div>
                    <span className="sr-card-name">{a.name}</span>
                    <span className="sr-card-sub">{a.albumCount ? `${a.albumCount} album${a.albumCount !== 1 ? 's' : ''}` : 'Artist'}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Albums row */}
          {albums.length > 0 && (
            <section className="sr-section">
              <h2 className="sr-section-title">Albums</h2>
              <div className="sr-scroll-row">
                {albums.map(a => (
                  <div
                    key={a.id}
                    className="sr-album-card"
                    onClick={() => handleAlbumNav(a.id, a.name, a.artist ?? '')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && handleAlbumNav(a.id, a.name, a.artist ?? '')}
                  >
                    <div className="sr-album-art">
                      <AlbumArt coverArtId={a.coverArt} alt={a.name} size={140} />
                      <div className="sr-album-overlay"><i className="fas fa-play"></i></div>
                    </div>
                    <span className="sr-card-name">{a.name}</span>
                    <span className="sr-card-sub">{a.year ? `${a.year} · ` : ''}{a.artist}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* More songs */}
          {moreSongs.length > 0 && (
            <section className="sr-section">
              <h2 className="sr-section-title">More Songs</h2>
              <div className="sr-song-list sr-song-list-full">
                {moreSongs.map((s) => (
                  <div
                    key={s.id}
                    className={`song-item all-songs-item${currentSong?.id === s.id ? ' active' : ''}`}
                    onClick={() => handleSongPlay(s.id, s.title, s.artist ?? '', s.album ?? '', s.duration, s.coverArt)}
                    onContextMenu={e => handleContextMenu(e, s)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && handleSongPlay(s.id, s.title, s.artist ?? '', s.album ?? '', s.duration, s.coverArt)}
                  >
                    <div className="all-songs-art">
                      <AlbumArt coverArtId={s.coverArt} alt={s.title} size={48} className="all-songs-thumbnail" />
                      <div className="song-art-overlay">
                        {currentSong?.id === s.id && isPlaying
                          ? <><div className="equalizer-bars song-art-eq" aria-label="Now playing"><span /><span /><span /></div><i className="fas fa-pause song-art-icon" /></>
                          : <i className="fas fa-play song-art-icon" />
                        }
                      </div>
                    </div>
                    <div className="song-info">
                      <div className="song-title">{s.title}</div>
                      <div className="song-artist">{s.artist}{s.album && <span className="all-songs-album"> · {s.album}</span>}</div>
                    </div>
                    <div className="song-meta">
                      <span className="song-duration">{fmt(s.duration)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      )}
      {contextMenu && (
        <SongContextMenu
          song={contextMenu.song}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onPlayNow={() => { handleSongPlay(contextMenu.song.id, contextMenu.song.title, contextMenu.song.artist, contextMenu.song.album, contextMenu.song.duration, contextMenu.song.coverArt); setContextMenu(null); }}
          onPlayNext={() => { insertNext(contextMenu.song); setContextMenu(null); }}
          onAddToQueue={() => { addToQueue(contextMenu.song); setContextMenu(null); }}
          onAddToPlaylist={() => { setPlaylistDialogSong(contextMenu.song); setContextMenu(null); }}
          onDownload={() => {
            const s = contextMenu.song;
            downloadManager.addSongToQueue(
              { id: s.id, title: s.title, artist: s.artist, album: s.album, duration: s.duration, coverArt: s.coverArt, albumId: s.albumId },
              s.albumId ?? s.id, s.album, s.artist, '320',
            );
            setShowDownloadManager(true);
            setContextMenu(null);
          }}
        />
      )}
      {playlistDialogSong && (
        <AddToPlaylistDialog song={playlistDialogSong} onClose={() => setPlaylistDialogSong(null)} />
      )}
      <DownloadManagerWindow isOpen={showDownloadManager} onClose={() => setShowDownloadManager(false)} />
    </div>
  );
};

export default SearchResults;
