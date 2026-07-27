import React from 'react';
import DownloadQualityPicker from '../Library/DownloadQualityPicker';
import { DownloadQuality } from '../../types/offline';

export interface QualitySelectorProps {
    value: DownloadQuality;
    onChange: (quality: DownloadQuality) => void;
    onConfirm?: () => void;
    confirmLabel?: string;
}

const QualitySelector: React.FC<QualitySelectorProps> = ({ value, onChange, onConfirm, confirmLabel }) => (
    <DownloadQualityPicker
        value={value}
        onChange={onChange}
        onConfirm={onConfirm}
        confirmLabel={confirmLabel}
    />
);

export default QualitySelector;
