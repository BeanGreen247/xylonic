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
            const bitrate = null; // or get from settings

            console.log('Fetching all songs for shuffle...');
            
            // Get the response and extract songs from the Subsonic response
            const response = await getAllSongs(serverUrl, username, password);
            const subsonicResponse = response.data['subsonic-response'];
            
            if (subsonicResponse?.status === 'failed') {
                console.error('Failed to fetch songs:', subsonicResponse.error?.message);
                return;
            }

            // Extract songs from randomSongs response
            const allSongs = subsonicResponse?.randomSongs?.song || [];
            
            console.log(`Total songs available: ${allSongs.length}`);

            if (allSongs.length === 0) {
                console.log('No songs found to shuffle');
                return;
            }

            // Shuffle the songs
            const shuffledSongs = shuffleArray(allSongs);
            console.log(`Shuffled ${shuffledSongs.length} songs`);

            // Map songs to include streaming URLs with proper typing
            const songsWithUrls = shuffledSongs.map((song: any) => ({
                id: song.id,
                title: song.title,
                artist: song.artist,
                album: song.album,
                url: getStreamUrl(serverUrl, username, password, song.id, bitrate || undefined),
                duration: song.duration,
                coverArt: song.coverArt,
            }));

            console.log('Starting shuffled playback...');
            
            // Start playing the shuffled playlist
            playPlaylist(songsWithUrls, 0);
            
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