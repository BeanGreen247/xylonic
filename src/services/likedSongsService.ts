/**
 * Service for managing liked/favorited songs via Subsonic API
 */

import { getStarred, starSong, unstarSong } from './subsonicApi';
import { offlineCacheService } from './offlineCacheService';

export interface LikedSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  starred?: string; // ISO 8601 timestamp from server
}

interface PendingChange {
  songId: string;
  action: 'star' | 'unstar';
  timestamp: number;
}

// Cache starred song IDs in memory for quick checks
let starredSongIds: Set<string> = new Set();
let lastFetchTime = 0;
const CACHE_DURATION = 60000; // 1 minute cache

// Track pending changes made while offline
let pendingChanges: PendingChange[] = [];

/**
 * Check if offline mode is enabled
 */
const isOfflineMode = (): boolean => {
  const offlineModeConfig = localStorage.getItem('offlineModeConfig');
  if (offlineModeConfig) {
    try {
      const config = JSON.parse(offlineModeConfig);
      return config.enabled === true;
    } catch (e) {
      return false;
    }
  }
  return false;
};

/**
 * Get credentials from localStorage
 */
const getCredentials = () => {
  const serverUrl = localStorage.getItem('serverUrl');
  const username = localStorage.getItem('username');
  const password = localStorage.getItem('password');
  
  if (!serverUrl || !username || !password) {
    console.error('[LikedSongs] Missing credentials');
    return null;
  }
  
  return { serverUrl, username, password };
};

/**
 * Fetch starred songs from server and update cache
 */
const fetchStarredSongs = async (): Promise<void> => {
  const credentials = getCredentials();
  if (!credentials) return;
  
  // Check if offline mode is enabled
  if (isOfflineMode()) {
    console.log('[LikedSongs] Offline mode - loading from cache only');
    try {
      const cachedLikedSongs = offlineCacheService.getLikedSongs();
      starredSongIds = new Set(cachedLikedSongs);
      console.log('[LikedSongs] Loaded from offline cache:', starredSongIds.size);
    } catch (cacheError) {
      console.log('[LikedSongs] Cache not available');
    }
    return;
  }
  
  try {
    const response = await getStarred(credentials.serverUrl, credentials.username, credentials.password);
    const starred = response.data['subsonic-response']?.starred2;
    
    starredSongIds.clear();
    
    if (starred?.song) {
      starred.song.forEach((song: any) => {
        starredSongIds.add(song.id);
      });
    }
    
    // Sync with offline cache (only if initialized)
    try {
      const cachedLikedSongs = offlineCacheService.getLikedSongs();
      
      // Sync server state to cache
      for (const songId of starredSongIds) {
        if (!cachedLikedSongs.includes(songId)) {
          await offlineCacheService.addLikedSong(songId);
        }
      }
      
      // Remove songs from cache that are no longer starred on server
      for (const songId of cachedLikedSongs) {
        if (!starredSongIds.has(songId)) {
          await offlineCacheService.removeLikedSong(songId);
        }
      }
    } catch (cacheError) {
      // Cache not initialized yet, skip sync
      console.log('[LikedSongs] Cache not initialized, skipping sync');
    }
    
    lastFetchTime = Date.now();
    console.log('[LikedSongs] Fetched starred songs from server. Total:', starredSongIds.size);
  } catch (error) {
    console.error('[LikedSongs] Failed to fetch starred songs:', error);
    // If fetch failed, try to load from cache
    try {
      const cachedLikedSongs = offlineCacheService.getLikedSongs();
      starredSongIds = new Set(cachedLikedSongs);
      console.log('[LikedSongs] Loaded from offline cache:', starredSongIds.size);
    } catch (cacheError) {
      console.log('[LikedSongs] Cache not available');
    }
  }
};

/**
 * Get all liked songs from server
 */
export const getLikedSongs = async (): Promise<LikedSong[]> => {
  const credentials = getCredentials();
  if (!credentials) return [];
  
  try {
    const response = await getStarred(credentials.serverUrl, credentials.username, credentials.password);
    const starred = response.data['subsonic-response']?.starred2;
    
    if (starred?.song) {
      const songs = starred.song.map((song: any) => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        starred: song.starred
      }));
      console.log('[LikedSongs] Retrieved from server:', songs.length, 'songs');
      return songs;
    }
    
    return [];
  } catch (error) {
    console.error('[LikedSongs] Failed to load liked songs:', error);
    return [];
  }
};

/**
 * Check if a song is liked (uses cache with auto-refresh)
 */
export const isSongLiked = async (songId: string): Promise<boolean> => {
  // In offline mode, always use cache
  if (isOfflineMode()) {
    try {
      const cachedLikedSongs = offlineCacheService.getLikedSongs();
      starredSongIds = new Set(cachedLikedSongs);
    } catch (e) {
      // Cache not available
    }
    return starredSongIds.has(songId);
  }
  
  // Refresh cache if expired
  if (Date.now() - lastFetchTime > CACHE_DURATION) {
    await fetchStarredSongs();
  }
  
  return starredSongIds.has(songId);
};

/**
 * Add a song to liked songs (star on server)
 */
export const likeSong = async (song: { id: string; title: string; artist: string; album: string }): Promise<void> => {
  const credentials = getCredentials();
  if (!credentials) return;
  
  // Always update local cache first
  starredSongIds.add(song.id);
  try {
    await offlineCacheService.addLikedSong(song.id);
  } catch (cacheError) {
    console.log('[LikedSongs] Cache not initialized');
  }
  
  // Check if offline mode is enabled
  if (isOfflineMode()) {
    console.log(`[LikedSongs] Offline mode - queuing star for "${song.title}" (${song.id})`);
    // Add to pending changes queue
    pendingChanges.push({
      songId: song.id,
      action: 'star',
      timestamp: Date.now()
    });
    // Save to localStorage for persistence
    localStorage.setItem('likedSongsPendingChanges', JSON.stringify(pendingChanges));
    return;
  }
  
  try {
    await starSong(credentials.serverUrl, credentials.username, credentials.password, song.id);
    console.log(`[LikedSongs] Starred song "${song.title}" (${song.id}) on server`);
  } catch (error) {
    console.error('[LikedSongs] Failed to star song on server:', error);
    // Add to pending changes for retry
    pendingChanges.push({
      songId: song.id,
      action: 'star',
      timestamp: Date.now()
    });
    localStorage.setItem('likedSongsPendingChanges', JSON.stringify(pendingChanges));
  }
};

/**
 * Remove a song from liked songs (unstar on server)
 */
export const unlikeSong = async (songId: string): Promise<void> => {
  const credentials = getCredentials();
  if (!credentials) return;
  
  // Always update local cache first
  starredSongIds.delete(songId);
  try {
    await offlineCacheService.removeLikedSong(songId);
  } catch (cacheError) {
    console.log('[LikedSongs] Cache not initialized');
  }
  
  // Check if offline mode is enabled
  if (isOfflineMode()) {
    console.log(`[LikedSongs] Offline mode - queuing unstar for ${songId}`);
    // Add to pending changes queue
    pendingChanges.push({
      songId: songId,
      action: 'unstar',
      timestamp: Date.now()
    });
    // Save to localStorage for persistence
    localStorage.setItem('likedSongsPendingChanges', JSON.stringify(pendingChanges));
    return;
  }
  
  try {
    await unstarSong(credentials.serverUrl, credentials.username, credentials.password, songId);
    console.log(`[LikedSongs] Unstarred song ${songId} on server`);
  } catch (error) {
    console.error('[LikedSongs] Failed to unstar song on server:', error);
    // Add to pending changes for retry
    pendingChanges.push({
      songId: songId,
      action: 'unstar',
      timestamp: Date.now()
    });
    localStorage.setItem('likedSongsPendingChanges', JSON.stringify(pendingChanges));
  }
};

/**
 * Toggle like status for a song
 */
export const toggleLike = async (song: { id: string; title: string; artist: string; album: string }): Promise<boolean> => {
  const isCurrentlyLiked = await isSongLiked(song.id);
  
  if (isCurrentlyLiked) {
    await unlikeSong(song.id);
    return false;
  } else {
    await likeSong(song);
    return true;
  }
};

/**
 * Initialize cache on app start
 */
export const initializeStarredCache = async (): Promise<void> => {
  // Load pending changes from localStorage
  const savedPendingChanges = localStorage.getItem('likedSongsPendingChanges');
  if (savedPendingChanges) {
    try {
      pendingChanges = JSON.parse(savedPendingChanges);
      console.log('[LikedSongs] Loaded', pendingChanges.length, 'pending changes from storage');
    } catch (e) {
      console.error('[LikedSongs] Failed to load pending changes:', e);
      pendingChanges = [];
    }
  }
  
  await fetchStarredSongs();
};

/**
 * Sync pending changes to server
 * Call this when switching from offline to online mode
 */
export const syncPendingChanges = async (): Promise<{ synced: number; failed: number }> => {
  if (pendingChanges.length === 0) {
    console.log('[LikedSongs] No pending changes to sync');
    return { synced: 0, failed: 0 };
  }
  
  const credentials = getCredentials();
  if (!credentials) {
    return { synced: 0, failed: 0 };
  }
  
  console.log('[LikedSongs] Syncing', pendingChanges.length, 'pending changes to server');
  
  let synced = 0;
  let failed = 0;
  const failedChanges: PendingChange[] = [];
  
  // Process each pending change
  for (const change of pendingChanges) {
    try {
      if (change.action === 'star') {
        await starSong(credentials.serverUrl, credentials.username, credentials.password, change.songId);
        console.log('[LikedSongs] Synced star:', change.songId);
      } else {
        await unstarSong(credentials.serverUrl, credentials.username, credentials.password, change.songId);
        console.log('[LikedSongs] Synced unstar:', change.songId);
      }
      synced++;
    } catch (error) {
      console.error('[LikedSongs] Failed to sync change:', change, error);
      failedChanges.push(change);
      failed++;
    }
  }
  
  // Update pending changes (keep only failed ones)
  pendingChanges = failedChanges;
  if (pendingChanges.length > 0) {
    localStorage.setItem('likedSongsPendingChanges', JSON.stringify(pendingChanges));
  } else {
    localStorage.removeItem('likedSongsPendingChanges');
  }
  
  console.log(`[LikedSongs] Sync complete: ${synced} synced, ${failed} failed`);
  
  // Refresh from server to ensure consistency
  await fetchStarredSongs();
  
  return { synced, failed };
};

/**
 * Get count of pending changes
 */
export const getPendingChangesCount = (): number => {
  return pendingChanges.length;
};

/**
 * Get all starred songs (returns full song objects with metadata)
 */
export const getStarredSongsDetailed = async (): Promise<LikedSong[]> => {
  const credentials = getCredentials();
  if (!credentials) return [];
  
  try {
    const response = await getStarred(credentials.serverUrl, credentials.username, credentials.password);
    
    const starred = response.data['subsonic-response'];
    if (starred.status !== 'ok' || !starred.starred) {
      return [];
    }
    
    const songs = starred.starred.song || [];
    return songs.map((song: any) => ({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      starred: song.starred
    }));
  } catch (error) {
    console.error('[LikedSongs] Failed to fetch starred songs:', error);
    return [];
  }
};

/**
 * Check if any song in a list is starred
 */
export const getStarredStatusForSongs = async (songIds: string[]): Promise<Map<string, boolean>> => {
  // Ensure cache is fresh
  if (Date.now() - lastFetchTime > CACHE_DURATION) {
    await fetchStarredSongs();
  }
  
  const statusMap = new Map<string, boolean>();
  songIds.forEach(id => {
    statusMap.set(id, starredSongIds.has(id));
  });
  
  return statusMap;
};

/**
 * Clear starred songs cache (for logout)
 */
export const clearStarredCache = (): void => {
  starredSongIds.clear();
  lastFetchTime = 0;
  pendingChanges = [];
  localStorage.removeItem('likedSongsPendingChanges');
  console.log('[LikedSongs] Cleared cache and pending changes');
};

/**
 * Get cache stats for debugging
 */
export const getStarredCacheStats = () => {
  return {
    cachedCount: starredSongIds.size,
    cacheAge: Date.now() - lastFetchTime,
    cacheExpired: Date.now() - lastFetchTime > CACHE_DURATION,
    pendingChanges: pendingChanges.length
  };
};
