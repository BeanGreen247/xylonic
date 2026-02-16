import React, { useState, useEffect } from 'react';
import { usePlayer } from '../../context/PlayerContext';
import ProgressBar from './ProgressBar';
import VolumeControl from './VolumeControl';
import StreamingQualitySelector from './StreamingQualitySelector';
import AlbumArt from '../common/AlbumArt';
import './PlaybackControls.css';

const PlaybackControls: React.FC = () => {
  const {
    currentSong,
    isPlaying,
    currentTime,
    duration,
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

  const [showQualityNotification, setShowQualityNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');

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
    <div className="player-bar">
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
      
      <ProgressBar 
        currentTime={currentTime}
        duration={duration}
        onSeek={seek}
      />
      
      <div className="player-controls-container">
        {/* Current Song Info */}
        <div className="current-song-info">
          <div className="current-song-cover">
            {currentSong?.coverArt ? (
              <AlbumArt 
                coverArtId={currentSong.coverArt} 
                alt={currentSong.title}
                size={80}
                className="current-song-cover-image"
              />
            ) : (
              <div className="current-song-cover-placeholder">
                <i className="fas fa-music"></i>
              </div>
            )}
          </div>
          
          <div className="current-song-details">
            <div className="current-song-title">
              {currentSong?.title || 'No song playing'}
            </div>
            <div className="current-song-artist">
              {currentSong?.artist || '---'}
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="playback-controls">
          <button
            className={`shuffle-btn ${shuffle ? 'active' : ''}`}
            onClick={toggleShuffle}
            title="Shuffle"
          >
            <i className="fas fa-random"></i>
          </button>

          <button onClick={playPrevious} title="Previous">
            <i className="fas fa-step-backward"></i>
          </button>

          <button
            className="play-pause-btn"
            onClick={togglePlayPause}
            disabled={!currentSong}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`}></i>
          </button>

          <button onClick={playNext} title="Next">
            <i className="fas fa-step-forward"></i>
          </button>

          <button
            className={`repeat-btn ${repeat !== 'off' ? 'active' : ''}`}
            onClick={toggleRepeat}
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

        {/* Volume Control */}
        <div className="player-right-controls">
          <StreamingQualitySelector onQualityChange={handleQualityChange} />
          <VolumeControl 
            volume={volume}
            onVolumeChange={setVolume}
          />
        </div>
      </div>
    </div>
  );
};

export default PlaybackControls;