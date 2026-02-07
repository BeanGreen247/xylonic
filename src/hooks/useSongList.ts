import { useState, useEffect } from 'react';
import { getAllSongs } from '../services/subsonicApi';
import { getFromStorage } from '../utils/storage';

interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    duration?: number;
    track?: number;
    coverArt?: string;
}

export const useSongList = () => {
    const [songs, setSongs] = useState<Song[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchSongs = async () => {
            setLoading(true);
            setError(null);
            
            try {
                const { username, password, serverUrl } = getFromStorage();

                if (!username || !password || !serverUrl) {
                    setError('Not authenticated');
                    setLoading(false);
                    return;
                }

                const allSongs = await getAllSongs(username, password, serverUrl);
                setSongs(allSongs);
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setLoading(false);
            }
        };

        fetchSongs();
    }, []);

    return { songs, loading, error };
};