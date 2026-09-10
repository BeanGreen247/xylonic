import React, { createContext, useContext, useState, useRef, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { logger } from '../utils/logger';
import { buildShuffleQueue as buildShuffleQueuePure, computeNextIndex } from './playerQueue';
import { useMediaSession } from './useMediaSession';
import { useSleepTimer } from './useSleepTimer';
import { usePlaybackPrefs } from './usePlaybackPrefs';
import { useNeighborSongs } from './useNeighborSongs';
import { usePlaybackEngine } from './usePlaybackEngine';
import { useQueueActions } from './useQueueActions';
import { isSongLiked, toggleLike as toggleLikeSong } from '../services/likedSongsService';
import { offlineCacheService } from '../services/offlineCacheService';
import { useOfflineMode } from './OfflineModeContext';
import { getFromStorage } from '../utils/storage';
import { addToHistory } from '../services/recentlyPlayedService';
import { getCoverArtUrl } from '../services/subsonicApi';
import { Capacitor } from '@capacitor/core';
import { getBridge } from '../platform/bridge';
import { remoteDiscoveryService } from '../services/remoteDiscoveryService';

import {
    saveIndex,
    loadIndex,
    saveShuffle,
    loadShuffle,
    saveRepeat,
    loadRepeat,
    saveQueue as persistQueue,
    loadQueue as persistLoadQueue,
    clearPlayerPersistence,
} from './playerPersistence';

const saveQueue = (songs: Song[]) => persistQueue(songs);
const loadQueue = (): Song[] => persistLoadQueue<Song>();

interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    url: string;
    duration?: number;
    coverArt?: string;
    bitRate?: number;
    suffix?: string;
    size?: number;
    samplingRate?: number;
    channelCount?: number;
    bitDepth?: number;
    year?: number;
    track?: number;
    discNumber?: number;
}

export interface PlayerContextType {
    currentSong: Song | null;
    playlist: Song[];
    isPlaying: boolean;
    isLoading: boolean;
    volume: number;
    shuffle: boolean;
    repeat: 'off' | 'all' | 'one';
    bitrate: number | null;
    muted: boolean;
    isLiked: boolean;
    playbackSpeed: number;
    sleepTimerRemaining: number | null;
    nextSong: Song | null;
    prevSong: Song | null;
    playSong: (song: Song) => void;
    playPlaylist: (songs: Song[], startIndex?: number) => void;
    togglePlayPause: () => void;
    playNext: () => void;
    playPrevious: () => void;
    playPreviousForced: () => void;
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
    toggleShuffle: () => void;
    toggleRepeat: () => void;
    setBitrate: (bitrate: number | null) => void;
    toggleMute: () => void;
    setTrackListAndPlay: (songs: Song[], startIndex?: number) => void;
    toggleLike: () => void;
    clearPlayback: () => void;
    addToQueue: (song: Song) => void;
    insertNext: (song: Song) => void;
    removeFromQueue: (index: number) => void;
    moveInQueue: (from: number, to: number) => void;
    clearQueue: () => void;
    setPlaybackSpeed: (speed: number) => void;
    setSleepTimer: (minutes: number | null) => void;
}

// Separate context for high-frequency time updates so that components which
// only need currentSong / isPlaying / etc. are not re-rendered every frame.
export interface PlayerTimeContextType {
    currentTime: number;
    duration: number;
}

const PlayerContext     = createContext<PlayerContextType | undefined>(undefined);
const PlayerTimeContext = createContext<PlayerTimeContextType>({ currentTime: 0, duration: 0 });

export const usePlayer = () => {
    const context = useContext(PlayerContext);
    if (!context) {
        throw new Error('usePlayer must be used within PlayerProvider');
    }
    return context;
};

export const usePlayerTime = (): PlayerTimeContextType => useContext(PlayerTimeContext);

interface PlayerProviderProps {
    children: ReactNode;
}

export const PlayerProvider: React.FC<PlayerProviderProps> = ({ children }) => {
    const bridge = getBridge();
    const { offlineModeEnabled, cacheInitialized } = useOfflineMode();
    const offlineModeEnabledRef = useRef(offlineModeEnabled);
    useEffect(() => {
        offlineModeEnabledRef.current = offlineModeEnabled;
        if (!offlineModeEnabled) return; // only act on switch-to-offline

        const song = currentSongRef.current;
        if (!song || !offlineCacheService.isCached(song.id)) return;

        const audio = audioRef.current;
        if (!audio) return;
        const savedTime  = audio.currentTime;
        const wasPlaying = !audio.paused;

        offlineCacheService.getCachedFilePath(song.id)
            .then(cachedPath => {
                if (!cachedPath) return;
                const a = audioRef.current;
                if (!a) return;
                const url = /^https?:\/\/|^capacitor:\/\//.test(cachedPath)
                    ? cachedPath
                    : `file:///${cachedPath.replace(/\\/g, '/')}`;
                a.src = url;
                a.load();
                a.currentTime = savedTime;
                if (wasPlaying) a.play().catch(() => {});
            })
            .catch(() => {});
    }, [offlineModeEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

    // Startup: when the offline cache finishes initializing, prime audio.src
    // with the local file so the play button works on a fresh app launch.
    // Uses currentSongRef (not state) to avoid a TDZ — currentSong's useState
    // is declared later in the function body; the ref is already synced by the
    // time cacheInitialized flips true.
    useEffect(() => {
        if (!cacheInitialized || !offlineModeEnabled) return;
        const audio = audioRef.current;
        if (!audio || audio.src) return; // already primed
        const song = currentSongRef.current;
        if (!song || !offlineCacheService.isCached(song.id)) return;

        offlineCacheService.getCachedFilePath(song.id)
            .then(cachedPath => {
                if (!cachedPath) return;
                const a = audioRef.current;
                if (!a || a.src) return;
                const url = /^https?:\/\/|^capacitor:\/\//.test(cachedPath)
                    ? cachedPath
                    : `file:///${cachedPath.replace(/\\/g, '/')}`;
                a.src = url;
                a.load();
            })
            .catch(() => {});
    }, [cacheInitialized, offlineModeEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

    const [playlist, setPlaylist] = useState<Song[]>(loadQueue);
    const [currentIndex, setCurrentIndex] = useState(() => {
        const pl = loadQueue();
        const idx = loadIndex();
        return pl.length > 0 ? Math.min(idx, pl.length - 1) : 0;
    });
    const [currentSong, setCurrentSong] = useState<Song | null>(() => {
        const pl = loadQueue();
        const idx = pl.length > 0 ? Math.min(loadIndex(), pl.length - 1) : 0;
        return pl[idx] ?? null;
    });
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolumeState] = useState(0.7);
    const [shuffle, setShuffle] = useState(loadShuffle);
    const [repeat, setRepeat] = useState(loadRepeat);
    const [muted, setMuted] = useState(false);
    const [prevVolume, setPrevVolume] = useState(0.7);
    const [isLiked, setIsLiked] = useState(false);
    const wasPlayingRef = useRef(false);
    const saveQueueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const preloadRef = useRef<HTMLAudioElement | null>(null);
    const currentSongRef = useRef<Song | null>(null);
    const isGoingBackRef = useRef(false);
    const playHistoryRef = useRef<Song[]>([]);
    const [historyTip, setHistoryTip] = useState<Song | null>(null);
    const playPreviousWithRefsRef = useRef<() => void>(() => {});
    const playPreviousForcedRef   = useRef<() => void>(() => {});
    const shuffleQueueRef = useRef<number[]>([]);
    const shuffleQueueIndexRef = useRef(0);
    const lastIpcPositionRef = useRef(0);

    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Per-user playback prefs — bitrate + speed (extracted to ./usePlaybackPrefs)
    const { bitrate, setBitrate, playbackSpeed, setPlaybackSpeed, speedRef: playbackSpeedRef } =
        usePlaybackPrefs(audioRef);

    // Sleep timer (extracted to ./useSleepTimer)
    const { sleepTimerRemaining, setSleepTimer } = useSleepTimer(
        useCallback(() => { audioRef.current?.pause(); }, []),
    );
    const playlistRef = useRef<Song[]>([]);
    const currentIndexRef = useRef(0);
    const repeatRef = useRef<'off' | 'all' | 'one'>('off');
    const shuffleRef = useRef(false);

    // NEW: keep latest playNextWithRefs without depending on declaration order
    const playNextWithRefsRef = useRef<() => void>(() => {});
    // Stable ref to playSong — used by MediaSession previoustrack handler
    const playSongRef = useRef<(song: Song) => void>(() => {});
    // Stable ref to playPlaylist — used by remote command handler
    const playPlaylistRef = useRef<(songs: Song[], startIndex?: number) => void>(() => {});
    // Stable ref to toggleLike — used by notification like button
    const toggleLikeRef = useRef<() => void>(() => {});

    const applyVolume = useCallback((vol: number) => {
        if (audioRef.current) audioRef.current.volume = vol;
    }, []);

    // Create audio element ONCE (do not depend on volume or playNextWithRefs)
    useEffect(() => {
        const preload = new Audio();
        preload.preload = 'auto';
        preloadRef.current = preload;
        return () => { preload.src = ''; preloadRef.current = null; };
    }, []);

    // Owns the <audio> element + its media-event → state wiring (extracted to
    // ./usePlaybackEngine). `playNextWithRefsRef` is passed as the ended-handler
    // ref so the engine stays decoupled from the queue logic below.
    usePlaybackEngine({
        audioRef,
        setCurrentTime,
        setDuration,
        setIsPlaying,
        setIsLoading,
        onEnded: playNextWithRefsRef,
    });

    // Keep audio properties in sync with state (no re-creation)
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.muted = muted;
        audio.volume = muted ? 0 : volume;
    }, [muted, volume]);

    // Listen for logout event to clear playback
    useEffect(() => {
        const handleLogout = () => {
            logger.log('Logout detected, clearing playback');
            const audio = audioRef.current;
            if (audio) {
                audio.pause();
                audio.src = '';
                audio.load();
            }
            setCurrentSong(null);
            setPlaylist([]);
            setCurrentIndex(0);
            setIsPlaying(false);
            setCurrentTime(0);
            setDuration(0);
            setIsLiked(false);
            clearPlayerPersistence();
        };

        window.addEventListener('logout', handleLogout);
        return () => window.removeEventListener('logout', handleLogout);
    }, []);

    // Clear play history on logout
    useEffect(() => {
        const handleLogout = () => {
            playHistoryRef.current = [];
            setHistoryTip(null);
        };
        window.addEventListener('logout', handleLogout);
        return () => window.removeEventListener('logout', handleLogout);
    }, []);

    const playSong = useCallback(async (song: Song) => {
        const audio = audioRef.current;
        if (!audio) return;

        // Push current song to history when moving forward (not when going back)
        if (!isGoingBackRef.current && currentSongRef.current) {
            const hist = playHistoryRef.current;
            hist.push(currentSongRef.current);
            if (hist.length > 50) hist.shift();
            setHistoryTip(hist[hist.length - 1]);
        }
        isGoingBackRef.current = false;

        logger.log('[PLAYER] Playing song:', song.title, 'by', song.artist);
        logger.log('[PLAYER] Stream URL:', song.url);
        logger.log('Playing song:', song.title);
        setCurrentSong(song);
        setIsLoading(true);
        addToHistory(song);

        // Check if song is cached (offline-first)
        let sourceUrl = song.url;
        const isCached = offlineCacheService.isCached(song.id);

        if (isCached) {
            try {
                const cachedPath = await offlineCacheService.getCachedFilePath(song.id);
                if (cachedPath) {
                    // Capacitor returns a WebView-loadable URL (https://localhost/_capacitor_file_/...)
                    // Electron returns a native filesystem path that needs the file:/// prefix
                    if (/^https?:\/\/|^capacitor:\/\//.test(cachedPath)) {
                        sourceUrl = cachedPath;
                    } else {
                        const normalizedPath = cachedPath.replace(/\\/g, '/');
                        sourceUrl = `file:///${normalizedPath}`;
                    }
                    logger.log('[PLAYER] Using cached song:', sourceUrl);
                    logger.log('Using cached song:', sourceUrl);
                } else {
                    logger.warn('Cache path not found for cached song, falling back to stream');
                }
            } catch (error) {
                logger.error('Failed to get cached song, falling back to stream:', error);
            }
        }

        // In offline mode, never stream — if the song is not locally available, bail.
        if (offlineModeEnabledRef.current && sourceUrl === song.url) {
            logger.warn('[Player] Offline mode: song not cached, skipping network attempt:', song.title);
            setIsLoading(false);
            return;
        }

        audio.src = sourceUrl;
        audio.load();

        audio.muted = muted;
        audio.volume = muted ? 0 : volume;
        audio.playbackRate = playbackSpeedRef.current;

        audio.play().catch(err => logger.error('Play error:', err));
    }, [muted, volume]);

    // Keep refs in sync with state and persist queue (debounced write)
    useEffect(() => {
        playlistRef.current = playlist;
        currentIndexRef.current = currentIndex;
        repeatRef.current = repeat;
        shuffleRef.current = shuffle;
        if (saveQueueTimerRef.current) clearTimeout(saveQueueTimerRef.current);
        saveQueueTimerRef.current = setTimeout(() => {
            saveQueueTimerRef.current = null;
            saveQueue(playlist);
            saveIndex(currentIndex);
            saveShuffle(shuffle);
            saveRepeat(repeat);
        }, 500);
    }, [playlist, currentIndex, repeat, shuffle]);

    // Rebuild Fisher-Yates shuffle queue whenever shuffle is enabled or playlist length changes
    const buildShuffleQueue = useCallback((length: number, currentIdx: number) => {
        shuffleQueueRef.current = buildShuffleQueuePure(length, currentIdx);
        shuffleQueueIndexRef.current = 0;
    }, []);

    useEffect(() => {
        if (shuffle) buildShuffleQueue(playlist.length, currentIndex);
    }, [shuffle, playlist.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const playNextWithRefs = useCallback(() => {
        const currentPlaylist = playlistRef.current;
        const currentIdx = currentIndexRef.current;
        const currentRepeat = repeatRef.current;
        const currentShuffle = shuffleRef.current;

        if (currentPlaylist.length === 0) {
            logger.log('No playlist, cannot play next');
            return;
        }

        logger.log(`Current index: ${currentIdx}, Playlist length: ${currentPlaylist.length}, Repeat: ${currentRepeat}`);

        const result = computeNextIndex({
            currentIndex: currentIdx,
            playlistLength: currentPlaylist.length,
            repeat: currentRepeat,
            shuffle: currentShuffle,
            shuffleQueue: shuffleQueueRef.current,
            shuffleQueuePos: shuffleQueueIndexRef.current,
        });

        if (result.action === 'noop') return;

        if (result.action === 'replay') {
            logger.log('Repeat one: replaying current song');
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play().catch(err => logger.error('Play error:', err));
            }
            return;
        }

        // 'advance' — persist any rebuilt shuffle queue / cursor back to the refs
        shuffleQueueRef.current = result.shuffleQueue;
        shuffleQueueIndexRef.current = result.shuffleQueuePos;
        const nextIndex = result.nextIndex;
        logger.log(`Next index ${nextIndex} (shuffle=${currentShuffle})`);

        setCurrentIndex(nextIndex);
        playSong(currentPlaylist[nextIndex]);
    }, [playSong]);

    // NEW: update refs whenever callbacks change
    useEffect(() => {
        playNextWithRefsRef.current = playNextWithRefs;
    }, [playNextWithRefs]);

    useEffect(() => {
        playSongRef.current = playSong;
    }, [playSong]);

    useEffect(() => {
        currentSongRef.current = currentSong;
    }, [currentSong]);

    const playPreviousWithRefs = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.currentTime > 3) { audio.currentTime = 0; return; }

        const hist = playHistoryRef.current;
        if (hist.length > 0) {
            const prevFromHistory = hist.pop()!;
            setHistoryTip(hist.length > 0 ? hist[hist.length - 1] : null);
            // Sync currentIndex if the song is still in the playlist
            const idx = playlistRef.current.findIndex(s => s.id === prevFromHistory.id);
            if (idx !== -1) {
                currentIndexRef.current = idx;
                setCurrentIndex(idx);
            }
            isGoingBackRef.current = true;
            playSongRef.current(prevFromHistory);
            return;
        }

        // No history — sequential fallback for non-shuffle
        const pl  = playlistRef.current;
        const idx = currentIndexRef.current;
        const rep = repeatRef.current;
        if (pl.length === 0) return;
        let prev = idx - 1;
        if (prev < 0) {
            if (rep === 'all') prev = pl.length - 1;
            else { audio.currentTime = 0; return; }
        }
        currentIndexRef.current = prev;
        setCurrentIndex(prev);
        isGoingBackRef.current = true;
        playSongRef.current(pl[prev]);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        playPreviousWithRefsRef.current = playPreviousWithRefs;
    }, [playPreviousWithRefs]);

    // Like playPreviousWithRefs but always switches song — no "restart if >3s" guard.
    // Used by the native notification prev button so a swipe always goes to the prior song.
    const playPreviousForced = useCallback(() => {
        const hist = playHistoryRef.current;
        if (hist.length > 0) {
            const prevFromHistory = hist.pop()!;
            setHistoryTip(hist.length > 0 ? hist[hist.length - 1] : null);
            const idx = playlistRef.current.findIndex(s => s.id === prevFromHistory.id);
            if (idx !== -1) {
                currentIndexRef.current = idx;
                setCurrentIndex(idx);
            }
            isGoingBackRef.current = true;
            playSongRef.current(prevFromHistory);
            return;
        }
        const pl  = playlistRef.current;
        const idx = currentIndexRef.current;
        const rep = repeatRef.current;
        if (pl.length === 0) return;
        let prev = idx - 1;
        if (prev < 0) {
            if (rep === 'all') prev = pl.length - 1;
            else return;
        }
        currentIndexRef.current = prev;
        setCurrentIndex(prev);
        isGoingBackRef.current = true;
        playSongRef.current(pl[prev]);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        playPreviousForcedRef.current = playPreviousForced;
    }, [playPreviousForced]);

    const playPlaylist = useCallback((songs: Song[], startIndex = 0) => {
        logger.log(`Playing playlist: ${songs.length} songs, starting at index ${startIndex}`);
        // Clear history on fresh playlist load — old session history no longer applies
        playHistoryRef.current = [];
        setHistoryTip(null);
        isGoingBackRef.current = true; // don't push the outgoing song to fresh history
        setPlaylist(songs);
        setCurrentIndex(startIndex);
        if (songs[startIndex]) {
            playSong(songs[startIndex]);
        }
    }, [playSong]);

    useEffect(() => {
        playPlaylistRef.current = playPlaylist;
    }); // intentionally no deps — always track latest

    const togglePlayPause = useCallback(() => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play().catch(err => logger.error('Play error:', err));
        }
    }, [isPlaying]);

    const playNext = useCallback(() => {
        playNextWithRefs();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const playPrevious = useCallback(() => {
        playPreviousWithRefsRef.current();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const playPreviousForcedStable = useCallback(() => {
        playPreviousForcedRef.current();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const seek = useCallback((time: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = time;
            setCurrentTime(time);
        }
    }, []);

    const setVolume = useCallback((newVolume: number) => {
        const clamped = Math.max(0, Math.min(1, newVolume));
        setVolumeState(clamped);
        if (clamped > 0) {
            setPrevVolume(clamped);
            if (muted) setMuted(false);
        } else {
            if (!muted) setMuted(true);
        }
        if (audioRef.current) {
            audioRef.current.volume = clamped;
        }
    }, [muted]);

    const toggleMute = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (!muted) {
            wasPlayingRef.current = !audio.paused;
            const remember = volume > 0 ? volume : prevVolume;
            setPrevVolume(remember > 0 ? remember : 0.7);
            setMuted(true);
            setVolumeState(0);
            audio.muted = true;
            audio.volume = 0;
            return;
        }
        const restore = prevVolume > 0 ? prevVolume : 0.7;
        setMuted(false);
        setVolumeState(restore);
        audio.muted = false;
        audio.volume = restore;
        if (wasPlayingRef.current) {
            wasPlayingRef.current = false;
            audio.play().catch(err => logger.error('Play error:', err));
        }
    }, [muted, volume, prevVolume]);

    const toggleShuffle = useCallback(() => {
        setShuffle(prev => !prev);
    }, []);

    const toggleRepeat = useCallback(() => {
        setRepeat(prev => {
            if (prev === 'off') return 'all';
            if (prev === 'all') return 'one';
            return 'off';
        });
    }, []);

    const toggleLike = useCallback(async () => {
        if (currentSong) {
            try {
                const newLikedState = await toggleLikeSong({
                    id: currentSong.id,
                    title: currentSong.title,
                    artist: currentSong.artist,
                    album: currentSong.album
                });
                setIsLiked(newLikedState);
            } catch (error) {
                logger.error('[Player] Failed to toggle like:', error);
            }
        }
    }, [currentSong]);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { toggleLikeRef.current = toggleLike; }, [toggleLike]);

    // Keep isLiked in sync with cross-device liked-song changes (periodic sync events)
    useEffect(() => {
        const handler = async () => {
            if (!currentSong) return;
            try {
                const liked = await isSongLiked(currentSong.id);
                setIsLiked(liked);
            } catch { /* best-effort liked-state refresh */ }
        };
        window.addEventListener('likedSongsUpdated', handler);
        return () => window.removeEventListener('likedSongsUpdated', handler);
    }, [currentSong]);

    // Update liked status when song changes
    useEffect(() => {
        let cancelled = false;
        const checkLikedStatus = async () => {
            if (currentSong) {
                logger.log('[Player] Song changed, checking liked status for:', currentSong.id, currentSong.title);
                try {
                    const liked = await isSongLiked(currentSong.id);
                    logger.log(`[Player] Song "${currentSong.title}" (${currentSong.id}) liked status:`, liked);
                    if (!cancelled) setIsLiked(liked);
                } catch (error) {
                    logger.error('[Player] Failed to check liked status:', error);
                    if (!cancelled) setIsLiked(false);
                }
            } else {
                logger.log('[Player] No current song, setting liked to false');
                setIsLiked(false);
            }
        };

        checkLikedStatus();
        return () => { cancelled = true; };
    }, [currentSong, currentSong?.id, cacheInitialized]);

    // ── OS Media Session + native notification (extracted to ./useMediaSession) ──
    useMediaSession({
        currentSong, isPlaying, currentTime, duration, playbackSpeed, isLiked, repeat, setRepeat,
        audioRef,
        playNextRef: playNextWithRefsRef,
        playPreviousRef: playPreviousWithRefsRef,
        playPreviousForcedRef,
        toggleLikeRef,
    });


    // Handle incoming remote commands from other Xylonic devices
    useEffect(() => {
        const unsub = remoteDiscoveryService.onRemoteCommand((action, data) => {
            switch (action) {
                case 'togglePlay':
                    if (audioRef.current?.paused) audioRef.current.play().catch(() => {});
                    else audioRef.current?.pause();
                    break;
                case 'play':
                    audioRef.current?.play().catch(() => {});
                    break;
                case 'pause':
                    audioRef.current?.pause();
                    break;
                case 'next':
                    playNextWithRefsRef.current();
                    break;
                case 'previous':
                    playPreviousWithRefsRef.current();
                    break;
                case 'seek':
                    if (data?.time != null && audioRef.current)
                        audioRef.current.currentTime = data.time;
                    break;
                case 'setVolume':
                    if (data?.volume != null) {
                        const v = Math.max(0, Math.min(1, data.volume));
                        if (audioRef.current) audioRef.current.volume = v;
                        setVolumeState(v);
                    }
                    break;
                case 'playSong':
                    if (data?.url) playSongRef.current(data as Song);
                    break;
                case 'playPlaylist':
                    if (Array.isArray(data?.songs) && data.songs.length > 0) {
                        playPlaylistRef.current(data.songs, data.startIndex ?? 0);
                    }
                    break;
                case 'toggleShuffle':
                    setShuffle(prev => !prev);
                    break;
                case 'toggleRepeat':
                    setRepeat(prev => prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off');
                    break;
            }
        });
        return unsub;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Broadcast metadata changes to mini player + native MPRIS service (Electron only).
    // Fires immediately on song/play/control changes — deliberately excludes currentTime.
    useEffect(() => {
        if (!bridge.isElectron) return;
        const { username, password, serverUrl } = getFromStorage();
        const coverArtUrl = (currentSong?.coverArt && username && password && serverUrl)
            ? getCoverArtUrl(serverUrl, username, password, currentSong.coverArt, 512)
            : null;
        bridge.sendPlayerState({
            currentSong, isPlaying, isLoading,
            currentTime, duration, volume, shuffle, repeat, muted, coverArtUrl,
        });
    }, [currentSong, isPlaying, isLoading, duration, volume, shuffle, repeat, muted]); // eslint-disable-line react-hooks/exhaustive-deps

    // Throttled position-only IPC update — max 2 fps to avoid flooding the main process.
    useEffect(() => {
        if (!bridge.isElectron) return;
        const now = Date.now();
        if (now - lastIpcPositionRef.current < 500) return;
        lastIpcPositionRef.current = now;
        bridge.sendPlayerState({
            currentSong, isPlaying, isLoading,
            currentTime, duration, volume, shuffle, repeat, muted, coverArtUrl: null,
        });
    }, [currentTime]); // eslint-disable-line react-hooks/exhaustive-deps

    // Push player state into the remote discovery broadcast so controllers can mirror our playback
    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;
        remoteDiscoveryService.updatePlayerState({
            isPlaying: isPlaying && !isLoading,
            currentTime: audioRef.current?.currentTime ?? currentTime,
            duration,
            song: currentSong ? {
                id:       currentSong.id,
                title:    currentSong.title,
                artist:   currentSong.artist,
                album:    currentSong.album    ?? '',
                coverArt: currentSong.coverArt ?? '',
                duration: currentSong.duration ?? 0,
            } : null,
        }).catch(() => {});
    }, [currentSong, isPlaying, isLoading, duration]); // eslint-disable-line react-hooks/exhaustive-deps

    // Listen for control actions from mini player and native MPRIS service
    useEffect(() => {
        if (bridge.isElectron) {
            const unsubscribe = bridge.onPlayerControlAction((action: string, data?: any) => {
                switch (action) {
                    case 'play':
                        audioRef.current?.play().catch(err => logger.error('Play error:', err));
                        break;
                    case 'pause':
                        audioRef.current?.pause();
                        break;
                    case 'togglePlayPause':
                        if (!audioRef.current) return;
                        if (audioRef.current.paused) {
                            audioRef.current.play().catch(err => logger.error('Play error:', err));
                        } else {
                            audioRef.current.pause();
                        }
                        break;
                    case 'playNext':
                        playNextWithRefsRef.current();
                        break;
                    case 'playPrevious':
                        playPreviousWithRefsRef.current();
                        break;
                    case 'seekAbsolute':
                        if (audioRef.current && typeof data === 'number')
                            audioRef.current.currentTime = data;
                        break;
                    case 'seekRelative':
                        if (audioRef.current && typeof data === 'number')
                            audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime + data);
                        break;
                    case 'setShuffle':
                        setShuffle(!!data);
                        break;
                    case 'setVolume':
                        if (typeof data === 'number') setVolume(data);
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
            return unsubscribe;
        }
    }, [playSong]);

    const clearPlayback = useCallback(() => {
        const audio = audioRef.current;
        if (audio) {
            audio.pause();
            audio.src = '';
            audio.load();
        }
        setCurrentSong(null);
        setPlaylist([]);
        setCurrentIndex(0);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setIsLiked(false);
        playHistoryRef.current = [];
        setHistoryTip(null);
        logger.log('Playback cleared');
    }, []);

    // Queue mutation actions (extracted to ./useQueueActions) — pure array/index
    // bookkeeping against playlistRef / currentIndexRef.
    const { addToQueue, insertNext, removeFromQueue, moveInQueue, clearQueue } = useQueueActions<Song>({
        playlistRef,
        currentIndexRef,
        setPlaylist,
        setCurrentIndex,
    });

    // ── Neighbor songs + look-ahead preload (extracted to ./useNeighborSongs) ──
    const { nextSong, prevSong } = useNeighborSongs({
        playlist, currentIndex, shuffle, repeat, historyTip,
        shuffleQueueRef, shuffleQueueIndexRef, preloadRef, audioRef, offlineModeEnabledRef,
    });

    // Memoized so that the context object reference only changes when something
    // besides currentTime / duration changes. This prevents every usePlayer()
    // consumer from re-rendering at the playback frame rate (30-60 fps).
    const value = useMemo<PlayerContextType>(() => ({
        currentSong,
        playlist,
        isPlaying,
        isLoading,
        volume,
        shuffle,
        repeat,
        bitrate,
        muted,
        isLiked,
        playbackSpeed,
        sleepTimerRemaining,
        nextSong,
        prevSong,
        playSong,
        playPlaylist,
        togglePlayPause,
        playNext,
        playPrevious,
        playPreviousForced: playPreviousForcedStable,
        seek,
        setVolume,
        toggleShuffle,
        toggleRepeat,
        setBitrate,
        toggleMute,
        toggleLike,
        setTrackListAndPlay: playPlaylist,
        clearPlayback,
        addToQueue,
        insertNext,
        removeFromQueue,
        moveInQueue,
        clearQueue,
        setPlaybackSpeed,
        setSleepTimer,
    }), [
        currentSong, playlist, isPlaying, isLoading, volume, shuffle, repeat,
        bitrate, muted, isLiked, playbackSpeed, sleepTimerRemaining,
        nextSong, prevSong,
        playSong, playPlaylist, togglePlayPause, playNext, playPrevious, playPreviousForcedStable, seek,
        setVolume, toggleShuffle, toggleRepeat, setBitrate, toggleMute, toggleLike,
        clearPlayback, addToQueue, insertNext, removeFromQueue, moveInQueue,
        clearQueue, setPlaybackSpeed, setSleepTimer,
    ]);

    const timeValue = useMemo<PlayerTimeContextType>(
        () => ({ currentTime, duration }),
        [currentTime, duration]
    );

    return (
        <PlayerContext.Provider value={value}>
            <PlayerTimeContext.Provider value={timeValue}>
                {children}
            </PlayerTimeContext.Provider>
        </PlayerContext.Provider>
    );
};