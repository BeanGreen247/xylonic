import { useState, useEffect } from 'react';
import { getAllSongs, getStreamUrl, getCoverArtUrl } from '../services/subsonicApi';

interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    duration?: number;
    coverArt?: string;
}

export const useSongList = () => {
    const [songs, setSongs] = useState<Song[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchSongs = async () => {
            try {
                const serverUrl = localStorage.getItem('serverUrl') || '';
                const username = localStorage.getItem('username') || '';
                const password = localStorage.getItem('password') || '';

                // getAllSongs now returns the songs array directly, not a response object
                const rawSongs = await getAllSongs(serverUrl, username, password);
                
                // Transform songs if needed
                const songs = rawSongs.map((song: any) => ({
                    id: song.id,
                    title: song.title,
                    artist: song.artist,
                    album: song.album,
                    url: getStreamUrl(serverUrl, username, password, song.id),
                    duration: song.duration,
                    coverArt: song.coverArt ? getCoverArtUrl(serverUrl, username, password, song.coverArt, 300) : undefined
                }));

                setSongs(songs);
            } catch (error) {
                console.error('Failed to fetch songs:', error);
                setError((error as Error).message);
            } finally {
                setLoading(false);
            }
        };

        fetchSongs();
    }, []);

    return { songs, loading, error };
};

export default useSongList;