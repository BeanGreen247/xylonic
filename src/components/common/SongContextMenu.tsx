import React, { useEffect, useRef, useState } from 'react';
import './SongContextMenu.css';

export interface ContextMenuSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  url: string;
  duration?: number;
  coverArt?: string;
}

interface Props {
  song: ContextMenuSong;
  x: number;
  y: number;
  onClose: () => void;
  onPlayNow: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
  onAddToPlaylist: () => void;
  onDownload?: () => void;
}

const SongContextMenu: React.FC<Props> = ({
  song, x, y, onClose,
  onPlayNow, onPlayNext, onAddToQueue, onAddToPlaylist, onDownload,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Clamp to viewport so the menu never renders off-screen
  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth  - width  - 8),
      y: Math.min(y, window.innerHeight - height - 8),
    });
  }, [x, y]);

  const run = (fn: () => void) => { fn(); onClose(); };

  return (
    <>
      <div className="ctx-backdrop" onMouseDown={onClose} onContextMenu={e => { e.preventDefault(); onClose(); }} />
      <div className="ctx-menu" ref={menuRef} style={{ left: pos.x, top: pos.y }}>
        <div className="ctx-header">
          <span className="ctx-song-title">{song.title}</span>
          <span className="ctx-song-artist">{song.artist}</span>
        </div>

        <button className="ctx-item" onClick={() => run(onPlayNow)}>
          <i className="fas fa-play" /> Play Now
        </button>
        <button className="ctx-item" onClick={() => run(onPlayNext)}>
          <i className="fas fa-step-forward" /> Play Next
        </button>
        <button className="ctx-item" onClick={() => run(onAddToQueue)}>
          <i className="fas fa-list-ul" /> Add to Queue
        </button>

        <div className="ctx-separator" />

        <button className="ctx-item" onClick={() => run(onAddToPlaylist)}>
          <i className="fas fa-plus" /> Add to Playlist…
        </button>

        {onDownload && (
          <>
            <div className="ctx-separator" />
            <button className="ctx-item" onClick={() => run(onDownload)}>
              <i className="fas fa-download" /> Download
            </button>
          </>
        )}
      </div>
    </>
  );
};

export default SongContextMenu;
