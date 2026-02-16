import React from 'react';
import { usePlayer } from '../../context/PlayerContext';
import { localStorageService } from '../../services/localStorageService';
import { getFromStorage } from '../../utils/storage';
import { getStreamUrl } from '../../services/subsonicApi';
import { offlineCacheService } from '../../services/offlineCacheService';
import DownloadButton from './DownloadButton';

interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    duration?: number;
    coverArt?: string;
}

interface SongItemProps {
    song: Song;
    allSongs?: Song[];
}

const SongItem: React.FC<SongItemProps> = ({ song, allSongs = [] }) => {
    const { playSong, playPlaylist, currentSong, isPlaying, bitrate } = usePlayer();
    const isCurrentTrack = currentSong?.id === song.id;
    const isCurrentlyPlaying = isCurrentTrack && isPlaying;
    
    // Check if downloaded (use 0 as fallback for null bitrate)
    const effectiveBitrate = bitrate || 0;
    const isDownloaded = localStorageService.isSongDownloaded(song.id, effectiveBitrate);
    const isCached = offlineCacheService.isCached(song.id);
    const isCoverArtCached = song.coverArt ? offlineCacheService.isCoverArtCached(song.coverArt) : false;

    const getUrl = (songId: string, currentBitrate: number | null): string => {
        // Check if song is downloaded at current quality
        const downloadedSong = localStorageService.getDownloadedSong(songId, currentBitrate || 0);
        if (downloadedSong) {
            console.log('[PLAYBACK] Playing from local storage:', downloadedSong.localPath);
            return downloadedSong.localPath;
        }
        
        // Fall back to streaming
        const { username, password, serverUrl } = getFromStorage();
        console.log(`[PLAYBACK] Streaming song ${songId} at quality:`, currentBitrate === null ? 'Original' : `${currentBitrate} kbps`);
        return getStreamUrl(username, password, serverUrl, songId, currentBitrate || undefined);
    };

    const handlePlayPause = (e: React.MouseEvent) => {
        e.stopPropagation();
        
        if (isCurrentTrack) {
            // Toggle play/pause for current track - handled by PlaybackControls
            return;
        }

        // Play this song
        const url = getUrl(song.id, bitrate);
        
        const songWithUrl = {
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            url: url,
            duration: song.duration,
            coverArt: song.coverArt,
        };

        if (allSongs.length > 0) {
            // If we have a list of songs, set up a playlist
            const currentIndex = allSongs.findIndex(s => s.id === song.id);
            const songsWithUrls = allSongs.map(s => ({
                id: s.id,
                title: s.title,
                artist: s.artist,
                album: s.album,
                url: getUrl(s.id, bitrate),
                duration: s.duration,
                coverArt: s.coverArt,
            }));
            
            playPlaylist(songsWithUrls, currentIndex >= 0 ? currentIndex : 0);
        } else {
            // Just play this single song
            playSong(songWithUrl);
        }
    };

    const formatDuration = (seconds?: number) => {
        if (!seconds) return '';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className={`song-item ${isCurrentTrack ? 'active' : ''}`}>
            <button 
                className="play-button"
                onClick={handlePlayPause}
            >
                {isCurrentlyPlaying ? (
                    <><i className="fas fa-pause"></i> Pause</>
                ) : (
                    <><i className="fas fa-play"></i> Play</>
                )}
            </button>
            
            <div className="song-info">
                <div className="song-title">{song.title}</div>
                <div className="song-artist">{song.artist}</div>
            </div>
            
            <div className="song-meta">
                {song.album && <span className="song-album">{song.album}</span>}
                {song.duration && <span className="song-duration">{formatDuration(song.duration)}</span>}
                {isDownloaded && <span className="downloaded-badge"><i className="fas fa-download"></i> Downloaded</span>}
                {isCached && (
                    <span className="cached-badge" title="Song cached">
                        <i className="fas fa-circle-check"></i>
                    </span>
                )}
                {isCoverArtCached && (
                    <span className="cached-art-badge" title="Album art cached">
                        <i className="fas fa-image"></i>
                    </span>
                )}
            </div>

            <DownloadButton song={song} />
        </div>
    );
};

export default SongItem;