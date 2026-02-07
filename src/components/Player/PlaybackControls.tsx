import React from 'react';
import { usePlayer } from '../../context/PlayerContext';
import AlbumArt from '../common/AlbumArt';

const PlaybackControls: React.FC = () => {
    const {
        isPlaying,
        currentSong,
        shuffle,
        repeat,
        togglePlayPause,
        playNext,
        playPrevious,
        toggleShuffle,
        toggleRepeat,
    } = usePlayer();

    // Disable controls when no song is loaded
    const hasCurrentSong = currentSong !== null;

    return (
        <>
            {/* Current Song Info */}
            <div className="current-song-info">
                {currentSong ? (
                    <>
                        <div className="current-song-cover">
                            {currentSong.coverArt ? (
                                <AlbumArt coverArtId={currentSong.coverArt} size={56} />
                            ) : (
                                <div className="current-song-cover-placeholder">
                                    <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor">
                                        <path d="M9 13c0 1.105-1.12 2-2.5 2S4 14.105 4 13s1.12-2 2.5-2 2.5.895 2.5 2z"/>
                                        <path fillRule="evenodd" d="M9 3v10H8V3h1z"/>
                                        <path d="M8 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 13 2.22V4L8 5V2.82z"/>
                                    </svg>
                                </div>
                            )}
                        </div>
                        <div className="current-song-details">
                            <div className="current-song-title" title={currentSong.title}>
                                {currentSong.title}
                            </div>
                            <div className="current-song-artist" title={currentSong.artist}>
                                {currentSong.artist}
                            </div>
                        </div>
                        <button 
                            className="current-song-like"
                            title="Like song"
                            disabled={!hasCurrentSong}
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                <path d="m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 4.385.92 1.815 2.834 3.989 6.286 6.357 3.452-2.368 5.365-4.542 6.286-6.357.955-1.886.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171a3.12 3.12 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15z"/>
                            </svg>
                        </button>
                    </>
                ) : (
                    <>
                        <div className="current-song-cover-placeholder">
                            <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M9 13c0 1.105-1.12 2-2.5 2S4 14.105 4 13s1.12-2 2.5-2 2.5.895 2.5 2z"/>
                                <path fillRule="evenodd" d="M9 3v10H8V3h1z"/>
                                <path d="M8 2.82a1 1 0 0 1 .804-.98l3-.6A1 1 0 0 1 13 2.22V4L8 5V2.82z"/>
                            </svg>
                        </div>
                        <div className="current-song-details">
                            <div className="current-song-title">No song playing</div>
                            <div className="current-song-artist">Select a song to start</div>
                        </div>
                    </>
                )}
            </div>

            {/* Playback Controls */}
            <div className="playback-controls">
                <button 
                    className={`shuffle-btn ${shuffle ? 'active' : ''}`}
                    onClick={toggleShuffle}
                    title={shuffle ? 'Shuffle On' : 'Shuffle Off'}
                    disabled={!hasCurrentSong}
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M13.151.922a.75.75 0 1 0-1.06 1.06L13.109 3H11.16a3.75 3.75 0 0 0-2.873 1.34l-6.173 7.356A2.25 2.25 0 0 1 .39 12.5H0V14h.391a3.75 3.75 0 0 0 2.873-1.34l6.173-7.356a2.25 2.25 0 0 1 1.724-.804h1.947l-1.017 1.018a.75.75 0 0 0 1.06 1.06L15.98 3.75 13.15.922zM.391 3.5H0V2h.391c1.109 0 2.16.49 2.873 1.34L4.89 5.277l-.979 1.167-1.796-2.14A2.25 2.25 0 0 0 .39 3.5z"/>
                        <path d="m7.5 10.723.98-1.167.957 1.14a2.25 2.25 0 0 0 1.724.804h1.947l-1.017-1.018a.75.75 0 1 1 1.06-1.06l2.829 2.828-2.829 2.828a.75.75 0 1 1-1.06-1.06L13.109 13H11.16a3.75 3.75 0 0 1-2.873-1.34l-.787-.938z"/>
                    </svg>
                </button>

                <button 
                    onClick={playPrevious} 
                    title="Previous"
                    disabled={!hasCurrentSong}
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M3.3 1a.7.7 0 0 1 .7.7v5.15l9.95-5.744a.7.7 0 0 1 1.05.606v12.575a.7.7 0 0 1-1.05.607L4 9.149V14.3a.7.7 0 0 1-.7.7H1.7a.7.7 0 0 1-.7-.7V1.7a.7.7 0 0 1 .7-.7h1.6z"/>
                    </svg>
                </button>

                <button 
                    className="play-pause-btn" 
                    onClick={togglePlayPause} 
                    title={isPlaying ? 'Pause' : 'Play'}
                    disabled={!hasCurrentSong}
                >
                    {isPlaying ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7H2.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-2.6z"/>
                        </svg>
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M3 1.713a.7.7 0 0 1 1.05-.607l10.89 6.288a.7.7 0 0 1 0 1.212L4.05 14.894A.7.7 0 0 1 3 14.288V1.713z"/>
                        </svg>
                    )}
                </button>

                <button 
                    onClick={playNext} 
                    title="Next"
                    disabled={!hasCurrentSong}
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M12.7 1a.7.7 0 0 0-.7.7v5.15L2.05 1.107A.7.7 0 0 0 1 1.712v12.575a.7.7 0 0 0 1.05.607L12 9.149V14.3a.7.7 0 0 0 .7.7h1.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-1.6z"/>
                    </svg>
                </button>

                <button 
                    className={`repeat-btn ${repeat !== 'off' ? 'active' : ''}`}
                    onClick={toggleRepeat}
                    title={repeat === 'off' ? 'Repeat Off' : repeat === 'all' ? 'Repeat All' : 'Repeat One'}
                    disabled={!hasCurrentSong}
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M0 4.75A3.75 3.75 0 0 1 3.75 1h8.5A3.75 3.75 0 0 1 16 4.75v5a3.75 3.75 0 0 1-3.75 3.75H9.81l1.018 1.018a.75.75 0 1 1-1.06 1.06L6.939 12.75l2.829-2.828a.75.75 0 1 1 1.06 1.06L9.811 12h2.439a2.25 2.25 0 0 0 2.25-2.25v-5a2.25 2.25 0 0 0-2.25-2.25h-8.5a2.25 2.25 0 0 0-2.25 2.25v5A2.25 2.25 0 0 0 3.75 12H5v1.5H3.75A3.75 3.75 0 0 1 0 9.75v-5z"/>
                    </svg>
                    {repeat === 'one' && (
                        <span className="repeat-one-indicator">1</span>
                    )}
                </button>
            </div>
        </>
    );
};

export default PlaybackControls;