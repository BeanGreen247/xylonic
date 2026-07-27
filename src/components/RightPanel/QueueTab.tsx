import React, { useMemo, useRef, useState } from 'react';
import { usePlayback } from '../../hooks/usePlayback';
import { getPlaylists, addSongToPlaylist, createPlaylist } from '../../services/playlistService';
import type { Song } from '../../types';

interface AddMenuState {
  song: Song;
  x: number;
  y: number;
}

const formatDuration = (s?: number): string => {
  if (!s) return '';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

interface QueueTabProps {
  searchTerm?: string;
}

const QueueTab: React.FC<QueueTabProps> = ({ searchTerm = '' }) => {
  const { playlist, currentSong, playSong, removeFromQueue, moveInQueue, clearQueue } = usePlayback();
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const currentIndex = playlist.findIndex(s => s.id === currentSong?.id);

  const displayedItems = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return playlist.reduce<Array<{ song: Song; originalIndex: number }>>((acc, song, i) => {
      if (!term || song.title.toLowerCase().includes(term) || song.artist.toLowerCase().includes(term)) {
        acc.push({ song, originalIndex: i });
      }
      return acc;
    }, []);
  }, [playlist, searchTerm]);

  // ── Drag and drop ──────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    (e.currentTarget as HTMLElement).classList.add('drag-over');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).classList.remove('drag-over');
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).classList.remove('drag-over');
    if (dragIndexRef.current !== null && dragIndexRef.current !== toIndex) {
      moveInQueue(dragIndexRef.current, toIndex);
    }
    dragIndexRef.current = null;
  };

  // ── Add to playlist menu ───────────────────────────────────────
  const openAddMenu = (e: React.MouseEvent, song: Song) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAddMenu({ song, x: rect.left, y: rect.bottom + 4 });
  };

  const handleAddToPlaylist = (playlistId: string, song: Song) => {
    addSongToPlaylist(playlistId, song);
    setAddMenu(null);
  };

  const handleAddToNewPlaylist = (song: Song) => {
    const name = prompt('New playlist name:');
    if (name?.trim()) {
      createPlaylist(name.trim(), [song]);
    }
    setAddMenu(null);
  };

  if (playlist.length === 0) {
    return (
      <div className="panel-empty">
        <i className="fas fa-list-music"></i>
        <p>Queue is empty.<br />Play a song to get started.</p>
      </div>
    );
  }

  if (displayedItems.length === 0) {
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
        <span className="panel-section-label">{displayedItems.length} song{displayedItems.length !== 1 ? 's' : ''}</span>
        <button className="panel-section-btn danger" onClick={clearQueue} title="Clear queue">
          <i className="fas fa-trash-alt"></i> Clear
        </button>
      </div>

      {displayedItems.map(({ song, originalIndex }) => (
        <div
          key={`${song.id}-${originalIndex}`}
          className={`panel-song-row${song.id === currentSong?.id ? ' is-current' : ''}`}
          draggable
          onDragStart={e => handleDragStart(e, originalIndex)}
          onDragOver={e => handleDragOver(e, originalIndex)}
          onDragLeave={handleDragLeave}
          onDrop={e => handleDrop(e, originalIndex)}
        >
          <span className="panel-drag-handle" title="Drag to reorder">
            <i className="fas fa-grip-vertical"></i>
          </span>

          <div className="panel-song-info" onClick={() => playSong(song)} style={{ cursor: 'pointer' }}>
            <div className="panel-song-title">
              {song.id === currentSong?.id && (
                <i className="fas fa-volume-up" style={{ fontSize: 10, marginRight: 5, color: 'var(--primary-color)' }}></i>
              )}
              {song.title}
            </div>
            <div className="panel-song-sub">{song.artist}</div>
          </div>

          {song.duration && (
            <span className="panel-song-time">{formatDuration(song.duration)}</span>
          )}

          <div className="panel-song-actions">
            <button
              className="panel-action-btn primary"
              onClick={e => openAddMenu(e, song)}
              title="Add to playlist"
            >
              <i className="fas fa-plus"></i>
            </button>
            <button
              className="panel-action-btn danger"
              onClick={() => removeFromQueue(originalIndex)}
              title="Remove from queue"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>
      ))}

      {/* Add to playlist menu */}
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

export default QueueTab;
