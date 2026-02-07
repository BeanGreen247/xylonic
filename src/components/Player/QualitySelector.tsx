import React from 'react';

export interface QualitySelectorProps {
    value: number | null;
    onChange: (bitrate: number | null) => void;
}

const QualitySelector: React.FC<QualitySelectorProps> = ({ value, onChange }) => {
    return (
        <div className="quality-selector">
            <label>Quality:</label>
            <select 
                value={value || 'original'} 
                onChange={(e) => {
                    const val = e.target.value;
                    onChange(val === 'original' ? null : parseInt(val));
                }}
            >
                <option value="original">Original</option>
                <option value="320">320 kbps</option>
                <option value="256">256 kbps</option>
                <option value="192">192 kbps</option>
                <option value="128">128 kbps</option>
            </select>
        </div>
    );
};

export default QualitySelector;