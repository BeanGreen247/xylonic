import React, { createContext, useContext, useState, useRef, useEffect, ReactNode, useCallback } from 'react';
import { logger } from '../utils/logger';
import { isSongLiked, toggleLike as toggleLikeSong } from '../services/likedSongsService';
import { offlineCacheService } from '../services/offlineCacheService';
import { useOfflineMode } from './OfflineModeContext';
import { getUserSettings } from '../utils/settingsManager';
import { getFromStorage } from '../utils/storage';

const electron = (window as any).electron;

interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    url: string;
    duration?: number;
    coverArt?: string;
}

export interface PlayerContextType {
    currentSong: Song | null;
    playlist: Song[];
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    shuffle: boolean;
    repeat: 'off' | 'all' | 'one';
    bitrate: number | null;
    muted: boolean;
    isLiked: boolean;
    playSong: (song: Song) => void;
    playPlaylist: (songs: Song[], startIndex?: number) => void;
    togglePlayPause: () => void;
    playNext: () => void;
    playPrevious: () => void;
    seek: (time: number) => void;
    setVolume: (volume: number) => void;
    toggleShuffle: () => void;
    toggleRepeat: () => void;
    setBitrate: (bitrate: number | null) => void;
    toggleMute: () => void;
    setTrackListAndPlay: (songs: Song[], startIndex?: number) => void;
    toggleLike: () => void;
    clearPlayback: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

export const usePlayer = () => {
    const context = useContext(PlayerContext);
    if (!context) {
        throw new Error('usePlayer must be used within PlayerProvider');
    }
    return context;
};

interface PlayerProviderProps {
    children: ReactNode;
}

export const PlayerProvider: React.FC<PlayerProviderProps> = ({ children }) => {
    const [currentSong, setCurrentSong] = useState<Song | null>(null);
    const [playlist, setPlaylist] = useState<Song[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolumeState] = useState(0.7);
    const [shuffle, setShuffle] = useState(false);
    const [repeat, setRepeat] = useState<'off' | 'all' | 'one'>('off');
    const [bitrate, setBitrateState] = useState<number | null>(null);
    const [muted, setMuted] = useState(false);
    const [prevVolume, setPrevVolume] = useState(0.7);
    const [isLiked, setIsLiked] = useState(false);
    const wasPlayingRef = useRef(false);

    // Load saved streaming quality on mount
    useEffect(() => {
        const loadStreamingQuality = async () => {
            try {
                const { username } = getFromStorage();
                if (username) {
                    const userSettings = await getUserSettings(username);
                    if (userSettings?.streamingQuality !== undefined) {
                        logger.log('Loading saved streaming quality:', userSettings.streamingQuality);
                        setBitrateState(userSettings.streamingQuality);
                    }
                }
            } catch (error) {
                logger.error('Failed to load streaming quality:', error);
            }
        };
        loadStreamingQuality();
    }, []);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const playlistRef = useRef<Song[]>([]);
    const currentIndexRef = useRef(0);
    const repeatRef = useRef<'off' | 'all' | 'one'>('off');
    const shuffleRef = useRef(false);

    // NEW: keep latest playNextWithRefs without depending on declaration order
    const playNextWithRefsRef = useRef<() => void>(() => {});

    const applyVolume = useCallback((vol: number) => {
        if (audioRef.current) audioRef.current.volume = vol;
    }, []);

    // Create audio element ONCE (do not depend on volume or playNextWithRefs)
    useEffect(() => {
        const audio = new Audio();
        audioRef.current = audio;

        const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
        const handleDurationChange = () => setDuration(audio.duration);

        const handleEnded = () => {
            logger.log('Song ended, calling playNext');
            playNextWithRefsRef.current();
        };

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('durationchange', handleDurationChange);
        audio.addEventListener('ended', handleEnded);
        audio.addEventListener('play', handlePlay);
        audio.addEventListener('pause', handlePause);

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('durationchange', handleDurationChange);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('play', handlePlay);
            audio.removeEventListener('pause', handlePause);
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
        };

        window.addEventListener('logout', handleLogout);
        return () => window.removeEventListener('logout', handleLogout);
    }, []);

    const playSong = useCallback(async (song: Song) => {
        const audio = audioRef.current;
        if (!audio) return;

        console.log('[PLAYER] Playing song:', song.title, 'by', song.artist);
        console.log('[PLAYER] Stream URL:', song.url);
        logger.log('Playing song:', song.title);
        setCurrentSong(song);

        // Check if song is cached (offline-first)
        let sourceUrl = song.url;
        const isCached = offlineCacheService.isCached(song.id);
        
        if (isCached) {
            try {
                const cachedPath = await offlineCacheService.getCachedFilePath(song.id);
                if (cachedPath) {
                    // Use file:// protocol for cached files
                    // Windows requires forward slashes and three slashes for absolute paths
                    const normalizedPath = cachedPath.replace(/\\/g, '/');
                    sourceUrl = `file:///${normalizedPath}`;
                    console.log('[PLAYER] Using cached song:', sourceUrl);
                    logger.log('Using cached song:', sourceUrl);
                } else {
                    logger.warn('Cache path not found for cached song, falling back to stream');
                }
            } catch (error) {
                logger.error('Failed to get cached song, falling back to stream:', error);
            }
        }

        audio.src = sourceUrl;
        audio.load(); // ensure reload when src changes

        // Ensure current mute/volume are applied before playing
        audio.muted = muted;
        audio.volume = muted ? 0 : volume;

        audio.play().catch(err => logger.error('Play error:', err));
    }, [muted, volume]);

    // Keep refs in sync with state
    useEffect(() => {
        playlistRef.current = playlist;
        currentIndexRef.current = currentIndex;
        repeatRef.current = repeat;
        shuffleRef.current = shuffle;
    }, [playlist, currentIndex, repeat, shuffle]);

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
            nextIndex = Math.floor(Math.random() * currentPlaylist.length);
            logger.log(`Shuffle: next index ${nextIndex}`);
        } else {
            nextIndex = currentIdx + 1;
            logger.log(`Sequential: next index ${nextIndex}`);
            
            if (nextIndex >= currentPlaylist.length) {
                if (currentRepeat === 'all') {
                    logger.log('Reached end, repeat all: going to index 0');
                    nextIndex = 0;
                } else {
                    logger.log('Reached end, no repeat: stopping');
                    return;
                }
            }
        }

        setCurrentIndex(nextIndex);
        playSong(currentPlaylist[nextIndex]);
    }, [playSong]);

    // NEW: update ref whenever callback changes
    useEffect(() => {
        playNextWithRefsRef.current = playNextWithRefs;
    }, [playNextWithRefs]);

    const playPlaylist = (songs: Song[], startIndex = 0) => {
        logger.log(`Playing playlist: ${songs.length} songs, starting at index ${startIndex}`);
        setPlaylist(songs);
        setCurrentIndex(startIndex);
        if (songs[startIndex]) {
            playSong(songs[startIndex]);
        }
    };

    const togglePlayPause = () => {
        if (!audioRef.current) return;

        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play().catch(err => logger.error('Play error:', err));
        }
    };

    const playNext = () => {
        playNextWithRefs();
    };

    const playPrevious = () => {
        if (playlist.length === 0) return;

        if (audioRef.current && audioRef.current.currentTime > 3) {
            audioRef.current.currentTime = 0;
            return;
        }

        let prevIndex = currentIndex - 1;
        if (prevIndex < 0) {
            if (repeat === 'all') {
                prevIndex = playlist.length - 1;
            } else {
                return;
            }
        }

        setCurrentIndex(prevIndex);
        playSong(playlist[prevIndex]);
    };

    const seek = (time: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const setVolume = (newVolume: number) => {
        const clamped = Math.max(0, Math.min(1, newVolume));
        setVolumeState(clamped);

        // Track last non-zero volume for unmute restore
        if (clamped > 0) {
            setPrevVolume(clamped);
            if (muted) setMuted(false);
        } else {
            // volume 0 behaves like muted for UI + audio consistency
            if (!muted) setMuted(true);
        }

        // apply immediately (state sync effect will also run)
        if (audioRef.current) {
            audioRef.current.volume = clamped;
        }
    };

    const toggleMute = () => {
        const audio = audioRef.current;
        if (!audio) return;

        if (!muted) {
            wasPlayingRef.current = !audio.paused;

            // remember last non-zero volume
            const remember = volume > 0 ? volume : prevVolume;
            setPrevVolume(remember > 0 ? remember : 0.7);

            setMuted(true);
            setVolumeState(0);

            audio.muted = true;
            audio.volume = 0;
            return; // do not pause
        }

        // Unmute: restore volume and resume if needed
        const restore = prevVolume > 0 ? prevVolume : 0.7;
        setMuted(false);
        setVolumeState(restore);

        audio.muted = false;
        audio.volume = restore;

        if (wasPlayingRef.current) {
            wasPlayingRef.current = false;
            audio.play().catch(err => logger.error('Play error:', err));
        }
    };

    const toggleShuffle = () => {
        setShuffle(prev => !prev);
    };

    const toggleRepeat = () => {
        setRepeat(prev => {
            if (prev === 'off') return 'all';
            if (prev === 'all') return 'one';
            return 'off';
        });
    };

    const toggleLike = async () => {
        if (currentSong) {
            console.log('[Player] Toggling like for song:', currentSong.id, currentSong.title);
            try {
                const newLikedState = await toggleLikeSong({
                    id: currentSong.id,
                    title: currentSong.title,
                    artist: currentSong.artist,
                    album: currentSong.album
                });
                console.log('[Player] New liked state:', newLikedState);
                setIsLiked(newLikedState);
            } catch (error) {
                console.error('[Player] Failed to toggle like:', error);
            }
        }
    };

    // Update liked status when song changes
    useEffect(() => {
        const checkLikedStatus = async () => {
            if (currentSong) {
                console.log('[Player] Song changed, checking liked status for:', currentSong.id, currentSong.title);
                try {
                    const liked = await isSongLiked(currentSong.id);
                    console.log(`[Player] Song "${currentSong.title}" (${currentSong.id}) liked status:`, liked);
                    setIsLiked(liked);
                } catch (error) {
                    console.error('[Player] Failed to check liked status:', error);
                    setIsLiked(false);
                }
            } else {
                console.log('[Player] No current song, setting liked to false');
                setIsLiked(false);
            }
        };
        
        checkLikedStatus();
    }, [currentSong, currentSong?.id]);

    const setBitrate = (newBitrate: number | null) => {
        setBitrateState(newBitrate);
    };

    // Broadcast player state to mini player window via IPC
    useEffect(() => {
        if (window.electron?.sendPlayerState) {
            const state = {
                currentSong,
                isPlaying,
                currentTime,
                duration,
                volume,
                shuffle,
                repeat,
                muted,
            };
            console.log('[PlayerContext] Sending state to electron:', state.currentSong?.title || 'no song');
            window.electron.sendPlayerState(state);
        }
    }, [currentSong, isPlaying, currentTime, duration, volume, shuffle, repeat, muted]);

    // Listen for control actions from mini player
    useEffect(() => {
        if (window.electron?.onPlayerControlAction) {
            const unsubscribe = window.electron.onPlayerControlAction((action: string) => {
                switch (action) {
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
                        const currentPlaylist = playlistRef.current;
                        const currentIdx = currentIndexRef.current;
                        const currentRepeat = repeatRef.current;
                        
                        if (currentPlaylist.length === 0) return;

                        if (audioRef.current && audioRef.current.currentTime > 3) {
                            audioRef.current.currentTime = 0;
                            return;
                        }

                        let prevIndex = currentIdx - 1;
                        if (prevIndex < 0) {
                            if (currentRepeat === 'all') {
                                prevIndex = currentPlaylist.length - 1;
                            } else {
                                return;
                            }
                        }

                        setCurrentIndex(prevIndex);
                        playSong(currentPlaylist[prevIndex]);
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
        logger.log('Playback cleared');
    }, []);

    const value: PlayerContextType = {
        currentSong,
        playlist,
        isPlaying,
        currentTime,
        duration,
        volume,
        shuffle,
        repeat,
        bitrate,
        muted,
        isLiked,
        playSong,
        playPlaylist,
        togglePlayPause,
        playNext,
        playPrevious,
        seek,
        setVolume,
        toggleShuffle,
        toggleRepeat,
        setBitrate,
        toggleMute,
        toggleLike,
        setTrackListAndPlay: (songs: Song[], startIndex?: number) => playPlaylist(songs, startIndex),
        clearPlayback,
    };

    return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};