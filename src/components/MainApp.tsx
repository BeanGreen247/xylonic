import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import LoginForm from './Auth/LoginForm';
import Header from './Layout/Header';
import ArtistList from './Library/ArtistList';
import AlbumList from './Library/AlbumList';
import SongList from './Library/SongList';
import PlaybackControls from './Player/PlaybackControls';

type View = 'artists' | 'albums' | 'songs';

const MainApp: React.FC = () => {
  const { isAuthenticated, logout } = useAuth();
  const [currentView, setCurrentView] = useState<View>('artists');
  const [selectedArtist, setSelectedArtist] = useState<{ id: string; name: string } | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<{ id: string; name: string } | null>(null);

  // Enable keyboard shortcuts (now safe because we're inside providers)
  useKeyboardShortcuts();

  const handleArtistClick = (artistId: string, artistName: string) => {
    setSelectedArtist({ id: artistId, name: artistName });
    setCurrentView('albums');
  };

  const handleAlbumClick = (albumId: string, albumName: string) => {
    setSelectedAlbum({ id: albumId, name: albumName });
    setCurrentView('songs');
  };

  const handleBackToArtists = () => {
    setCurrentView('artists');
    setSelectedArtist(null);
  };

  const handleBackToAlbums = () => {
    setCurrentView('albums');
    setSelectedAlbum(null);
  };

  const handleLogout = () => {
    logout();
    setCurrentView('artists');
    setSelectedArtist(null);
    setSelectedAlbum(null);
  };

  if (!isAuthenticated) {
    return <LoginForm />;
  }

  return (
    <div className="app">
      <Header onLogout={handleLogout} />
      <main className="main-content">
        {currentView === 'artists' && (
          <ArtistList onArtistClick={handleArtistClick} />
        )}
        {currentView === 'albums' && selectedArtist && (
          <AlbumList
            artistId={selectedArtist.id}
            artistName={selectedArtist.name}
            onBack={handleBackToArtists}
            onAlbumClick={handleAlbumClick}
          />
        )}
        {currentView === 'songs' && selectedAlbum && selectedArtist && (
          <SongList
            albumId={selectedAlbum.id}
            albumName={selectedAlbum.name}
            artistName={selectedArtist.name}
            onBack={handleBackToAlbums}
          />
        )}
      </main>
      <PlaybackControls />
    </div>
  );
};

export default MainApp;
