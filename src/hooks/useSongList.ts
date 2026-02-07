import { useState, useEffect } from 'react';
import { getAllSongs } from '../services/subsonicApi';

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

                console.log('Fetching songs...');
                
                const response = await getAllSongs(serverUrl, username, password);
                const subsonicResponse = response.data['subsonic-response'];
                
                if (subsonicResponse?.status === 'failed') {
                    throw new Error(subsonicResponse.error?.message || 'Failed to fetch songs');
                }

                // Extract songs from randomSongs response
                const songsList = subsonicResponse?.randomSongs?.song || [];
                setSongs(songsList);
                
                console.log(`Loaded ${songsList.length} songs`);
            } catch (err) {
                setError((err as Error).message);
                console.error('Error fetching songs:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchSongs();
    }, []);

    return { songs, loading, error };
};

export default useSongList;