/**
 * Download Manager Service
 * Manages sequential song downloads to permanent cache
 */

import {
  DownloadQuality,
  DownloadQueueItem,
  DownloadStatus,
  DownloadProgress,
  AlbumDownloadRequest,
  DownloadEvent,
  DownloadEventType,
  DownloadableSong
} from '../types/offline';
import { Song } from '../types';
import { getStreamUrl } from './subsonicApi';
import { offlineCacheService } from './offlineCacheService';
import { logger } from '../utils/logger';
import md5 from 'md5';

// Use the exposed Electron API from preload
const electron = (window as any).electron;

type DownloadEventListener = (event: DownloadEvent) => void;

class DownloadManagerService {
  private queue: DownloadQueueItem[] = [];
  private currentDownload: DownloadQueueItem | null = null;
  private isPaused: boolean = false;
  private isDownloading: boolean = false;
  private listeners: DownloadEventListener[] = [];
  private maxRetries: number = 3;
  
  // Track which albums and artists have had cover art downloaded in this session
  private downloadedAlbumCovers: Set<string> = new Set();
  private downloadedArtistCovers: Set<string> = new Set();
  
  // Track the primary cover art ID for each album (first one downloaded)
  private albumCoverArtMap: Map<string, string> = new Map();
  
  // Track auto-clear timeouts for completed downloads
  private autoClearTimeouts: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Add event listener
   */
  addEventListener(listener: DownloadEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: DownloadEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  /**
   * Add album to download queue
   */
  addAlbumToQueue(request: AlbumDownloadRequest): void {
    logger.log('[DownloadManager] Adding album to queue:', request.albumName, `(${request.songs.length} songs)`);

    const newItems: DownloadQueueItem[] = request.songs.map(song => ({
      id: `${song.id}_${Date.now()}_${Math.random()}`,
      song,
      albumId: request.albumId,
      albumName: request.albumName,
      artistName: request.artistName,
      artistId: request.artistId,
      artistCoverArtId: request.artistCoverArtId,
      quality: request.quality,
      status: 'pending',
      progress: 0,
      retryCount: 0,
      addedAt: Date.now()
    }));

    this.queue.push(...newItems);
    
    this.emit({ type: 'queue-updated', progress: this.getProgress() });

    // Start downloading if not already
    if (!this.isDownloading && !this.isPaused) {
      this.processQueue();
    }
  }

  /**
   * Add single song to queue
   */
  addSongToQueue(song: DownloadableSong, albumId: string, albumName: string, artistName: string, quality: DownloadQuality): void {
    const item: DownloadQueueItem = {
      id: `${song.id}_${Date.now()}`,
      song,
      albumId,
      albumName,
      artistName,
      quality,
      status: 'pending',
      progress: 0,
      retryCount: 0,
      addedAt: Date.now()
    };

    this.queue.push(item);
    this.emit({ type: 'queue-updated', progress: this.getProgress() });

    if (!this.isDownloading && !this.isPaused) {
      this.processQueue();
    }
  }

  /**
   * Process download queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isDownloading || this.isPaused) {
      return;
    }

    const pendingItem = this.queue.find(item => item.status === 'pending' || item.status === 'failed');
    
    if (!pendingItem) {
      logger.log('[DownloadManager] Queue empty or all completed');
      this.isDownloading = false;
      this.currentDownload = null;
      
      // Clear cover art tracking when all downloads are complete
      this.downloadedAlbumCovers.clear();
      this.downloadedArtistCovers.clear();
      this.albumCoverArtMap.clear();
      return;
    }

    this.isDownloading = true;
    this.currentDownload = pendingItem;

    try {
      await this.downloadSong(pendingItem);
      
      // Reset downloading flag before continuing
      this.isDownloading = false;
      
      // Continue to next song
      if (!this.isPaused) {
        setTimeout(() => this.processQueue(), 100);
      }
    } catch (error) {
      logger.error('[DownloadManager] Queue processing error:', error);
      this.isDownloading = false;
    }
  }

  /**
   * Download a single song
   */
  private async downloadSong(item: DownloadQueueItem): Promise<void> {
    logger.log('[DownloadManager] Downloading song:', item.song.title);

    // Update status
    item.status = 'downloading';
    item.startedAt = Date.now();
    this.emit({ type: 'download-started', item, progress: this.getProgress() });

    try {
      // Get credentials
      const serverUrl = localStorage.getItem('serverUrl');
      const username = localStorage.getItem('username');
      const password = localStorage.getItem('password');

      if (!serverUrl || !username || !password) {
        throw new Error('Missing authentication credentials');
      }

      // Check if already cached
      if (offlineCacheService.isCached(item.song.id)) {
        logger.log('[DownloadManager] Song already cached, skipping:', item.song.title);
        item.status = 'completed';
        item.completedAt = Date.now();
        item.progress = 100;
        this.emit({ type: 'download-completed', item, progress: this.getProgress() });
        return;
      }

      // Get bitrate for transcoding
      const bitrate = this.qualityToBitrate(item.quality);
      
      // Get stream URL
      const streamUrl = getStreamUrl(serverUrl, username, password, item.song.id, bitrate);

      // Download audio data
      const response = await fetch(streamUrl);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength = parseInt(response.headers.get('content-length') || '0');
      const reader = response.body?.getReader();
      
      if (!reader) {
        throw new Error('Failed to get response reader');
      }

      // Read stream with progress tracking
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedBytes += value.length;

        // Update progress
        if (contentLength > 0) {
          item.progress = Math.round((receivedBytes / contentLength) * 100);
          this.emit({ type: 'download-progress', item, progress: this.getProgress() });
        }
      }

      // Combine chunks into single buffer
      const buffer = new Uint8Array(receivedBytes);
      let position = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, position);
        position += chunk.length;
      }

      // Determine file extension from content-type or default to mp3
      const contentType = response.headers.get('content-type') || 'audio/mpeg';
      let extension = '.mp3';
      if (contentType.includes('ogg')) extension = '.ogg';
      else if (contentType.includes('flac')) extension = '.flac';
      else if (contentType.includes('m4a')) extension = '.m4a';
      else if (contentType.includes('wav')) extension = '.wav';

      // Add to cache (v2.0 - handles saving internally with hash-based storage)
      if (electron) {
        await offlineCacheService.addToCache(
          item.song,
          item.quality,
          buffer.buffer, // Pass ArrayBuffer
          extension,
          item.artistId,
          item.artistCoverArtId
        );

        // Download and cache album cover art if available
        // Only download once per album to avoid duplicates
        if (item.song.coverArt && !this.downloadedAlbumCovers.has(item.albumId) && !offlineCacheService.isCoverArtCached(item.song.coverArt)) {
          try {
            // Generate proper auth params for cover art
            const salt = Math.random().toString(36).substring(7);
            const token = md5(password + salt);
            const coverArtUrl = `${serverUrl}/rest/getCoverArt.view?id=${item.song.coverArt}&u=${username}&t=${token}&s=${salt}&v=1.16.1&c=SubsonicMusicApp&f=json&size=500`;
            
            console.log('📸 [CACHE] Downloading album cover art:', item.song.coverArt, 'for album:', item.albumName);
            const coverResponse = await fetch(coverArtUrl);
            
            if (coverResponse.ok) {
              const coverData = await coverResponse.arrayBuffer();
              const coverType = coverResponse.headers.get('content-type') || 'image/jpeg';
              let coverExt = '.jpg';
              if (coverType.includes('png')) coverExt = '.png';
              else if (coverType.includes('webp')) coverExt = '.webp';
              
              await offlineCacheService.cacheCoverArt(item.song.coverArt, new Uint8Array(coverData), coverExt);
              console.log('[CACHE] Album cover art cached successfully:', item.song.coverArt);
              logger.log('[DownloadManager] Album cover art cached:', item.song.coverArt);
              
              // Store this as the primary cover art ID for this album
              this.albumCoverArtMap.set(item.albumId, item.song.coverArt);
              
              // Mark this album as having its cover art downloaded
              this.downloadedAlbumCovers.add(item.albumId);
            } else {
              console.error('[CACHE] ERROR: Cover art download failed:', coverResponse.status, coverResponse.statusText);
            }
          } catch (coverError) {
            console.error('[CACHE] ERROR: Failed to cache album cover art:', coverError);
            logger.warn('[DownloadManager] Failed to cache album cover art:', coverError);
            // Don't fail the entire download if cover art fails
          }
        } else if (item.song.coverArt && this.downloadedAlbumCovers.has(item.albumId) && !offlineCacheService.isCoverArtCached(item.song.coverArt)) {
          // Album cover already downloaded, but this song has a different coverArtId
          // Create an alias WITHOUT downloading the image again (saves bandwidth & storage)
          try {
            const primaryCoverArtId = this.albumCoverArtMap.get(item.albumId);
            if (primaryCoverArtId && offlineCacheService.isCoverArtCached(primaryCoverArtId)) {
              console.log('[CACHE] Creating cover art alias (no download):', item.song.coverArt, '→', primaryCoverArtId);
              offlineCacheService.createCoverArtAlias(item.song.coverArt, primaryCoverArtId);
              console.log('[CACHE] Cover art alias created successfully');
            }
          } catch (aliasError) {
            console.error('[CACHE] ERROR: Failed to create cover art alias:', aliasError);
            // Don't fail the download
          }
        } else if (item.song.coverArt) {
          if (this.downloadedAlbumCovers.has(item.albumId)) {
            // Album cover already downloaded and this ID is already cached
            console.log('[CACHE] Album cover art already available for:', item.albumName);
          } else {
            console.log('[CACHE] INFO: Album cover art already cached:', item.song.coverArt);
            // Mark as downloaded to avoid checking again for this album
            this.downloadedAlbumCovers.add(item.albumId);
            this.albumCoverArtMap.set(item.albumId, item.song.coverArt);
          }
        }

        // Download and cache artist cover art if available
        // Only download once per artist to avoid duplicates
        const artistKey = item.artistId || item.artistName;
        if (item.artistCoverArtId && artistKey && !this.downloadedArtistCovers.has(artistKey) && !offlineCacheService.isCoverArtCached(item.artistCoverArtId)) {
          try {
            // Generate proper auth params for artist cover art
            const salt = Math.random().toString(36).substring(7);
            const token = md5(password + salt);
            const artistCoverUrl = `${serverUrl}/rest/getCoverArt.view?id=${item.artistCoverArtId}&u=${username}&t=${token}&s=${salt}&v=1.16.1&c=SubsonicMusicApp&f=json&size=500`;
            
            console.log('📸 [CACHE] Downloading artist cover art:', item.artistCoverArtId, 'for artist:', item.artistName);
            const artistCoverResponse = await fetch(artistCoverUrl);
            
            if (artistCoverResponse.ok) {
              const artistCoverData = await artistCoverResponse.arrayBuffer();
              const artistCoverType = artistCoverResponse.headers.get('content-type') || 'image/jpeg';
              let artistCoverExt = '.jpg';
              if (artistCoverType.includes('png')) artistCoverExt = '.png';
              else if (artistCoverType.includes('webp')) artistCoverExt = '.webp';
              
              await offlineCacheService.cacheCoverArt(item.artistCoverArtId, new Uint8Array(artistCoverData), artistCoverExt);
              console.log('[CACHE] Artist cover art cached successfully:', item.artistCoverArtId);
              logger.log('[DownloadManager] Artist cover art cached:', item.artistCoverArtId);
              
              // Mark this artist as having its cover art downloaded
              this.downloadedArtistCovers.add(artistKey);
            } else {
              console.error('[CACHE] ERROR: Artist cover art download failed:', artistCoverResponse.status, artistCoverResponse.statusText);
            }
          } catch (artistCoverError) {
            console.error('[CACHE] ERROR: Failed to cache artist cover art:', artistCoverError);
            logger.warn('[DownloadManager] Failed to cache artist cover art:', artistCoverError);
            // Don't fail the entire download if artist cover art fails
          }
        } else if (item.artistCoverArtId && artistKey) {
          if (this.downloadedArtistCovers.has(artistKey)) {
            console.log('[CACHE] Artist cover art already downloaded for this artist, skipping:', item.artistName);
          } else {
            console.log('[CACHE] INFO: Artist cover art already cached:', item.artistCoverArtId);
            // Mark as downloaded to avoid checking again for this artist
            this.downloadedArtistCovers.add(artistKey);
          }
        }

        logger.log('[DownloadManager] Song downloaded successfully:', item.song.title);
        
        item.status = 'completed';
        item.completedAt = Date.now();
        item.progress = 100;
        
        this.emit({ type: 'download-completed', item, progress: this.getProgress() });
        this.emit({ type: 'cache-updated' });
        
        // Auto-clear completed download after 20 seconds
        this.scheduleAutoClear(item.id);
      } else {
        throw new Error('Electron IPC not available');
      }

    } catch (error) {
      logger.error('[DownloadManager] Download failed:', error);

      // Retry logic
      if (item.retryCount < this.maxRetries) {
        item.retryCount++;
        item.status = 'pending';
        item.error = `Retry ${item.retryCount}/${this.maxRetries}: ${(error as Error).message}`;
        logger.log('[DownloadManager] Retrying download:', item.retryCount);
      } else {
        item.status = 'failed';
        item.error = (error as Error).message;
      }

      this.emit({ type: 'download-failed', item, progress: this.getProgress(), error: item.error });
    }
  }

  /**
   * Convert quality to bitrate
   */
  private qualityToBitrate(quality: DownloadQuality): number | undefined {
    switch (quality) {
      case 'original': return undefined; // No transcoding
      case '320': return 320;
      case '256': return 256;
      case '128': return 128;
      case '64': return 64;
      default: return undefined;
    }
  }

  /**
   * Schedule auto-clear for a completed download after 20 seconds
   */
  private scheduleAutoClear(itemId: string): void {
    // Clear any existing timeout for this item
    const existingTimeout = this.autoClearTimeouts.get(itemId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Schedule removal after 20 seconds
    const timeout = setTimeout(() => {
      const item = this.queue.find(i => i.id === itemId);
      
      // Only remove if still completed (not failed or paused)
      if (item && item.status === 'completed') {
        logger.log('[DownloadManager] Auto-clearing completed download:', item.song.title);
        this.removeFromQueue(itemId);
      }
      
      // Clean up timeout reference
      this.autoClearTimeouts.delete(itemId);
    }, 20000); // 20 seconds
    
    this.autoClearTimeouts.set(itemId, timeout);
  }
  
  /**
   * Clear auto-clear timeout for an item
   */
  private clearAutoClearTimeout(itemId: string): void {
    const timeout = this.autoClearTimeouts.get(itemId);
    if (timeout) {
      clearTimeout(timeout);
      this.autoClearTimeouts.delete(itemId);
    }
  }

  /**
   * Sanitize filename for safe file system storage
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid chars
      .replace(/\s+/g, ' ')           // Normalize spaces
      .trim()
      .substring(0, 100);             // Limit length
  }

  /**
   * Pause download queue
   */
  pauseQueue(): void {
    if (!this.isPaused) {
      this.isPaused = true;
      logger.log('[DownloadManager] Queue paused');
      this.emit({ type: 'queue-paused', progress: this.getProgress() });
    }
  }

  /**
   * Resume download queue
   */
  resumeQueue(): void {
    if (this.isPaused) {
      this.isPaused = false;
      logger.log('[DownloadManager] Queue resumed');
      this.emit({ type: 'queue-resumed', progress: this.getProgress() });
      
      if (!this.isDownloading) {
        this.processQueue();
      }
    }
  }

  /**
   * Clear completed and failed downloads from queue
   */
  clearCompleted(): void {
    const before = this.queue.length;
    const itemsToRemove = this.queue.filter(item => 
      item.status === 'completed' || item.status === 'failed'
    );
    
    // Clear auto-clear timeouts for removed items
    itemsToRemove.forEach(item => this.clearAutoClearTimeout(item.id));
    
    this.queue = this.queue.filter(item => 
      item.status === 'pending' || item.status === 'downloading'
    );
    const removed = before - this.queue.length;
    
    if (removed > 0) {
      logger.log('[DownloadManager] Cleared', removed, 'completed/failed items');
      this.emit({ type: 'queue-updated', progress: this.getProgress() });
    }
    
    // If queue is now empty, clear cover art tracking
    if (this.queue.length === 0) {
      this.downloadedAlbumCovers.clear();
      this.downloadedArtistCovers.clear();
      this.albumCoverArtMap.clear();
    }
  }

  /**
   * Retry all failed downloads
   */
  retryFailed(): void {
    const failedItems = this.queue.filter(item => item.status === 'failed');
    
    failedItems.forEach(item => {
      item.status = 'pending';
      item.error = undefined;
      item.retryCount = 0;
    });

    if (failedItems.length > 0) {
      logger.log('[DownloadManager] Retrying', failedItems.length, 'failed downloads');
      this.emit({ type: 'queue-updated', progress: this.getProgress() });
      
      if (!this.isDownloading && !this.isPaused) {
        this.processQueue();
      }
    }
  }

  /**
   * Remove specific item from queue
   */
  removeFromQueue(itemId: string): void {
    // Clear any pending auto-clear timeout
    this.clearAutoClearTimeout(itemId);
    
    this.queue = this.queue.filter(item => item.id !== itemId);
    this.emit({ type: 'queue-updated', progress: this.getProgress() });
  }

  /**
   * Clear entire queue
   */
  clearQueue(): void {
    // Clear all auto-clear timeouts
    this.autoClearTimeouts.forEach(timeout => clearTimeout(timeout));
    this.autoClearTimeouts.clear();
    
    this.queue = [];
    this.currentDownload = null;
    this.isDownloading = false;
    
    // Clear cover art tracking
    this.downloadedAlbumCovers.clear();
    this.downloadedArtistCovers.clear();
    this.albumCoverArtMap.clear();
    
    logger.log('[DownloadManager] Queue cleared');
    this.emit({ type: 'queue-updated', progress: this.getProgress() });
  }

  /**
   * Get current download progress
   */
  getProgress(): DownloadProgress {
    const totalSongs = this.queue.length;
    const completedSongs = this.queue.filter(item => item.status === 'completed').length;
    const failedSongs = this.queue.filter(item => item.status === 'failed').length;
    const pendingSongs = this.queue.filter(item => item.status === 'pending').length;

    let overallProgress = 0;
    if (totalSongs > 0) {
      const totalProgress = this.queue.reduce((sum, item) => sum + item.progress, 0);
      overallProgress = Math.round(totalProgress / totalSongs);
    }

    return {
      totalSongs,
      completedSongs,
      failedSongs,
      pendingSongs,
      currentSong: this.currentDownload || undefined,
      overallProgress,
      isPaused: this.isPaused,
      isDownloading: this.isDownloading
    };
  }

  /**
   * Get queue items
   */
  getQueue(): DownloadQueueItem[] {
    return [...this.queue];
  }

  /**
   * Check if queue is empty
   */
  isQueueEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get queue status
   */
  getStatus(): { isPaused: boolean; isDownloading: boolean; queueLength: number } {
    return {
      isPaused: this.isPaused,
      isDownloading: this.isDownloading,
      queueLength: this.queue.length
    };
  }
}

// Export singleton instance
export const downloadManager = new DownloadManagerService();
