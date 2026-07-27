import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { usePlayer } from '../../context/PlayerContext';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { logger } from '../../utils/logger';
import { saveStreamingQuality } from '../../utils/settingsManager';
import { offlineCacheService } from '../../services/offlineCacheService';

interface StreamingQualitySelectorProps {
    onQualityChange?: (bitrate: number | null) => void;
}

interface QualityOption {
    value: number | null;
    label: string;
    kbpsLabel: string;
    desc: string;
    bars: number;
}

const QUALITY_OPTIONS: QualityOption[] = [
    { value: null, label: 'Original', kbpsLabel: 'Original', desc: 'No transcoding · Best quality',   bars: 6 },
    { value: 320,  label: '320 kbps', kbpsLabel: '320',      desc: 'Excellent · Recommended',          bars: 6 },
    { value: 256,  label: '256 kbps', kbpsLabel: '256',      desc: 'High quality · Good balance',      bars: 5 },
    { value: 192,  label: '192 kbps', kbpsLabel: '192',      desc: 'Good quality',                     bars: 4 },
    { value: 128,  label: '128 kbps', kbpsLabel: '128',      desc: 'Moderate · Data saving',           bars: 3 },
    { value: 64,   label: '64 kbps',  kbpsLabel: '64',       desc: 'Low · Minimum data',               bars: 2 },
];

const StreamingQualitySelector: React.FC<StreamingQualitySelectorProps> = ({ onQualityChange }) => {
    const { bitrate, setBitrate, currentSong } = usePlayer();
    const { cacheInitialized, offlineModeEnabled } = useOfflineMode();
    const [isStreaming, setIsStreaming] = useState(true);
    const [cachedQualityLabel, setCachedQualityLabel] = useState<string | null>(null);
    const [open, setOpen] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!currentSong) return;
        const cached = offlineCacheService.isCached(currentSong.id);
        setIsStreaming(!cached);
        if (cached) {
            const q = offlineCacheService.getCachedSong(currentSong.id)?.quality;
            setCachedQualityLabel(q === 'original' ? 'OG' : (q ?? null));
        } else {
            setCachedQualityLabel(null);
        }
    }, [currentSong, cacheInitialized]);

    // Close on Escape
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const getQualityBars = (b: number | null) => {
        if (b === null) return 6;
        if (b >= 320) return 6;
        if (b >= 256) return 5;
        if (b >= 192) return 4;
        if (b >= 128) return 3;
        return 2;
    };

    const handleSelect = (option: QualityOption) => {
        logger.log('Streaming quality changed to:', option.label);
        setBitrate(option.value);
        onQualityChange?.(option.value);
        setOpen(false);
        saveStreamingQuality(option.value);
    };

    const currentOption = QUALITY_OPTIONS.find(o => o.value === bitrate) ?? QUALITY_OPTIONS[0];
    const bars = cachedQualityLabel && cachedQualityLabel !== 'OG'
        ? getQualityBars(Number(cachedQualityLabel))
        : cachedQualityLabel === 'OG'
            ? 6
            : getQualityBars(bitrate);

    return (
        <>
            {/* ── Trigger button ─────────────────────── */}
            <button
                className="streaming-quality-selector"
                onClick={() => { if (!offlineModeEnabled) setOpen(true); }}
                disabled={offlineModeEnabled}
                title={offlineModeEnabled ? 'Playing from cache' : 'Streaming quality'}
                aria-haspopup="listbox"
                aria-expanded={open}
                style={offlineModeEnabled ? { opacity: 0.45, cursor: 'default' } : undefined}
            >
                <div className="quality-bars">
                    {[1, 2, 3, 4, 5, 6].map(b => (
                        <div key={b} className={`quality-bar ${b <= bars ? 'active' : ''}`}
                             style={{ height: `${b * 3 + 2}px` }} />
                    ))}
                </div>
                <div className="source-indicator">
                    <i className={`fas fa-${isStreaming ? 'cloud' : 'hdd'}`}
                       style={{ color: 'var(--primary-color)' }}
                       title={isStreaming ? 'Streaming' : 'Cached'} />
                </div>
                <span className="quality-current-label">{cachedQualityLabel ?? currentOption.kbpsLabel}</span>
            </button>

            {/* ── Quality picker modal (Portal → escapes backdrop-filter/transform stacking) */}
            {open && ReactDOM.createPortal(
                <>
                    {/* Backdrop */}
                    <div className="quality-picker-backdrop" onClick={() => setOpen(false)} />

                    {/* Sheet / card */}
                    <div className="quality-picker-modal" ref={modalRef} role="listbox" aria-label="Select streaming quality">
                        <div className="quality-picker-header">
                            <span className="quality-picker-title">
                                <i className="fas fa-signal" />
                                Streaming Quality
                            </span>
                            <button className="quality-picker-close" onClick={() => setOpen(false)} aria-label="Close">
                                <i className="fas fa-times" />
                            </button>
                        </div>

                        <p className="quality-picker-hint">
                            Changes apply to the next track loaded.
                        </p>

                        <div className="quality-picker-list">
                            {QUALITY_OPTIONS.map(option => {
                                const active = option.value === bitrate;
                                return (
                                    <button
                                        key={option.label}
                                        className={`quality-picker-item${active ? ' active' : ''}`}
                                        role="option"
                                        aria-selected={active}
                                        onClick={() => handleSelect(option)}
                                    >
                                        <div className="quality-picker-bars">
                                            {[1, 2, 3, 4, 5, 6].map(b => (
                                                <div
                                                    key={b}
                                                    className={`quality-picker-bar${b <= option.bars ? ' active' : ''}`}
                                                    style={{ height: `${b * 4 + 2}px` }}
                                                />
                                            ))}
                                        </div>

                                        <div className="quality-picker-info">
                                            <span className="quality-picker-name">{option.label}</span>
                                            <span className="quality-picker-desc">{option.desc}</span>
                                        </div>

                                        {active && <i className="fas fa-check quality-picker-check" />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </>,
                document.body
            )}
        </>
    );
};

export default StreamingQualitySelector;
