import React, { useState } from 'react';
import { downloadManager } from '../../services/downloadManager';
import { getFromStorage } from '../../utils/storage';

interface Song {
    id: string;
    title: string;
    artist: string;
    album: string;
    duration?: number;
    coverArt?: string;
}

interface DownloadButtonProps {
    song: Song;
}

const DownloadButton: React.FC<DownloadButtonProps> = ({ song }) => {
    const [downloading, setDownloading] = useState(false);
    const [progress, setProgress] = useState(0);

    const handleDownload = async () => {
        setDownloading(true);
        
        try {
            const { username, password, serverUrl } = getFromStorage();
            
            await downloadManager.downloadSong(
                username,
                password,
                serverUrl,
                song.id,
                song.title,
                song.artist,
                song.album,
                {
                    bitrate: 320, // Default quality
                    onProgress: (prog: number) => setProgress(prog),
                }
            );
            console.log('Download completed:', song.title);
        } catch (error) {
            console.error('Download failed:', error);
        } finally {
            setDownloading(false);
            setProgress(0);
        }
    };

    return (
        <button 
            className="download-button"
            onClick={handleDownload}
            disabled={downloading}
            title="Download song"
        >
            {downloading ? (
                <span>{Math.round(progress)}%</span>
            ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                    <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                </svg>
            )}
        </button>
    );
};

export default DownloadButton;