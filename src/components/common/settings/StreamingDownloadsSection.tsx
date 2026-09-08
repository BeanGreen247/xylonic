import React, { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { usePlayer } from '../../../context/PlayerContext';
import { DownloadQuality } from '../../../types/offline';
import {
  getDefaultDownloadQuality,
  saveDefaultDownloadQuality,
  saveStreamingQuality,
  getMaxConcurrentDownloads,
  saveMaxConcurrentDownloads,
  MAX_CONCURRENT_DOWNLOADS_LIMIT,
} from '../../../utils/settingsManager';
import { downloadManager } from '../../../services/downloadManagerService';

/**
 * "Streaming" + "Downloads" settings sections — streaming bitrate, default
 * download quality, and concurrent-download count. Self-contained: owns its own
 * quality/concurrency state and reads the streaming bitrate from PlayerContext.
 */
const StreamingDownloadsSection: React.FC = () => {
  const { bitrate, setBitrate } = usePlayer();
  const [defaultDlQuality, setDefaultDlQuality] = useState<DownloadQuality>(getDefaultDownloadQuality);
  const [maxConcurrentDownloads, setMaxConcurrentDownloads] = useState<number>(getMaxConcurrentDownloads);

  const handleQualityChange = (q: DownloadQuality) => {
    setDefaultDlQuality(q);
    saveDefaultDownloadQuality(q);
  };

  const handleMaxConcurrentChange = (count: number) => {
    setMaxConcurrentDownloads(count);
    saveMaxConcurrentDownloads(count);
    downloadManager.syncMaxConcurrentDownloads();
  };

  const handleStreamingQualityChange = (raw: string) => {
    const value = raw === '' ? null : Number(raw);
    setBitrate(value);
    saveStreamingQuality(value);
  };

  return (
    <>
      {/* ── Streaming ─────────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Streaming</h3>
        <div className="settings-card">
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-signal" /></span>
            <span className="settings-row-label">Streaming Quality
              <span className="settings-row-sub">Applies to the next track loaded</span>
            </span>
            <span className="settings-row-action">
              <select
                className="settings-select"
                value={bitrate === null ? '' : String(bitrate)}
                onChange={e => handleStreamingQualityChange(e.target.value)}
              >
                <option value="">Original</option>
                <option value="320">320 kbps</option>
                <option value="256">256 kbps</option>
                <option value="192">192 kbps</option>
                <option value="128">128 kbps</option>
                <option value="64">64 kbps</option>
              </select>
            </span>
          </div>
        </div>
      </section>

      {/* ── Downloads ─────────────────────────────────────── */}
      <section className="settings-section">
        <h3 className="settings-section-title">Downloads</h3>
        <div className="settings-card">
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-sliders-h" /></span>
            <span className="settings-row-label">Download Quality</span>
            <span className="settings-row-action">
              <select
                className="settings-select"
                value={defaultDlQuality}
                onChange={e => handleQualityChange(e.target.value as DownloadQuality)}
              >
                <option value="original">Original</option>
                <option value="320">320 kbps</option>
                <option value="256">256 kbps</option>
                <option value="128">128 kbps</option>
                <option value="64">64 kbps</option>
              </select>
            </span>
          </div>
          <div className="settings-divider" />
          <div className="settings-row non-interactive">
            <span className="settings-row-icon"><i className="fas fa-layer-group" /></span>
            <span className="settings-row-label">Concurrent Downloads
              <span className="settings-row-sub">
                {maxConcurrentDownloads === 1 ? 'One song at a time' : `Up to ${maxConcurrentDownloads} songs at once`}
                {Capacitor.getPlatform() === 'ios' ? ' — iOS applies this from next app launch' : ''}
              </span>
            </span>
            <span className="settings-row-action">
              <select
                className="settings-select"
                value={maxConcurrentDownloads}
                onChange={e => handleMaxConcurrentChange(Number(e.target.value))}
              >
                {Array.from({ length: MAX_CONCURRENT_DOWNLOADS_LIMIT }, (_, i) => i + 1).map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </span>
          </div>
        </div>
      </section>
    </>
  );
};

export default StreamingDownloadsSection;
