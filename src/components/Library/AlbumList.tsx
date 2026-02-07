import React, { useEffect, useState } from 'react';
import { getArtist, getCoverArtUrl } from '../../services/subsonicApi';
import './AlbumList.css';

interface Album {
  id: string;
  name: string;
  artist: string;
  year?: number;
  songCount?: number;
  duration?: number;
  coverArt?: string;
}

interface AlbumListProps {
  artistId: string;
  artistName: string;
  onBack: () => void;
  onAlbumClick?: (albumId: string, albumName: string) => void;
}

const AlbumList: React.FC<AlbumListProps> = ({ artistId, artistName, onBack, onAlbumClick }) => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAlbums();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistId]);

  const loadAlbums = async () => {
    try {
      setError(null);
      const serverUrl = localStorage.getItem('serverUrl');
      const username = localStorage.getItem('username');
      const password = localStorage.getItem('password');
      
      if (!serverUrl || !username || !password) {
        setError('Missing server credentials. Please log in again.');
        setLoading(false);
        return;
      }

      console.log('Fetching albums for artist:', artistId);
      
      const response = await getArtist(serverUrl, username, password, artistId);
      const subsonicResponse = response.data['subsonic-response'];
      
      if (subsonicResponse?.status === 'failed') {
        setError(subsonicResponse.error?.message || 'Failed to fetch albums');
        setLoading(false);
        return;
      }
      
      const albumsList: Album[] = subsonicResponse?.artist?.album || [];
      setAlbums(albumsList);
      
      console.log(`Loaded ${albumsList.length} albums`);
    } catch (error) {
      console.error('Failed to load albums', error);
      setError((error as Error).message || 'Failed to load albums');
    } finally {
      setLoading(false);
    }
  };

  const handleAlbumClick = (album: Album) => {
    if (onAlbumClick) {
      onAlbumClick(album.id, album.name);
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <i className="fas fa-spinner"></i>
        <span>Loading albums...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-message" style={{ padding: '40px', textAlign: 'center' }}>
        <i className="fas fa-exclamation-circle" style={{ fontSize: '48px', color: '#ff3b30', marginBottom: '16px' }}></i>
        <h3>Error Loading Albums</h3>
        <p>{error}</p>
        <button onClick={loadAlbums} className="test-button" style={{ marginTop: '20px' }}>
          <i className="fas fa-redo"></i>
          Retry
        </button>
      </div>
    );
  }

  const serverUrl = localStorage.getItem('serverUrl') || '';
  const username = localStorage.getItem('username') || '';
  const password = localStorage.getItem('password') || '';
  const totalSongs = albums.reduce((sum, album) => sum + (album.songCount || 0), 0);

  return (
    <div>
      <div className="library-header">
        <button className="back-button" onClick={onBack}>
          <i className="fas fa-arrow-left"></i>
          Back to Artists
        </button>
        <h2 className="library-title">
          <i className="fas fa-compact-disc"></i>
          {artistName}
        </h2>
        <div className="library-header-right">
          <div className="library-stats">
            <i className="fas fa-compact-disc"></i>
            <span>{albums.length} albums</span>
          </div>
          <div className="library-stats">
            <i className="fas fa-music"></i>
            <span>{totalSongs} songs</span>
          </div>
        </div>
      </div>

      {albums.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <i className="fas fa-compact-disc" style={{ fontSize: '48px', marginBottom: '16px' }}></i>
          <h3>No Albums Found</h3>
          <p>This artist has no albums.</p>
        </div>
      ) : (
        <div className="albums-grid">
          {albums.map((album) => (
            <div 
              className="album-card" 
              key={album.id}
              onClick={() => handleAlbumClick(album)}
            >
              <div className="album-cover">
                {album.coverArt ? (
                  <img 
                    src={getCoverArtUrl(serverUrl, username, password, album.coverArt, 300)} 
                    alt={album.name}
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                      if (e.currentTarget.parentElement) {
                        e.currentTarget.parentElement.innerHTML = '<div class="album-art-fallback"><i class="fas fa-compact-disc"></i></div>';
                      }
                    }}
                  />
                ) : (
                  <div className="album-art-fallback">
                    <i className="fas fa-compact-disc"></i>
                  </div>
                )}
              </div>
              <div className="album-name">{album.name}</div>
              <div className="album-artist">
                {album.year && `${album.year} • `}
                {album.songCount || 0} songs
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AlbumList;
