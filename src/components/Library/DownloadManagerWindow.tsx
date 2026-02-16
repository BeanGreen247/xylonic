/**
 * Download Manager Window
 * Modal for managing song downloads to permanent cache
 */

import React, { useState, useEffect } from 'react';
import { downloadManager } from '../../services/downloadManagerService';
import { offlineCacheService } from '../../services/offlineCacheService';
import { DownloadProgress, DownloadQueueItem, CacheStats, DownloadQuality } from '../../types/offline';
import { useOfflineMode } from '../../context/OfflineModeContext';
import { formatBytes } from '../../utils/cacheHelpers';
import './DownloadManagerWindow.css';

interface DownloadManagerWindowProps {
  isOpen: boolean;
  onClose: () => void;
}

const DownloadManagerWindow: React.FC<DownloadManagerWindowProps> = ({ isOpen, onClose }) => {
  const { cacheInitialized } = useOfflineMode();
  const [progress, setProgress] = useState<DownloadProgress>(downloadManager.getProgress());
  const [queue, setQueue] = useState<DownloadQueueItem[]>(downloadManager.getQueue());
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<DownloadQuality>('320');
  const [showCacheManager, setShowCacheManager] = useState(false);
  const [cacheLocation, setCacheLocation] = useState<string>('');
  const [isChangingLocation, setIsChangingLocation] = useState(false);
  const [locationMessage, setLocationMessage] = useState<{ type: 'success' | 'error' | '', text: string }>({ type: '', text: '' });

  // Subscribe to download events
  useEffect(() => {
    const unsubscribe = downloadManager.addEventListener((event) => {
      setProgress(downloadManager.getProgress());
      setQueue(downloadManager.getQueue());

      if (event.type === 'cache-updated') {
        updateCacheStats();
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
      const location = await (window as any).electron.getCacheLocation();
      setCacheLocation(location || 'Not set');
    } catch (error) {
      console.error('Failed to load cache location:', error);
      setCacheLocation('Error loading location');
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
    if (window.confirm('Clear entire download queue?')) {
      downloadManager.clearQueue();
    }
  };

  const handleClearCache = async () => {
    if (window.confirm('Delete all cached songs? This cannot be undone.')) {
      await offlineCacheService.clearAllCache();
      updateCacheStats();
    }
  };

  const handleRemoveAlbum = async (albumId: string) => {
    if (window.confirm('Remove this album from cache?')) {
      await offlineCacheService.removeAlbumFromCache(albumId);
      updateCacheStats();
    }
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

  return (
    <div className="download-manager-overlay" onClick={onClose}>
      <div className="download-manager-window" onClick={(e) => e.stopPropagation()}>
        <div className="download-manager-header">
          <h2>Download Manager</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="download-manager-content">
          {/* Overall Progress */}
          <div className="download-progress-section">
            <h3>Overall Progress</h3>
            <div className="download-progress-bar-container">
              <div className="download-progress-bar" style={{ width: `${progress.overallProgress}%` }}>
                <span className="download-progress-text">{progress.overallProgress}%</span>
              </div>
            </div>
            <div className="progress-stats">
              <span>Total: {progress.totalSongs}</span>
              <span>Completed: {progress.completedSongs}</span>
              <span>Failed: {progress.failedSongs}</span>
              <span>Pending: {progress.pendingSongs}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="download-controls">
            <button 
              onClick={handlePauseResume} 
              disabled={queue.length === 0}
              className="control-btn"
            >
              {progress.isPaused ? 'Resume' : 'Pause'}
            </button>
            <button 
              onClick={handleRetryFailed} 
              disabled={progress.failedSongs === 0}
              className="control-btn"
            >
              Retry Failed ({progress.failedSongs})
            </button>
            <button 
              onClick={handleClearCompleted}
              disabled={progress.completedSongs === 0}
              className="control-btn"
            >
              🧹 Clear Completed
            </button>
            <button 
              onClick={handleClearQueue}
              disabled={queue.length === 0}
              className="control-btn danger"
            >
              Clear Queue
            </button>
          </div>

          {/* Quality Selector */}
          <div className="quality-selector-section">
            <label>Default Download Quality:</label>
            <select 
              value={selectedQuality} 
              onChange={(e) => setSelectedQuality(e.target.value as DownloadQuality)}
              className="quality-select"
            >
              <option value="original">Original (Raw)</option>
              <option value="320">320 kbps</option>
              <option value="256">256 kbps</option>
              <option value="128">128 kbps</option>
              <option value="64">64 kbps</option>
            </select>
          </div>

          {/* Queue List */}
          <div className="download-queue-section">
            <h3>Download Queue ({queue.length})</h3>
            <div className="queue-list">
              {queue.length === 0 ? (
                <p className="empty-queue">No downloads in queue</p>
              ) : (
                queue.map((item) => (
                  <div key={item.id} className={`queue-item ${item.status}`}>
                    <span className="status-icon">{getStatusIcon(item.status)}</span>
                    <div className="song-info">
                      <div className="song-title">{item.song.title}</div>
                      <div className="song-artist">{item.artistName} - {item.albumName}</div>
                      {item.error && <div className="error-message">{item.error}</div>}
                    </div>
                    <div className="song-details">
                      <span className="song-duration">{formatDuration(item.song.duration)}</span>
                      <span className="song-quality">{item.quality === 'original' ? 'RAW' : `${item.quality}k`}</span>
                      {item.status === 'downloading' && (
                        <span className="download-progress">{item.progress}%</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

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
                  <span className="stat-label">Songs:</span>
                  <span className="stat-value">{cacheStats.totalSongs}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Albums:</span>
                  <span className="stat-value">{cacheStats.albumCount}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Your Cache:</span>
                  <span className="stat-value">{cacheStats.totalSizeFormatted}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Total Cache:</span>
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
                    <button 
                      className="control-btn change-location-btn"
                      onClick={handleChangeCacheLocation}
                      disabled={isChangingLocation}
                    >
                      <i className="fas fa-folder-open"></i> {isChangingLocation ? 'Changing...' : 'Change Location'}
                    </button>
                  </div>
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
                      <button 
                        className="delete-btn"
                        onClick={() => handleRemoveAlbum(album.albumId)}
                        title="Remove from cache"
                      >
                        <i className="fas fa-trash"></i> Delete
                      </button>
                    </div>
                  ))}
                  {offlineCacheService.getCachedAlbums().length === 0 && (
                    <p className="empty-cache">No albums cached</p>
                  )}
                </div>
                <button 
                  className="control-btn danger"
                  onClick={handleClearCache}
                  disabled={!cacheStats || cacheStats.totalSongs === 0}
                >
                  <i className="fas fa-broom"></i> Clear All Cache
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DownloadManagerWindow;
