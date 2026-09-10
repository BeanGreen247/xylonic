import React, { useMemo, useRef, useState, useEffect } from 'react';
import { List, RowComponentProps } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import { usePlayback } from '../../hooks/usePlayback';
import { useLayoutMode } from '../../context/LayoutModeContext';
import { getPlaylists, addSongToPlaylist, createPlaylist } from '../../services/playlistService';
import type { Song } from '../../types';

interface AddMenuState {
  song: Song;
  x: number;
  y: number;
}

// Above this many rows the list is virtualised (react-window). Below it we render
// every row so native HTML5 drag-to-reorder keeps working — impractical on a
// thousand-row queue anyway, and touch devices can't drag at all.
const VIRTUAL_THRESHOLD = 60;

const formatDuration = (s?: number): string => {
  if (!s) return '';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

interface QueueTabProps {
  searchTerm?: string;
}

type QueueItem = { song: Song; originalIndex: number };

interface VirtualRowData {
  items: QueueItem[];
  currentSongId?: string;
  onPlay: (song: Song) => void;
  onRemove: (originalIndex: number) => void;
  onOpenAddMenu: (e: React.MouseEvent, song: Song) => void;
}

const VirtualQueueRow = React.memo((props: RowComponentProps<VirtualRowData>) => {
  const { index, style, items, currentSongId, onPlay, onRemove, onOpenAddMenu } =
    props as typeof props & VirtualRowData;
  const { song } = items[index];
  const isCurrent = song.id === currentSongId;
  return (
    <div style={style} className={`panel-song-row${isCurrent ? ' is-current' : ''}`}>
      <div className="panel-song-info" onClick={() => onPlay(song)} style={{ cursor: 'pointer' }}>
        <div className="panel-song-title">
          {isCurrent && (
            <i className="fas fa-volume-up" style={{ fontSize: 10, marginRight: 5, color: 'var(--primary-color)' }}></i>
          )}
          {song.title}
        </div>
        <div className="panel-song-sub">{song.artist}</div>
      </div>

      {song.duration && <span className="panel-song-time">{formatDuration(song.duration)}</span>}

      <div className="panel-song-actions">
        <button
          className="panel-action-btn primary"
          onClick={e => onOpenAddMenu(e, song)}
          title="Add to playlist" aria-label="Add to playlist"
        >
          <i className="fas fa-plus"></i>
        </button>
        <button
          className="panel-action-btn danger"
          onClick={() => onRemove(items[index].originalIndex)}
          title="Remove from queue" aria-label="Remove from queue"
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
    </div>
  );
});
VirtualQueueRow.displayName = 'VirtualQueueRow';

const QueueTab: React.FC<QueueTabProps> = ({ searchTerm = '' }) => {
  const { playlist, currentSong, playSong, removeFromQueue, moveInQueue, clearQueue } = usePlayback();
  const { isCoarsePointer } = useLayoutMode();
  const [addMenu, setAddMenu] = useState<AddMenuState | null>(null);
  const dragIndexRef = useRef<number | null>(null);

  const rowHeight = isCoarsePointer ? 85 : 50;

  // Height available to the virtualised list — the panel content area minus the
  // section header. Measured off a sentinel so it tracks resize / orientation.
  const listWrapRef = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(480);
  useEffect(() => {
    const measure = () => {
      const el = listWrapRef.current;
      if (el) setListHeight(Math.max(160, window.innerHeight - el.getBoundingClientRect().top - 8));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const displayedItems = useMemo<QueueItem[]>(() => {
    const term = searchTerm.toLowerCase();
    return playlist.reduce<QueueItem[]>((acc, song, i) => {
      if (!term || song.title.toLowerCase().includes(term) || song.artist.toLowerCase().includes(term)) {
        acc.push({ song, originalIndex: i });
      }
      return acc;
    }, []);
  }, [playlist, searchTerm]);

  // ── Drag and drop (natural-render path only) ───────────────────
  const handleDragStart = (e: React.DragEvent, index: number) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
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
  const virtualise = displayedItems.length > VIRTUAL_THRESHOLD;

  return (
    <>
      <div className="panel-section-header">
        <span className="panel-section-label" role="status" aria-live="polite">{displayedItems.length} song{displayedItems.length !== 1 ? 's' : ''}</span>
        <button className="panel-section-btn danger" onClick={clearQueue} title="Clear queue">
          <i className="fas fa-trash-alt"></i> Clear
        </button>
      </div>

      {virtualise ? (
        <div ref={listWrapRef} style={{ height: listHeight }}>
          <AutoSizer renderProp={({ height, width }: { height: number | undefined; width: number | undefined }) => (
            <List
              rowCount={displayedItems.length}
              rowHeight={rowHeight}
              rowComponent={VirtualQueueRow}
              rowProps={{
                items: displayedItems,
                currentSongId: currentSong?.id,
                onPlay: playSong,
                onRemove: removeFromQueue,
                onOpenAddMenu: openAddMenu,
              }}
              style={{ height: height ?? listHeight, width: width ?? '100%' }}
            />
          )} />
        </div>
      ) : (
        displayedItems.map(({ song, originalIndex }) => (
          <div
            key={`${song.id}-${originalIndex}`}
            className={`panel-song-row${song.id === currentSong?.id ? ' is-current' : ''}`}
            draggable
            onDragStart={e => handleDragStart(e, originalIndex)}
            onDragOver={handleDragOver}
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
                title="Add to playlist" aria-label="Add to playlist"
              >
                <i className="fas fa-plus"></i>
              </button>
              <button
                className="panel-action-btn danger"
                onClick={() => removeFromQueue(originalIndex)}
                title="Remove from queue" aria-label="Remove from queue"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          </div>
        ))
      )}

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
