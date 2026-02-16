/**
 * Offline Mode & Download Manager Types
 */

import { Song } from './index';

/**
 * Audio quality options for downloads
 */
export type DownloadQuality = 
  | 'original'  // Raw/original quality from server
  | '320'       // 320 kbps MP3
  | '256'       // 256 kbps MP3
  | '128'       // 128 kbps MP3
  | '64';       // 64 kbps MP3

/**
 * Download queue item status
 */
export type DownloadStatus = 
  | 'pending'     // Waiting in queue
  | 'downloading' // Currently downloading
  | 'completed'   // Successfully downloaded
  | 'failed'      // Download failed
  | 'paused';     // Download paused by user

/**
 * Single song download queue item
 */
export interface DownloadQueueItem {
  id: string;                    // Unique queue item ID
  song: DownloadableSong;        // Song to download
  albumId: string;               // Album ID for grouping
  albumName: string;             // Album name for display
  artistName: string;            // Artist name for display
  artistId?: string;             // Artist ID
  artistCoverArtId?: string;     // Artist cover art ID
  quality: DownloadQuality;      // Selected quality
  status: DownloadStatus;        // Current status
  progress: number;              // 0-100 download progress
  error?: string;                // Error message if failed
  retryCount: number;            // Number of retry attempts
  addedAt: number;               // Timestamp when added to queue
  startedAt?: number;            // Timestamp when download started
  completedAt?: number;          // Timestamp when completed
}

/**
 * Simplified song info for downloads (URL not needed)
 */
export interface DownloadableSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration?: number;
  coverArt?: string;
  albumId?: string;
}

/**
 * Album download request
 */
export interface AlbumDownloadRequest {
  albumId: string;
  albumName: string;
  artistName: string;
  artistId?: string;
  artistCoverArtId?: string;
  songs: DownloadableSong[];
  quality: DownloadQuality;
}

/**
 * Content hash for audio files (deterministic across users)
 */
export type AudioHash = string; // md5(serverUrl:songId)
export type CoverArtHash = string; // md5(serverUrl:coverArtId)

/**
 * Audio file reference in shared storage
 */
export interface AudioFileReference {
  hash: AudioHash;               // Content hash (deterministic)
  filePath: string;              // Relative path: audio/{hash}/audio.ext
  fileSize: number;              // File size in bytes
  quality: DownloadQuality;      // Quality level
  format: string;                // File format (mp3, flac, etc)
  createdAt: number;             // First download timestamp
  refCount: number;              // How many users reference this
  users: string[];               // List of userIds who cached this
}

/**
 * Cover art file reference in shared storage
 */
export interface CoverArtFileReference {
  hash: CoverArtHash;            // Content hash
  filePath: string;              // Relative path: audio/{hash}/cover.jpg
  fileSize: number;              // File size in bytes
  format: string;                // Image format (jpg, png)
  createdAt: number;             // First download timestamp
  refCount: number;              // How many users reference this
  users: string[];               // List of userIds who use this
  primaryCoverArtId: string;     // Primary coverArtId (first one downloaded)
  aliases: string[];             // Alternative coverArtIds that point to this same file
}

/**
 * User-specific song metadata (stored in user's cache_index.json)
 */
export interface CachedSongMetadata {
  songId: string;                // Subsonic song ID
  title: string;                 // Song title
  artist: string;                // Artist name
  album: string;                 // Album name
  albumId: string;               // Album ID
  artistId?: string;             // Artist ID
  artistCoverArtId?: string;     // Artist cover art ID
  duration?: number;             // Duration in seconds
  quality: DownloadQuality;      // Cached quality
  audioHash: AudioHash;          // Reference to shared audio file
  fileSize: number;              // File size (cached for stats)
  cachedAt: number;              // Timestamp when cached by this user
  lastAccessed: number;          // Last time this user played it
  coverArtId?: string;           // Album cover art ID
  coverArtHash?: CoverArtHash;   // Reference to shared cover art
}

/**
 * User-specific cache index (stored in users/{userId}/cache_index.json)
 */
export interface CacheIndex {
  version: string;               // Cache index format version (2.0.0)
  userId: string;                // username@server identifier
  username: string;              // Subsonic username
  serverUrl: string;             // Server URL
  songs: Record<string, CachedSongMetadata>; // songId -> metadata
  totalSize: number;             // This user's attributed size
  lastUpdated: number;           // Last index update timestamp
}

/**
 * User metadata (stored in users/{userId}/metadata.json)
 */
export interface UserMetadata {
  userId: string;                // username@server identifier
  likedSongs: string[];          // Array of liked song IDs
  downloadHistory: {             // Download history tracking
    albumId: string;
    downloadedAt: number;
    songCount: number;
  }[];
  preferences: {                 // User preferences
    defaultQuality?: DownloadQuality;
    autoCache?: boolean;
  };
}

/**
 * Global audio file registry (stored in audio/registry.json)
 */
export interface AudioFileRegistry {
  version: string;               // Registry version
  audioFiles: Record<AudioHash, AudioFileReference>;
  coverArtFiles: Record<CoverArtHash, CoverArtFileReference>;
  coverArtIdMap: Record<string, CoverArtHash>; // Quick lookup: coverArtId -> hash
  totalSize: number;             // Total shared storage size
  lastUpdated: number;
}

/**
 * Download progress summary
 */
export interface DownloadProgress {
  totalSongs: number;            // Total songs in queue
  completedSongs: number;        // Successfully downloaded
  failedSongs: number;           // Failed downloads
  pendingSongs: number;          // Waiting in queue
  currentSong?: DownloadQueueItem; // Currently downloading song
  overallProgress: number;       // 0-100 overall progress percentage
  isPaused: boolean;             // Queue paused?
  isDownloading: boolean;        // Any active download?
}

/**
 * Offline mode configuration
 */
export interface OfflineModeConfig {
  enabled: boolean;              // Offline mode enabled?
  preferCache: boolean;          // Always prefer cached songs (offline-first)
  maxCacheSize?: number;         // Max cache size in MB (optional limit)
  warnCacheSizeAt: number;       // Warn at X MB (e.g., 1000 = 1GB)
}

/**
 * Cache statistics
 */
export interface CacheStats {
  totalSongs: number;            // Number of cached songs
  totalSize: number;             // Total size in bytes
  totalSizeFormatted: string;    // Human-readable size (e.g., "1.2 GB")
  albumCount: number;            // Number of albums with cached songs
  oldestCache: number;           // Timestamp of oldest cached song
  newestCache: number;           // Timestamp of newest cached song
}

/**
 * Download manager event types
 */
export type DownloadEventType =
  | 'queue-updated'
  | 'download-started'
  | 'download-progress'
  | 'download-completed'
  | 'download-failed'
  | 'queue-paused'
  | 'queue-resumed'
  | 'cache-updated';

/**
 * Download manager event
 */
export interface DownloadEvent {
  type: DownloadEventType;
  item?: DownloadQueueItem;
  progress?: DownloadProgress;
  error?: string;
}
