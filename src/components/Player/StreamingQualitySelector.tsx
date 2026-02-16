import React, { useState, useEffect } from 'react';
import { usePlayer } from '../../context/PlayerContext';
import { logger } from '../../utils/logger';
import { readSettings, writeSettings } from '../../utils/settingsManager';
import { getFromStorage } from '../../utils/storage';
import { offlineCacheService } from '../../services/offlineCacheService';

interface StreamingQualitySelectorProps {
    onQualityChange?: (bitrate: number | null) => void;
}

const StreamingQualitySelector: React.FC<StreamingQualitySelectorProps> = ({ onQualityChange }) => {
    const { bitrate, setBitrate, currentSong } = usePlayer();
    const [isStreaming, setIsStreaming] = useState(true);

    // Check if current song is from cache or streaming
    useEffect(() => {
        if (currentSong) {
            const isCached = offlineCacheService.isCached(currentSong.id);
            setIsStreaming(!isCached);
        }
    }, [currentSong]);

    const getQualityBars = (bitrate: number | null) => {
        if (bitrate === null) return 6; // Original = max bars
        if (bitrate >= 320) return 6;
        if (bitrate >= 256) return 5;
        if (bitrate >= 192) return 4;
        if (bitrate >= 128) return 3;
        if (bitrate >= 64) return 2;
        return 1;
    };

    const handleQualityChange = async (newBitrate: number | null) => {
        console.log('[STREAMING QUALITY] Changed to:', newBitrate === null ? 'Original (no transcoding)' : `${newBitrate} kbps`);
        logger.log('Streaming quality changed to:', newBitrate);
        setBitrate(newBitrate);
        
        // Notify parent component about quality change
        if (onQualityChange) {
            onQualityChange(newBitrate);
        }

        // Persist the streaming quality preference
        try {
            const { username } = getFromStorage();
            if (username) {
                const settings = await readSettings();
                if (!settings[username]) {
                    settings[username] = { theme: 'cyan-wave', customThemes: {} };
                }
                settings[username].streamingQuality = newBitrate;
                await writeSettings(settings);
                console.log('[STREAMING QUALITY] Saved to settings for user:', username);
                logger.log('Streaming quality saved to settings');
            }
        } catch (error) {
            logger.error('Failed to save streaming quality:', error);
        }
    };

    const bars = getQualityBars(bitrate);

    return (
        <div className="streaming-quality-selector">
            <div className="quality-bars">
                {[1, 2, 3, 4, 5, 6].map((bar) => (
                    <div 
                        key={bar} 
                        className={`quality-bar ${bar <= bars ? 'active' : ''}`}
                        style={{ height: `${bar * 3 + 2}px` }}
                    />
                ))}
            </div>
            <div className="source-indicator">
                <i className={`fas fa-${isStreaming ? 'cloud' : 'hdd'}`} 
                   title={isStreaming ? 'Streaming from server' : 'Playing from cache'}
                   style={{ color: 'var(--primary-color)' }}
                />
            </div>
            <select 
                id="streaming-quality"
                value={bitrate === null ? 'original' : bitrate.toString()} 
                onChange={(e) => {
                    const val = e.target.value;
                    handleQualityChange(val === 'original' ? null : parseInt(val));
                }}
                title="Streaming quality"
            >
                <option value="original">Original</option>
                <option value="320">320</option>
                <option value="256">256</option>
                <option value="192">192</option>
                <option value="128">128</option>
                <option value="64">64</option>
            </select>
        </div>
    );
};

export default StreamingQualitySelector;
