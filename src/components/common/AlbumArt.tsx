import React, { useState, useEffect } from 'react';
import { getCoverArtUrl } from '../../services/subsonicApi';
import { getFromStorage } from '../../utils/storage';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { useImageCache } from '../../context/ImageCacheContext';
import { imageCacheService } from '../../services/imageCacheService';
import { offlineCacheService } from '../../services/offlineCacheService';
import { precacheStateService } from '../../services/precacheStateService';
import { fetchArtFromInternet } from '../../services/internetArtworkService';
import { networkStatsService } from '../../services/networkStatsService';
import { getBridge } from '../../platform/bridge';

interface AlbumArtProps {
    coverArtId?: string;
    albumId?: string;
    alt?: string;
    size?: number;
    className?: string;
    artist?: string;
    album?: string;
}

const AlbumArt: React.FC<AlbumArtProps> = ({
    coverArtId,
    albumId,
    alt = 'Album Art',
    size = 300,
    className = '',
    artist,
    album,
}) => {
    const [imageError, setImageError] = useState(false);
    // Lazily seed imageUrl from the synchronous memory cache so the component
    // renders with the correct blob URL on the very first paint — no placeholder flash.
    const [imageUrl, setImageUrl] = useState<string>(() => {
        if (!coverArtId || coverArtId.startsWith('http://') || coverArtId.startsWith('https://')) return '';
        return imageCacheService.getFromMemoryCache(coverArtId) || '';
    });
    const serverUrlFallback = React.useRef<string>('');
    const retryTimerRef    = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [isPrecaching, setIsPrecaching] = useState(precacheStateService.isPrecaching());
    const { offlineModeEnabled, cacheInitialized } = useOfflineMode();
    const { getCachedImage, isInitialized: imageCacheInitialized } = useImageCache();

    useEffect(() => {
        const unsubscribe = precacheStateService.subscribe(() => {
            setIsPrecaching(precacheStateService.isPrecaching());
        });
        return unsubscribe;
    }, []);

    useEffect(() => {
        if (isPrecaching) {
            setImageUrl('');
            return;
        }

        let cancelled = false;
        let retries = 0;
        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 5000;

        const loadImage = async () => {
            if (!coverArtId) {
                // No song-level cover art — use albumId or internet fallback
                if (albumId) {
                    const { username: u, password: p, serverUrl: srv } = getFromStorage();
                    if (u && p && srv && !offlineModeEnabled) {
                        const directUrl = getCoverArtUrl(srv, u, p, albumId, size);
                        serverUrlFallback.current = directUrl;

                        if (imageCacheInitialized) {
                            const memCached = imageCacheService.getFromMemoryCache(albumId);
                            if (memCached) {
                                networkStatsService.recordImageMemoryHit();
                                if (!cancelled) { setImageError(false); setImageUrl(memCached); }
                                return;
                            }
                            try {
                                const cachedUrl = await getCachedImage(albumId, () => directUrl);
                                if (!cancelled) {
                                    if (cachedUrl) {
                                        setImageError(false); setImageUrl(cachedUrl);
                                    } else if (retries < MAX_RETRIES) {
                                        retries++;
                                        retryTimerRef.current = setTimeout(loadImage, RETRY_DELAY_MS);
                                    } else {
                                        setImageError(false); setImageUrl(directUrl);
                                    }
                                }
                            } catch {
                                if (!cancelled) { setImageError(false); setImageUrl(directUrl); }
                            }
                        }
                        // If !imageCacheInitialized: keep showing placeholder; effect re-runs
                        // when imageCacheInitialized changes to true.
                        return;
                    }

                    // Offline: folder art
                    try {
                        const folderArt = await offlineCacheService.findFolderArtForAlbum(albumId);
                        if (!cancelled && folderArt) { setImageError(false); setImageUrl(folderArt); return; }
                    } catch { /* ignore */ }

                    // Offline: embedded art
                    try {
                        const embeddedArt = await offlineCacheService.extractEmbeddedArtForAlbum(albumId);
                        if (!cancelled && embeddedArt) { setImageError(false); setImageUrl(embeddedArt); return; }
                    } catch { /* ignore */ }
                }

                // Internet fetch using artist + album name
                if (!offlineModeEnabled && (artist || album)) {
                    try {
                        networkStatsService.recordImageInternetFetch();
                        const internetArt = await fetchArtFromInternet(artist || '', album || '');
                        if (!cancelled && internetArt) { setImageError(false); setImageUrl(internetArt); return; }
                    } catch { /* ignore */ }
                }

                if (!cancelled) setImageUrl('');
                return;
            }

            // Reset error state when coverArtId changes
            if (!cancelled) setImageError(false);

            // If coverArtId is already a full URL (backward compat)
            if (coverArtId.startsWith('http://') || coverArtId.startsWith('https://')) {
                if (!cancelled) setImageUrl(coverArtId);
                return;
            }

            const { username, password, serverUrl } = getFromStorage();
            if (!username || !password || !serverUrl) {
                if (!cancelled) { setImageUrl(''); setImageError(true); }
                return;
            }

            if (!offlineModeEnabled) {
                const directUrl = getCoverArtUrl(serverUrl, username, password, coverArtId, size);
                serverUrlFallback.current = directUrl;

                if (imageCacheInitialized) {
                    const memCached = imageCacheService.getFromMemoryCache(coverArtId);
                    if (memCached) {
                        networkStatsService.recordImageMemoryHit();
                        if (!cancelled) setImageUrl(memCached);
                        return;
                    }

                    // IDB lookup or throttled server fetch (≤ maxConcurrentFetches).
                    // On 429 the service returns '' — schedule a retry instead of
                    // putting the raw server URL into <img> and repeating the cascade.
                    try {
                        const cachedUrl = await getCachedImage(coverArtId, () => directUrl);
                        if (!cancelled) {
                            if (cachedUrl) {
                                setImageUrl(cachedUrl);
                            } else if (retries < MAX_RETRIES) {
                                retries++;
                                retryTimerRef.current = setTimeout(loadImage, RETRY_DELAY_MS);
                            } else {
                                // Retries exhausted — use the server URL directly so the image
                                // either loads or shows the error fallback instead of staying
                                // permanently stuck as a loading spinner.
                                setImageUrl(directUrl);
                            }
                        }
                    } catch {
                        if (!cancelled) setImageUrl(directUrl);
                    }
                }
                // If !imageCacheInitialized: keep showing placeholder; effect re-runs
                // when imageCacheInitialized becomes true — no unthrottled burst.
                return;
            }

            // OFFLINE MODE fallbacks

            // Performance/permanent cache (IndexedDB — populated by preload dialog)
            if (imageCacheInitialized) {
                const memCached = imageCacheService.getFromMemoryCache(coverArtId);
                if (memCached) {
                    networkStatsService.recordImageMemoryHit();
                    if (!cancelled) { setImageError(false); setImageUrl(memCached); }
                    return;
                }
                try {
                    const idbImage = await imageCacheService.getFromIndexedDB(coverArtId);
                    if (idbImage) {
                        const blobUrl = URL.createObjectURL(idbImage.blob);
                        imageCacheService.addBlobUrlToMemory(coverArtId, blobUrl);
                        if (!cancelled) { setImageError(false); setImageUrl(blobUrl); return; }
                    }
                } catch { /* fall through */ }
            }

            // Electron offline cache (downloaded songs)
            if (cacheInitialized && offlineCacheService.isCoverArtCached(coverArtId)) {
                const cachedPath = offlineCacheService.getCachedCoverArtPath(coverArtId);
                if (cachedPath && getBridge().isCacheAvailable) {
                    try {
                        const dataUrl = await getBridge().readCachedImage(cachedPath);
                        if (!cancelled && dataUrl) {
                            setImageUrl(dataUrl);
                            return;
                        }
                    } catch { /* fall through */ }
                }
            }

            // Folder art (offline)
            if (albumId) {
                try {
                    const folderArt = await offlineCacheService.findFolderArtForAlbum(albumId);
                    if (!cancelled && folderArt) { setImageUrl(folderArt); return; }
                } catch { /* ignore */ }

                try {
                    const embeddedArt = await offlineCacheService.extractEmbeddedArtForAlbum(albumId);
                    if (!cancelled && embeddedArt) { setImageUrl(embeddedArt); return; }
                } catch { /* ignore */ }
            }

            // Internet fetch (last resort)
            if (!offlineModeEnabled && (artist || album)) {
                try {
                    networkStatsService.recordImageInternetFetch();
                    const internetArt = await fetchArtFromInternet(artist || '', album || '');
                    if (!cancelled && internetArt) { setImageUrl(internetArt); return; }
                } catch { /* ignore */ }
            }

            if (!cancelled) { setImageUrl(''); setImageError(true); }
        };

        loadImage();
        return () => {
            cancelled = true;
            if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
        };
    }, [coverArtId, albumId, size, imageCacheInitialized, getCachedImage, artist, album, isPrecaching, offlineModeEnabled, cacheInitialized]);

    if (imageError) {
        return (
            <div className={`album-art-fallback ${className}`}>
                <i className="fas fa-music"></i>
            </div>
        );
    }

    if (!imageUrl) {
        return <div className={`album-art-loading ${className}`} />;
    }

    return (
        <img
            src={imageUrl}
            alt={alt}
            className={`album-art ${className}`}
            onError={() => {
                // If a blob URL fails (e.g. edge-case revocation), fall back to
                // the server URL instead of showing a permanent placeholder.
                if (imageUrl.startsWith('blob:') && serverUrlFallback.current) {
                    setImageError(false);
                    setImageUrl(serverUrlFallback.current);
                } else {
                    setImageError(true);
                }
            }}
        />
    );
};

export default React.memo(AlbumArt);
