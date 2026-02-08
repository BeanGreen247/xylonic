import React, { useState } from 'react';
import { getAllSongs, getStreamUrl } from '../../services/subsonicApi';
import { usePlayer } from '../../context/PlayerContext';

const ShuffleAllButton: React.FC = () => {
    const { playPlaylist } = usePlayer();
    const [shuffling, setShuffling] = useState(false);

    const handleShuffleAll = async () => {
        setShuffling(true);
        
        try {
            const serverUrl = localStorage.getItem('serverUrl') || '';
            const username = localStorage.getItem('username') || '';
            const password = localStorage.getItem('password') || '';

            // getAllSongs now returns the songs array directly, not a response object
            const rawSongs = await getAllSongs(serverUrl, username, password);
            
            // Transform raw songs to Song format with stream URLs
            const songs = rawSongs.map((song: any) => ({
                id: song.id,
                title: song.title,
                artist: song.artist,
                album: song.album,
                url: getStreamUrl(serverUrl, username, password, song.id),
                duration: song.duration,
                coverArt: song.coverArt,
            }));

            console.log('Starting shuffled playback...');
            
            // Start playing the shuffled playlist
            playPlaylist(songs, 0);
            
        } catch (error) {
            console.error('Failed to shuffle all songs:', error);
        } finally {
            setShuffling(false);
        }
    };

    const shuffleArray = <T,>(array: T[]): T[] => {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    };

    return (
        <button
            className="shuffle-all-button"
            onClick={handleShuffleAll}
            disabled={shuffling}
        >
            {shuffling ? (
                <>
                    <i className="fas fa-spinner fa-spin"></i>
                    Shuffling...
                </>
            ) : (
                <>
                    <i className="fas fa-random"></i>
                    Shuffle All
                </>
            )}
        </button>
    );
};

export default ShuffleAllButton;