/**
 * Cache Helper Utilities
 * Functions for hash-based cache management
 */

import md5 from 'md5';
import { AudioHash, CoverArtHash } from '../types/offline';

/**
 * Normalize server URL for consistent hashing
 * Ensures URLs like "http://server:4533" and "http://server:4533/" produce the same hash
 */
const normalizeServerUrl = (serverUrl: string): string => {
  try {
    const url = new URL(serverUrl);
    // Use protocol + hostname + port (if non-standard)
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return `${url.protocol}//${url.hostname}:${port}`;
  } catch {
    // Fallback: just trim and remove trailing slash
    return serverUrl.trim().replace(/\/+$/, '');
  }
};

/**
 * Generate audio hash from server URL and song ID
 * This ensures the same song from the same server always gets the same hash
 */
export const generateAudioHash = (serverUrl: string, songId: string): AudioHash => {
  const normalized = `${normalizeServerUrl(serverUrl)}:${songId.trim()}`;
  return md5(normalized);
};

/**
 * Generate cover art hash from server URL and cover art ID
 */
export const generateCoverArtHash = (serverUrl: string, coverArtId: string): CoverArtHash => {
  const normalized = `${normalizeServerUrl(serverUrl)}:coverart:${coverArtId.trim()}`;
  return md5(normalized);
};

/**
 * Generate user ID from username and server URL
 * Format: username@serverhost:port
 */
export const generateUserId = (username: string, serverUrl: string): string => {
  try {
    const url = new URL(serverUrl);
    const host = url.hostname;
    const port = url.port;
    const hostWithPort = port ? `${host}:${port}` : host;
    return `${username}@${hostWithPort}`;
  } catch {
    // Fallback if URL parsing fails
    const sanitized = serverUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `${username}@${sanitized}`;
  }
};

/**
 * Sanitize user ID for filesystem use (Windows doesn't allow colons in paths)
 * Converts: "kenny@100.74.4.30:4533" → "kenny@100.74.4.30-4533"
 */
export const sanitizeUserIdForFilesystem = (userId: string): string => {
  return userId.replace(/:/g, '-');
};

/**
 * Get file extension from content type or filename
 */
export const getFileExtension = (contentTypeOrFilename: string): string => {
  // Handle content-type
  if (contentTypeOrFilename.includes('/')) {
    const mimeType = contentTypeOrFilename.toLowerCase();
    if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return '.mp3';
    if (mimeType.includes('ogg')) return '.ogg';
    if (mimeType.includes('flac')) return '.flac';
    if (mimeType.includes('m4a') || mimeType.includes('mp4')) return '.m4a';
    if (mimeType.includes('wav')) return '.wav';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
    if (mimeType.includes('png')) return '.png';
    if (mimeType.includes('webp')) return '.webp';
    return '.mp3'; // Default for audio
  }
  
  // Handle filename
  const parts = contentTypeOrFilename.split('.');
  if (parts.length > 1) {
    return `.${parts[parts.length - 1]}`;
  }
  
  return '.mp3'; // Default
};

/**
 * Format bytes to human-readable size
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Get format from extension
 */
export const getFormatFromExtension = (extension: string): string => {
  return extension.replace('.', '').toLowerCase();
};
