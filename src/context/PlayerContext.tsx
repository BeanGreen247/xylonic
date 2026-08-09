import React, { createContext, useContext, useState, useRef, useEffect, ReactNode, useCallback, useMemo } from 'react';
import { logger } from '../utils/logger';
import { isSongLiked, toggleLike as toggleLikeSong } from '../services/likedSongsService';
import { offlineCacheService } from '../services/offlineCacheService';
import { useOfflineMode } from './OfflineModeContext';
import { getUserSettings, readSettings, writeSettings } from '../utils/settingsManager';
import { getFromStorage } from '../utils/storage';
import { addToHistory } from '../services/recentlyPlayedService';
import { getCoverArtUrl } from '../services/subsonicApi';
import { imageCacheService } from '../services/imageCacheService';
import { Capacitor } from '@capacitor/core';
import { getBridge } from '../platform/bridge';
import { remoteDiscoveryService } from '../services/remoteDiscoveryService';
import { isPerformanceModeEnabled } from '../services/performanceModeService';
import { isPowerSaverEnabled }       from '../services/powerSaverService';

const getQueueKey   = () => `queue_${localStorage.getItem('username') || 'guest'}`;
const getIndexKey   = () => `queue_idx_${localStorage.getItem('username') || 'guest'}`;
const getShuffleKey = () => `shuffle_pref_${localStorage.getItem('username') || 'guest'}`;

const saveQueue = (songs: Song[]) => {
    try { localStorage.setItem(getQueueKey(), JSON.stringify(songs)); } catch {}
};

const saveIndex = (idx: number) => {
    try { localStorage.setItem(getIndexKey(), String(idx)); } catch {}
};

const saveShuffle = (v: boolean) => {
    try { localStorage.setItem(getShuffleKey(), String(v)); } catch {}
};

const loadQueue = (): Song[] => {
    try {
        const raw = localStorage.getItem(getQueueKey());
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
};

const loadIndex = (): number => {
    try {
        const raw = localStorage.getItem(getIndexKey());
        return raw !== null ? parseInt(raw, 10) : 0;
    } catch { return 0; }
};

const loadShuffle = (): boolean => {
    try { return localStorage.getItem(getShuffleKey()) === 'true'; } catch { return false; }
};

const getRepeatKey = () => `repeat_pref_${localStorage.getItem('username') || 'guest'}`;
const saveRepeat   = (v: 'off' | 'all' | 'one') => { try { localStorage.setItem(getRepeatKey(), v); } catch {} };
const loadRepeat   = (): 'off' | 'all' | 'one' => {
    try { const v = localStorage.getItem(getRepeatKey()); if (v === 'all' || v === 'one') return v; } catch {}
    return 'off';
};

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
    const [bitrate, setBitrateState] = useState<number | null>(null);
    const [muted, setMuted] = useState(false);
    const [prevVolume, setPrevVolume] = useState(0.7);
    const [isLiked, setIsLiked] = useState(false);
    const [playbackSpeed, setPlaybackSpeedState] = useState(1.0);
    const [sleepTimerEnd, setSleepTimerEnd] = useState<number | null>(null);
    const [sleepTimerRemaining, setSleepTimerRemaining] = useState<number | null>(null);
    const wasPlayingRef = useRef(false);
    const playbackSpeedRef = useRef(1.0);
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
    const lastMediaPositionRef = useRef(0);
    const lastMediaIsPlayingRef = useRef<boolean | null>(null);

    // Load saved streaming quality and playback speed on mount
    useEffect(() => {
        const loadSettings = async () => {
            try {
                const { username } = getFromStorage();
                if (username) {
                    const userSettings = await getUserSettings(username);
                    if (userSettings?.streamingQuality !== undefined) {
                        logger.log('Loading saved streaming quality:', userSettings.streamingQuality);
                        setBitrateState(userSettings.streamingQuality);
                    }
                    if (userSettings?.playbackSpeed !== undefined) {
                        setPlaybackSpeedState(userSettings.playbackSpeed);
                        playbackSpeedRef.current = userSettings.playbackSpeed;
                    }
                }
            } catch (error) {
                logger.error('Failed to load settings:', error);
            }
        };
        loadSettings();
    }, []);

    // Apply playback speed whenever it changes
    useEffect(() => {
        playbackSpeedRef.current = playbackSpeed;
        if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
    }, [playbackSpeed]);

    // Sleep timer countdown
    useEffect(() => {
        if (!sleepTimerEnd) { setSleepTimerRemaining(null); return; }
        const tick = () => {
            const rem = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 1000));
            setSleepTimerRemaining(rem);
            if (rem === 0) {
                audioRef.current?.pause();
                setSleepTimerEnd(null);
            }
        };
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, [sleepTimerEnd]);

    const audioRef = useRef<HTMLAudioElement | null>(null);
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

    useEffect(() => {
        const audio = new Audio();
        audioRef.current = audio;

        // Buffer the latest playback position and flush it to state via RAF so
        // render frequency is capped by the RAF throttle (60 / 30 / 5 fps per
        // mode) rather than firing on every timeupdate event (~4×/s always).
        let pendingTime: number | null = null;
        let rafId: number | null = null;

        const handleTimeUpdate = () => {
            pendingTime = audio.currentTime;
            if (rafId === null) {
                rafId = requestAnimationFrame(() => {
                    if (pendingTime !== null) setCurrentTime(pendingTime);
                    pendingTime = null;
                    rafId = null;
                });
            }
        };
        const handleDurationChange = () => setDuration(audio.duration);

        const handleEnded = () => {
            logger.log('Song ended, calling playNext');
            playNextWithRefsRef.current();
        };

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => { setIsPlaying(false); setIsLoading(false); };
        const handleWaiting = () => setIsLoading(true);
        const handlePlaying = () => setIsLoading(false);
        const handleError = () => setIsLoading(false);

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('durationchange', handleDurationChange);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);
        audio.addEventListener('waiting', handleWaiting);
        audio.addEventListener('playing', handlePlaying);
        audio.addEventListener('error', handleError);

        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('durationchange', handleDurationChange);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
            audio.removeEventListener('waiting', handleWaiting);
            audio.removeEventListener('playing', handlePlaying);
            audio.removeEventListener('error', handleError);
            audio.pause();
            audioRef.current = null;
        };
    }, []);

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
            try { localStorage.removeItem(getQueueKey()); localStorage.removeItem(getIndexKey()); localStorage.removeItem(getShuffleKey()); localStorage.removeItem(getRepeatKey()); } catch {}
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

        console.log('[PLAYER] Playing song:', song.title, 'by', song.artist);
        console.log('[PLAYER] Stream URL:', song.url);
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
                    console.log('[PLAYER] Using cached song:', sourceUrl);
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
        const indices = Array.from({ length }, (_, i) => i).filter(i => i !== currentIdx);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        shuffleQueueRef.current = indices;
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

        let nextIndex: number;

        if (currentRepeat === 'one') {
            logger.log('Repeat one: replaying current song');
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play().catch(err => logger.error('Play error:', err));
            }
            return;
        }

        if (currentShuffle) {
            if (shuffleQueueIndexRef.current >= shuffleQueueRef.current.length) {
                buildShuffleQueue(currentPlaylist.length, currentIdx);
            }
            nextIndex = shuffleQueueRef.current[shuffleQueueIndexRef.current++];
            logger.log(`Shuffle: next index ${nextIndex} (queue pos ${shuffleQueueIndexRef.current - 1}/${shuffleQueueRef.current.length})`);
        } else {
            nextIndex = currentIdx + 1;
            logger.log(`Sequential: next index ${nextIndex}`);

            if (nextIndex >= currentPlaylist.length) {
                logger.log('Reached end of queue, wrapping to index 0');
                nextIndex = 0;
            }
        }

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
            } catch {}
        };
        window.addEventListener('likedSongsUpdated', handler);
        return () => window.removeEventListener('likedSongsUpdated', handler);
    }, [currentSong]);

    // Update liked status when song changes
    useEffect(() => {
        let cancelled = false;
        const checkLikedStatus = async () => {
            if (currentSong) {
                console.log('[Player] Song changed, checking liked status for:', currentSong.id, currentSong.title);
                try {
                    const liked = await isSongLiked(currentSong.id);
                    console.log(`[Player] Song "${currentSong.title}" (${currentSong.id}) liked status:`, liked);
                    if (!cancelled) setIsLiked(liked);
                } catch (error) {
                    console.error('[Player] Failed to check liked status:', error);
                    if (!cancelled) setIsLiked(false);
                }
            } else {
                console.log('[Player] No current song, setting liked to false');
                setIsLiked(false);
            }
        };

        checkLikedStatus();
        return () => { cancelled = true; };
    }, [currentSong, currentSong?.id, cacheInitialized]);

    const setBitrate = useCallback((newBitrate: number | null) => {
        setBitrateState(newBitrate);
    }, []);

    const setPlaybackSpeed = useCallback(async (speed: number) => {
        setPlaybackSpeedState(speed);
        playbackSpeedRef.current = speed;
        if (audioRef.current) audioRef.current.playbackRate = speed;
        try {
            const { username } = getFromStorage();
            if (username) {
                const allSettings = await readSettings();
                if (!allSettings[username]) allSettings[username] = { theme: 'cyan-wave', customThemes: {} };
                allSettings[username].playbackSpeed = speed;
                await writeSettings(allSettings);
            }
        } catch {}
    }, []);

    const setSleepTimer = useCallback((minutes: number | null) => {
        if (minutes === null) {
            setSleepTimerEnd(null);
        } else {
            setSleepTimerEnd(Date.now() + minutes * 60 * 1000);
        }
    }, []);

    // ── OS Media Session (MPRIS / macOS MediaRemote / Windows SMTC) ──────────

    // 1. Register action handlers once — all use stable refs, no deps needed
    useEffect(() => {
        if (!('mediaSession' in navigator)) return;

        const safe = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
            try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) {}
        };

        safe('play',     () => audioRef.current?.play().catch(() => {}));
        safe('pause',    () => audioRef.current?.pause());
        safe('nexttrack',() => playNextWithRefsRef.current());
        safe('previoustrack', () => playPreviousWithRefsRef.current());
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
                .forEach(a => { try { navigator.mediaSession.setActionHandler(a, null); } catch (_) {} });
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

                        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
                        const bytes = new Uint8Array(totalLen);
                        let pos = 0;
                        for (const c of chunks) { bytes.set(c, pos); pos += c.length; }

                        // Chunked String.fromCharCode avoids stack overflow on large images
                        let binary = '';
                        const step = 8192;
                        for (let i = 0; i < bytes.length; i += step) {
                            binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + step, bytes.length)));
                        }

                        const mime = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
                        const dataUrl = `data:${mime};base64,${btoa(binary)}`;

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
                            artSrc = await new Promise<string | null>((resolve) => {
                                const reader = new FileReader();
                                reader.onload  = () => resolve(reader.result as string);
                                reader.onerror = () => resolve(null);
                                reader.readAsDataURL(idbEntry.blob);
                            });
                        }
                    } catch { /* fall through to Subsonic fetch */ }
                }

                // ── Level 3 (Electron) / web fallback: fetch → data URL ──
                if (!artSrc && !offlineCacheService.getConfig().enabled) {
                    const { username, password, serverUrl } = getFromStorage();
                    if (username && password && serverUrl) {
                        const remoteUrl = getCoverArtUrl(serverUrl, username, password, currentSong.coverArt!, 512);
                        const response = await fetch(remoteUrl, { signal: controller.signal });
                        const blob = await response.blob();
                        artSrc = await new Promise<string | null>((resolve) => {
                            const reader = new FileReader();
                            reader.onload  = () => resolve(reader.result as string);
                            reader.onerror = () => resolve(null);
                            reader.readAsDataURL(blob);
                        });
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
        } catch (_) {}
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
                            artworkUrl = await new Promise<string | null>((resolve) => {
                                const reader = new FileReader();
                                reader.onload  = () => resolve(reader.result as string);
                                reader.onerror = () => resolve(null);
                                reader.readAsDataURL(idbEntry.blob);
                            });
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
                case 'next':     playNextWithRefsRef.current(); break;
                case 'previous':       playPreviousWithRefsRef.current(); break;
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

    const addToQueue = useCallback((song: Song) => {
        const next = [...playlistRef.current, song];
        playlistRef.current = next;
        setPlaylist(next);
    }, []);

    const insertNext = useCallback((song: Song) => {
        const list = [...playlistRef.current];
        const insertAt = currentIndexRef.current + 1;
        list.splice(insertAt, 0, song);
        playlistRef.current = list;
        setPlaylist(list);
    }, []);

    const removeFromQueue = useCallback((index: number) => {
        const next = [...playlistRef.current];
        next.splice(index, 1);
        playlistRef.current = next;
        setPlaylist(next);
        const currentIdx = currentIndexRef.current;
        if (index < currentIdx) {
            const newIdx = currentIdx - 1;
            currentIndexRef.current = newIdx;
            setCurrentIndex(newIdx);
        }
    }, []);

    const moveInQueue = useCallback((from: number, to: number) => {
        if (from === to) return;
        const next = [...playlistRef.current];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        playlistRef.current = next;
        setPlaylist(next);
        const currentIdx = currentIndexRef.current;
        let newIdx = currentIdx;
        if (currentIdx === from) {
            newIdx = to;
        } else if (from < to) {
            if (currentIdx > from && currentIdx <= to) newIdx = currentIdx - 1;
        } else {
            if (currentIdx >= to && currentIdx < from) newIdx = currentIdx + 1;
        }
        if (newIdx !== currentIdx) {
            currentIndexRef.current = newIdx;
            setCurrentIndex(newIdx);
        }
    }, []);

    const clearQueue = useCallback(() => {
        const currentIdx = currentIndexRef.current;
        const current = playlistRef.current[currentIdx];
        if (current) {
            playlistRef.current = [current];
            currentIndexRef.current = 0;
            setPlaylist([current]);
            setCurrentIndex(0);
        } else {
            playlistRef.current = [];
            currentIndexRef.current = 0;
            setPlaylist([]);
            setCurrentIndex(0);
        }
    }, []);

    // ── Neighbor songs (carousel peek + audio/art preload) ──────────────────
    const nextSong = useMemo<Song | null>(() => {
        if (playlist.length === 0) return null;
        if (shuffle) {
            // Peek at the next position in the shuffle queue without advancing it
            const nextIdx = shuffleQueueRef.current[shuffleQueueIndexRef.current];
            return nextIdx !== undefined ? (playlist[nextIdx] ?? null) : null;
        }
        const i = currentIndex + 1;
        if (i >= playlist.length) return repeat === 'all' ? playlist[0] : null;
        return playlist[i];
    }, [playlist, currentIndex, shuffle, repeat]); // eslint-disable-line react-hooks/exhaustive-deps

    const prevSong = useMemo<Song | null>(() => {
        // History always wins — shows literally the last-played song in all modes
        if (historyTip) return historyTip;
        // Sequential fallback when no history yet
        if (shuffle || playlist.length === 0) return null;
        const i = currentIndex - 1;
        if (i < 0) return repeat === 'all' ? playlist[playlist.length - 1] : null;
        return playlist[i];
    }, [historyTip, playlist, currentIndex, shuffle, repeat]);

    // Preload next song's audio so browser HTTP cache has it buffered before it plays
    useEffect(() => {
        const audio = preloadRef.current;
        if (!audio) return;
        if (!nextSong) { audio.src = ''; return; }

        const songId  = nextSong.id;
        const songUrl = nextSong.url;
        let cancelled = false;

        (async () => {
            let url = songUrl;
            if (offlineCacheService.isCached(songId)) {
                const p = await offlineCacheService.getCachedFilePath(songId);
                if (p) url = /^https?:\/\/|^capacitor:\/\//.test(p)
                    ? p
                    : `file:///${p.replace(/\\/g, '/')}`;
            } else if (offlineCacheService.getConfig().enabled) {
                const el = preloadRef.current;
                if (el) { el.src = ''; }
                return;
            }
            if (!cancelled) {
                const current = preloadRef.current;
                if (current && current.src !== url) { current.src = url; current.load(); }
            }
        })();

        return () => { cancelled = true; };
    }, [nextSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Safety-net: if next song wasn't known when the current track started (e.g.
    // shuffle pick or queue insertion), trigger preload 15 s before the end.
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !nextSong) return;
        const id  = nextSong.id;
        const url = nextSong.url;
        const handler = () => {
            if (!audio.duration || audio.duration === Infinity) return;
            const remaining = audio.duration - audio.currentTime;
            if (remaining < 15 && remaining > 0) {
                const preload = preloadRef.current;
                if (preload && !preload.src) {
                    (async () => {
                        let src = url;
                        if (offlineCacheService.isCached(id)) {
                            const p = await offlineCacheService.getCachedFilePath(id);
                            if (p) src = /^https?:\/\/|^capacitor:\/\//.test(p) ? p : `file:///${p.replace(/\\/g, '/')}`;
                        } else if (offlineCacheService.getConfig().enabled) {
                            return;
                        }
                        const el = preloadRef.current;
                        if (el && !el.src) { el.src = src; el.load(); }
                    })();
                }
            }
        };
        audio.addEventListener('timeupdate', handler);
        return () => audio.removeEventListener('timeupdate', handler);
    }, [nextSong]); // eslint-disable-line react-hooks/exhaustive-deps

    // Prefetch cover art for neighbors + lookahead window (up to 5 songs ahead)
    useEffect(() => {
        if (offlineModeEnabledRef.current) return;
        const { username, password, serverUrl } = getFromStorage();
        if (!username || !password || !serverUrl) return;

        const toPreload: (Song | null)[] = [nextSong, prevSong];

        // Add upcoming songs from the sequential queue (depth: normal=4, perf=2, eco=0)
        const maxAhead = isPowerSaverEnabled() ? 0 : isPerformanceModeEnabled() ? 2 : 4;
        if (!shuffle && playlist.length > 0) {
            for (let offset = 2; offset <= maxAhead; offset++) {
                const i = currentIndex + offset;
                if (i < playlist.length) toPreload.push(playlist[i]);
            }
        }

        for (const song of toPreload) {
            if (song?.coverArt) {
                imageCacheService.getImage(
                    song.coverArt,
                    () => getCoverArtUrl(serverUrl, username, password, song.coverArt!, 512)
                );
            }
        }
    }, [nextSong?.id, prevSong?.id, currentIndex, shuffle]); // eslint-disable-line react-hooks/exhaustive-deps

    // Preload next song's artwork into the native notification layer so it appears instantly
    useEffect(() => {
        if (!bridge.isCapacitor || !nextSong?.coverArt) return;
        if (isPowerSaverEnabled()) return;
        const { username, password, serverUrl } = getFromStorage();
        let cancelled = false;
        (async () => {
            let artworkUrl: string | null = null;
            if (offlineCacheService.isCoverArtCached(nextSong.coverArt!)) {
                const rel = offlineCacheService.getCachedCoverArtPath(nextSong.coverArt!);
                if (rel) artworkUrl = await getBridge().readCachedImage(rel);
            }
            if (!artworkUrl && username && password && serverUrl && !offlineCacheService.getConfig().enabled) {
                artworkUrl = getCoverArtUrl(serverUrl, username, password, nextSong.coverArt!, 512);
            }
            if (!cancelled && artworkUrl) bridge.preloadNextArtwork(artworkUrl);
        })();
        return () => { cancelled = true; };
    }, [nextSong?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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