/**
 * Search Cache Service
 * Caches music library metadata for fast offline search
 */

import { logger } from '../utils/logger';
import { generateUserId } from '../utils/cacheHelpers';
import { SearchResult3, Artist, Album, SearchResultSong } from '../types/subsonic';

interface SearchIndex {
  artists: Artist[];
  albums: Album[];
  songs: SearchResultSong[];
  timestamp: number;
  userId: string;
  version: string;
}

class SearchCacheService {
  private dbName = 'XylonicSearchCache';
  private dbVersion = 1;
  private storeName = 'searchIndex';
  private db: IDBDatabase | null = null;
  private userId: string = '';
  private searchIndex: SearchIndex | null = null;
  private cacheMaxAge = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Initialize the search cache service
   */
  async initialize(username: string, serverUrl: string): Promise<void> {
    this.userId = generateUserId(username, serverUrl);
    logger.log('[SearchCache] Initializing for user:', this.userId);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        logger.error('[SearchCache] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        logger.log('[SearchCache] Database opened successfully');
        this.loadSearchIndex().then(() => resolve());
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'userId' });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
          logger.log('[SearchCache] Object store created');
        }
      };
    });
  }

  /**
   * Load search index from IndexedDB
   */
  private async loadSearchIndex(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(this.userId);

      request.onsuccess = () => {
        const result = request.result as SearchIndex | undefined;
        
        if (result) {
          const age = Date.now() - result.timestamp;
          if (age <= this.cacheMaxAge) {
            this.searchIndex = result;
            logger.log(`[SearchCache] Loaded cached index (${age / 1000 / 60} minutes old)`);
            logger.log(`[SearchCache] Index contains: ${result.artists.length} artists, ${result.albums.length} albums, ${result.songs.length} songs`);
          } else {
            logger.log('[SearchCache] WARNING: Cached index expired, will refresh');
            this.searchIndex = null;
          }
        } else {
          logger.log('[SearchCache] INFO: No cached index found');
        }
        resolve();
      };

      request.onerror = () => {
        logger.error('[SearchCache] Error loading index:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Update the search index with fresh data
   */
  async updateSearchIndex(artists: Artist[], albums: Album[], songs: SearchResultSong[]): Promise<void> {
    if (!this.db) {
      logger.warn('[SearchCache] Database not initialized');
      return;
    }

    logger.log(`[SearchCache] 📝 Updating index with ${artists.length} artists, ${albums.length} albums, ${songs.length} songs`);

    const searchIndex: SearchIndex = {
      artists,
      albums,
      songs,
      timestamp: Date.now(),
      userId: this.userId,
      version: '1.0'
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(searchIndex);

      request.onsuccess = () => {
        this.searchIndex = searchIndex;
        logger.log('[SearchCache] Search index updated successfully');
        resolve();
      };

      request.onerror = () => {
        logger.error('[SearchCache] ERROR: Error updating index:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Search the cached index
   */
  search(query: string): SearchResult3 | null {
    if (!this.searchIndex) {
      logger.log('[SearchCache] WARNING: No cached index available for search');
      return null;
    }

    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
      return { artist: [], album: [], song: [] };
    }

    logger.log(`[SearchCache] Searching cached index for: "${query}"`);

    // Search artists
    const matchedArtists = this.searchIndex.artists.filter(artist =>
      artist.name.toLowerCase().includes(normalizedQuery)
    ).slice(0, 20); // Limit to 20 results

    // Search albums
    const matchedAlbums = this.searchIndex.albums.filter(album =>
      album.name.toLowerCase().includes(normalizedQuery) ||
      (album.artist && album.artist.toLowerCase().includes(normalizedQuery))
    ).slice(0, 20);

    // Search songs
    const matchedSongs = this.searchIndex.songs.filter(song =>
      song.title.toLowerCase().includes(normalizedQuery) ||
      song.artist.toLowerCase().includes(normalizedQuery) ||
      song.album.toLowerCase().includes(normalizedQuery)
    ).slice(0, 50); // More songs since they're smaller

    logger.log(`[SearchCache] Found: ${matchedArtists.length} artists, ${matchedAlbums.length} albums, ${matchedSongs.length} songs`);

    return {
      artist: matchedArtists,
      album: matchedAlbums,
      song: matchedSongs
    };
  }

  /**
   * Check if index is available and fresh
   */
  hasValidIndex(): boolean {
    if (!this.searchIndex) return false;
    const age = Date.now() - this.searchIndex.timestamp;
    return age <= this.cacheMaxAge;
  }

  /**
   * Get index age in minutes
   */
  getIndexAge(): number | null {
    if (!this.searchIndex) return null;
    return Math.floor((Date.now() - this.searchIndex.timestamp) / 1000 / 60);
  }

  /**
   * Force refresh the index (mark as expired)
   */
  invalidateIndex(): void {
    this.searchIndex = null;
    logger.log('[SearchCache] Index invalidated');
  }

  /**
   * Get the current search index (for comparing counts)
   */
  getSearchIndex(): SearchIndex | null {
    return this.searchIndex;
  }

  /**
   * Clear the entire search cache
   */
  async clearCache(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(this.userId);

      request.onsuccess = () => {
        this.searchIndex = null;
        logger.log('[SearchCache] Cache cleared');
        resolve();
      };

      request.onerror = () => {
        logger.error('[SearchCache] Error clearing cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    if (!this.searchIndex) {
      return { hasCache: false };
    }

    return {
      hasCache: true,
      artistCount: this.searchIndex.artists.length,
      albumCount: this.searchIndex.albums.length,
      songCount: this.searchIndex.songs.length,
      ageMinutes: this.getIndexAge(),
      timestamp: new Date(this.searchIndex.timestamp).toLocaleString()
    };
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.searchIndex = null;
  }
}

// Export singleton instance
export const searchCacheService = new SearchCacheService();
