import React from 'react';
import { usePlayer } from '../../context/PlayerContext';
import ProgressBar from './ProgressBar';
import VolumeControl from './VolumeControl';
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
    togglePlayPause,
    playNext,
    playPrevious,
    toggleRepeat,
    toggleShuffle,
    seek,
    setVolume,
  } = usePlayer();

  return (
    <div className="player-bar">
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
              <img src={currentSong.coverArt} alt="" />
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
        </div>

        {/* Volume Control */}
        <div className="player-right-controls">
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