import React, { useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { PlayerProvider } from './context/PlayerContext';
import { useAuth } from './context/AuthContext';
import LoginForm from './components/Auth/LoginForm';
import ReauthDialog from './components/Auth/ReauthDialog';
import Header from './components/Layout/Header';
import ArtistList from './components/Library/ArtistList';
import AlbumList from './components/Library/AlbumList';
import PlaybackControls from './components/Player/PlaybackControls';
import SongList from './components/Library/SongList';
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
  const { isAuthenticated, requiresReauth } = useAuth();
  const [navigation, setNavigation] = useState<NavigationState>({ view: 'artists' });

  console.log('App: isAuthenticated =', isAuthenticated, 'requiresReauth =', requiresReauth);

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

  // Show reauth dialog if credentials are partial/expired
  if (requiresReauth) {
    return <ReauthDialog />;
  }

  // Show login form if not authenticated (this is the fix)
  if (!isAuthenticated) {
    return <LoginForm />;
  }

  // Main app interface (only shown when authenticated)
  return (
    <div className="app">
      <Header />
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
    <AuthProvider>
      <PlayerProvider>
        <AppContent />
      </PlayerProvider>
    </AuthProvider>
  );
}

export default App;