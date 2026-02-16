/**
 * Image Cache Service
 * Caches cover art images per user to prevent rate limiting and reduce server load
 */

import { logger } from '../utils/logger';
import { generateUserId } from '../utils/cacheHelpers';

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

class ImageCacheService {
  private dbName = 'XylonicImageCache';
  private dbVersion = 1;
  private storeName = 'images';
  private db: IDBDatabase | null = null;
  private userId: string = '';
  private memoryCache: Map<string, string> = new Map(); // coverArtId -> blob URL
  private maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
  private maxMemoryCacheSize = 100; // Keep 100 images in memory
  private initializationPromise: Promise<void> | null = null; // Track ongoing initialization

  /**
   * Initialize the image cache service
   */
  async initialize(username: string, serverUrl: string): Promise<void> {
    const newUserId = generateUserId(username, serverUrl);
    
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
   * Get cached image or fetch from server
   */
  async getImage(coverArtId: string, serverFetchFn: () => string): Promise<string> {
    if (!this.db) {
      console.warn('[ImageCache] WARNING: Database not initialized, using server fetch');
      return serverFetchFn();
    }

    console.log(`[ImageCache] Getting image for: ${coverArtId}`);

    // Check memory cache first
    const memoryCached = this.memoryCache.get(coverArtId);
    if (memoryCached) {
      console.log(`%cMEMORY CACHE HIT: ${coverArtId}`, 'background: green; color: white; font-weight: bold');
      return memoryCached;
    }
    console.log(`[ImageCache] Memory cache miss: ${coverArtId}`);

    // Check IndexedDB
    try {
      console.log(`[ImageCache] Checking IndexedDB for: ${coverArtId}`);
      const cached = await this.getCachedImage(coverArtId);
      if (cached) {
        console.log(`%cINDEXEDDB CACHE HIT: ${coverArtId}`, 'background: blue; color: white; font-weight: bold');
        console.log(`Blob size: ${cached.blob.size} bytes, age: ${((Date.now() - cached.timestamp) / 1000 / 60).toFixed(1)} minutes`);
        const blobUrl = URL.createObjectURL(cached.blob);
        this.addToMemoryCache(coverArtId, blobUrl);
        console.log(`[ImageCache] Created blob URL and added to memory cache: ${coverArtId}`);
        return blobUrl;
      }
      console.log(`[ImageCache] IndexedDB miss: ${coverArtId}`);
    } catch (error) {
      console.error('[ImageCache] ERROR: Error reading from cache:', error);
    }

    // Fetch from server and cache
    console.log(`%cFETCHING FROM SERVER: ${coverArtId}`, 'background: orange; color: black; font-weight: bold');
    const serverUrl = serverFetchFn();
    this.fetchAndCache(coverArtId, serverUrl).catch(err => {
      console.error('[ImageCache] ERROR: Error caching image:', err);
    });

    return serverUrl;
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

      console.log(`[getCachedImage] Looking up key: [userId: ${this.userId}, coverArtId: ${coverArtId}]`);
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get([this.userId, coverArtId]);

      request.onsuccess = () => {
        const result = request.result as CachedImage | undefined;
        console.log(`[STATS] [getCachedImage] IndexedDB lookup result for ${coverArtId}:`, result ? 'FOUND' : 'NOT FOUND');
        
        if (result) {
          // Check if image is expired
          const age = Date.now() - result.timestamp;
          console.log(`⏰ [getCachedImage] Image age: ${(age / 1000 / 60).toFixed(1)} minutes (max: ${this.maxAge / 1000 / 60} minutes)`);
          if (age > this.maxAge) {
            console.log(`⏰ [ImageCache] Image expired, deleting: ${coverArtId}`);
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
   * Fetch image from server and cache it
   */
  private async fetchAndCache(coverArtId: string, url: string): Promise<void> {
    try {
      console.log(`[ImageCache] Fetching image from server: ${coverArtId}`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }

      const blob = await response.blob();
      console.log(`%c[ImageCache] Received blob (${blob.size} bytes): ${coverArtId}`, 'color: lime');
      await this.cacheImage(coverArtId, url, blob);
      console.log(`%c[ImageCache] Successfully cached in IndexedDB: ${coverArtId}`, 'background: green; color: white');
    } catch (error) {
      console.error(`[ImageCache] ERROR: Failed to fetch and cache image ${coverArtId}:`, error);
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

      console.log(`[ImageCache] Storing in IndexedDB: ${coverArtId} (${blob.size} bytes)`);

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
        console.log(`%cSTORED IN INDEXEDDB: ${coverArtId}`, 'background: purple; color: white; font-weight: bold');
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
   * Add image to memory cache (LRU strategy)
   */
  private addToMemoryCache(coverArtId: string, blobUrl: string): void {
    // If cache is full, remove oldest entry
    if (this.memoryCache.size >= this.maxMemoryCacheSize) {
      const firstKey = this.memoryCache.keys().next().value;
      const oldBlobUrl = this.memoryCache.get(firstKey);
      if (oldBlobUrl) {
        URL.revokeObjectURL(oldBlobUrl);
      }
      this.memoryCache.delete(firstKey);
    }

    this.memoryCache.set(coverArtId, blobUrl);
  }

  /**
   * Clear all memory cache and revoke blob URLs (used during chunked cache warming)
   */
  clearMemoryCache(): void {
    console.log(`[ImageCache] Clearing memory cache (${this.memoryCache.size} blob URLs)`);
    
    // Revoke all blob URLs to free memory
    this.memoryCache.forEach((blobUrl) => {
      URL.revokeObjectURL(blobUrl);
    });
    
    this.memoryCache.clear();
    console.log('[ImageCache] Memory cache cleared, RAM freed for garbage collection');
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
   * Clean up old images from cache
   */
  private async cleanupOldImages(): Promise<void> {
    if (!this.db) return;

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
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const image = cursor.value as CachedImage;
          totalImages++;
          cacheSize += image.blob.size;
          
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
      };

      request.onerror = () => {
        logger.error('[ImageCache] Error getting stats:', request.error);
        reject(request.error);
      };
    });
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

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Revoke all blob URLs
    this.memoryCache.forEach((blobUrl) => URL.revokeObjectURL(blobUrl));
    this.memoryCache.clear();

    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Export singleton instance
export const imageCacheService = new ImageCacheService();
