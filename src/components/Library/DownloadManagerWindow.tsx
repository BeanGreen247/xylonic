/**
 * Download Manager Window
 * Modal for managing song downloads to permanent cache
 */

import React, { useState, useEffect } from 'react';
import { downloadManager } from '../../services/downloadManagerService';
import { offlineCacheService } from '../../services/offlineCacheService';
import { DownloadProgress, DownloadQueueItem, CacheStats } from '../../types/offline';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { formatBytes } from '../../utils/cacheHelpers';
import { getBridge } from '../../platform/bridge';
import './DownloadManagerWindow.css';

const isElectron = getBridge().isElectron;
const isMobile = !isElectron;

interface DownloadManagerWindowProps {
  isOpen: boolean;
  onClose: () => void;
  inline?: boolean;
}

const DownloadManagerWindow: React.FC<DownloadManagerWindowProps> = ({ isOpen, onClose, inline = false }) => {
  const { cacheInitialized } = useOfflineMode();
  const [progress, setProgress] = useState<DownloadProgress>(downloadManager.getProgress());
  const [queue, setQueue] = useState<DownloadQueueItem[]>(downloadManager.getQueue());
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [showCacheManager, setShowCacheManager] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [cacheLocation, setCacheLocation] = useState<string>('');
  const [diskSpace, setDiskSpace] = useState<{ available: number; total: number } | null>(null);
  const [isChangingLocation, setIsChangingLocation] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [clearTotal, setClearTotal] = useState(0);
  const [locationMessage, setLocationMessage] = useState<{ type: 'success' | 'error' | '', text: string }>({ type: '', text: '' });
  const [showClearCacheConfirm, setShowClearCacheConfirm] = useState(false);
  const [pendingRemoveAlbumId, setPendingRemoveAlbumId] = useState<string | null>(null);
  const [verifyState, setVerifyState] = useState<{
    status: 'idle' | 'running' | 'done';
    verified: number;
    total: number;
    removed: number;
    durationMs: number;
  }>({ status: 'idle', verified: 0, total: 0, removed: 0, durationMs: 0 });

  // Subscribe to download events
  useEffect(() => {
    const unsubscribe = downloadManager.addEventListener((event) => {
      setProgress(downloadManager.getProgress());
      setQueue(downloadManager.getQueue());

      if (event.type === 'cache-updated') {
        updateCacheStats();
      }
      if (event.type === 'cache-verify-started') {
        setVerifyState(v => ({ ...v, status: 'running', verified: 0, total: 0 }));
      }
      if (event.type === 'cache-verify-progress' && event.verifyProgress) {
        setVerifyState(v => ({ ...v, verified: event.verifyProgress!.verified, total: event.verifyProgress!.total }));
      }
      if (event.type === 'cache-verify-complete' && event.verifyResult) {
        setVerifyState({ status: 'done', ...event.verifyResult });
        if (event.verifyResult.removed > 0) updateCacheStats();
      }
    });

    // Initial load
    updateCacheStats();

    return unsubscribe;
  }, []);

  // Update stats when cache initializes
  useEffect(() => {
    if (cacheInitialized) {
      updateCacheStats();
    }
  }, [cacheInitialized]);

  // Update stats when window opens
  useEffect(() => {
    if (isOpen && cacheInitialized) {
      updateCacheStats();
      loadCacheLocation();
    }
  }, [isOpen, cacheInitialized]);

  const updateCacheStats = () => {
    const stats = offlineCacheService.getCacheStats();
    setCacheStats(stats);
  };

  const loadCacheLocation = async () => {
    try {
      const location = await getBridge().getCacheDir();
      setCacheLocation(location || 'Not set');
      if (isElectron && window.electron?.getDiskSpace) {
        const space = await window.electron.getDiskSpace(location || undefined);
        setDiskSpace(space);
      }
    } catch (error) {
      setCacheLocation('Unknown');
    }
  };

  const handleChangeCacheLocation = async () => {
    setIsChangingLocation(true);
    setLocationMessage({ type: '', text: '' });

    try {
      const newLocation = await (window as any).electron.pickCacheLocation();
      
      if (newLocation && newLocation !== cacheLocation) {
        // Update cache location
        await (window as any).electron.setCacheLocation(newLocation);
        setCacheLocation(newLocation);
        setLocationMessage({
          type: 'success',
          text: 'Cache location updated successfully. Restart the app for changes to take full effect.'
        });

        // Refresh disk space for the new location
        if (window.electron?.getDiskSpace) {
          const space = await window.electron.getDiskSpace(newLocation);
          setDiskSpace(space);
        }

        // Reload cache stats with new location
        setTimeout(() => {
          updateCacheStats();
        }, 500);
      } else if (newLocation === null) {
        // User cancelled
        setLocationMessage({ type: '', text: '' });
      }
    } catch (error) {
      console.error('Failed to change cache location:', error);
      setLocationMessage({ 
        type: 'error', 
        text: `Failed to change cache location: ${(error as Error).message}` 
      });
    } finally {
      setIsChangingLocation(false);
    }
  };

  const handlePauseResume = () => {
    if (progress.isPaused) {
      downloadManager.resumeQueue();
    } else {
      downloadManager.pauseQueue();
    }
  };

  const handleRetryFailed = () => {
    downloadManager.retryFailed();
  };

  const handleClearCompleted = () => {
    downloadManager.clearCompleted();
  };

  const handleClearQueue = () => {
    downloadManager.clearQueue();
  };

  const handleClearCache = async () => {
    const total = cacheStats?.totalSongs ?? 0;
    setClearTotal(total);
    setIsClearingCache(true);
    setShowClearCacheConfirm(false);
    try {
      await offlineCacheService.clearAllCache(() => updateCacheStats());
      updateCacheStats();
    } finally {
      setIsClearingCache(false);
      setClearTotal(0);
    }
  };

  const handleRemoveAlbum = async (albumId: string) => {
    await offlineCacheService.removeAlbumFromCache(albumId);
    setPendingRemoveAlbumId(null);
    updateCacheStats();
  };

  const handleVerifyCache = () => {
    downloadManager.triggerCacheVerification();
  };

  const getStatusIcon = (status: DownloadQueueItem['status']) => {
    switch (status) {
      case 'pending': return 'Pending';
      case 'downloading': return 'Downloading';
      case 'completed': return 'Completed';
      case 'failed': return 'Failed';
      case 'paused': return 'Paused';
    }
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  const hasActivity = queue.length > 0 || progress.totalSongs > 0;

  const content = (
        <div className="download-manager-content">
          {/* Overall Progress — only shown while there is / was something to download */}
          {hasActivity && (
            <div className="download-progress-section">
              <div className="download-progress-bar-container">
                <div className="download-progress-bar" style={{ width: `${progress.overallProgress}%` }}>
                  <span className="download-progress-text">{progress.overallProgress}%</span>
                </div>
              </div>
              <div className="progress-stats">
                <span>Total: {progress.totalSongs}</span>
                <span>Done: {progress.completedSongs}</span>
                {progress.failedSongs > 0 && <span className="stat-failed">Failed: {progress.failedSongs}</span>}
                <span>Pending: {progress.pendingSongs}</span>
              </div>
            </div>
          )}

          {/* Controls — only shown when there is something to act on */}
          {hasActivity && (
            <div className="download-controls">
              <button
                onClick={handlePauseResume}
                disabled={queue.length === 0}
                className="control-btn"
              >
                {progress.isPaused ? 'Resume' : 'Pause'}
              </button>
              {progress.failedSongs > 0 && (
                <button onClick={handleRetryFailed} className="control-btn">
                  Retry Failed ({progress.failedSongs})
                </button>
              )}
              {progress.completedSongs > 0 && (
                <button onClick={handleClearCompleted} className="control-btn">
                  Clear Completed
                </button>
              )}
              <button
                onClick={handleClearQueue}
                disabled={queue.length === 0 || progress.pendingClear}
                className="control-btn danger"
              >
                {progress.pendingClear ? 'Stopping…' : 'Clear Queue'}
              </button>
            </div>
          )}

          {/* Active download card(s) — one per concurrent download, always visible while downloading */}
          {progress.currentDownloads.length > 0 ? (
            <div className={`active-downloads-list${progress.currentDownloads.length > 1 ? ' multi' : ''}`}>
              {progress.currentDownloads.map(dl => (
                <div className="active-download-card" key={dl.id}>
                  <div className="active-download-label">
                    <i className="fas fa-arrow-circle-down" /> Now downloading
                  </div>
                  <div className="active-download-title">{dl.song.title}</div>
                  <div className="active-download-sub">
                    {dl.artistName} — {dl.albumName}
                  </div>
                  <div className="active-download-bar-wrap">
                    <div
                      className="active-download-bar"
                      style={{ width: `${dl.progress}%` }}
                    />
                  </div>
                  <div className="active-download-pct">{dl.progress}%</div>
                </div>
              ))}
            </div>
          ) : !hasActivity ? (
            <p className="empty-queue">No downloads in queue</p>
          ) : null}

          {/* Collapsed queue — toggled on demand to avoid rendering large lists */}
          {queue.length > 0 && (
            <div className="download-queue-section">
              <button
                className="queue-toggle-btn"
                onClick={() => setShowQueue(v => !v)}
              >
                <i className={`fas fa-chevron-${showQueue ? 'up' : 'down'}`} />
                {showQueue ? 'Hide' : 'Show'} queue ({queue.length})
              </button>

              {showQueue && (
                <div className="queue-list">
                  {queue.map((item) => (
                    <div key={item.id} className={`queue-item ${item.status}`}>
                      <span className="status-icon">{getStatusIcon(item.status)}</span>
                      <div className="song-info">
                        <div className="song-title">{item.song.title}</div>
                        <div className="song-artist">{item.artistName} - {item.albumName}</div>
                        {item.status === 'failed' && item.error && (
                          <div className="error-message">{item.error}</div>
                        )}
                        {item.status === 'pending' && item.retryCount > 0 && (
                          <div className="retry-hint">Retrying… attempt {item.retryCount}/{8}</div>
                        )}
                      </div>
                      <div className="song-details">
                        <span className="song-duration">{formatDuration(item.song.duration)}</span>
                        <span className="song-quality">{item.quality === 'original' ? 'RAW' : `${item.quality}k`}</span>
                        {item.status === 'downloading' && (
                          <span className="download-progress">{item.progress}%</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Cache Stats */}
          <div className="cache-stats-section">
            <div className="cache-stats-header">
              <h3>Cache Statistics</h3>
              <button 
                className="toggle-btn" 
                onClick={() => setShowCacheManager(!showCacheManager)}
              >
                {showCacheManager ? 'Hide' : 'Manage'} Cache
              </button>
            </div>
            
            {cacheStats && (
              <div className="cache-stats">
                <div className="stat-item">
                  <span className="stat-label">Songs</span>
                  <span className="stat-value">{cacheStats.totalSongs}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Albums</span>
                  <span className="stat-value">{cacheStats.albumCount}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Your Cache</span>
                  <span className="stat-value">{cacheStats.totalSizeFormatted}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Total Cache</span>
                  <span className="stat-value" title="Total cache size across all users">
                    {offlineCacheService.getTotalSharedCacheSize() > 0
                      ? formatBytes(offlineCacheService.getTotalSharedCacheSize())
                      : 'N/A'}
                  </span>
                </div>
              </div>
            )}

            {/* Cache Manager */}
            {showCacheManager && (
              <div className="cache-manager">
                {/* Cache Location Section */}
                <div className="cache-location-section">
                  <h4>Cache Location</h4>
                  <div className="cache-location-info">
                    <div className="location-path" title={cacheLocation}>
                      <i className="fas fa-folder"></i> {cacheLocation || 'Loading...'}
                    </div>
                    {isElectron && (
                      <button
                        className="control-btn change-location-btn"
                        onClick={handleChangeCacheLocation}
                        disabled={isChangingLocation}
                      >
                        <i className="fas fa-folder-open"></i> {isChangingLocation ? 'Changing...' : 'Change Location'}
                      </button>
                    )}
                  </div>
                  {diskSpace && (
                    <div className="disk-space-bar-wrap">
                      <div className="disk-space-labels">
                        <span className="disk-space-free">
                          <i className="fas fa-hdd"></i> {formatBytes(diskSpace.available)} free
                        </span>
                        <span className="disk-space-total">{formatBytes(diskSpace.total)} total</span>
                      </div>
                      <div className="disk-space-bar">
                        <div
                          className="disk-space-bar-used"
                          style={{ width: `${Math.min(100, ((diskSpace.total - diskSpace.available) / diskSpace.total) * 100).toFixed(1)}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {locationMessage.text && (
                    <div className={`location-message ${locationMessage.type}`}>
                      {locationMessage.type === 'success' ? 'SUCCESS:' : 'ERROR:'} {locationMessage.text}
                    </div>
                  )}
                </div>

                <h4>Cached Albums</h4>
                <div className="cached-albums-list">
                  {offlineCacheService.getCachedAlbums().map((album) => (
                    <div key={album.albumId} className="cached-album-item">
                      <div className="album-info">
                        <div className="album-name">{album.albumName}</div>
                        <div className="album-artist">{album.artistName} ({album.songCount} songs)</div>
                      </div>
                      {pendingRemoveAlbumId === album.albumId ? (
                        <div className="inline-confirm">
                          <button className="control-btn danger" onClick={() => handleRemoveAlbum(album.albumId)}>
                            Delete
                          </button>
                          <button className="control-btn" onClick={() => setPendingRemoveAlbumId(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="delete-btn"
                          onClick={() => setPendingRemoveAlbumId(album.albumId)}
                          title="Remove from cache"
                        >
                          <i className="fas fa-trash"></i> Delete
                        </button>
                      )}
                    </div>
                  ))}
                  {offlineCacheService.getCachedAlbums().length === 0 && (
                    <p className="empty-cache">No albums cached</p>
                  )}
                </div>
                {/* Cache Integrity */}
                <div className="cache-verify-section">
                  <h4>Cache Integrity</h4>
                  <button
                    className="control-btn"
                    onClick={handleVerifyCache}
                    disabled={verifyState.status === 'running' || !cacheStats || cacheStats.totalSongs === 0}
                  >
                    {verifyState.status === 'running'
                      ? <><i className="fas fa-spinner fa-spin" /> Verifying… {verifyState.total > 0 ? `${verifyState.verified} / ${verifyState.total}` : ''}</>
                      : <><i className="fas fa-shield-alt" /> Verify Cache</>
                    }
                  </button>
                  {verifyState.status === 'done' && (
                    <div className="verify-result">
                      <i className="fas fa-check-circle" /> {verifyState.verified} songs verified
                      {verifyState.removed > 0 && (
                        <>, <span className="verify-removed">{verifyState.removed} orphaned {verifyState.removed === 1 ? 'entry' : 'entries'} removed</span></>
                      )}
                      <span className="verify-duration"> ({(verifyState.durationMs / 1000).toFixed(1)}s)</span>
                    </div>
                  )}
                </div>

                {showClearCacheConfirm ? (
                  <div className="inline-confirm">
                    <span className="inline-confirm-text">Delete all cached songs?</span>
                    <button className="control-btn danger" onClick={handleClearCache}>
                      Delete all
                    </button>
                    <button className="control-btn" onClick={() => setShowClearCacheConfirm(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="control-btn danger"
                    onClick={() => setShowClearCacheConfirm(true)}
                    disabled={!cacheStats || cacheStats.totalSongs === 0 || isClearingCache}
                  >
                    {isClearingCache
                      ? <><i className="fas fa-spinner fa-spin"></i> Clearing… {cacheStats?.totalSongs ?? 0} / {clearTotal} left</>
                      : <><i className="fas fa-broom"></i> Clear All Cache</>
                    }
                  </button>
                )}

              </div>
            )}
          </div>
        </div>
  );

  if (inline) {
    return (
      <div className="download-manager-inline">
        <div className="library-header">
          <h2 className="library-title">
            <i className="fas fa-download" />
            Downloads
          </h2>
        </div>
        {content}
      </div>
    );
  }

  return (
    <div className={`download-manager-overlay${isMobile ? ' mobile' : ''}`} onClick={onClose}>
      <div className={`download-manager-window${isMobile ? ' mobile' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="download-manager-header">
          <h2>Download Manager</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        {content}
      </div>
    </div>
  );
};

export default DownloadManagerWindow;
