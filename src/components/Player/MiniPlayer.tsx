import React, { useState, useEffect, useMemo } from 'react';
import AlbumArt from '../common/AlbumArt';
import { getCoverArtUrl } from '../../services/subsonicApi';
import { getBridge } from '../../platform/bridge';
import './MiniPlayer.css';

const bridge = getBridge();

interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    url: string;
    duration?: number;
    coverArt?: string;
}

interface PlayerState {
    currentSong: Song | null;
    isPlaying: boolean;
    isLoading: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    shuffle: boolean;
    repeat: 'off' | 'all' | 'one';
    muted: boolean;
}

const MiniPlayer: React.FC = () => {
    console.log('[MiniPlayer] Component rendering');
    
    // Theme CSS variables are automatically applied by ThemeProvider
    // No need to access theme object directly
    
    // Local state that will be synced from main window via IPC
    const [playerState, setPlayerState] = useState<PlayerState>({
        currentSong: null,
        isPlaying: false,
        isLoading: false,
        currentTime: 0,
        duration: 0,
        volume: 1,
        shuffle: false,
        repeat: 'off',
        muted: false,
    });

    // Subscribe to player state updates from main window
    useEffect(() => {
        console.log('[MiniPlayer] Mounting, requesting initial state...');
        
        bridge.requestPlayerState().then((state: PlayerState | null) => {
            if (state) setPlayerState(state);
        }).catch(() => {});

        const unsubscribe = bridge.onPlayerStateChanged((state: PlayerState) => {
            setPlayerState(state);
        });
        return unsubscribe;
    }, []);

    // Reset when song changes
    useEffect(() => {
        // Song changed
    }, [playerState.currentSong?.id]);

    const formatTime = (time: number): string => {
        if (!time || isNaN(time)) return '0:00';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const handleReturnToMain = () => { bridge.toggleMiniPlayer(); };

    const handlePlayPause = () => { bridge.sendPlayerControl('togglePlayPause'); };
    const handleNext      = () => { bridge.sendPlayerControl('playNext'); };
    const handlePrevious  = () => { bridge.sendPlayerControl('playPrevious'); };

    const progress = playerState.duration > 0 ? (playerState.currentTime / playerState.duration) * 100 : 0;
    const { currentSong, isPlaying, isLoading, currentTime, duration } = playerState;

    // Memoize cover art URL to prevent flickering during playback
    // Only recalculate when the song's coverArt ID changes
    const coverArtUrl = useMemo(() => {
        if (!currentSong?.coverArt) return null;
        const serverUrl = localStorage.getItem('serverUrl');
        const username = localStorage.getItem('username');
        const password = localStorage.getItem('password');
        if (!serverUrl || !username || !password) return null;
        return getCoverArtUrl(serverUrl, username, password, currentSong.coverArt, 500);
    }, [currentSong?.coverArt]);

    return (
        <div 
            className="mini-player"
            style={{
                backgroundImage: coverArtUrl ? `url(${coverArtUrl})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
            }}
        >
            <div className="mini-player-overlay">
                <div className="mini-player-content">
                    {/* Song Info */}
                    <div className="mini-player-info">
                        <div className="mini-player-title">
                            {currentSong?.title || 'No song playing'}
                        </div>
                        <div className="mini-player-artist">
                            {currentSong?.artist || 'Unknown Artist'}
                        </div>
                    </div>

                    {/* Playback Controls */}
                    <div className="mini-player-controls">
                        <button
                            className="mini-player-btn"
                            onClick={handlePrevious}
                            disabled={!currentSong}
                            title="Previous"
                        >
                            <i className="fas fa-step-backward"></i>
                        </button>
                        <button
                            className="mini-player-btn mini-player-play"
                            onClick={handlePlayPause}
                            disabled={!currentSong}
                            title={isLoading ? 'Loading…' : isPlaying ? 'Pause' : 'Play'}
                        >
                            {isLoading ? (
                                <span className="mini-player-spinner" />
                            ) : (
                                <i className={`fas fa-${isPlaying ? 'pause' : 'play'}`}></i>
                            )}
                        </button>
                        <button
                            className="mini-player-btn"
                            onClick={handleNext}
                            disabled={!currentSong}
                            title="Next"
                        >
                            <i className="fas fa-step-forward"></i>
                        </button>
                    </div>

                    {/* Return Button */}
                    <button
                        className="mini-player-return"
                        onClick={handleReturnToMain}
                        title="Return to main window (Ctrl+M)"
                    >
                        <i className="fas fa-expand"></i>
                    </button>
                </div>

                {/* Progress Bar at bottom */}
                <div className="mini-player-progress-bar">
                    <div 
                        className="mini-player-progress-fill"
                        style={{ width: `${progress}%` }}
                    ></div>
                </div>
            </div>
        </div>
    );
};

export default MiniPlayer;
