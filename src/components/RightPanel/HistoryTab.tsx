import React, { useEffect, useState } from 'react';
import { usePlayback } from '../../hooks/usePlayback';
import { getHistory, clearHistory, HistoryEntry } from '../../services/recentlyPlayedService';
import { getPlaylists, addSongToPlaylist, createPlaylist } from '../../services/playlistService';
import { Song } from '../../types';
import { getFromStorage } from '../../utils/storage';
import { getStreamUrl } from '../../services/subsonicApi';

interface AddMenuState {
  song: Song;
  x: number;
  y: number;
}

const timeAgo = (ts: number): string => {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

interface HistoryTabProps {
  searchTerm?: string;
}

const HistoryTab: React.FC<HistoryTabProps> = ({ searchTerm = '' }) => {
  const { playSong, addToQueue, bitrate, currentSong } = usePlayback();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null);

  useEffect(() => {
    setHistory(getHistory());
  }, []);

  // Refresh history whenever the current song changes (new entry was added)
  useEffect(() => {
    setHistory(getHistory());
  }, [currentSong?.id]);

  const handleClear = () => {
    clearHistory();
    setHistory([]);
  };

  const getUrl = (song: HistoryEntry): string => {
    const { username, password, serverUrl } = getFromStorage();
    return getStreamUrl(username, password, serverUrl, song.id, bitrate || undefined);
  };

  const handlePlay = (entry: HistoryEntry) => {
    const url = getUrl(entry);
    playSong({ ...entry, url });
  };

  const handleAddToQueue = (entry: HistoryEntry) => {
    const url = getUrl(entry);
    addToQueue({ ...entry, url });
  };

  const openAddMenu = (e: React.MouseEvent, song: HistoryEntry) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAddMenu({ song: { ...song, url: getUrl(song) }, x: rect.left, y: rect.bottom + 4 });
  };

  const handleAddToPlaylist = (playlistId: string, song: Song) => {
    addSongToPlaylist(playlistId, song);
    setAddMenu(null);
  };

  const handleAddToNewPlaylist = (song: Song) => {
    const name = prompt('New playlist name:');
    if (name?.trim()) createPlaylist(name.trim(), [song]);
    setAddMenu(null);
  };

  const term = searchTerm.toLowerCase();
  const displayedHistory = term
    ? history.filter(e => e.title.toLowerCase().includes(term) || e.artist.toLowerCase().includes(term))
    : history;

  if (history.length === 0) {
    return (
      <div className="panel-empty">
        <i className="fas fa-history"></i>
        <p>No recently played songs yet.<br />Start playing to build your history.</p>
      </div>
    );
  }

  if (displayedHistory.length === 0) {
    return (
      <div className="panel-empty">
        <i className="fas fa-search"></i>
        <p>No results for "{searchTerm}"</p>
      </div>
    );
  }

  const playlists = getPlaylists();

  return (
    <>
      <div className="panel-section-header">
        <span className="panel-section-label">{displayedHistory.length} song{displayedHistory.length !== 1 ? 's' : ''}</span>
        <button className="panel-section-btn danger" onClick={handleClear} title="Clear history">
          <i className="fas fa-trash-alt"></i> Clear
        </button>
      </div>

      {displayedHistory.map((entry, index) => (
        <div key={`${entry.id}-${index}`} className="panel-song-row">
          <div className="panel-song-info">
            <div className="panel-song-title">{entry.title}</div>
            <div className="panel-song-sub">{entry.artist} · {timeAgo(entry.playedAt)}</div>
          </div>

          <div className="panel-song-actions">
            <button
              className="panel-action-btn"
              onClick={() => handleAddToQueue(entry)}
              title="Add to queue"
            >
              <i className="fas fa-list-ul"></i>
            </button>
            <button
              className="panel-action-btn primary"
              onClick={e => openAddMenu(e, entry)}
              title="Add to playlist"
            >
              <i className="fas fa-plus"></i>
            </button>
            <button
              className="panel-action-btn primary"
              onClick={() => handlePlay(entry)}
              title="Play"
            >
              <i className="fas fa-play"></i>
            </button>
          </div>
        </div>
      ))}

      {addMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
            onClick={() => setAddMenu(null)}
          />
          <div
            className="add-to-playlist-menu"
            style={{ top: Math.min(addMenu.y, window.innerHeight - 200), left: Math.max(addMenu.x - 140, 8) }}
          >
            {playlists.length === 0 && (
              <div className="add-to-playlist-menu-empty">No playlists yet</div>
            )}
            {playlists.map(pl => (
              <button
                key={pl.id}
                className="add-to-playlist-menu-item"
                onClick={() => handleAddToPlaylist(pl.id, addMenu.song)}
              >
                <i className="fas fa-list"></i>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pl.name}
                </span>
              </button>
            ))}
            <button
              className="add-to-playlist-menu-item create-new"
              onClick={() => handleAddToNewPlaylist(addMenu.song)}
            >
              <i className="fas fa-plus"></i> New Playlist
            </button>
          </div>
        </>
      )}
    </>
  );
};

export default HistoryTab;
