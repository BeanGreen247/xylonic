import React from 'react';

export interface QualitySelectorProps {
    value: number | null;
    onChange: (bitrate: number | null) => void;
}

const QualitySelector: React.FC<QualitySelectorProps> = ({ value, onChange }) => {
    const handleChange = (newValue: number | null) => {
        console.log('[DOWNLOAD QUALITY] Selected:', newValue === null ? 'Original (no transcoding)' : `${newValue} kbps`);
        onChange(newValue);
    };

    return (
        <div className="quality-selector">
            <div className="quality-selector-header">
                <i className="fas fa-download" title="Download Quality"></i>
                <span className="quality-type-label">Downloads</span>
            </div>
            <select 
                value={value || 'original'} 
                onChange={(e) => {
                    const val = e.target.value;
                    handleChange(val === 'original' ? null : parseInt(val));
                }}
                title="Select quality for downloads"
            >
                <option value="original">Original</option>
                <option value="320">320 kbps</option>
                <option value="256">256 kbps</option>
                <option value="192">192 kbps</option>
                <option value="128">128 kbps</option>
                <option value="64">64 kbps</option>
            </select>
        </div>
    );
};

export default QualitySelector;