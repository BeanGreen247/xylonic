/**
 * Image Cache Service
 * Caches cover art images per user to prevent rate limiting and reduce server load
 */

import { logger } from '../utils/logger';
import { generateUserId } from '../utils/cacheHelpers';
import { networkStatsService } from './networkStatsService';
import { searchCacheService } from './searchCacheService';
import { isPerformanceModeEnabled } from './performanceModeService';
import { isPowerSaverEnabled }       from './powerSaverService';
import type { Album, SearchResultSong } from '../types/subsonic';

interface CachedImage {
  url: string;
  blob: Blob;
  timestamp: number;
  coverArtId: string;
  userId: string;
}

interface ImageCacheStats {
  totalImages: number;
  cacheSize: number;
  oldestImage: number | null;
  newestImage: number | null;
}

export interface PerformanceCacheStats {
  totalImages: number;
  cacheSize: number;
  memoryEntries: number;
  memoryHits: number;
  idbHits: number;
  serverFetches: number;
  internetArtFetches: number;
  metadataFetches: number;
  searchIndexSizeBytes: number;
  searchIndexArtists: number;
  searchIndexAlbums: number;
  searchIndexSongs: number;
}

class ImageCacheService {
  private dbName = 'XylonicImageCache';
  private dbVersion = 1;
  private storeName = 'images';
  private db: IDBDatabase | null = null;
  private userId: string = '';
  private memoryCache: Map<string, string> = new Map(); // coverArtId -> blob URL
  private maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year — invalidated by count change, not time
  private maxMemoryCacheSize = 400; // Keep 400 images in memory
  // Evicted blob URLs queued for deferred revocation so any in-flight <img>
  // elements finish loading before the underlying data is freed.
  private pendingRevoke: Array<{ url: string; after: number }> = [];
  private initializationPromise: Promise<void> | null = null;
  private pendingRequests: Map<string, Promise<string>> = new Map(); // in-flight dedup
  private coverArtAliasMap: Map<string, string> = new Map(); // song coverArtId → album coverArtId
  private maxConcurrentFetches = 4;
  private activeFetchCount = 0;
  private fetchQueue: Array<() => void> = [];
  private isCleanedUp = false;
  private rateLimitBackoffUntil = 0;
  private rateLimitConsecutiveHits = 0;
  private readonly RATE_LIMIT_INITIAL_BACKOFF_MS = 2_000;
  private readonly RATE_LIMIT_MAX_BACKOFF_MS = 30_000;

  /**
   * Initialize the image cache service
   */
  async initialize(username: string, serverUrl: string): Promise<void> {
    this.syncWithAppMode();
    const newUserId = generateUserId(username, serverUrl);

    // Reset cleanup state so a re-login after logout works correctly
    this.isCleanedUp = false;
    this.pendingRequests.clear();

    // If already initialized for this user, return immediately
    if (this.db && this.userId === newUserId) {
      console.log('[ImageCache] Already initialized for this user');
      return Promise.resolve();
    }
    
    // If initialization is in progress, return the existing promise
    if (this.initializationPromise) {
      console.log('[ImageCache] Initialization already in progress, waiting...');
      return this.initializationPromise;
    }

    // If switching users, only clear memory cache (keep IndexedDB data for all users)
    if (this.db && this.userId && this.userId !== newUserId) {
      console.log('[ImageCache] Switching from user', this.userId, 'to', newUserId);
      
      // Only clear memory cache (blob URLs in RAM), keep IndexedDB data
      // IndexedDB stores images for ALL users with composite key [userId, coverArtId]
      // Each user's data is isolated by their userId, so they coexist peacefully
      this.memoryCache.forEach((blobUrl) => {
        URL.revokeObjectURL(blobUrl);
      });
      this.memoryCache.clear();
      console.log('[ImageCache] Cleared memory cache for previous user (IndexedDB preserved for all users)');
      
      // Update userId but keep database connection (it's shared across all users)
      this.userId = newUserId;
      console.log('[ImageCache] Switched to new user:', this.userId);
      console.log('[ImageCache] Will now cache/retrieve images for this user from shared IndexedDB');
      return Promise.resolve(); // Database already open, just switched user context
    }

    this.userId = newUserId;
    console.log('[ImageCache] Starting initialization...');
    console.log('[ImageCache] Username:', username);
    console.log('[ImageCache] Server URL:', serverUrl);
    console.log('[ImageCache] User ID:', this.userId);

    this.initializationPromise = new Promise((resolve, reject) => {
      try {
        console.log('[ImageCache] Opening IndexedDB...');
        const request = indexedDB.open(this.dbName, this.dbVersion);

        request.onerror = () => {
          console.error('[ImageCache] ERROR: Failed to open database:', request.error);
          this.initializationPromise = null; // Reset on error
          reject(request.error);
        };

        request.onsuccess = () => {
          console.log('[ImageCache] IndexedDB opened successfully');
          this.db = request.result;
          console.log('[ImageCache] Database ready:', this.dbName);
          console.log('[ImageCache] Store name:', this.storeName);
          console.log('[ImageCache] Initialization COMPLETE');
          this.cleanupOldImages(); // Clean up old images on init
          this.initializationPromise = null; // Clear the promise
          resolve();
        };

        request.onupgradeneeded = (event) => {
          console.log('[ImageCache] 🔧 Upgrading database schema...');
          const db = (event.target as IDBOpenDBRequest).result;
          
          // Create object store if it doesn't exist
          if (!db.objectStoreNames.contains(this.storeName)) {
            const objectStore = db.createObjectStore(this.storeName, { keyPath: ['userId', 'coverArtId'] });
            objectStore.createIndex('userId', 'userId', { unique: false });
            objectStore.createIndex('timestamp', 'timestamp', { unique: false });
            objectStore.createIndex('coverArtId', 'coverArtId', { unique: false });
            console.log('[ImageCache] Object store created:', this.storeName);
          } else {
            console.log('[ImageCache] INFO: Object store already exists');
          }
        };
      } catch (error) {
        console.error('[ImageCache] ERROR: Exception during initialization:', error);
        this.initializationPromise = null; // Reset on error
        reject(error);
      }
    });

    return this.initializationPromise;
  }

  /**
   * Build an in-memory alias map so song-level coverArt IDs resolve to their
   * album's cached blob (e.g. Navidrome uses mf-{id} for songs, al-{id} for albums).
   * Must be called after the search index is available.
   */
  buildAliasMap(albums: Album[], songs: SearchResultSong[]): void {
    const albumCoverArtById = new Map<string, string>();
    for (const album of albums) {
      if (album.id && album.coverArt) albumCoverArtById.set(album.id, album.coverArt);
    }

    const cachedAlbumArtIds = new Set(albumCoverArtById.values());
    this.coverArtAliasMap.clear();

    for (const song of songs) {
      if (!song.coverArt || cachedAlbumArtIds.has(song.coverArt)) continue;
      const albumCoverArt = albumCoverArtById.get(song.albumId);
      if (albumCoverArt) this.coverArtAliasMap.set(song.coverArt, albumCoverArt);
    }

    logger.log(`[ImageCache] Built coverArt alias map: ${this.coverArtAliasMap.size} song IDs → album IDs`);
  }

  /**
   * Get cached image or fetch from server.
   * Deduplicates concurrent requests for the same ID and resolves song-level
   * coverArt IDs to their album's cached blob via the alias map.
   */
  async getImage(coverArtId: string, serverFetchFn: () => string): Promise<string> {
    if (!this.db) {
      console.warn('[ImageCache] WARNING: Database not initialized, using server fetch');
      return serverFetchFn();
    }

    // Check memory cache first (by requested ID) — promote to MRU on hit
    const memoryCached = this.memoryCache.get(coverArtId);
    if (memoryCached) {
      this.memoryCache.delete(coverArtId);
      this.memoryCache.set(coverArtId, memoryCached);
      networkStatsService.recordImageMemoryHit();
      return memoryCached;
    }

    // Resolve alias: song coverArtId → album coverArtId
    const effectiveId = this.coverArtAliasMap.get(coverArtId) ?? coverArtId;

    // Check memory cache by effective ID (avoids duplicate IDB read) — promote on hit
    if (effectiveId !== coverArtId) {
      const aliasMemoryCached = this.memoryCache.get(effectiveId);
      if (aliasMemoryCached) {
        this.memoryCache.delete(effectiveId);
        this.memoryCache.set(effectiveId, aliasMemoryCached);
        networkStatsService.recordImageMemoryHit();
        this.addToMemoryCache(coverArtId, aliasMemoryCached);
        return aliasMemoryCached;
      }
    }

    // Deduplicate: if a request for this effective ID is already in-flight, reuse it
    const existing = this.pendingRequests.get(effectiveId);
    if (existing) {
      return existing.then(url => {
        // Also cache under the original ID in memory for fast future access
        if (url && coverArtId !== effectiveId) this.addToMemoryCache(coverArtId, url);
        return url;
      });
    }

    const promise = this._resolveImage(effectiveId, coverArtId, serverFetchFn);
    this.pendingRequests.set(effectiveId, promise);
    try {
      return await promise;
    } finally {
      this.pendingRequests.delete(effectiveId);
    }
  }

  private async _resolveImage(
    effectiveId: string,
    requestedId: string,
    serverFetchFn: () => string
  ): Promise<string> {
    try {
      const cached = await this.getCachedImage(effectiveId);
      if (cached) {
        networkStatsService.recordImageDiskHit();
        const blobUrl = URL.createObjectURL(cached.blob);
        this.addToMemoryCache(effectiveId, blobUrl);
        if (requestedId !== effectiveId) this.addToMemoryCache(requestedId, blobUrl);
        return blobUrl;
      }
    } catch (error) {
      console.error('[ImageCache] ERROR: Error reading from cache:', error);
    }

    // Not in any cache — fetch through the throttled queue so we never fire
    // more than maxConcurrentFetches requests to the server simultaneously.
    // Awaiting here means the caller waits for the blob URL (or server URL
    // fallback) rather than getting the server URL immediately and having
    // both the <img> element AND this background fetch hit the server at once.
    networkStatsService.recordImageSubsonicFetch();
    const serverUrl = serverFetchFn();
    const result = await this.fetchAndCacheQueued(effectiveId, serverUrl);
    // Guard: don't cache an empty string (returned when server was rate-limited)
    if (result && requestedId !== effectiveId) this.addToMemoryCache(requestedId, result);
    return result;
  }

  /**
   * Batch-write multiple blobs to IDB in a single transaction.
   * Cuts thousands of per-image transactions down to ~40 during bulk preload.
   */
  async cacheImagesBatch(
    entries: Array<{ coverArtId: string; url: string; blob: Blob }>
  ): Promise<void> {
    if (!this.db || entries.length === 0) return;
    const now = Date.now();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([this.storeName], 'readwrite');
      const store = tx.objectStore(this.storeName);
      for (const { coverArtId, url, blob } of entries) {
        store.put({ url, blob, timestamp: now, coverArtId, userId: this.userId });
      }
      tx.oncomplete = () => resolve();
      tx.onerror   = () => reject(tx.error);
      tx.onabort   = () => reject(tx.error);
    });
  }

  /**
   * Directly cache an image blob (for pre-caching)
   * @param skipMemoryCache - Set to true during bulk preload to prevent memory exhaustion
   */
  async cacheImageDirect(coverArtId: string, url: string, blob: Blob, skipMemoryCache: boolean = false): Promise<void> {
    try {
      await this.cacheImage(coverArtId, url, blob);
      
      // Only add to memory cache if requested (skip during bulk preload to prevent blob URL exhaustion)
      if (!skipMemoryCache) {
        const blobUrl = URL.createObjectURL(blob);
        this.addToMemoryCache(coverArtId, blobUrl);
      }
      // Note: Images cached without blob URLs will generate them on-demand when first requested
    } catch (error) {
      console.error(`Failed to cache image ${coverArtId}:`, error);
      throw error;
    }
  }

  /**
   * Get cached image from IndexedDB
   */
  private getCachedImage(coverArtId: string): Promise<CachedImage | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        console.warn('[getCachedImage] WARNING: DB not initialized');
        resolve(null);
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get([this.userId, coverArtId]);

      request.onsuccess = () => {
        const result = request.result as CachedImage | undefined;
        if (result) {
          const age = Date.now() - result.timestamp;
          if (age > this.maxAge) {
            this.deleteImage(coverArtId);
            resolve(null);
          } else {
            resolve(result);
          }
        } else {
          resolve(null);
        }
      };

      request.onerror = () => {
        logger.error('[ImageCache] Error reading from store:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Rate-limited fetch+cache that returns a blob URL (or the server URL as
   * fallback on error). At most maxConcurrentFetches requests run in parallel;
   * excess requests queue and execute in FIFO order.
   *
   * When the server returns 429, the queue pauses for an exponentially
   * increasing backoff (2 s → 4 s → … → 30 s) before running the next item.
   */
  private fetchAndCacheQueued(coverArtId: string, url: string): Promise<string> {
    if (this.isCleanedUp) return Promise.resolve(url);

    return new Promise<string>((resolve) => {
      const run = async () => {
        if (this.isCleanedUp) { resolve(url); return; }
        this.activeFetchCount++;
        let wasRateLimited = false;
        try {
          const result = await this.fetchAndCache(coverArtId, url);

          if (result.status === 'rate-limited') {
            wasRateLimited = true;
            this.rateLimitConsecutiveHits++;
            const backoffMs = Math.min(
              this.RATE_LIMIT_INITIAL_BACKOFF_MS * Math.pow(2, this.rateLimitConsecutiveHits - 1),
              this.RATE_LIMIT_MAX_BACKOFF_MS
            );
            this.rateLimitBackoffUntil = Date.now() + backoffMs;
            logger.warn(`[ImageCache] Rate limited (429), backoff ${backoffMs}ms`);
            // Return '' instead of the server URL so AlbumArt does not put a raw
            // server URL into <img src> which would fire another uncontrolled request.
            resolve('');
            return;
          }

          if (result.status === 'ok') {
            this.rateLimitConsecutiveHits = 0;
            this.rateLimitBackoffUntil = 0;
            // Use the blob already in memory — no second IDB read needed
            const blobUrl = URL.createObjectURL(result.blob);
            this.addToMemoryCache(coverArtId, blobUrl);
            resolve(blobUrl);
            return;
          }

          resolve(url);
        } catch {
          resolve(url);
        } finally {
          this.activeFetchCount--;
          const next = this.fetchQueue.shift();
          if (next) {
            const delay = wasRateLimited ? Math.max(0, this.rateLimitBackoffUntil - Date.now()) : 0;
            if (delay > 0) setTimeout(next, delay);
            else next();
          }
        }
      };

      if (this.activeFetchCount < this.maxConcurrentFetches) {
        run();
      } else {
        this.fetchQueue.push(run);
      }
    });
  }

  /**
   * Fetch image from server and cache it.
   * Returns the blob on success so the caller can create a blobUrl without a
   * second IDB read. Returns 'rate-limited' on HTTP 429, 'error' otherwise.
   */
  private async fetchAndCache(coverArtId: string, url: string): Promise<{ status: 'ok'; blob: Blob } | { status: 'rate-limited' | 'error' }> {
    try {
      const response = await fetch(url);
      if (response.status === 429) {
        return { status: 'rate-limited' };
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      const blob = await response.blob();
      await this.cacheImage(coverArtId, url, blob);
      return { status: 'ok', blob };
    } catch (error) {
      console.error(`[ImageCache] ERROR: Failed to fetch and cache image ${coverArtId}:`, error);
      return { status: 'error' };
    }
  }

  /**
   * Cache an image in IndexedDB
   */
  private cacheImage(coverArtId: string, url: string, blob: Blob): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const cachedImage: CachedImage = {
        url,
        blob,
        timestamp: Date.now(),
        coverArtId,
        userId: this.userId
      };

      const request = store.put(cachedImage);

      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        console.error(`[ImageCache] ERROR: Error storing in IndexedDB ${coverArtId}:`, request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Delete an image from cache
   */
  private deleteImage(coverArtId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete([this.userId, coverArtId]);

      request.onsuccess = () => {
        // Also remove from memory cache
        const blobUrl = this.memoryCache.get(coverArtId);
        if (blobUrl) {
          URL.revokeObjectURL(blobUrl);
          this.memoryCache.delete(coverArtId);
        }
        resolve();
      };

      request.onerror = () => {
        logger.error('[ImageCache] Error deleting image:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Add image to memory cache (LRU strategy).
   * Evicted URLs are queued for deferred revocation (5 s grace) so any
   * in-flight <img> elements finish loading before the underlying data is freed.
   */
  private addToMemoryCache(coverArtId: string, blobUrl: string): void {
    if (this.memoryCache.has(coverArtId)) {
      // Promote existing entry to MRU position (tail of insertion order)
      this.memoryCache.delete(coverArtId);
    } else if (this.memoryCache.size >= this.maxMemoryCacheSize) {
      // Evict true LRU entry (head of insertion order)
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey !== undefined) {
        const evicted = this.memoryCache.get(firstKey);
        this.memoryCache.delete(firstKey);
        if (evicted) this.pendingRevoke.push({ url: evicted, after: Date.now() + 5000 });
      }
    }
    this.memoryCache.set(coverArtId, blobUrl);
    this.flushPendingRevokes();
  }

  private flushPendingRevokes(): void {
    if (this.pendingRevoke.length === 0) return;
    const now  = Date.now();
    const keep: typeof this.pendingRevoke = [];
    for (const entry of this.pendingRevoke) {
      if (entry.after <= now) URL.revokeObjectURL(entry.url);
      else keep.push(entry);
    }
    this.pendingRevoke = keep;
  }

  /**
   * Clear all memory cache and revoke blob URLs (used during chunked cache warming)
   */
  clearMemoryCache(): void {
    this.memoryCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
    this.memoryCache.clear();
    // Flush any deferred revokes immediately too
    for (const entry of this.pendingRevoke) URL.revokeObjectURL(entry.url);
    this.pendingRevoke = [];
  }

  /**
   * Get image directly from IndexedDB (for cache warming)
   */
  async getFromIndexedDB(coverArtId: string): Promise<CachedImage | null> {
    if (!this.db) {
      console.warn('[getFromIndexedDB] DB not initialized');
      return null;
    }
    
    try {
      return await this.getCachedImage(coverArtId);
    } catch (error) {
      console.error(`[getFromIndexedDB] Error fetching ${coverArtId}:`, error);
      return null;
    }
  }

  /**
   * Add blob URL to memory cache (for cache warming)
   */
  addBlobUrlToMemory(coverArtId: string, blobUrl: string): void {
    this.addToMemoryCache(coverArtId, blobUrl);
  }

  /**
   * Synchronous memory-cache lookup with alias resolution.
   * Used by AlbumArt for zero-flash lazy state initialisation.
   */
  getFromMemoryCache(coverArtId: string): string | null {
    const direct = this.memoryCache.get(coverArtId);
    if (direct) return direct;
    const alias = this.coverArtAliasMap.get(coverArtId);
    return alias ? (this.memoryCache.get(alias) ?? null) : null;
  }

  /**
   * Batch-warm the memory cache from IDB using a single transaction.
   * Call this before rendering a song list so AlbumArt renders with blob
   * URLs immediately instead of going through the server-URL fast path.
   */
  async prewarmBatch(coverArtIds: string[]): Promise<void> {
    if (!this.db || coverArtIds.length === 0) return;

    // Resolve aliases; skip IDs already in memory cache
    const toFetch: Array<{ requested: string; effective: string }> = [];
    for (const id of coverArtIds) {
      if (this.memoryCache.has(id)) continue;
      const effective = this.coverArtAliasMap.get(id) ?? id;
      const cached = this.memoryCache.get(effective);
      if (cached) {
        this.addToMemoryCache(id, cached);
        continue;
      }
      toFetch.push({ requested: id, effective });
    }
    if (toFetch.length === 0) return;

    // Deduplicate by effective ID so we don't open duplicate requests
    const seen = new Set<string>();
    const unique = toFetch.filter(({ effective }) => !seen.has(effective) && seen.add(effective) as unknown as boolean);

    // Single read-only transaction, all gets fired concurrently
    const transaction = this.db.transaction([this.storeName], 'readonly');
    const store = transaction.objectStore(this.storeName);

    await Promise.all(unique.map(({ requested, effective }) =>
      new Promise<void>(resolve => {
        const req = store.get([this.userId, effective]);
        req.onsuccess = () => {
          const result = req.result as CachedImage | undefined;
          if (result) {
            const blobUrl = URL.createObjectURL(result.blob);
            this.addToMemoryCache(effective, blobUrl);
            if (effective !== requested) this.addToMemoryCache(requested, blobUrl);
          }
          resolve();
        };
        req.onerror = () => resolve();
      })
    ));
  }

  private static readonly CLEANUP_KEY = 'xylonic_image_cache_last_cleanup';
  private static readonly CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

  /**
   * Clean up old images from cache — runs at most once per 24 hours.
   */
  private async cleanupOldImages(): Promise<void> {
    if (!this.db) return;
    const last = parseInt(localStorage.getItem(ImageCacheService.CLEANUP_KEY) || '0', 10);
    if (Date.now() - last < ImageCacheService.CLEANUP_INTERVAL_MS) return;
    localStorage.setItem(ImageCacheService.CLEANUP_KEY, String(Date.now()));

    try {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('userId');
      const request = index.openCursor(IDBKeyRange.only(this.userId));

      const cutoffTime = Date.now() - this.maxAge;
      let deletedCount = 0;

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const image = cursor.value as CachedImage;
          if (image.timestamp < cutoffTime) {
            cursor.delete();
            deletedCount++;
          }
          cursor.continue();
        } else {
          if (deletedCount > 0) {
            logger.log(`[ImageCache] Cleaned up ${deletedCount} old images`);
          }
        }
      };

      request.onerror = () => {
        logger.error('[ImageCache] Error during cleanup:', request.error);
      };
    } catch (error) {
      logger.error('[ImageCache] Cleanup failed:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<ImageCacheStats> {
    if (!this.db) {
      return { totalImages: 0, cacheSize: 0, oldestImage: null, newestImage: null };
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('userId');
      const request = index.openCursor(IDBKeyRange.only(this.userId));

      let totalImages = 0;
      let cacheSize = 0;
      let oldestImage: number | null = null;
      let newestImage: number | null = null;

      request.onsuccess = (event) => {
        try {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            const image = cursor.value as CachedImage;
            totalImages++;
            cacheSize += image?.blob?.size ?? 0;

            if (oldestImage === null || image.timestamp < oldestImage) {
              oldestImage = image.timestamp;
            }
            if (newestImage === null || image.timestamp > newestImage) {
              newestImage = image.timestamp;
            }

            cursor.continue();
          } else {
            resolve({ totalImages, cacheSize, oldestImage, newestImage });
          }
        } catch {
          resolve({ totalImages, cacheSize, oldestImage, newestImage });
        }
      };

      request.onerror = () => {
        logger.error('[ImageCache] Error getting stats:', request.error);
        resolve({ totalImages: 0, cacheSize: 0, oldestImage: null, newestImage: null });
      };
    });
  }

  async getPerformanceStats(): Promise<PerformanceCacheStats> {
    let totalImages = 0;
    let cacheSize = 0;
    try {
      ({ totalImages, cacheSize } = await this.getCacheStats());
    } catch {
      // IDB unavailable or corrupt on this platform — show zeros
    }
    const ns = networkStatsService.getStats();
    const searchStats = searchCacheService.getCacheStats();
    return {
      totalImages,
      cacheSize,
      memoryEntries:        this.memoryCache.size,
      memoryHits:           ns.imageMemoryHits,
      idbHits:              ns.imageDiskHits,
      serverFetches:        ns.imageSubsonicFetches,
      internetArtFetches:   ns.imageInternetFetches,
      metadataFetches:      ns.metadataFetches,
      searchIndexSizeBytes: searchCacheService.getIndexSizeBytes(),
      searchIndexArtists:   searchStats.hasCache ? (searchStats as any).artistCount : 0,
      searchIndexAlbums:    searchStats.hasCache ? (searchStats as any).albumCount  : 0,
      searchIndexSongs:     searchStats.hasCache ? (searchStats as any).songCount   : 0,
    };
  }

  /**
   * Clear all cached images for current user
   */
  async clearCache(): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('userId');
      const request = index.openCursor(IDBKeyRange.only(this.userId));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          // Clear memory cache
          this.memoryCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
          this.memoryCache.clear();
          logger.log('[ImageCache] Cache cleared for user:', this.userId);
          resolve();
        }
      };

      request.onerror = () => {
        logger.error('[ImageCache] Error clearing cache:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Clear entire IndexedDB image cache database (all users)
   * Used to force a complete re-precache from scratch
   */
  async clearAllCacheAndReset(): Promise<void> {
    logger.log('[ImageCache] Clearing entire image cache database...');

    // Clear memory cache first
    this.memoryCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
    this.memoryCache.clear();
    logger.log('[ImageCache] Memory cache cleared');

    // Close database connection
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.log('[ImageCache] Database connection closed');
    }

    // Delete entire database
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);

      deleteRequest.onsuccess = () => {
        logger.log(`[ImageCache] ✅ Database "${this.dbName}" deleted successfully`);
        // Reset precache completion flag
        localStorage.removeItem('precacheComplete');
        logger.log('[ImageCache] Precache completion flag reset');
        resolve();
      };

      deleteRequest.onerror = () => {
        logger.error('[ImageCache] Error deleting database:', deleteRequest.error);
        reject(deleteRequest.error);
      };

      deleteRequest.onblocked = () => {
        logger.warn('[ImageCache] Database deletion blocked (open connections exist)');
        reject(new Error('Database deletion blocked'));
      };
    });
  }

  /**
   * Preload images (useful for artist list)
   */
  async preloadImages(images: Array<{ coverArtId: string; urlFn: () => string }>): Promise<void> {
    logger.log(`[ImageCache] Preloading ${images.length} images`);
    
    // Process in batches to avoid overwhelming the server
    const batchSize = 5;
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(({ coverArtId, urlFn }) => 
          this.getImage(coverArtId, urlFn)
        )
      );
    }
  }

  syncWithAppMode(): void {
    if (isPowerSaverEnabled()) {
      this.maxConcurrentFetches = 1;
      this.maxMemoryCacheSize   = 100;
    } else if (isPerformanceModeEnabled()) {
      this.maxConcurrentFetches = 2;
      this.maxMemoryCacheSize   = 200;
    } else {
      this.maxConcurrentFetches = 4;
      this.maxMemoryCacheSize   = 400;
    }
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.isCleanedUp = true;
    this.fetchQueue.length = 0;
    this.activeFetchCount = 0;
    this.pendingRequests.clear();

    this.memoryCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
    this.memoryCache.clear();
    for (const entry of this.pendingRevoke) URL.revokeObjectURL(entry.url);
    this.pendingRevoke = [];

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Export singleton instance
export const imageCacheService = new ImageCacheService();

window.addEventListener('appModeChanged', () => imageCacheService.syncWithAppMode());
