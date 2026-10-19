import React, { useCallback, useEffect, useState } from 'react';
import {
  getStorageInfo, isCacheLocationSupported, moveCacheTo, openAppSettings,
  type StorageInfo, type StorageVolume,
} from '../../../services/cacheStorageService';
import './StorageLocationSection.css';

function fmtBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * "Storage" settings (Android): choose where the permanent cache (downloaded songs, cover
 * art, indexes) lives, moving what is already cached, and jump to Android's own settings
 * where the app itself can be moved to adoptable storage. Renders nothing elsewhere.
 */
const StorageLocationSection: React.FC = () => {
  const supported = isCacheLocationSupported();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [picking, setPicking] = useState(false);
  const [choice, setChoice] = useState<string>('');
  const [progress, setProgress] = useState<{ copied: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    getStorageInfo().then(setInfo).catch(() => setInfo(null));
  }, []);
  useEffect(() => { if (supported) refresh(); }, [supported, refresh]);

  if (!supported) return null;

  const current = info?.volumes.find(v => v.selected);
  const chosen: StorageVolume | undefined = info?.volumes.find(v => v.path === choice);
  const moving = progress !== null;

  const open = () => {
    setError(null);
    setChoice(current?.path ?? '');
    setPicking(true);
    refresh();
  };

  const handleMove = async () => {
    if (!chosen || chosen.selected || moving) return;
    setError(null);
    setProgress({ copied: 0, total: info?.cacheBytes ?? 0 });
    try {
      await moveCacheTo(chosen.path, (copied, total) => setProgress({ copied, total }));
      window.location.reload(); // every cache reader re-resolves its root on start
    } catch (err) {
      setProgress(null);
      setError((err as Error)?.message || 'The move failed. Nothing was changed.');
      refresh();
    }
  };

  const pct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.copied / progress.total) * 100)) : 0;

  return (
    <section className="settings-section">
      <h3 className="settings-section-title">Storage</h3>
      <div className="settings-card">
        <button className="settings-row" onClick={open}>
          <span className="settings-row-icon"><i className="fas fa-hdd" /></span>
          <span className="settings-row-label">
            Permanent cache location
            <span className="settings-row-sub">
              {current ? `${current.label} · ${fmtBytes(info?.cacheBytes ?? 0)} cached · ${fmtBytes(current.freeBytes)} free` : 'Loading…'}
            </span>
          </span>
          <span className="settings-row-action"><i className="fas fa-chevron-right" /></span>
        </button>
        {info?.storedUnavailable && (
          <div className="storage-warning" role="alert">
            Your chosen storage is not available right now (SD card removed?). The app is using internal storage until it is back; nothing was deleted.
          </div>
        )}
        <div className="settings-divider" />
        <button className="settings-row" onClick={() => { void openAppSettings(); }}>
          <span className="settings-row-icon"><i className="fas fa-cog" /></span>
          <span className="settings-row-label">
            App install location
            <span className="settings-row-sub">Android can move the app itself to an SD card or adopted storage: Storage → Change</span>
          </span>
          <span className="settings-row-action"><span className="settings-badge on">Open</span></span>
        </button>
      </div>

      {picking && (
        <div className="storage-overlay" role="dialog" aria-label="Permanent cache location">
          <div className="storage-dialog">
            <h3 className="storage-title">Permanent cache location</h3>
            <p className="storage-sub">Downloaded songs, cover art and indexes are stored here. Choosing another location moves what is already cached.</p>
            <div className="storage-list">
              {info?.volumes.map(v => (
                <button
                  key={v.id}
                  className={`storage-option${choice === v.path ? ' selected' : ''}`}
                  onClick={() => !moving && setChoice(v.path)}
                  disabled={moving}
                >
                  {choice === v.path ? <i className="fas fa-check-circle" /> : <span className="storage-radio" aria-hidden="true" />}
                  <span className="storage-option-text">
                    <strong>{v.label}{v.selected ? ' (current)' : ''}</strong>
                    <small>{fmtBytes(v.freeBytes)} free of {fmtBytes(v.totalBytes)}</small>
                  </span>
                </button>
              ))}
            </div>
            {chosen && !chosen.selected && !moving && (
              <p className="storage-note">
                Moves {fmtBytes(info?.cacheBytes ?? 0)} to {chosen.label}. Keep the app open and pause downloads first.
                {chosen.removable ? ' If the card is removed later, the app falls back to internal storage until it is back.' : ''}
              </p>
            )}
            {moving && (
              <div className="storage-progress" aria-live="polite">
                <div className="storage-progress-bar"><div className="storage-progress-fill" style={{ width: `${pct}%` }} /></div>
                <span>Moving… {pct}% ({fmtBytes(progress?.copied ?? 0)} of {fmtBytes(progress?.total ?? 0)})</span>
              </div>
            )}
            {error && <p className="storage-error" role="alert">{error}</p>}
            <div className="storage-actions">
              <button className="storage-btn" onClick={() => setPicking(false)} disabled={moving}>Close</button>
              <button className="storage-btn primary" onClick={handleMove} disabled={!chosen || chosen.selected || moving}>
                {moving ? 'Moving…' : 'Move here'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default StorageLocationSection;
