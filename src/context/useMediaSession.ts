import { useEffect, useRef, RefObject, MutableRefObject } from 'react';
import { offlineCacheService } from '../services/offlineCacheService';
import { imageCacheService } from '../services/imageCacheService';
import { getCoverArtUrl } from '../services/subsonicApi';
import { getFromStorage } from '../utils/storage';
import { getBridge } from '../platform/bridge';
import { Capacitor } from '@capacitor/core';
import { blobToDataUrl, chunksToDataUrl } from '../utils/dataUrl';

type RepeatMode = 'off' | 'all' | 'one';

interface MediaSong {
  title: string;
  artist: string;
  album: string;
  coverArt?: string;
}

export interface UseMediaSessionOpts {
  currentSong: MediaSong | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  isLiked: boolean;
  repeat: RepeatMode;
  setRepeat: (r: RepeatMode) => void;
  audioRef: RefObject<HTMLAudioElement>;
  playNextRef: MutableRefObject<() => void>;
  playPreviousRef: MutableRefObject<() => void>;
  playPreviousForcedRef: MutableRefObject<() => void>;
  toggleLikeRef: MutableRefObject<() => void>;
}

/**
 * OS media-session integration extracted from PlayerContext (WS-ARCH):
 * navigator.mediaSession action handlers + metadata + playback/position state,
 * and the Capacitor foreground-service / notification bridge calls. Behaviour is
 * unchanged — the effects moved verbatim.
 */
export function useMediaSession(opts: UseMediaSessionOpts): void {
  const {
    currentSong, isPlaying, currentTime, duration, playbackSpeed, isLiked, repeat,
    setRepeat, audioRef, playNextRef, playPreviousRef, playPreviousForcedRef, toggleLikeRef,
  } = opts;

  const bridge = getBridge();
  const lastMediaPositionRef = useRef(0);
  const lastMediaIsPlayingRef = useRef<boolean | null>(null);

    // 1. Register action handlers once — all use stable refs, no deps needed
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;

        const safe = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
            try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* action unsupported in this browser */ }
        };

        safe('play',     () => audioRef.current?.play().catch(() => {}));
        safe('pause',    () => audioRef.current?.pause());
        safe('nexttrack',() => playNextRef.current());
        safe('previoustrack', () => playPreviousRef.current());
        safe('seekto', (d) => {
            if (audioRef.current && d.seekTime != null)
                audioRef.current.currentTime = d.seekTime;
        });
        safe('seekforward', (d) => {
            const a = audioRef.current;
            if (a) a.currentTime = Math.min(a.currentTime + (d.seekOffset ?? 10), a.duration || 0);
        });
        safe('seekbackward', (d) => {
            const a = audioRef.current;
            if (a) a.currentTime = Math.max(a.currentTime - (d.seekOffset ?? 10), 0);
        });

        return () => {
            (['play','pause','nexttrack','previoustrack','seekto','seekforward','seekbackward'] as MediaSessionAction[])
                .forEach(a => { try { navigator.mediaSession.setActionHandler(a, null); } catch { /* action unsupported in this browser */ } });
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // 2. Update metadata when song changes (title, artist, album, artwork)
    //
    // Artwork is supplied as an inline data: URL so Chromium's MPRIS/SMTC bridge
    // never has to make a cross-process fetch (blob: URLs are unreachable from the
    // browser process, and file:// URLs went through a broken protocol handler).
    // data: URLs are decoded entirely in-process — no network, no filesystem access
    // required.
    //
    // Resolution order (all platforms):
    //   1. Explicitly cached offline cover art → readCachedImage → data URL
    //      (works on Electron and Capacitor/iOS/Android — readCachedImage is implemented
    //      identically on all of them; this is the only path that works while offline)
    //   2. imageCacheService IDB by coverArt ID → FileReader → data URL  (same source as AlbumArt UI)
    //   3. iOS-only: fetch() + streaming reader → data URL (bypasses ATS/CapacitorHttp issues)
    //   4. Fetch from Subsonic in renderer → FileReader → data URL
    //
    // Level 2 ensures the notification always shows the same art as the player UI.
    // The old Level 2 (sibling/embedded audio-file art) was removed because it could
    // surface per-track embedded art that differs from the Subsonic album cover art.
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        if (!currentSong) {
            navigator.mediaSession.metadata = null;
            return;
        }

        // Publish text metadata immediately so OS controls appear at once.
        navigator.mediaSession.metadata = new MediaMetadata({
            title:   currentSong.title,
            artist:  currentSong.artist,
            album:   currentSong.album,
            artwork: [],
        });

        if (!currentSong.coverArt) return;

        // Level 1 (all platforms): explicitly cached offline cover art. Checked first —
        // it's the fastest path and the only one that works while offline. readCachedImage
        // is implemented identically on Electron and Capacitor (iOS/Android), so this is
        // not platform-gated.
        if (offlineCacheService.isCoverArtCached(currentSong.coverArt)) {
            const cachedPath = offlineCacheService.getCachedCoverArtPath(currentSong.coverArt);
            if (cachedPath) {
                (async () => {
                    const artSrc = await bridge.readCachedImage(cachedPath);
                    if (!artSrc) return;
                    if (navigator.mediaSession.metadata?.title !== currentSong.title) return;
                    navigator.mediaSession.metadata = new MediaMetadata({
                        title:   currentSong.title,
                        artist:  currentSong.artist,
                        album:   currentSong.album,
                        artwork: [{ src: artSrc, sizes: '512x512', type: 'image/jpeg' }],
                    });
                })();
                return;
            }
        }

        // iOS fast path: MPNowPlayingInfoCenter fetches artwork natively, bypassing
        // CapacitorHttp, so HTTP Subsonic URLs are blocked by ATS.
        // CapacitorHttp.request() has no native iOS impl and falls back to the JS
        // web class, which internally calls response.blob() — the known broken path.
        // Use fetch() + ReadableStream reader instead: this is the same proven path
        // that downloadSongJS uses for audio files on iOS.
        if (Capacitor.getPlatform() === 'ios' && !offlineCacheService.getConfig().enabled) {
            const { username, password, serverUrl } = getFromStorage();
            if (username && password && serverUrl && currentSong.coverArt) {
                const artUrl = getCoverArtUrl(serverUrl, username, password, currentSong.coverArt!, 512);
                (async () => {
                    try {
                        const response = await fetch(artUrl);
                        if (!response.ok || !response.body) return;

                        const reader = response.body.getReader();
                        const chunks: Uint8Array[] = [];
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            if (value) chunks.push(value);
                        }

                        const mime = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
                        const dataUrl = chunksToDataUrl(chunks, mime);

                        if (navigator.mediaSession.metadata?.title !== currentSong.title) return;
                        navigator.mediaSession.metadata = new MediaMetadata({
                            title:   currentSong.title,
                            artist:  currentSong.artist,
                            album:   currentSong.album,
                            artwork: [{ src: dataUrl, sizes: '512x512', type: mime }],
                        });
                    } catch { /* keep text-only metadata */ }
                })();
            }
            return;
        }

        const controller = new AbortController();

        (async () => {
            try {
                let artSrc: string | null = null;

                // (Level 1 — explicitly cached offline cover art — is handled above,
                // before this async block, for all platforms.)

                // ── Level 2: imageCacheService IDB (same source as the player UI) ─
                if (!artSrc) {
                    try {
                        const idbEntry = await imageCacheService.getFromIndexedDB(currentSong.coverArt!);
                        if (idbEntry) {
                            artSrc = await blobToDataUrl(idbEntry.blob);
                        }
                    } catch { /* fall through to Subsonic fetch */ }
                }

                // ── Level 3 (Electron) / web fallback: fetch → data URL ──
                if (!artSrc && !offlineCacheService.getConfig().enabled) {
                    const { username, password, serverUrl } = getFromStorage();
                    if (username && password && serverUrl) {
                        const remoteUrl = getCoverArtUrl(serverUrl, username, password, currentSong.coverArt!, 512);
                        const response = await fetch(remoteUrl, { signal: controller.signal });
                        artSrc = await blobToDataUrl(await response.blob());
                    }
                }

                if (!artSrc) return;
                // Guard: bail if the song changed while we were resolving artwork
                if (navigator.mediaSession.metadata?.title !== currentSong.title) return;

                navigator.mediaSession.metadata = new MediaMetadata({
                    title:   currentSong.title,
                    artist:  currentSong.artist,
                    album:   currentSong.album,
                    artwork: [{ src: artSrc, sizes: '512x512', type: 'image/jpeg' }],
                });
            } catch {
                // aborted or network error — keep text-only metadata
            }
        })();

        return () => { controller.abort(); };
    }, [currentSong]);

    // 3. Sync playback state (playing / paused / none)
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = currentSong
            ? (isPlaying ? 'playing' : 'paused')
            : 'none';
    }, [isPlaying, currentSong]);

    // 4. Update seek-bar position in OS controls
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        if (!duration || !isFinite(duration)) return;
        try {
            navigator.mediaSession.setPositionState({
                duration,
                playbackRate: playbackSpeed,
                position: Math.min(currentTime, duration),
            });
        } catch { /* setPositionState unsupported in this browser */ }
    }, [currentTime, duration, playbackSpeed]);

    // Start/stop Android foreground service; metadata is bundled in the intent
    // so the notification is correct the moment startForeground() is called.
    // Artwork resolution order mirrors the player UI (AlbumArt component):
    //   1. Permanent download cache (offline-first)
    //   2. imageCacheService IDB by coverArt ID (same source as AlbumArt UI)
    //   3. Subsonic server URL fallback
    useEffect(() => {
        if (!bridge.isCapacitor) return;
        if (!currentSong) { bridge.stopMediaService(); return; }

        (async () => {
            const { username, password, serverUrl } = getFromStorage();
            let artworkUrl: string | null = null;

            if (currentSong.coverArt) {
                // Level 1: downloaded cover art
                if (offlineCacheService.isCoverArtCached(currentSong.coverArt)) {
                    const rel = offlineCacheService.getCachedCoverArtPath(currentSong.coverArt);
                    if (rel) artworkUrl = await getBridge().readCachedImage(rel);
                }
                // Level 2: imageCacheService IDB (same as what AlbumArt shows)
                if (!artworkUrl) {
                    try {
                        const idbEntry = await imageCacheService.getFromIndexedDB(currentSong.coverArt);
                        if (idbEntry) {
                            artworkUrl = await blobToDataUrl(idbEntry.blob);
                        }
                    } catch { /* fall through to server URL */ }
                }
                // Level 3: Subsonic server URL
                if (!artworkUrl && username && password && serverUrl && !offlineCacheService.getConfig().enabled) {
                    artworkUrl = getCoverArtUrl(serverUrl, username, password, currentSong.coverArt, 512);
                }
            }

            bridge.startMediaService(currentSong.title, currentSong.artist, currentSong.album ?? '', artworkUrl);
        })();
    }, [currentSong]);

    // Push play/pause state + position to the native notification.
    // Position updates are throttled to 1 fps to avoid flooding the native bridge
    // (each call triggers a Capacitor debug log). Play/pause changes always fire immediately.
    useEffect(() => {
        if (!bridge.isCapacitor) return;
        const now = Date.now();
        const playStateChanged = isPlaying !== lastMediaIsPlayingRef.current;
        if (!playStateChanged && now - lastMediaPositionRef.current < 1000) return;
        lastMediaPositionRef.current = now;
        lastMediaIsPlayingRef.current = isPlaying;
        bridge.updateMediaPlaybackState(isPlaying, Math.floor(currentTime * 1000), Math.floor(duration * 1000));
    }, [isPlaying, currentTime, duration]);

    // Push liked + repeat state to the native notification buttons
    useEffect(() => {
        if (!bridge.isCapacitor) return;
        const repeatMode = repeat === 'off' ? 0 : repeat === 'all' ? 1 : 2;
        bridge.updateMediaNotificationState(isLiked, repeatMode);
    }, [isLiked, repeat]);

    // Handle media control events fired from the native notification buttons
    useEffect(() => {
        if (!bridge.isCapacitor) return;
        const unsub = bridge.onMediaControl((action, positionMs) => {
            switch (action) {
                case 'play':     audioRef.current?.play().catch(() => {}); break;
                case 'pause':    audioRef.current?.pause(); break;
                case 'next':     playNextRef.current(); break;
                case 'previous':       playPreviousRef.current(); break;
                case 'previous_force': playPreviousForcedRef.current();   break;
                case 'seek':
                    if (positionMs != null && audioRef.current)
                        audioRef.current.currentTime = positionMs / 1000;
                    break;
                case 'like':
                    toggleLikeRef.current();
                    break;
                case 'repeat_off':
                    setRepeat('off');
                    break;
                case 'repeat_all':
                    setRepeat('all');
                    break;
                case 'repeat_one':
                    setRepeat('one');
                    break;
            }
        });
        return unsub;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
