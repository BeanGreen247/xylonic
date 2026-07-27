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

interface CompressedRecord {
  userId: string;
  timestamp: number;
  version: string;
  compressed: ArrayBuffer;
}

class SearchCacheService {
  private dbName = 'XylonicSearchCache';
  private dbVersion = 1;
  private storeName = 'searchIndex';
  private db: IDBDatabase | null = null;
  private userId: string = '';
  private searchIndex: SearchIndex | null = null;
  private cacheMaxAge    = 365 * 24 * 60 * 60 * 1000; // 1 year hard expiry — invalidated by count change
  private cacheRefreshAge = 365 * 24 * 60 * 60 * 1000; // 1 year soft refresh — count-based, not time-based

  private worker: Worker | null = null;
  private pendingSearches = new Map<number, (result: SearchResult3) => void>();
  private searchIdCounter = 0;

  private compress(data: string): Promise<ArrayBuffer> {
    // pipeThrough runs producer + consumer concurrently, avoiding backpressure deadlock on large indices
    const readable = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Response(readable).arrayBuffer();
  }

  private async decompress(data: ArrayBuffer): Promise<string> {
    const readable = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buf = await new Response(readable).arrayBuffer();
    return new TextDecoder().decode(buf);
  }

  private startWorker(): void {
    try {
      this.worker = new Worker(new URL('./searchWorker', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => {
        const { id, artists, albums, songs } = e.data;
        const resolve = this.pendingSearches.get(id);
        if (resolve) {
          this.pendingSearches.delete(id);
          resolve({ artist: artists, album: albums, song: songs });
        }
      };
      this.worker.onerror = (err) => {
        logger.error('[SearchCache] Worker error:', err);
        // Reject all pending searches so callers don't hang
        for (const [id, resolve] of this.pendingSearches) {
          this.pendingSearches.delete(id);
          resolve({ artist: [], album: [], song: [] });
        }
      };
    } catch (err) {
      logger.warn('[SearchCache] Could not start search worker, falling back to main-thread search:', err);
      this.worker = null;
    }
  }

  private sendIndexToWorker(): void {
    if (!this.worker || !this.searchIndex) return;
    this.worker.postMessage({
      type: 'init',
      index: {
        artists: this.searchIndex.artists,
        albums:  this.searchIndex.albums,
        songs:   this.searchIndex.songs,
      },
    });
  }

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
        this.startWorker();
        this.loadSearchIndex().then(() => resolve()).catch(() => resolve());
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
        const result = request.result as (CompressedRecord & Partial<SearchIndex>) | undefined;

        if (!result) {
          logger.log('[SearchCache] INFO: No cached index found');
          resolve();
          return;
        }

        if (result.compressed instanceof ArrayBuffer) {
          // v2.0 compressed record
          this.decompress(result.compressed)
            .then(json => {
              const { artists, albums, songs } = JSON.parse(json) as { artists: Artist[]; albums: Album[]; songs: SearchResultSong[] };
              const age = Date.now() - result.timestamp;
              if (age > this.cacheMaxAge) {
                logger.log('[SearchCache] Compressed cache too old, will rebuild');
                resolve();
                return;
              }
              this.searchIndex = { artists, albums, songs, timestamp: result.timestamp, userId: result.userId, version: result.version };
              this.sendIndexToWorker();
              const ageMin = Math.round(age / 60000);
              logger.log(`[SearchCache] Loaded compressed index (${ageMin} min old): ${artists.length} artists, ${albums.length} albums, ${songs.length} songs`);
              resolve();
            })
            .catch(err => {
              logger.warn('[SearchCache] Decompression failed, will rebuild on next search:', err);
              resolve();
            });
          return;
        }

        // Legacy v1.0 uncompressed record — treat as missing; next updateSearchIndex writes v2.0
        logger.log('[SearchCache] Legacy uncompressed index found; will rebuild on next search');
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

    const timestamp = Date.now();

    // Compress BEFORE opening the IDB transaction — async work must not straddle an open transaction
    let record: CompressedRecord | SearchIndex;
    try {
      const json = JSON.stringify({ artists, albums, songs });
      const compressed = await this.compress(json);
      record = { userId: this.userId, timestamp, version: '2.0', compressed };
    } catch (err) {
      logger.warn('[SearchCache] Compression unavailable, storing uncompressed:', err);
      record = { artists, albums, songs, timestamp, userId: this.userId, version: '1.0' };
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(record);

      request.onsuccess = () => {
        this.searchIndex = { artists, albums, songs, timestamp, userId: this.userId, version: record.version };
        this.sendIndexToWorker();
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
   * Search the cached index. Offloads filter passes to a Web Worker when available;
   * falls back to synchronous main-thread search if the worker failed to start.
   */
  search(query: string): Promise<SearchResult3 | null> {
    if (!this.searchIndex) {
      logger.log('[SearchCache] WARNING: No cached index available for search');
      return Promise.resolve(null);
    }

    const normalizedQuery = query.toLowerCase().trim();
    if (!normalizedQuery) {
      return Promise.resolve({ artist: [], album: [], song: [] });
    }

    if (this.worker) {
      const id = this.searchIdCounter++;
      return new Promise<SearchResult3>((resolve) => {
        this.pendingSearches.set(id, resolve);
        this.worker!.postMessage({ type: 'search', id, query: normalizedQuery });
      });
    }

    // Main-thread fallback (worker unavailable)
    logger.log(`[SearchCache] Searching on main thread for: "${query}"`);
    const idx = this.searchIndex;
    const artists = idx.artists.filter(a => a.name.toLowerCase().includes(normalizedQuery)).slice(0, 20);
    const albums  = idx.albums.filter(a =>
      a.name.toLowerCase().includes(normalizedQuery) ||
      (a.artist && a.artist.toLowerCase().includes(normalizedQuery))
    ).slice(0, 20);
    const songs   = idx.songs.filter(s =>
      s.title.toLowerCase().includes(normalizedQuery) ||
      s.artist.toLowerCase().includes(normalizedQuery) ||
      s.album.toLowerCase().includes(normalizedQuery)
    ).slice(0, 50);
    return Promise.resolve({ artist: artists, album: albums, song: songs });
  }

  /**
   * Check if index is available (within 1-year hard expiry; refresh is count-driven, not time-driven)
   */
  hasValidIndex(): boolean {
    return this.searchIndex !== null;
  }

  /**
   * True only when no index exists at all (first run / cleared cache).
   * Refresh is otherwise driven by server count changes, not time.
   */
  needsRefresh(): boolean {
    return this.searchIndex === null;
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
   * Returns the serialized byte size of the in-memory search index.
   * Uses Blob for accurate UTF-8 byte count.
   */
  getIndexSizeBytes(): number {
    if (!this.searchIndex) return 0;
    try {
      return new Blob([JSON.stringify(this.searchIndex)]).size;
    } catch {
      return 0;
    }
  }

  /**
   * Get the raw search index (albums + songs needed for coverArt alias map)
   */
  getIndex(): SearchIndex | null {
    return this.searchIndex;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingSearches.clear();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.searchIndex = null;
  }
}

// Export singleton instance
export const searchCacheService = new SearchCacheService();
