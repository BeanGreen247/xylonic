import React from 'react';
import './LibraryViewToggle.css';

export type TopLevelView = 'artists' | 'allAlbums' | 'allSongs' | 'likedSongs';

interface LibraryViewToggleProps {
  currentView: TopLevelView;
  onChange: (view: TopLevelView) => void;
}

const LibraryViewToggle: React.FC<LibraryViewToggleProps> = ({ currentView, onChange }) => {
  return (
    <div className="library-view-toggle">
      <button
        className={`view-toggle-btn ${currentView === 'artists' ? 'active' : ''}`}
        onClick={() => onChange('artists')}
        title="Browse by Artist"
      >
        <i className="fas fa-users"></i>
        <span>Artists</span>
      </button>
      <button
        className={`view-toggle-btn ${currentView === 'allAlbums' ? 'active' : ''}`}
        onClick={() => onChange('allAlbums')}
        title="Browse all Albums"
      >
        <i className="fas fa-record-vinyl"></i>
        <span>Albums</span>
      </button>
      <button
        className={`view-toggle-btn ${currentView === 'allSongs' ? 'active' : ''}`}
        onClick={() => onChange('allSongs')}
        title="Browse all Songs"
      >
        <i className="fas fa-music"></i>
        <span>Songs</span>
      </button>
      <button
        className={`view-toggle-btn ${currentView === 'likedSongs' ? 'active' : ''}`}
        onClick={() => onChange('likedSongs')}
        title="Liked Songs"
      >
        <i className="fas fa-heart"></i>
        <span>Liked</span>
      </button>
    </div>
  );
};

export default LibraryViewToggle;
