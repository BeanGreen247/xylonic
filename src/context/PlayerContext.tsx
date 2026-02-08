import React, { createContext, useContext, useState, useRef, useEffect, ReactNode, useCallback } from 'react';
import { logger } from '../utils/logger';

interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    url: string;
    duration?: number;
    coverArt?: string;
}

interface PlayerContextType {
    currentSong: Song | null;
    playlist: Song[];
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    shuffle: boolean;
    repeat: 'off' | 'all' | 'one';
    bitrate: number | null;
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
    
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const playlistRef = useRef<Song[]>([]);
    const currentIndexRef = useRef(0);
    const repeatRef = useRef<'off' | 'all' | 'one'>('off');
    const shuffleRef = useRef(false);

    // Keep refs in sync with state
    useEffect(() => {
        playlistRef.current = playlist;
        currentIndexRef.current = currentIndex;
        repeatRef.current = repeat;
        shuffleRef.current = shuffle;
    }, [playlist, currentIndex, repeat, shuffle]);

    const playSong = useCallback((song: Song) => {
        if (!audioRef.current) return;

        logger.log('Playing song:', song.title);
        setCurrentSong(song);
        audioRef.current.src = song.url;
        audioRef.current.play().catch(err => logger.error('Play error:', err));
    }, []);

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

    // Initialize audio element
    useEffect(() => {
        const audio = new Audio();
        audio.volume = volume;
        audioRef.current = audio;

        const handleTimeUpdate = () => {
            setCurrentTime(audio.currentTime);
        };

        const handleDurationChange = () => {
            setDuration(audio.duration);
        };

        const handleEnded = () => {
            logger.log('Song ended, calling playNext');
            playNextWithRefs();
        };

        const handlePlay = () => {
            setIsPlaying(true);
        };

        const handlePause = () => {
            setIsPlaying(false);
        };

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
        };
    }, [volume, playNextWithRefs]);

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
        const clampedVolume = Math.max(0, Math.min(1, newVolume));
        setVolumeState(clampedVolume);
        if (audioRef.current) {
            audioRef.current.volume = clampedVolume;
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

    const setBitrate = (newBitrate: number | null) => {
        setBitrateState(newBitrate);
    };

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
    };

    return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};