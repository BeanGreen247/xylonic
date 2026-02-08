import React, { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { PlayerProvider } from './context/PlayerContext';
import { ThemeProvider } from './context/ThemeContext';
import { useAuth } from './context/AuthContext';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import LoginForm from './components/Auth/LoginForm';
import Header from './components/Layout/Header';
import ArtistList from './components/Library/ArtistList';
import AlbumList from './components/Library/AlbumList';
import SongList from './components/Library/SongList';
import PlaybackControls from './components/Player/PlaybackControls';
import './styles/index.css';

type View = 'artists' | 'albums' | 'songs';

interface NavigationState {
  view: View;
  artistId?: string;
  artistName?: string;
  albumId?: string;
  albumName?: string;
}

const AppContent: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();
  const [navigation, setNavigation] = useState<NavigationState>({ view: 'artists' });

  // Enable keyboard shortcuts
  useKeyboardShortcuts();

  const handleArtistClick = (artistId: string, artistName: string) => {
    setNavigation({ view: 'albums', artistId, artistName });
  };

  const handleAlbumClick = (albumId: string, albumName: string) => {
    setNavigation({ 
      ...navigation, 
      view: 'songs', 
      albumId, 
      albumName 
    });
  };

  const handleBackToArtists = () => {
    setNavigation({ view: 'artists' });
  };

  const handleBackToAlbums = () => {
    setNavigation({ 
      view: 'albums', 
      artistId: navigation.artistId, 
      artistName: navigation.artistName 
    });
  };

  const handleLogout = () => {
    logout();
    setNavigation({ view: 'artists' });
  };

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return (
    <div className="app">
      <Header onLogout={handleLogout} />
      <main className="main-content">
        {navigation.view === 'artists' && (
          <ArtistList onArtistClick={handleArtistClick} />
        )}
        {navigation.view === 'albums' && navigation.artistId && (
          <AlbumList
            artistId={navigation.artistId}
            artistName={navigation.artistName || 'Unknown Artist'}
            onBack={handleBackToArtists}
            onAlbumClick={handleAlbumClick}
          />
        )}
        {navigation.view === 'songs' && navigation.albumId && (
          <SongList
            albumId={navigation.albumId}
            albumName={navigation.albumName || 'Unknown Album'}
            artistName={navigation.artistName || 'Unknown Artist'}
            onBack={handleBackToAlbums}
          />
        )}
      </main>
      <PlaybackControls />
    </div>
  );
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PlayerProvider>
          <AppContent />
        </PlayerProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;