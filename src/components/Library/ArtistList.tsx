import React, { useEffect, useState } from 'react';
import { getArtists, getArtist, getAlbum } from '../../services/subsonicApi';
import { getFromStorage } from '../../utils/storage';
import { usePlayer } from '../../context/PlayerContext';
import SongItem from './SongItem';
import AlbumArt from '../common/AlbumArt';
import { getAllSongs, getStreamUrl } from '../../services/subsonicApi';
import ShuffleAllButton from './ShuffleAllButton';
import DownloadNotification from './DownloadNotification';

interface Artist {
    id: string;
    name: string;
    albumCount?: number;
    coverArt?: string;
}

interface Album {
    id: string;
    name: string;
    artist: string;
    year?: number;
    songCount?: number;
    coverArt?: string;
}

interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    duration?: number;
    track?: number;
    coverArt?: string;
}

const ArtistList: React.FC = () => {
    const [artists, setArtists] = useState<Artist[]>([]);
    const [albums, setAlbums] = useState<Album[]>([]);
    const [songs, setSongs] = useState<Song[]>([]);
    const [view, setView] = useState<'artists' | 'albums' | 'songs'>('artists');
    const [loading, setLoading] = useState(false);
    const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
    const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
    const [allSongs, setAllSongs] = useState<Song[]>([]);
    const [totalSongs, setTotalSongs] = useState<number | null>(null);

    const { playPlaylist, bitrate } = usePlayer();

    useEffect(() => {
        loadArtists();
        loadAllSongs();
    }, []);

    const loadAllSongs = async () => {
        try {
            const { username, password, serverUrl } = getFromStorage();

            const songs = await getAllSongs(username, password, serverUrl);
            setAllSongs(songs);
            setTotalSongs(songs.length);
        } catch (error) {
            console.error('Failed to load all songs:', error);
        }
    };

    const loadArtists = async () => {
        setLoading(true);
        try {
            const { username, password, serverUrl } = getFromStorage();

            const response = await getArtists(username, password, serverUrl);
            const artistsData = response.data['subsonic-response']?.artists?.index || [];
            
            const allArtists: Artist[] = [];
            artistsData.forEach((index: any) => {
                if (index.artist) {
                    allArtists.push(...index.artist);
                }
            });

            setArtists(allArtists);
        } catch (error) {
            console.error('Failed to load artists:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleArtistClick = async (artist: Artist) => {
        setSelectedArtist(artist);
        setLoading(true);
        try {
            const { username, password, serverUrl } = getFromStorage();

            const response = await getArtist(username, password, serverUrl, artist.id);
            const albumsData = response.data['subsonic-response']?.artist?.album || [];
            setAlbums(albumsData);
            setView('albums');
        } catch (error) {
            console.error('Failed to load albums:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleAlbumClick = async (album: Album) => {
        setSelectedAlbum(album);
        setLoading(true);
        try {
            const { username, password, serverUrl } = getFromStorage();

            const response = await getAlbum(username, password, serverUrl, album.id);
            const songsData = response.data['subsonic-response']?.album?.song || [];
            setSongs(songsData);
            setView('songs');
        } catch (error) {
            console.error('Failed to load songs:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleBack = () => {
        if (view === 'songs') {
            setView('albums');
            setSelectedAlbum(null);
            setSongs([]);
        } else if (view === 'albums') {
            setView('artists');
            setSelectedArtist(null);
            setAlbums([]);
        }
    };

    const handlePlayAlbum = () => {
        if (songs.length === 0) return;

        const { username, password, serverUrl } = getFromStorage();

        const songsWithUrls = songs.map(song => ({
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            url: getStreamUrl(username, password, serverUrl, song.id, bitrate || undefined),
            duration: song.duration,
            coverArt: song.coverArt,
        }));

        playPlaylist(songsWithUrls, 0);
    };

    if (loading) {
        return (
            <div className="library-container">
                <div className="loading">
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Loading...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="library-container">
            {view !== 'artists' && (
                <button className="back-button" onClick={handleBack}>
                    <i className="fas fa-arrow-left"></i>
                    <span>Back</span>
                </button>
            )}

            {view === 'artists' && (
                <>
                    <div className="library-header">
                        <h1>
                            <i className="fas fa-music"></i></h1><h1>Your Library
                        </h1>
                        <div className="library-header-right">
                            <DownloadNotification songs={allSongs} />
                            {totalSongs !== null && (
                                <div className="library-stats">
                                    <i className="fas fa-compact-disc"></i>
                                    <span>{totalSongs.toLocaleString()} songs</span>
                                </div>
                            )}
                        </div>
                    </div>
                    
                    <ShuffleAllButton />

                    <div className="artists-grid">
                        {artists.map(artist => (
                            <div 
                                key={artist.id} 
                                className="artist-card"
                                onClick={() => handleArtistClick(artist)}
                            >
                                {artist.coverArt ? (
                                    <AlbumArt 
                                        coverArtId={artist.coverArt} 
                                        alt={artist.name}
                                        size={150}
                                        className="artist-art"
                                    />
                                ) : (
                                    <div className="artist-icon">
                                        <i className="fas fa-user-music"></i>
                                    </div>
                                )}
                                <div className="artist-name">{artist.name}</div>
                                {artist.albumCount && (
                                    <div className="artist-album-count">
                                        <i className="fas fa-compact-disc"></i>
                                        {artist.albumCount} albums
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {view === 'albums' && selectedArtist && (
                <>
                    <h2 className="view-title">
                        <i className="fas fa-compact-disc"></i>
                        {selectedArtist.name} - Albums
                    </h2>
                    <div className="albums-grid">
                        {albums.map(album => (
                            <div 
                                key={album.id} 
                                className="album-card"
                                onClick={() => handleAlbumClick(album)}
                            >
                                {album.coverArt ? (
                                    <AlbumArt 
                                        coverArtId={album.coverArt} 
                                        alt={album.name}
                                        size={150}
                                        className="album-art-thumb"
                                    />
                                ) : (
                                    <div className="album-icon">
                                        <i className="fas fa-compact-disc"></i>
                                    </div>
                                )}
                                <div className="album-name">{album.name}</div>
                                {album.year && <div className="album-year">{album.year}</div>}
                                {album.songCount && (
                                    <div className="album-song-count">
                                        <i className="fas fa-music"></i>
                                        {album.songCount} songs
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {view === 'songs' && selectedAlbum && (
                <>
                    <div className="album-header">
                        <div className="album-header-content">
                            {selectedAlbum.coverArt && (
                                <AlbumArt 
                                    coverArtId={selectedAlbum.coverArt} 
                                    alt={selectedAlbum.name}
                                    size={200}
                                    className="album-header-art"
                                />
                            )}
                            <div className="album-header-info">
                                <h2>
                                    <i className="fas fa-compact-disc"></i>
                                    {selectedAlbum.name}
                                </h2>
                                <p className="album-artist">{selectedAlbum.artist}</p>
                                {selectedAlbum.year && <p className="album-year">{selectedAlbum.year}</p>}
                            </div>
                        </div>
                        <button className="play-album-button" onClick={handlePlayAlbum}>
                            <i className="fas fa-play-circle"></i>
                            <span>Play Album</span>
                        </button>
                    </div>
                    <div className="songs-list">
                        {songs.map(song => (
                            <SongItem key={song.id} song={song} allSongs={songs} />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default ArtistList;