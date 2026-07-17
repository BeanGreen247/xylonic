import React, { useEffect, useRef, useState } from 'react';
import { usePlayer, usePlayerTime } from '../../context/PlayerContext';
import { useUI } from '../../context/UIContext';
import { useRemoteMode } from '../../context/RemoteModeContext';
import { getSongMetadata, SongAudioMeta } from '../../services/subsonicApi';
import { getFromStorage } from '../../utils/storage';
import { offlineCacheService } from '../../services/offlineCacheService';
import AlbumArt from '../common/AlbumArt';
import ProgressBar from './ProgressBar';
import StreamingQualitySelector from './StreamingQualitySelector';
import SpeedSelector from './SpeedSelector';
import AddToPlaylistDialog from '../common/AddToPlaylistDialog';
import './NowPlayingOverlay.css';

const SWIPE_THRESHOLD = 50;

const formatBytes = (bytes?: number): string => {
  if (!bytes) return '—';
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

const formatHz = (hz?: number): string => {
  if (!hz) return '—';
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`;
};

const NowPlayingOverlay: React.FC = () => {
  const { nowPlayingOpen, closeNowPlaying } = useUI();
  const {
    currentSong, isPlaying, isLoading, isLiked,
    shuffle, repeat, nextSong, prevSong,
    togglePlayPause, playNext, playPrevious, playPreviousForced,
    toggleShuffle, toggleRepeat, toggleLike, seek,
  } = usePlayer();

  const { currentTime, duration } = usePlayerTime();

  const {
    isRemoteMode, remoteTarget,
    remotePlayerState, remoteCurrentTime,
    sendRemoteCommand,
  } = useRemoteMode();

  const displaySong     = isRemoteMode ? (remotePlayerState?.song    ?? null)  : currentSong;
  const displayPlaying  = isRemoteMode ? (remotePlayerState?.isPlaying ?? false) : isPlaying;
  const displayTime     = isRemoteMode ? remoteCurrentTime                      : currentTime;
  const displayDuration = isRemoteMode ? (remotePlayerState?.duration  ?? 0)   : duration;
  // Neighbors are local-only; remote mode doesn't expose adjacent songs
  const displayNext = isRemoteMode ? null : nextSong;
  const displayPrev = isRemoteMode ? null : prevSong;

  // ── Remote pending state ─────────────────────────────────────────────────
  // Shows the spinner immediately when a play/skip command is sent and clears
  // as soon as the next state broadcast arrives from the desktop (≤ 1s with
  // the current broadcast interval), or after 1.5s max as a safety fallback.
  const [remotePending, setRemotePending] = useState(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStartRef = useRef(0);

  const markPending = () => {
    pendingStartRef.current = Date.now();
    setRemotePending(true);
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(() => setRemotePending(false), 1500);
  };

  // Clear once an updated state broadcast arrives (400 ms min to skip any
  // stale broadcast that was already in-flight when we sent the command).
  useEffect(() => {
    if (remotePending && Date.now() - pendingStartRef.current > 400) {
      setRemotePending(false);
      if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
    }
  }, [remotePlayerState]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTogglePlay    = isRemoteMode ? () => { markPending(); sendRemoteCommand('togglePlay'); }   : togglePlayPause;
  const handleNext          = isRemoteMode ? () => { markPending(); sendRemoteCommand('next'); }         : playNext;
  const handlePrevious      = isRemoteMode ? () => { markPending(); sendRemoteCommand('previous'); }     : playPrevious;
  // Swipe always forces an immediate track change — no "restart if > 3s" guard
  const handleSwipePrevious = isRemoteMode ? () => { markPending(); sendRemoteCommand('previous'); }     : playPreviousForced;
  const handleSeek       = isRemoteMode ? (t: number) => sendRemoteCommand('seek', { time: t })                  : seek;
  const handleShuffle    = isRemoteMode ? () => sendRemoteCommand('toggleShuffle')                               : toggleShuffle;
  const handleRepeat     = isRemoteMode ? () => sendRemoteCommand('toggleRepeat')                                : toggleRepeat;

  // ── Fetch audio metadata when missing from song object ──────────────────
  const [fetchedMeta, setFetchedMeta] = useState<SongAudioMeta | null>(null);

  useEffect(() => {
    if (!currentSong) { setFetchedMeta(null); return; }

    // Already have metadata — no fetch needed
    if (currentSong.bitRate !== undefined || currentSong.suffix !== undefined ||
        currentSong.size !== undefined || currentSong.samplingRate !== undefined ||
        currentSong.bitDepth !== undefined) {
      setFetchedMeta(null);
      return;
    }

    // For cached songs, derive what we can from the permanent cache index
    const cachedMeta = offlineCacheService.getCachedSong(currentSong.id);
    if (cachedMeta) {
      const qBitrate: Record<string, number | undefined> = {
        '320': 320, '256': 256, '128': 128, '64': 64,
      };
      setFetchedMeta({
        bitRate: qBitrate[cachedMeta.quality],
        suffix: offlineCacheService.getAudioFileFormat(currentSong.id),
        size: cachedMeta.fileSize || undefined,
      });
      return;
    }

    let cancelled = false;
    const { serverUrl, username, password } = getFromStorage();
    if (serverUrl && username && password) {
      getSongMetadata(serverUrl, username, password, currentSong.id)
        .then(meta => { if (!cancelled) setFetchedMeta(meta); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [currentSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Quality toast ────────────────────────────
  const [qualityToast, setQualityToast] = useState('');
  const qualityToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleQualityChange = (bitrate: number | null) => {
    const label = bitrate === null ? 'Original' : `${bitrate} kbps`;
    setQualityToast(`Quality → ${label} (next track)`);
    if (qualityToastTimer.current) clearTimeout(qualityToastTimer.current);
    qualityToastTimer.current = setTimeout(() => setQualityToast(''), 3500);
  };

  // ── Playlist dialog ──────────────────────────
  const [showPlaylistDialog, setShowPlaylistDialog] = useState(false);

  // ── Swipe — horizontal (track skip) uses state; vertical (close) uses refs
  //    to avoid React re-renders on every touchmove frame.
  const overlayRef       = useRef<HTMLDivElement>(null);
  const carouselRef      = useRef<HTMLDivElement>(null);
  const isCommitting     = useRef(false); // true while commit animation is running
  const infoRef          = useRef<HTMLDivElement>(null);
  const swipeTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartX      = useRef(0);
  const touchStartY      = useRef(0);
  const swipeDirRef      = useRef<'none' | 'h' | 'v'>('none'); // direction locked after 1st move
  const swipeDyRef       = useRef(0);

  // horizontal swipe drives hint icons via state; carousel moves via DOM ref (no re-render per frame)
  const [swipeDx, setSwipeDx]     = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current  = e.touches[0].clientX;
    touchStartY.current  = e.touches[0].clientY;
    swipeDirRef.current  = 'none';
    swipeDyRef.current   = 0;
    setIsSwiping(false);
    setSwipeDx(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isCommitting.current) return;

    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    if (swipeDirRef.current === 'none') {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        swipeDirRef.current = 'h';
        setIsSwiping(true);
      } else if (dy > 12 && dy > Math.abs(dx) * 1.2) {
        swipeDirRef.current = 'v';
      }
    }

    if (swipeDirRef.current === 'h') {
      // Drive the carousel track directly via DOM ref — no React re-render per frame
      if (carouselRef.current) {
        carouselRef.current.style.transition = 'none';
        carouselRef.current.style.transform  = `translateX(calc(-33.333% + ${dx}px))`;
      }
      setSwipeDx(dx); // still needed for swipe-hint icon visibility
    } else if (swipeDirRef.current === 'v' && dy > 0) {
      swipeDyRef.current = dy;
      const offset = Math.min(dy * 0.55, 180);
      if (overlayRef.current) {
        overlayRef.current.style.transition = 'none';
        overlayRef.current.style.transform  = `translateY(${offset}px)`;
      }
    }
  };

  const handleTouchEnd = () => {
    if (swipeDirRef.current === 'h') {
      const goNext = swipeDx < -SWIPE_THRESHOLD;
      const goPrev = swipeDx >  SWIPE_THRESHOLD;

      if ((goNext || goPrev) && !isCommitting.current) {
        isCommitting.current = true;
        const track = carouselRef.current;
        if (track) {
          track.style.transition = 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)';
          track.style.transform  = goNext ? 'translateX(-66.666%)' : 'translateX(0%)';
        }
        swipeTimeoutRef.current = setTimeout(() => {
          if (goNext) handleNext(); else handleSwipePrevious();
          // Snap back without transition — React re-render + snap happen in the same batch
          if (track) {
            track.style.transition = 'none';
            track.style.transform  = 'translateX(-33.333%)';
          }
          isCommitting.current = false;
        }, 280);
      } else if (!isCommitting.current) {
        // Below threshold — spring back to center
        const track = carouselRef.current;
        if (track) {
          track.style.transition = 'transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)';
          track.style.transform  = 'translateX(-33.333%)';
          swipeTimeoutRef.current = setTimeout(() => {
            if (track) track.style.transition = '';
          }, 280);
        }
      }

      setSwipeDx(0);
      setIsSwiping(false);

    } else if (swipeDirRef.current === 'v') {
      const dy = swipeDyRef.current;
      swipeDyRef.current = 0;

      if (dy > SWIPE_THRESHOLD) {
        // Animate the rest of the way down then close
        if (overlayRef.current) {
          overlayRef.current.style.transition = 'transform 0.2s ease-in';
          overlayRef.current.style.transform  = 'translateY(100%)';
        }
        swipeTimeoutRef.current = setTimeout(() => {
          if (overlayRef.current) {
            overlayRef.current.style.transition = '';
            overlayRef.current.style.transform  = '';
          }
          closeNowPlaying();
        }, 200);
      } else {
        // Snap back with spring feel
        if (overlayRef.current) {
          overlayRef.current.style.transition = 'transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)';
          overlayRef.current.style.transform  = '';
        }
        swipeTimeoutRef.current = setTimeout(() => {
          if (overlayRef.current) overlayRef.current.style.transition = '';
        }, 280);
      }
    }

    swipeDirRef.current = 'none';
  };

  // Clean up on unmount
  useEffect(() => () => {
    if (swipeTimeoutRef.current)  clearTimeout(swipeTimeoutRef.current);
    if (pendingTimerRef.current)  clearTimeout(pendingTimerRef.current);
  }, []);

  // Fade-in the info row whenever the song changes
  useEffect(() => {
    const el = infoRef.current;
    if (!el || !currentSong) return;
    el.style.opacity = '0';
    el.style.transform = 'translateX(6px)';
    const raf = requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
      el.style.opacity = '1';
      el.style.transform = '';
      setTimeout(() => { if (el) el.style.transition = ''; }, 230);
    });
    return () => cancelAnimationFrame(raf);
  }, [currentSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Close on Escape ──────────────────────────
  useEffect(() => {
    if (!nowPlayingOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeNowPlaying(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nowPlayingOpen, closeNowPlaying]);

  // Stats — prefer song-object data, fall back to fetched metadata
  const meta = {
    suffix:       currentSong?.suffix       ?? fetchedMeta?.suffix,
    bitRate:      currentSong?.bitRate      ?? fetchedMeta?.bitRate,
    size:         currentSong?.size         ?? fetchedMeta?.size,
    samplingRate: currentSong?.samplingRate ?? fetchedMeta?.samplingRate,
    bitDepth:     currentSong?.bitDepth     ?? fetchedMeta?.bitDepth,
  };
  const statFormat   = meta.suffix?.toUpperCase() || '—';
  const statBitrate  = meta.bitRate ? `${meta.bitRate} kbps` : '—';
  const statSR       = formatHz(meta.samplingRate);
  const statBitDepth = meta.bitDepth ? `${meta.bitDepth}-bit` : '—';
  const statSize     = formatBytes(meta.size);

  return (
    <>
      <div
        ref={overlayRef}
        className={`now-playing-overlay${nowPlayingOpen ? ' open' : ''}`}
        aria-hidden={!nowPlayingOpen}
      >
        {/* ── Ambient blurred background ────────── */}
        <div className="npo-bg" aria-hidden="true">
          {displaySong?.coverArt && (
            <AlbumArt
              coverArtId={displaySong.coverArt}
              alt=""
              size={200}
              className="npo-bg-img"
            />
          )}
        </div>
        <div className="npo-bg-scrim" aria-hidden="true" />

        {/* ── Drag handle ──────────────────────── */}
        <div className="npo-handle" onClick={closeNowPlaying} role="button" aria-label="Close">
          <div className="npo-handle-bar" />
        </div>

        {/* ── Header ──────────────────────────── */}
        <div className="npo-header">
          <button className="npo-close" onClick={closeNowPlaying} aria-label="Close Now Playing">
            <i className="fas fa-chevron-down" />
          </button>
          <span className="npo-label">
            {isRemoteMode ? `Remote: ${remoteTarget?.name ?? ''}` : 'Now Playing'}
          </span>
          <div className="npo-header-spacer" aria-hidden="true" />
        </div>

        {/* ── Album Art carousel + swipe zone ─────── */}
        <div
          className="npo-art-wrap"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Directional hints — appear when drag exceeds 30 px */}
          <i className={`fas fa-step-backward npo-swipe-hint left${swipeDx > 18 ? ' show' : ''}`} />
          <i className={`fas fa-step-forward  npo-swipe-hint right${swipeDx < -18 ? ' show' : ''}`} />

          {/* Three-card track: [prev | current | next] — resting at -33.333% */}
          <div className="npo-carousel-track" ref={carouselRef}>

            {/* Prev card */}
            <div className="npo-art-card npo-art-card--neighbor">
              <div className="npo-art-inner">
                {displayPrev?.coverArt ? (
                  <AlbumArt coverArtId={displayPrev.coverArt} alt={displayPrev.title || ''} size={1000} className="npo-art-img" />
                ) : (
                  <div className="npo-art-fallback"><i className="fas fa-music" /></div>
                )}
              </div>
            </div>

            {/* Current card */}
            <div className="npo-art-card" onClick={togglePlayPause}>
              <div className="npo-art-inner">
                {displaySong?.coverArt ? (
                  <AlbumArt coverArtId={displaySong.coverArt} alt={displaySong.title || ''} size={1000} className="npo-art-img" />
                ) : (
                  <div className="npo-art-fallback"><i className="fas fa-music" /></div>
                )}
              </div>
            </div>

            {/* Next card */}
            <div className="npo-art-card npo-art-card--neighbor">
              <div className="npo-art-inner">
                {displayNext?.coverArt ? (
                  <AlbumArt coverArtId={displayNext.coverArt} alt={displayNext.title || ''} size={1000} className="npo-art-img" />
                ) : (
                  <div className="npo-art-fallback"><i className="fas fa-music" /></div>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* ── Song info + like ─────────────────── */}
        <div className="npo-info-row" ref={infoRef}>
          <div className="npo-info">
            <div className="npo-song-title">{displaySong?.title || 'No song playing'}</div>
            <div className="npo-song-artist">{displaySong?.artist || '---'}</div>
          </div>
          {!isRemoteMode && (
            <button
              className={`npo-like-btn${isLiked ? ' active' : ''}`}
              onClick={toggleLike}
              disabled={!currentSong}
              aria-label={isLiked ? 'Unlike' : 'Like'}
            >
              <i className={`fa${isLiked ? 's' : 'r'} fa-heart`} />
            </button>
          )}
          {!isRemoteMode && (
            <button
              className="npo-playlist-icon-btn"
              onClick={() => setShowPlaylistDialog(true)}
              disabled={!currentSong}
              aria-label="Add to playlist"
              title="Add to playlist"
            >
              <i className="fas fa-list-ul" />
            </button>
          )}
        </div>

        {/* ── Progress ─────────────────────────── */}
        <div className="npo-progress">
          <ProgressBar currentTime={displayTime} duration={displayDuration} onSeek={handleSeek} />
        </div>

        {/* ── Controls ─────────────────────────── */}
        <div className="npo-controls">
          <button className={`npo-ctrl secondary${shuffle ? ' active' : ''}`} onClick={handleShuffle} aria-label="Shuffle">
            <i className="fas fa-random" />
          </button>
          <button className="npo-ctrl" onClick={handlePrevious} aria-label="Previous">
            <i className="fas fa-step-backward" />
          </button>
          <button
            className={`npo-ctrl primary${isRemoteMode && remotePending ? ' remote-pending' : ''}`}
            onClick={handleTogglePlay}
            disabled={!displaySong}
            aria-label={displayPlaying ? 'Pause' : 'Play'}
          >
            {(isRemoteMode && remotePending) || (!isRemoteMode && isLoading)
              ? <span className="npo-spinner" />
              : <i className={`fas fa-${displayPlaying ? 'pause' : 'play'}`} />}
          </button>
          <button className="npo-ctrl" onClick={handleNext} aria-label="Next">
            <i className="fas fa-step-forward" />
          </button>
          <button className={`npo-ctrl secondary${repeat !== 'off' ? ' active' : ''}`} onClick={handleRepeat} aria-label={`Repeat: ${repeat}`}>
            <i className="fas fa-redo" />
            {repeat === 'one' && <span className="npo-repeat-badge">1</span>}
          </button>
        </div>

        {/* ── Selectors row: quality · speed ── */}
        {!isRemoteMode && (
          <div className="npo-selectors-row">
            <StreamingQualitySelector onQualityChange={handleQualityChange} />
            <SpeedSelector />
          </div>
        )}

        {/* ── Quality toast ─────────────────────── */}
        {qualityToast && (
          <div className="npo-quality-toast">{qualityToast}</div>
        )}

        {/* ── Audio stats — always visible ─────── */}
        {!isRemoteMode && (
          <div className="npo-stats">
            <div className="npo-stat">
              <span className="npo-stat-label">Format</span>
              <span className="npo-stat-value">{statFormat}</span>
            </div>
            <div className="npo-stat">
              <span className="npo-stat-label">Bitrate</span>
              <span className="npo-stat-value">{statBitrate}</span>
            </div>
            <div className="npo-stat">
              <span className="npo-stat-label">Sample Rate</span>
              <span className="npo-stat-value">{statSR}</span>
            </div>
            <div className="npo-stat">
              <span className="npo-stat-label">Bit Depth</span>
              <span className="npo-stat-value">{statBitDepth}</span>
            </div>
            <div className="npo-stat">
              <span className="npo-stat-label">File Size</span>
              <span className="npo-stat-value">{statSize}</span>
            </div>
          </div>
        )}
      </div>

      {showPlaylistDialog && currentSong && (
        <AddToPlaylistDialog
          song={currentSong}
          onClose={() => setShowPlaylistDialog(false)}
        />
      )}
    </>
  );
};

export default NowPlayingOverlay;
