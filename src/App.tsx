import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PlayerProvider, usePlayer } from './context/PlayerContext';
import Header from './components/Layout/Header';
import LoginForm from './components/Auth/LoginForm';
import ArtistList from './components/Library/ArtistList';
import PlaybackControls from './components/Player/PlaybackControls';
import ProgressBar from './components/Player/ProgressBar';
import VolumeControl from './components/Player/VolumeControl';
import QualitySelector from './components/Player/QualitySelector';
import './styles/index.css';

const PlayerBar: React.FC = () => {
    const { currentTime, duration, seek, volume, setVolume, bitrate, setBitrate } = usePlayer();

    return (
        <div className="player-bar">
            <ProgressBar currentTime={currentTime} duration={duration} onSeek={seek} />
            <div className="player-controls-container">
                <PlaybackControls />
                <div className="player-right-controls">
                    <QualitySelector value={bitrate} onChange={setBitrate} />
                    <VolumeControl volume={volume} onVolumeChange={setVolume} />
                </div>
            </div>
        </div>
    );
};

const AppContent: React.FC = () => {
    const { isAuthenticated } = useAuth();

    if (!isAuthenticated) {
        return <LoginForm />;
    }

    return (
        <div className="app">
            <Header />
            <main className="main-content">
                <ArtistList />
            </main>
            <PlayerBar />
        </div>
    );
};

function App() {
    return (
        <AuthProvider>
            <PlayerProvider>
                <AppContent />
            </PlayerProvider>
        </AuthProvider>
    );
}

export default App;