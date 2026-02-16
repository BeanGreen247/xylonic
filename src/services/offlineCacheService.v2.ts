/**
 * Offline Cache Service v2.0
 * Multi-user cache with shared audio storage and reference counting
 */

import {
  CacheIndex,
  CachedSongMetadata,
  DownloadQuality,
  CacheStats,
  OfflineModeConfig,
  DownloadableSong,
  AudioFileRegistry,
  AudioFileReference,
  CoverArtFileReference,
  UserMetadata
} from '../types/offline';
import { 
  generateAudioHash, 
  generateCoverArtHash, 
  generateUserId,
  getFileExtension,
  formatBytes,
  getFormatFromExtension
} from '../utils/cacheHelpers';
import { logger } from '../utils/logger';

// Use the exposed Electron API from preload
const electron = (window as any).electron;

class OfflineCacheService {
  private cacheIndex: CacheIndex | null = null;
  private userMetadata: UserMetadata | null = null;
  private audioRegistry: AudioFileRegistry | null = null;
  private config: OfflineModeConfig = {
    enabled: false,
    preferCache: true,
    warnCacheSizeAt: 1000 // 1GB
  };
  private userId: string = '';
  private serverUrl: string = '';
  private cacheDir: string = '';

  /**
   * Initialize cache service for a user
   */
  async initialize(username: string, serverUrl: string): Promise<void> {
    try {
      this.userId = generateUserId(username, serverUrl);
      this.serverUrl = serverUrl;
      
      logger.log('[OfflineCache] Initializing v2.0 cache for user:', this.userId);
      
      // Get cache directory
      if (electron && electron.getCacheDir) {
        this.cacheDir = await electron.getCacheDir();
        logger.log('[OfflineCache] Cache directory:', this.cacheDir);
      } else {
        logger.warn('[OfflineCache] Not running in Electron, cache disabled');
        return;
      }

      // Load or create audio registry (shared across all users)
      await this.loadOrCreateRegistry();
      
      // Load or create user's cache index
      await this.loadOrCreateUserIndex(username, serverUrl);
      
      // Load or create user metadata
      await this.loadOrCreateUserMetadata();
      
      // Load configuration
      this.loadConfig();
      
      logger.log('[OfflineCache] Initialized successfully - v2.0');
    } catch (error) {
      logger.error('[OfflineCache] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Check if cache exists for a user without full initialization
   */
  async hasCacheForUser(username: string, serverUrl: string): Promise<boolean> {
    try {
      if (!electron || !electron.readUserCacheIndex) {
        return false;
      }

      const userId = generateUserId(username, serverUrl);
      const indexData = await electron.readUserCacheIndex(userId);
      
      if (!indexData) {
        return false;
      }

      const cacheIndex = JSON.parse(indexData);
      const songCount = Object.keys(cacheIndex.songs || {}).length;
      
      logger.log('[OfflineCache] Cache check for user:', userId, '-', songCount, 'songs');
      return songCount > 0;
    } catch (error) {
      logger.error('[OfflineCache] Failed to check cache:', error);
      return false;
    }
  }

  /**
   * Load or create audio file registry
   */
  private async loadOrCreateRegistry(): Promise<void> {
    try {
      const registryData = await electron.readAudioRegistry();
      
      if (registryData) {
        this.audioRegistry = JSON.parse(registryData);
        
        // Backward compatibility: add coverArtIdMap if missing
        if (!this.audioRegistry!.coverArtIdMap) {
          logger.log('[OfflineCache] Migrating registry to add coverArtIdMap');
          this.audioRegistry!.coverArtIdMap = {};
          
          // Build initial map from existing cover art files
          Object.values(this.audioRegistry!.coverArtFiles).forEach((coverArt: any) => {
            if (coverArt.primaryCoverArtId) {
              this.audioRegistry!.coverArtIdMap[coverArt.primaryCoverArtId] = coverArt.hash;
            }
            if (coverArt.aliases) {
              coverArt.aliases.forEach((aliasId: string) => {
                this.audioRegistry!.coverArtIdMap[aliasId] = coverArt.hash;
              });
            }
          });
          
          await this.saveRegistry();
        }
        
        logger.log('[OfflineCache] Loaded audio registry:', 
          Object.keys(this.audioRegistry!.audioFiles).length, 'audio files,',
          Object.keys(this.audioRegistry!.coverArtFiles).length, 'cover art files,',
          Object.keys(this.audioRegistry!.coverArtIdMap).length, 'cover art ID mappings');
      } else {
        // Create new registry
        this.audioRegistry = {
          version: '2.0.0',
          audioFiles: {},
          coverArtFiles: {},
          coverArtIdMap: {},
          totalSize: 0,
          lastUpdated: Date.now()
        };
        await this.saveRegistry();
        logger.log('[OfflineCache] Created new audio registry');
      }
    } catch (error) {
      logger.error('[OfflineCache] Failed to load/create registry:', error);
      throw error;
    }
  }

  /**
   * Save audio file registry
   */
  private async saveRegistry(): Promise<void> {
    if (!this.audioRegistry) return;
    
    this.audioRegistry.lastUpdated = Date.now();
    
    try {
      await electron.writeAudioRegistry(JSON.stringify(this.audioRegistry, null, 2));
      logger.log('[OfflineCache] Registry saved');
    } catch (error) {
      logger.error('[OfflineCache] Failed to save registry:', error);
    }
  }

  /**
   * Load or create user's cache index
   */
  private async loadOrCreateUserIndex(username: string, serverUrl: string): Promise<void> {
    try {
      const indexData = await electron.readUserCacheIndex(this.userId);
      
      if (indexData) {
        this.cacheIndex = JSON.parse(indexData);
        
        // Ensure songs object exists (defensive programming)
        if (!this.cacheIndex!.songs) {
          this.cacheIndex!.songs = {};
        }
        
        // Recalculate totalSize
        const songs = Object.values(this.cacheIndex!.songs);
        const calculatedSize = songs.reduce((total, song) => total + (song.fileSize || 0), 0);
        
        if (this.cacheIndex!.totalSize !== calculatedSize) {
          logger.log('[OfflineCache] Correcting totalSize:', this.cacheIndex!.totalSize, '→', calculatedSize);
          this.cacheIndex!.totalSize = calculatedSize;
          await this.saveIndex();
        }
        
        logger.log('[OfflineCache] Loaded user cache index:', songs.length, 'songs');
      } else {
        // Create new index
        this.cacheIndex = {
          version: '2.0.0',
          userId: this.userId,
          username,
          serverUrl,
          songs: {},
          totalSize: 0,
          lastUpdated: Date.now()
        };
        await this.saveIndex();
        logger.log('[OfflineCache] Created new user cache index');
      }
    } catch (error) {
      logger.error('[OfflineCache] Failed to load/create user index:', error);
      throw error;
    }
  }

  /**
   * Save user's cache index
   */
  private async saveIndex(): Promise<void> {
    if (!this.cacheIndex) return;
    
    this.cacheIndex.lastUpdated = Date.now();
    
    try {
      await electron.writeUserCacheIndex(this.userId, JSON.stringify(this.cacheIndex, null, 2));
      logger.log('[OfflineCache] User index saved');
    } catch (error) {
      logger.error('[OfflineCache] Failed to save user index:', error);
    }
  }

  /**
   * Load or create user metadata
   */
  private async loadOrCreateUserMetadata(): Promise<void> {
    try {
      const metadataData = await electron.readUserMetadata(this.userId);
      
      if (metadataData) {
        this.userMetadata = JSON.parse(metadataData);
        logger.log('[OfflineCache] Loaded user metadata:', this.userMetadata!.likedSongs.length, 'liked songs');
      } else {
        // Create new metadata
        this.userMetadata = {
          userId: this.userId,
          likedSongs: [],
          downloadHistory: [],
          preferences: {}
        };
        await this.saveUserMetadata();
        logger.log('[OfflineCache] Created new user metadata');
      }
    } catch (error) {
      logger.error('[OfflineCache] Failed to load/create user metadata:', error);
      throw error;
    }
  }

  /**
   * Save user metadata
   */
  private async saveUserMetadata(): Promise<void> {
    if (!this.userMetadata) return;
    
    try {
      await electron.writeUserMetadata(this.userId, JSON.stringify(this.userMetadata, null, 2));
      logger.log('[OfflineCache] User metadata saved');
    } catch (error) {
      logger.error('[OfflineCache] Failed to save user metadata:', error);
    }
  }

  /**
   * Check if a song is cached by this user
   */
  isCached(songId: string): boolean {
    return !!this.cacheIndex?.songs[songId];
  }

  /**
   * Get cached song metadata
   */
  getCachedSong(songId: string): CachedSongMetadata | null {
    return this.cacheIndex?.songs[songId] || null;
  }

  /**
   * Get file path for cached song
   */
  async getCachedFilePath(songId: string): Promise<string | null> {
    const metadata = this.getCachedSong(songId);
    if (!metadata || !this.audioRegistry) return null;

    // Update last accessed time
    metadata.lastAccessed = Date.now();
    await this.saveIndex();

    // Get audio file from registry
    const audioFile = this.audioRegistry.audioFiles[metadata.audioHash];
    if (!audioFile) return null;

    // Get full path to audio file
    const filename = audioFile.filePath.split('/').pop();
    return await electron.getAudioFilePath(metadata.audioHash, filename || 'audio.mp3');
  }

  /**
   * Add song to cache after download
   */
  async addToCache(
    song: DownloadableSong, 
    quality: DownloadQuality, 
    audioBuffer: ArrayBuffer, 
    fileExtension: string,
    artistId?: string, 
    artistCoverArtId?: string
  ): Promise<void> {
    if (!this.cacheIndex || !this.audioRegistry) return;

    const audioHash = generateAudioHash(this.serverUrl, song.id);
    const fileSize = audioBuffer.byteLength;

    // Check if audio file already exists in registry
    let audioFile = this.audioRegistry.audioFiles[audioHash];
    
    if (!audioFile) {
      // Save audio file to shared storage
      const buffer = Array.from(new Uint8Array(audioBuffer));
      const result = await electron.saveAudioFile(buffer, audioHash, fileExtension);
      
      // Create new audio file reference
      audioFile = {
        hash: audioHash,
        filePath: result.path,
        fileSize,
        quality,
        format: getFormatFromExtension(fileExtension),
        createdAt: Date.now(),
        refCount: 0,
        users: []
      };
      
      this.audioRegistry.audioFiles[audioHash] = audioFile;
      this.audioRegistry.totalSize += fileSize;
    }

    // Increment ref count and add user
    if (!audioFile.users.includes(this.userId)) {
      audioFile.refCount++;
      audioFile.users.push(this.userId);
    }

    // Add to user's cache index
    const metadata: CachedSongMetadata = {
      songId: song.id,
      title: song.title,
      artist: song.artist || 'Unknown Artist',
      album: song.album || 'Unknown Album',
      albumId: song.albumId || '',
      artistId,
      artistCoverArtId,
      duration: song.duration,
      quality,
      audioHash,
      fileSize, // For stats
      cachedAt: Date.now(),
      lastAccessed: Date.now(),
      coverArtId: song.coverArt
    };

    this.cacheIndex.songs[song.id] = metadata;
    this.cacheIndex.totalSize += fileSize; // Attributed size for this user
    
    await Promise.all([
      this.saveIndex(),
      this.saveRegistry()
    ]);
    
    logger.log('[OfflineCache] Added song to cache:', song.title, `(${formatBytes(fileSize)})`);
  }

  /**
   * Remove song from cache
   */
  async removeFromCache(songId: string): Promise<void> {
    if (!this.cacheIndex || !this.audioRegistry) return;

    const metadata = this.cacheIndex.songs[songId];
    if (!metadata) return;

    // Decrement ref count in registry
    const audioFile = this.audioRegistry.audioFiles[metadata.audioHash];
    if (audioFile) {
      audioFile.refCount--;
      audioFile.users = audioFile.users.filter(u => u !== this.userId);

      // Delete audio file if no more references
      if (audioFile.refCount <= 0) {
        await electron.deleteAudioDir(metadata.audioHash);
        delete this.audioRegistry.audioFiles[metadata.audioHash];
        this.audioRegistry.totalSize -= audioFile.fileSize;
        logger.log('[OfflineCache] Deleted shared audio file:', metadata.audioHash);
      }
    }

    // Handle cover art ref counting
    if (metadata.coverArtHash) {
      const coverArtFile = this.audioRegistry.coverArtFiles[metadata.coverArtHash];
      if (coverArtFile) {
        coverArtFile.refCount--;
        coverArtFile.users = coverArtFile.users.filter(u => u !== this.userId);

        if (coverArtFile.refCount <= 0) {
          delete this.audioRegistry.coverArtFiles[metadata.coverArtHash];
          logger.log('[OfflineCache] Deleted shared cover art:', metadata.coverArtHash);
        }
      }
    }

    // Remove from user's index
    this.cacheIndex.totalSize -= metadata.fileSize;
    delete this.cacheIndex.songs[songId];

    await Promise.all([
      this.saveIndex(),
      this.saveRegistry()
    ]);

    logger.log('[OfflineCache] Removed song from cache:', songId);
  }

  /**
   * Remove all songs from an album
   */
  async removeAlbumFromCache(albumId: string): Promise<void> {
    if (!this.cacheIndex) return;

    const songsToRemove = Object.values(this.cacheIndex.songs)
      .filter(song => song.albumId === albumId)
      .map(song => song.songId);

    for (const songId of songsToRemove) {
      await this.removeFromCache(songId);
    }

    logger.log('[OfflineCache] Removed album from cache:', albumId);
  }

  /**
   * Get list of cached albums for this user
   */
  getCachedAlbums(): Array<{ albumId: string; albumName: string; artistName: string; songCount: number }> {
    if (!this.cacheIndex) return [];

    const albums = new Map<string, { albumName: string; artistName: string; songCount: number }>();

    Object.values(this.cacheIndex.songs).forEach(song => {
      if (!albums.has(song.albumId)) {
        albums.set(song.albumId, {
          albumName: song.album,
          artistName: song.artist,
          songCount: 0
        });
      }
      const album = albums.get(song.albumId);
      if (album) album.songCount++;
    });

    return Array.from(albums.entries()).map(([albumId, data]) => ({
      albumId,
      ...data
    }));
  }

  /**
   * Get cache statistics for this user
   */
  getCacheStats(): CacheStats {
    if (!this.cacheIndex) {
      return {
        totalSongs: 0,
        totalSize: 0,
        totalSizeFormatted: '0 Bytes',
        albumCount: 0,
        oldestCache: 0,
        newestCache: 0
      };
    }

    const songs = Object.values(this.cacheIndex.songs);
    const albums = new Set(songs.map(s => s.albumId));

    let oldest = Date.now();
    let newest = 0;

    songs.forEach(song => {
      if (song.cachedAt < oldest) oldest = song.cachedAt;
      if (song.cachedAt > newest) newest = song.cachedAt;
    });

    return {
      totalSongs: songs.length,
      totalSize: this.cacheIndex.totalSize,
      totalSizeFormatted: formatBytes(this.cacheIndex.totalSize),
      albumCount: albums.size,
      oldestCache: songs.length > 0 ? oldest : 0,
      newestCache: songs.length > 0 ? newest : 0
    };
  }

  /**
   * Get total shared cache size (all users)
   */
  getTotalSharedCacheSize(): number {
    return this.audioRegistry?.totalSize || 0;
  }

  /**
   * Check if cache size exceeds warning threshold
   */
  shouldWarnCacheSize(): boolean {
    const sizeMB = this.cacheIndex ? this.cacheIndex.totalSize / (1024 * 1024) : 0;
    return sizeMB >= this.config.warnCacheSizeAt;
  }

  /**
   * Clear all cache for this user
   */
  async clearAllCache(): Promise<void> {
    if (!this.cacheIndex) return;

    const songIds = Object.keys(this.cacheIndex.songs);
    
    for (const songId of songIds) {
      await this.removeFromCache(songId);
    }

    logger.log('[OfflineCache] Cleared all cache for user');
  }

  /**
   * Save configuration
   */
  saveConfig(config: Partial<OfflineModeConfig>): void {
    this.config = { ...this.config, ...config };
    localStorage.setItem('offlineModeConfig', JSON.stringify(this.config));
    logger.log('[OfflineCache] Config saved');
  }

  /**
   * Load configuration
   */
  private loadConfig(): void {
    const savedConfig = localStorage.getItem('offlineModeConfig');
    if (savedConfig) {
      try {
        this.config = { ...this.config, ...JSON.parse(savedConfig) };
        logger.log('[OfflineCache] Config loaded');
      } catch (error) {
        logger.error('[OfflineCache] Failed to load config:', error);
      }
    }
  }

  /**
   * Get configuration
   */
  getConfig(): OfflineModeConfig {
    return { ...this.config };
  }

  /**
   * Get cache index (for debugging)
   */
  getCacheIndex(): any {
    // Defensive: ensure songs object always exists
    if (this.cacheIndex && !this.cacheIndex.songs) {
      this.cacheIndex.songs = {};
    }
    return this.cacheIndex;
  }

  /**
   * Cache cover art with ref counting and aliasing
   */
  async cacheCoverArt(coverArtId: string, imageData: Uint8Array, extension: string = '.jpg'): Promise<string> {
    if (!this.audioRegistry) return '';

    // Check if this coverArtId is already mapped to an existing hash (alias)
    let coverArtHash = this.audioRegistry.coverArtIdMap[coverArtId];
    
    if (coverArtHash) {
      // This ID is already mapped, just increment ref count if needed
      const coverArtFile = this.audioRegistry.coverArtFiles[coverArtHash];
      if (coverArtFile && !coverArtFile.users.includes(this.userId)) {
        coverArtFile.refCount++;
        coverArtFile.users.push(this.userId);
        await this.saveRegistry();
        logger.log('[OfflineCache] Cover art already exists, added user reference:', coverArtId);
      }
      return coverArtHash;
    }

    // Generate hash for this coverArtId
    coverArtHash = generateCoverArtHash(this.serverUrl, coverArtId);

    // Check if cover art file already exists with this hash
    let coverArtFile = this.audioRegistry.coverArtFiles[coverArtHash];

    if (!coverArtFile) {
      // Save cover art to shared storage
      const buffer = Array.from(imageData);
      const result = await electron.saveCoverArtFile(buffer, coverArtHash, extension);

      // Create new cover art reference
      coverArtFile = {
        hash: coverArtHash,
        filePath: result.path,
        fileSize: imageData.byteLength,
        format: getFormatFromExtension(extension),
        createdAt: Date.now(),
        refCount: 0,
        users: [],
        primaryCoverArtId: coverArtId,
        aliases: []
      };

      this.audioRegistry.coverArtFiles[coverArtHash] = coverArtFile;
      logger.log('[OfflineCache] Created new cover art file:', coverArtId, 'hash:', coverArtHash);
    } else {
      // File exists, add this as an alias if not already present
      if (!coverArtFile.aliases.includes(coverArtId) && coverArtFile.primaryCoverArtId !== coverArtId) {
        coverArtFile.aliases.push(coverArtId);
        logger.log('[OfflineCache] Added alias to existing cover art:', coverArtId, '→', coverArtFile.primaryCoverArtId);
      }
    }

    // Add to reverse lookup map
    this.audioRegistry.coverArtIdMap[coverArtId] = coverArtHash;

    // Increment ref count
    if (!coverArtFile.users.includes(this.userId)) {
      coverArtFile.refCount++;
      coverArtFile.users.push(this.userId);
    }
    
    await this.saveRegistry();
    return coverArtHash;
  }

  /**
   * Get cached cover art path
   */
  getCachedCoverArtPath(coverArtId: string): string | null {
    if (!this.audioRegistry) return null;

    // Use reverse lookup to find the hash for this ID
    const coverArtHash = this.audioRegistry.coverArtIdMap[coverArtId];
    if (!coverArtHash) return null;
    
    const coverArtFile = this.audioRegistry.coverArtFiles[coverArtHash];
    return coverArtFile ? coverArtFile.filePath : null;
  }

  /**
   * Check if cover art is cached
   */
  isCoverArtCached(coverArtId: string): boolean {
    if (!this.audioRegistry) return false;
    
    // Use reverse lookup to check if this ID has been cached
    return !!this.audioRegistry.coverArtIdMap[coverArtId];
  }

  /**
   * Create cover art alias (for songs with different IDs, same art)
   */
  async createCoverArtAlias(aliasCoverArtId: string, primaryCoverArtId: string): Promise<void> {
    if (!this.audioRegistry) return;
    
    // Check if alias already exists
    if (this.audioRegistry.coverArtIdMap[aliasCoverArtId]) {
      logger.log('[OfflineCache] Alias already exists:', aliasCoverArtId);
      return;
    }
    
    // Find the primary cover art's hash
    const primaryHash = this.audioRegistry.coverArtIdMap[primaryCoverArtId];
    if (!primaryHash) {
      logger.warn('[OfflineCache] Primary cover art not found:', primaryCoverArtId);
      return;
    }
    
    const coverArtFile = this.audioRegistry.coverArtFiles[primaryHash];
    if (!coverArtFile) {
      logger.warn('[OfflineCache] Cover art file not found for hash:', primaryHash);
      return;
    }
    
    // Add alias
    if (!coverArtFile.aliases.includes(aliasCoverArtId)) {
      coverArtFile.aliases.push(aliasCoverArtId);
    }
    
    // Add to reverse lookup map
    this.audioRegistry.coverArtIdMap[aliasCoverArtId] = primaryHash;
    
    // Increment ref count if this user doesn't have it yet
    if (!coverArtFile.users.includes(this.userId)) {
      coverArtFile.refCount++;
      coverArtFile.users.push(this.userId);
    }
    
    await this.saveRegistry();
    logger.log('[OfflineCache] Created alias:', aliasCoverArtId, '→', primaryCoverArtId);
  }

  /**
   * Rebuild cover art aliases (v1.0 compatibility, no-op in v2.0)
   */
  async rebuildCoverArtAliases(): Promise<void> {
    logger.log('[OfflineCache] Alias rebuilding not needed in v2.0 (hash-based)');
  }

  /**
   * Add liked song
   */
  async addLikedSong(songId: string): Promise<void> {
    if (!this.userMetadata) return;

    if (!this.userMetadata.likedSongs.includes(songId)) {
      this.userMetadata.likedSongs.push(songId);
      await this.saveUserMetadata();
      logger.log('[OfflineCache] Added liked song:', songId);
    }
  }

  /**
   * Remove liked song
   */
  async removeLikedSong(songId: string): Promise<void> {
    if (!this.userMetadata) return;

    const index = this.userMetadata.likedSongs.indexOf(songId);
    if (index !== -1) {
      this.userMetadata.likedSongs.splice(index, 1);
      await this.saveUserMetadata();
      logger.log('[OfflineCache] Removed liked song:', songId);
    }
  }

  /**
   * Get all liked songs
   */
  getLikedSongs(): string[] {
    return this.userMetadata?.likedSongs || [];
  }

  /**
   * Check if song is liked
   */
  isLiked(songId: string): boolean {
    return this.userMetadata?.likedSongs.includes(songId) || false;
  }

  /**
   * Get cache directory path
   */
  getCacheDir(): string {
    return this.cacheDir;
  }

  /**
   * Format bytes to human-readable (deprecated, use cacheHelpers)
   */
  private formatBytes(bytes: number): string {
    return formatBytes(bytes);
  }
}

// Export singleton instance
export const offlineCacheService = new OfflineCacheService();
