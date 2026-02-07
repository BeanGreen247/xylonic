import React from 'react';
import { useSongList } from '../../hooks/useSongList';
import SongItem from './SongItem';

const SongList: React.FC = () => {
    const { songs, loading, error } = useSongList();

    if (loading) {
        return <div className="loading">Loading songs...</div>;
    }

    if (error) {
        return <div className="error">Error loading songs: {error}</div>;
    }

    if (songs.length === 0) {
        return <div className="empty">No songs found</div>;
    }

    return (
        <div className="song-list">
            <h2>Songs ({songs.length})</h2>
            {songs.map(song => (
                <SongItem key={song.id} song={song} />
            ))}
        </div>
    );
};

export default SongList;