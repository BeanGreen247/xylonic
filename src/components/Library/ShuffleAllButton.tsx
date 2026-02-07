import React, { useState } from 'react';
import { getAllSongs, getStreamUrl } from '../../services/subsonicApi';
import { getFromStorage } from '../../utils/storage';
import { usePlayer } from '../../context/PlayerContext';

const ShuffleAllButton: React.FC = () => {
    const { playPlaylist, bitrate } = usePlayer();
    const [loading, setLoading] = useState(false);

    const shuffleArray = <T,>(array: T[]): T[] => {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    };

    const handleShuffleAll = async () => {
        setLoading(true);
        try {
            const { username, password, serverUrl } = getFromStorage();

            console.log('Fetching all songs for shuffle...');
            const allSongs = await getAllSongs(username, password, serverUrl);
            
            console.log(`Total songs available: ${allSongs.length}`);

            if (allSongs.length === 0) {
                console.log('No songs found to shuffle');
                return;
            }

            // Shuffle the songs
            const shuffledSongs = shuffleArray(allSongs);
            console.log(`Shuffled ${shuffledSongs.length} songs`);

            // Map songs to include streaming URLs
            const songsWithUrls = shuffledSongs.map(song => ({
                id: song.id,
                title: song.title,
                artist: song.artist,
                album: song.album,
                url: getStreamUrl(username, password, serverUrl, song.id, bitrate || undefined),
                duration: song.duration,
                coverArt: song.coverArt,
            }));

            console.log('Starting shuffled playback...');
            playPlaylist(songsWithUrls, 0);
        } catch (error) {
            console.error('Failed to shuffle all songs:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <button 
            className="shuffle-all-button"
            onClick={handleShuffleAll}
            disabled={loading}
        >
            {loading ? 'Loading...' : '🔀 Shuffle All'}
        </button>
    );
};

export default ShuffleAllButton;