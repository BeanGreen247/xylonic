import React, { useState, useEffect } from 'react';
import { getCoverArtUrl } from '../../services/subsonicApi';
import { getFromStorage } from '../../utils/storage';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { useImageCache } from '../../context/ImageCacheContext';
import { offlineCacheService } from '../../services/offlineCacheService';
import { precacheStateService } from '../../services/precacheStateService';

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
    const [imageUrl, setImageUrl] = useState<string>('');
    const [isPrecaching, setIsPrecaching] = useState(precacheStateService.isPrecaching());
    const { offlineModeEnabled, cacheInitialized } = useOfflineMode();
    const { getCachedImage, isInitialized: imageCacheInitialized } = useImageCache();

    // Subscribe to precaching state changes
    useEffect(() => {
        const unsubscribe = precacheStateService.subscribe(() => {
            setIsPrecaching(precacheStateService.isPrecaching());
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        // Skip fetching images during bulk pre-cache to avoid rate limiting
        if (isPrecaching) {
            console.log('[AlbumArt] Skipping fetch during pre-cache:', coverArtId);
            setImageUrl('');
            return;
        }

        const loadImage = async () => {
            if (!coverArtId) {
                setImageUrl('');
                return;
            }

            // Reset error state when coverArtId changes
            setImageError(false);

            console.log('[AlbumArt] Loading cover art:', coverArtId, '| imageCacheInit:', imageCacheInitialized, '| offline:', offlineModeEnabled);

            // Check if coverArtId is actually a full URL (backward compatibility)
            if (coverArtId.startsWith('http://') || coverArtId.startsWith('https://')) {
                console.log('[AlbumArt] coverArtId is already a URL, using directly');
                setImageUrl(coverArtId);
                return;
            }

            const { username, password, serverUrl } = getFromStorage();
            
            // Check credentials exist
            if (!username || !password || !serverUrl) {
                console.error('[AlbumArt] Missing credentials');
                setImageUrl('');
                setImageError(true);
                return;
            }

            // PRIORITY 1: Try IndexedDB image cache first (works online and offline)
            if (imageCacheInitialized) {
                try {
                    console.log('[AlbumArt] Checking IndexedDB cache for:', coverArtId);
                    const cachedUrl = await getCachedImage(coverArtId, () => 
                        getCoverArtUrl(serverUrl, username, password, coverArtId, size)
                    );
                    setImageUrl(cachedUrl);
                    console.log('[AlbumArt] Got image (cached or fresh):', coverArtId);
                    return;
                } catch (error) {
                    console.error('[AlbumArt] ERROR: Error with image cache:', error);
                    // Continue to fallback options
                }
            }

            // PRIORITY 2: Check Electron offline cache (for downloaded songs)
            if (cacheInitialized && offlineCacheService.isCoverArtCached(coverArtId)) {
                const cachedPath = offlineCacheService.getCachedCoverArtPath(coverArtId);
                
                if (cachedPath && window.electron && window.electron.readCachedImage) {
                    try {
                        const dataUrl = await window.electron.readCachedImage(cachedPath);
                        
                        if (dataUrl) {
                            console.log('[AlbumArt] Using offline cached cover art:', coverArtId);
                            setImageUrl(dataUrl);
                            return;
                        }
                    } catch (error) {
                        console.error('[AlbumArt] ERROR: Failed to load offline cached art:', error);
                    }
                }
            }

            // PRIORITY 3: Stream from server (only if online)
            if (!offlineModeEnabled) {
                const url = getCoverArtUrl(serverUrl, username, password, coverArtId, size);
                setImageUrl(url);
                console.log('[AlbumArt] Streaming from server:', coverArtId);
            } else {
                // In offline mode and not cached anywhere
                console.log('[AlbumArt] Offline mode - cover art not available:', coverArtId);
                setImageUrl('');
                setImageError(true);
            }
        };

        loadImage();
    }, [coverArtId, size, imageCacheInitialized, getCachedImage]);

    if (!coverArtId || imageError || !imageUrl) {
        return (
            <div className={`album-art-fallback ${className}`}>
                <i className="fas fa-music"></i>
            </div>
        );
    }

    return (
        <img
            src={imageUrl}
            alt={alt}
            className={`album-art ${className}`}
            onLoad={() => {
                console.log('[AlbumArt] Image loaded successfully:', coverArtId, imageUrl);
            }}
            onError={(e) => {
                console.error('[AlbumArt] ERROR: Image load error:', {
                    coverArtId,
                    imageUrl,
                    naturalWidth: (e.target as HTMLImageElement).naturalWidth,
                    naturalHeight: (e.target as HTMLImageElement).naturalHeight,
                    error: e
                });
                setImageError(true);
            }}
        />
    );
};

export default AlbumArt;