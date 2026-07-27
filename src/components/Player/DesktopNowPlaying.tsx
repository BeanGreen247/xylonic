import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { usePlayer, usePlayerTime } from '../../context/PlayerContext';
import { useUI } from '../../context/UIContext';
import { usePlayback } from '../../hooks/usePlayback';
import AlbumArt from '../common/AlbumArt';
import ProgressBar from './ProgressBar';
import './DesktopNowPlaying.css';

const fmt = (s?: number): string => {
  if (s == null) return '–';
  if (!s) return '';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const DRAG_THRESHOLD = 80;

const DesktopNowPlaying: React.FC = () => {
  const { desktopNowPlayingOpen, closeDesktopNowPlaying } = useUI();
  const {
    currentSong, isPlaying, isLoading, isLiked,
    shuffle, repeat,
    togglePlayPause, playNext, playPrevious,
    toggleShuffle, toggleRepeat, toggleLike, seek,
  } = usePlayer();
  const { currentTime, duration } = usePlayerTime();
  const { playlist, playSong } = usePlayback();
  const queueRef    = useRef<HTMLDivElement>(null);
  const overlayRef  = useRef<HTMLDivElement>(null);
  const dragTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Mouse drag (desktop) ─────────────────────────────────────
  const isDraggingRef  = useRef(false);
  const dragStartYRef  = useRef(0);
  const dragDyRef      = useRef(0);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.dnp-queue-list')) return;
    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragDyRef.current = 0;
    if (overlayRef.current) overlayRef.current.classList.add('dnp-dragging');
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dy = e.clientY - dragStartYRef.current;
      if (dy <= 0) return;
      dragDyRef.current = dy;
      const offset = Math.min(dy * 0.6, 220);
      if (overlayRef.current) {
        overlayRef.current.style.transition = 'none';
        overlayRef.current.style.transform  = `translateY(${offset}px)`;
      }
    };

    const handleMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      if (overlayRef.current) overlayRef.current.classList.remove('dnp-dragging');
      const dy = dragDyRef.current;
      dragDyRef.current = 0;
      if (dy > DRAG_THRESHOLD) {
        if (overlayRef.current) {
          overlayRef.current.style.transition = 'transform 0.2s ease-in';
          overlayRef.current.style.transform  = 'translateY(100%)';
        }
        dragTimerRef.current = setTimeout(() => {
          if (overlayRef.current) { overlayRef.current.style.transition = ''; overlayRef.current.style.transform = ''; }
          closeDesktopNowPlaying();
        }, 200);
      } else {
        if (overlayRef.current) {
          overlayRef.current.style.transition = 'transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)';
          overlayRef.current.style.transform  = '';
          setTimeout(() => { if (overlayRef.current) overlayRef.current.style.transition = ''; }, 280);
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup',   handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup',   handleMouseUp);
    };
  }, [closeDesktopNowPlaying]);

  // ── Touch swipe (Android tablet / large-screen) ──────────────
  const touchActiveRef  = useRef(false);
  const touchStartYRef  = useRef(0);
  const touchStartXRef  = useRef(0);
  const touchDyRef      = useRef(0);
  const touchLockedRef  = useRef(false); // true once we know it's a horizontal scroll

  const handleTouchStart = (e: React.TouchEvent) => {
    touchActiveRef.current = false;
    if ((e.target as HTMLElement).closest('.dnp-queue-list')) return;
    // Reset any horizontal scroll the browser may have accumulated on the overlay
    if (overlayRef.current && overlayRef.current.scrollLeft !== 0) {
      overlayRef.current.scrollLeft = 0;
    }
    touchActiveRef.current = true;
    touchLockedRef.current = false;
    touchStartYRef.current = e.touches[0].clientY;
    touchStartXRef.current = e.touches[0].clientX;
    touchDyRef.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchActiveRef.current) return;
    const dy = e.touches[0].clientY - touchStartYRef.current;
    const dx = Math.abs(e.touches[0].clientX - touchStartXRef.current);
    // Lock out if the gesture is more horizontal than vertical
    if (!touchLockedRef.current && dx > Math.abs(dy) && dx > 8) {
      touchLockedRef.current = true;
    }
    if (touchLockedRef.current || dy <= 0) return;
    touchDyRef.current = dy;
    const offset = Math.min(dy * 0.55, 220);
    if (overlayRef.current) {
      overlayRef.current.style.transition = 'none';
      overlayRef.current.style.transform  = `translateY(${offset}px)`;
    }
  };

  const handleTouchEnd = () => {
    if (!touchActiveRef.current) return;
    touchActiveRef.current = false;
    touchLockedRef.current = false;
    const dy = touchDyRef.current;
    touchDyRef.current = 0;
    if (dy > DRAG_THRESHOLD) {
      if (overlayRef.current) {
        overlayRef.current.style.transition = 'transform 0.2s ease-in';
        overlayRef.current.style.transform  = 'translateY(100%)';
      }
      dragTimerRef.current = setTimeout(() => {
        if (overlayRef.current) { overlayRef.current.style.transition = ''; overlayRef.current.style.transform = ''; }
        closeDesktopNowPlaying();
      }, 200);
    } else {
      if (overlayRef.current) {
        overlayRef.current.style.transition = 'transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)';
        overlayRef.current.style.transform  = '';
        setTimeout(() => { if (overlayRef.current) overlayRef.current.style.transition = ''; }, 280);
      }
    }
  };

  // Reset any horizontal scroll before the first paint (safety net for browsers without overflow:clip)
  useLayoutEffect(() => {
    if (desktopNowPlayingOpen && overlayRef.current) {
      overlayRef.current.scrollLeft = 0;
    }
  }, [desktopNowPlayingOpen]);

  // Close on Escape
  useEffect(() => {
    if (!desktopNowPlayingOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDesktopNowPlaying(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktopNowPlayingOpen, closeDesktopNowPlaying]);

  // Scroll the current song into view — manual scroll of the queue list only,
  // never propagates to ancestor elements (scrollIntoView does, which was the bug)
  useEffect(() => {
    if (!desktopNowPlayingOpen) return;
    const list = queueRef.current;
    const el   = list?.querySelector<HTMLElement>('.dnp-queue-row.is-current');
    if (!list || !el) return;
    const elTop    = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const listTop  = list.scrollTop;
    const listBot  = listTop + list.clientHeight;
    if (elBottom > listBot) {
      list.scrollTop = elBottom - list.clientHeight;
    } else if (elTop < listTop) {
      list.scrollTop = elTop;
    }
  }, [currentSong?.id, desktopNowPlayingOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => () => {
    if (dragTimerRef.current) clearTimeout(dragTimerRef.current);
  }, []);

  if (!desktopNowPlayingOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="dnp-overlay"
      role="dialog"
      aria-label="Now Playing"
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Ambient blurred background */}
      <div className="dnp-bg" aria-hidden="true">
        {currentSong?.coverArt && (
          <AlbumArt coverArtId={currentSong.coverArt} alt="" size={400} className="dnp-bg-img" />
        )}
      </div>
      <div className="dnp-bg-scrim" aria-hidden="true" />

      {/* Drag handle */}
      <div className="dnp-drag-handle" aria-hidden="true">
        <div className="dnp-drag-handle-bar" />
      </div>

      {/* Top bar */}
      <div className="dnp-topbar">
        <span className="dnp-topbar-label">Now Playing</span>
        <button className="dnp-close" onClick={closeDesktopNowPlaying} aria-label="Close">
          <i className="fas fa-times" />
        </button>
      </div>

      {/* Main two-column body */}
      <div className="dnp-body">

        {/* Left — art + info */}
        <div className="dnp-left">
          <div className="dnp-art-wrap" onClick={togglePlayPause}>
            {currentSong?.coverArt ? (
              <AlbumArt
                coverArtId={currentSong.coverArt}
                alt={currentSong.title || ''}
                size={800}
                className="dnp-art-img"
              />
            ) : (
              <div className="dnp-art-fallback"><i className="fas fa-music" /></div>
            )}
          </div>

          <div className="dnp-info">
            <div className="dnp-title">{currentSong?.title || 'No song playing'}</div>
            <div className="dnp-artist">{currentSong?.artist || '—'}</div>
          </div>

          <button
            className={`dnp-like-btn${isLiked ? ' active' : ''}`}
            onClick={toggleLike}
            disabled={!currentSong}
            aria-label={isLiked ? 'Unlike' : 'Like'}
          >
            <i className={`fa${isLiked ? 's' : 'r'} fa-heart`} />
          </button>
        </div>

        {/* Right — Up Next queue */}
        <div className="dnp-right">
          <div className="dnp-queue-header">Up Next</div>
          <div className="dnp-queue-list" ref={queueRef}>
            {playlist.length === 0 ? (
              <div className="dnp-queue-empty">
                <i className="fas fa-list-music" />
                <p>Queue is empty</p>
              </div>
            ) : playlist.map((song, i) => {
              const isCurrent = song.id === currentSong?.id;
              return (
                <div
                  key={`${song.id}-${i}`}
                  className={`dnp-queue-row${isCurrent ? ' is-current' : ''}`}
                  onClick={() => playSong(song)}
                >
                  <div className="dnp-queue-art">
                    <AlbumArt coverArtId={song.coverArt} alt={song.title} size={48} />
                    {isCurrent && (
                      <div className="dnp-queue-playing-icon">
                        <i className="fas fa-volume-up" />
                      </div>
                    )}
                  </div>
                  <div className="dnp-queue-info">
                    <div className="dnp-queue-title">{song.title}</div>
                    <div className="dnp-queue-artist">{song.artist}</div>
                  </div>
                  <div className="dnp-queue-duration">{fmt(song.duration)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="dnp-controls">
        <ProgressBar currentTime={currentTime} duration={duration} onSeek={seek} />
        <div className="dnp-controls-row">
          <button
            className={`dnp-ctrl secondary${shuffle ? ' active' : ''}`}
            onClick={toggleShuffle}
            aria-label="Shuffle"
          >
            <i className="fas fa-random" />
          </button>
          <button className="dnp-ctrl" onClick={playPrevious} aria-label="Previous">
            <i className="fas fa-step-backward" />
          </button>
          <button
            className="dnp-ctrl dnp-play-btn"
            onClick={togglePlayPause}
            disabled={!currentSong}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isLoading
              ? <span className="dnp-spinner" />
              : <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`} />}
          </button>
          <button className="dnp-ctrl" onClick={playNext} aria-label="Next">
            <i className="fas fa-step-forward" />
          </button>
          <button
            className={`dnp-ctrl secondary${repeat !== 'off' ? ' active' : ''}`}
            onClick={toggleRepeat}
            aria-label={`Repeat: ${repeat}`}
          >
            <i className="fas fa-redo" />
            {repeat === 'one' && <span className="dnp-repeat-badge">1</span>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DesktopNowPlaying;
