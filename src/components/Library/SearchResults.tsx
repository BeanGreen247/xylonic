import React, { useState, useEffect } from 'react';
import { useSearch } from '../../context/SearchContext';
import { usePlayer } from '../../context/PlayerContext';
import { useImageCache } from '../../context/ImageCacheContext';
import md5 from 'md5';
import '../../styles/SearchResults.css';

interface ImageLoadSource {
  [key: string]: 'cache' | 'server';
}

interface SearchResultsProps {
  onArtistClick?: (artistId: string) => void;
  onAlbumClick?: (albumId: string) => void;
}

// Helper component for cached images
interface CachedImageProps {
  coverArtId: string;
  alt: string;
  className: string;
}

const CachedImage: React.FC<CachedImageProps> = ({ coverArtId, alt, className }) => {
  const [imageUrl, setImageUrl] = useState<string>('');
  const [imageError, setImageError] = useState(false);
  const [loadSource, setLoadSource] = useState<'cache' | 'server' | null>(null);
  const { getCachedImage } = useImageCache();

  useEffect(() => {
    const loadImage = async () => {
      const startTime = Date.now();
      try {
        const url = await getCachedImage(coverArtId, () => {
          const serverUrl = localStorage.getItem('serverUrl') || '';
          const username = localStorage.getItem('username') || '';
          const password = localStorage.getItem('password') || '';
          
          const salt = Math.random().toString(36).substring(7);
          const token = md5(password + salt);
          const params = new URLSearchParams({
            id: coverArtId,
            u: username,
            t: token,
            s: salt,
            v: '1.16.1',
            c: 'SubsonicMusicApp',
            size: '300'
          });
          return `${serverUrl}/rest/getCoverArt.view?${params}`;
        });
        const loadTime = Date.now() - startTime;
        // If loaded very quickly (< 50ms), probably from cache
        setLoadSource(loadTime < 50 ? 'cache' : 'server');
        setImageUrl(url);
        // Clear indicator after 2 seconds
        setTimeout(() => setLoadSource(null), 2000);
      } catch (error) {
        console.error('Error loading cached image:', error);
        setImageError(true);
      }
    };

    loadImage();
  }, [coverArtId, getCachedImage]);

  if (imageError || !imageUrl) {
    return null;
  }

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <img
        src={imageUrl}
        alt={alt}
        className={className}
        onError={() => setImageError(true)}
      />
      {loadSource === 'cache' && (
        <div style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: '#4CAF50',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: 'bold'
        }}>
          Cache
        </div>
      )}
      {loadSource === 'server' && (
        <div style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: '#FF9800',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: 'bold'
        }}>
          Server
        </div>
      )}
    </div>
  );
};

const SearchResults: React.FC<SearchResultsProps> = ({ onArtistClick, onAlbumClick }) => {
  const { searchQuery, searchResults, clearSearch, setSearching, setNavigatedFromSearch, cacheInitialized } = useSearch();
  const { playSong } = usePlayer();

  if (!searchResults) {
    return (
      <div className="search-results">
        <div className="search-empty">
          <p>No results found for "{searchQuery}"</p>
        </div>
      </div>
    );
  }

  const { artist = [], album = [], song = [] } = searchResults;
  const hasResults = artist.length > 0 || album.length > 0 || song.length > 0;

  if (!hasResults) {
    return (
      <div className="search-results">
        <div className="search-empty">
          <p>No results found for "{searchQuery}"</p>
        </div>
      </div>
    );
  }

  const handleSongClick = (songIndex: number) => {
    console.log('Playing individual song from search:', song[songIndex]);
    // Play only this one song, not as a playlist
    const s = song[songIndex];
    const serverUrl = localStorage.getItem('serverUrl') || '';
    const username = localStorage.getItem('username') || '';
    const password = localStorage.getItem('password') || '';
    
    const salt = Math.random().toString(36).substring(7);
    const token = md5(password + salt);
    const streamUrl = `${serverUrl}/rest/stream.view?id=${s.id}&u=${username}&t=${token}&s=${salt}&v=1.16.1&c=SubsonicMusicApp&f=json`;
    
    playSong({
      id: s.id,
      title: s.title,
      artist: s.artist || 'Unknown Artist',
      album: s.album || 'Unknown Album',
      url: streamUrl,
      duration: s.duration,
      coverArt: s.coverArt // Just pass the coverArtId, player will handle URL generation
    });
  };

  const handleArtistClick = (artistId: string) => {
    if (onArtistClick) {
      setSearching(false); // Hide search results
      setNavigatedFromSearch(true); // Mark that we navigated from search
      onArtistClick(artistId);
    }
  };

  const handleAlbumClick = (albumId: string) => {
    if (onAlbumClick) {
      setSearching(false); // Hide search results
      setNavigatedFromSearch(true); // Mark that we navigated from search
      onAlbumClick(albumId);
    }
  };

  return (
    <div className="search-results">
      <div className="search-header">
        <div>
          <h2>Search Results for "{searchQuery}"</h2>
          {cacheInitialized ? (
            <small style={{ color: '#4CAF50', fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Instant search enabled (cached locally)
            </small>
          ) : (
            <small style={{ color: '#FF9800', fontSize: '0.85em', display: 'flex', alignItems: 'center', gap: '4px' }}>
              Searching server...
            </small>
          )}
        </div>
        <button onClick={clearSearch} className="back-button">
          ← Back to Library
        </button>
      </div>

      {artist.length > 0 && (
        <section className="search-section">
          <h3>Artists ({artist.length})</h3>
          <div className="search-grid">
            {artist.map((art) => (
              <div
                key={art.id}
                className="search-item artist-item"
                onClick={() => handleArtistClick(art.id)}
                style={{ cursor: 'pointer' }}
              >
                {art.coverArt && (
                  <CachedImage
                    coverArtId={art.coverArt}
                    alt={art.name}
                    className="search-artwork"
                  />
                )}
                <div className="search-info">
                  <h4>{art.name}</h4>
                  <p>{art.albumCount || 0} albums</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {album.length > 0 && (
        <section className="search-section">
          <h3>Albums ({album.length})</h3>
          <div className="search-grid">
            {album.map((alb) => (
              <div
                key={alb.id}
                className="search-item album-item"
                onClick={() => handleAlbumClick(alb.id)}
                style={{ cursor: 'pointer' }}
              >
                {alb.coverArt && (
                  <CachedImage
                    coverArtId={alb.coverArt}
                    alt={alb.name}
                    className="search-artwork"
                  />
                )}
                <div className="search-info">
                  <h4>{alb.name}</h4>
                  <p>{alb.artist}</p>
                  <p className="search-meta">
                    {alb.year ? `${alb.year} • ` : ''}{alb.songCount || 0} songs
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {song.length > 0 && (
        <section className="search-section">
          <h3>Songs ({song.length})</h3>
          <div className="search-list">
            {song.map((s, index) => (
              <div
                key={s.id}
                className="search-song"
                onClick={() => handleSongClick(index)}
                style={{ cursor: 'pointer' }}
              >
                {s.coverArt && (
                  <CachedImage
                    coverArtId={s.coverArt}
                    alt={s.album}
                    className="song-artwork"
                  />
                )}
                <div className="song-info">
                  <h4>{s.title}</h4>
                  <p>{s.artist} • {s.album}</p>
                </div>
                <span className="song-duration">
                  {s.duration
                    ? `${Math.floor(s.duration / 60)}:${String(s.duration % 60).padStart(2, '0')}`
                    : '--:--'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default SearchResults;
