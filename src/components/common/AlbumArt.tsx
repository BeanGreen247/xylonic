import React, { useState } from 'react';
import { getCoverArtUrl } from '../../services/subsonicApi';
import { getFromStorage } from '../../utils/storage';

interface AlbumArtProps {
    coverArtId?: string;
    alt?: string;
    size?: number;
    className?: string;
}

const AlbumArt: React.FC<AlbumArtProps> = ({ 
    coverArtId, 
    alt = 'Album Art', 
    size = 300,
    className = '' 
}) => {
    const [imageError, setImageError] = useState(false);

    if (!coverArtId || imageError) {
        return (
            <div className={`album-art-fallback ${className}`}>
                <i className="fas fa-music"></i>
            </div>
        );
    }

    const { username, password, serverUrl } = getFromStorage();

    const imageUrl = getCoverArtUrl(username, password, serverUrl, coverArtId, size);

    return (
        <img
            src={imageUrl}
            alt={alt}
            className={`album-art ${className}`}
            onError={() => setImageError(true)}
        />
    );
};

export default AlbumArt;