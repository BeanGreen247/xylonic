import React, { useState, useEffect, useRef } from 'react';
import { usePlayer, usePlayerTime } from '../../context/PlayerContext';
import { useUI } from '../../context/UIContext';
import { useRemoteMode } from '../../context/RemoteModeContext';
import ProgressBar from './ProgressBar';
import VolumeControl from './VolumeControl';
import StreamingQualitySelector from './StreamingQualitySelector';
import SpeedSelector from './SpeedSelector';
import AlbumArt from '../common/AlbumArt';
import './PlaybackControls.css';

const PlaybackControls: React.FC = () => {
  const {
    currentSong,
    isPlaying,
    isLoading,
    volume,
    repeat,
    shuffle,
    isLiked,
    togglePlayPause,
    playNext,
    playPrevious,
    toggleRepeat,
    toggleShuffle,
    toggleLike,
    seek,
    setVolume,
  } = usePlayer();

  const { currentTime, duration } = usePlayerTime();

  const { isRemoteMode, remoteTarget, isBeingControlled, controllerName, sendRemoteCommand, remotePlayerState, remoteCurrentTime } = useRemoteMode();

  // ── Remote pending state ──────────────────────────────────────────────────
  const [remotePending, setRemotePending] = useState(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStartRef = useRef(0);

  const markPending = () => {
    pendingStartRef.current = Date.now();
    setRemotePending(true);
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    pendingTimerRef.current = setTimeout(() => setRemotePending(false), 1500);
  };

  useEffect(() => {
    if (remotePending && Date.now() - pendingStartRef.current > 400) {
      setRemotePending(false);
      if (pendingTimerRef.current) { clearTimeout(pendingTimerRef.current); pendingTimerRef.current = null; }
    }
  }, [remotePlayerState]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current); }, []);

  const handleTogglePlay  = isRemoteMode
    ? () => { markPending(); sendRemoteCommand('togglePlay'); }
    : togglePlayPause;
  const handleNext        = isRemoteMode
    ? () => { markPending(); sendRemoteCommand('next'); }
    : playNext;
  const handlePrevious    = isRemoteMode
    ? () => { markPending(); sendRemoteCommand('previous'); }
    : playPrevious;
  const handleSeek        = isRemoteMode
    ? (t: number) => sendRemoteCommand('seek', { time: t })
    : seek;
  const handleVolumeChange = isRemoteMode
    ? (v: number) => sendRemoteCommand('setVolume', { volume: v })
    : setVolume;
  const handleToggleShuffle = isRemoteMode
    ? () => sendRemoteCommand('toggleShuffle')
    : toggleShuffle;
  const handleToggleRepeat = isRemoteMode
    ? () => sendRemoteCommand('toggleRepeat')
    : toggleRepeat;

  // When controlling a remote device, mirror its state instead of local state
  const displaySong     = isRemoteMode ? (remotePlayerState?.song ?? null) : currentSong;
  const displayPlaying  = isRemoteMode ? (remotePlayerState?.isPlaying ?? false) : isPlaying;
  const displayTime     = isRemoteMode ? remoteCurrentTime : currentTime;
  const displayDuration = isRemoteMode ? (remotePlayerState?.duration ?? 0) : duration;

  const { panelOpen, panelTab, togglePanel, openNowPlaying, openDesktopNowPlaying } = useUI();
  const [showQualityNotification, setShowQualityNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');

  const handleBarClick = (e: React.MouseEvent) => {
    if (!currentSong && !isRemoteMode) return;
    if (window.innerWidth > 680) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, a, [role="slider"]')) return;
    openNowPlaying();
  };

  const handleQualityChange = (newBitrate: number | null) => {
    const qualityText = newBitrate === null ? 'Original' : `${newBitrate} kbps`;
    setNotificationMessage(`Quality set to ${qualityText}`);
    setShowQualityNotification(true);

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      setShowQualityNotification(false);
    }, 4000);
  };

  return (
    <div
      className={`player-bar${displaySong ? ' has-song' : ''}`}
      onClick={handleBarClick}
    >
      {/* Quality Change Notification */}
      {showQualityNotification && (
        <div className="quality-notification">
          <i className="fas fa-info-circle"></i>
          <span>{notificationMessage} • Will apply to next track</span>
          <button 
            className="notification-close"
            onClick={() => setShowQualityNotification(false)}
            title="Dismiss"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>
      )}
      
      {isRemoteMode && remoteTarget && (
        <div className="remote-mode-bar">
          <i className="fas fa-satellite-dish" />
          <span>Remote: <strong>{remoteTarget.name}</strong></span>
        </div>
      )}
      {isBeingControlled && controllerName && (
        <div className="remote-mode-bar remote-mode-bar--controlled">
          <i className="fas fa-lock" />
          <span>Controlled by <strong>{controllerName}</strong></span>
        </div>
      )}
      <ProgressBar
        currentTime={displayTime}
        duration={displayDuration}
        onSeek={handleSeek}
      />
      
      <div className="player-controls-container">
        {/* Current Song Info — clickable on desktop to open full-screen now playing */}
        <div
          className={`current-song-info${currentSong ? ' clickable' : ''}`}
          onClick={() => {
            if (window.innerWidth > 680 && currentSong) openDesktopNowPlaying();
          }}
          title={currentSong && window.innerWidth > 680 ? 'Open Now Playing' : undefined}
        >
          <div className="current-song-cover">
            {displaySong ? (
              <AlbumArt
                coverArtId={displaySong.coverArt}
                alt={displaySong.title}
                size={80}
                className="current-song-cover-image"
                artist={displaySong.artist}
                album={displaySong.album}
              />
            ) : (
              <div className="current-song-cover-placeholder">
                <i className="fas fa-music"></i>
              </div>
            )}
          </div>
          
          <div className="current-song-details">
            <div className="current-song-title">
              {displaySong?.title || (isRemoteMode ? 'Waiting for playback…' : 'No song playing')}
            </div>
            <div className="current-song-artist">
              {displaySong?.artist || '---'}
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="playback-controls">
          <button
            className={`shuffle-btn ${shuffle ? 'active' : ''}`}
            onClick={handleToggleShuffle}
            title="Shuffle"
          >
            <i className="fas fa-random"></i>
          </button>

          <button onClick={handlePrevious} title="Previous">
            <i className="fas fa-step-backward"></i>
          </button>

          <button
            className={`play-pause-btn${isRemoteMode && remotePending ? ' remote-pending' : ''}`}
            onClick={handleTogglePlay}
            disabled={!isRemoteMode && !currentSong}
            title={isLoading ? 'Loading…' : displayPlaying ? 'Pause' : 'Play'}
          >
            {(isRemoteMode && remotePending) || (!isRemoteMode && isLoading) ? (
              <span className="play-pause-spinner" />
            ) : (
              <i className={`fas fa-${displayPlaying ? 'pause' : 'play'}`}></i>
            )}
          </button>

          <button onClick={handleNext} title="Next">
            <i className="fas fa-step-forward"></i>
          </button>

          <button
            className={`repeat-btn ${repeat !== 'off' ? 'active' : ''}`}
            onClick={handleToggleRepeat}
            title={`Repeat: ${repeat}`}
          >
            <i className={`fas fa-${repeat === 'one' ? 'repeat-1' : 'repeat'}`}></i>
            {repeat === 'one' && <span className="repeat-one-indicator">1</span>}
          </button>

          <button
            className={`like-btn ${isLiked ? 'active' : ''}`}
            onClick={toggleLike}
            disabled={!currentSong}
            title={isLiked ? 'Unlike' : 'Like'}
          >
            <i className={`fa${isLiked ? 's' : 'r'} fa-heart`}></i>
          </button>
        </div>

        {/* Right controls: quality, volume, panel toggles */}
        <div className="player-right-controls">
          <SpeedSelector />
          <StreamingQualitySelector onQualityChange={handleQualityChange} />
          <VolumeControl
            volume={volume}
            onVolumeChange={handleVolumeChange}
          />
          <button
            className={`queue-panel-btn${panelOpen && panelTab === 'queue' ? ' active' : ''}`}
            onClick={() => togglePanel('queue')}
            title="Queue"
          >
            <i className="fas fa-list-ul"></i>
          </button>
          <button
            className={`queue-panel-btn${panelOpen && panelTab === 'history' ? ' active' : ''}`}
            onClick={() => togglePanel('history')}
            title="History"
          >
            <i className="fas fa-history"></i>
          </button>
          <button
            className={`queue-panel-btn${panelOpen && panelTab === 'playlists' ? ' active' : ''}`}
            onClick={() => togglePanel('playlists')}
            title="Playlists"
          >
            <i className="fas fa-music"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlaybackControls;