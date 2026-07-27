# Xylonic Image Cache — Implementation & Change Log

## Last Updated: June 2026
## Affected Service: `src/services/imageCacheService.ts`
## Related Component: `src/components/common/AlbumArt.tsx`

---

## Overview

The image cache service stores cover art blobs in **IndexedDB** (`XylonicImageCache`) with a per-user composite key `[userId, coverArtId]`. A RAM memory cache (Map, capped at 100 entries) sits above IDB for zero-latency repeat lookups. Images expire after 7 days.

This system is entirely separate from the offline audio cache (`offlineCacheService.ts` / Cache v2.1).

---

## Architecture

```
AlbumArt component
      │
      ▼
imageCacheService.getImage(id, serverFetchFn)
      │
      ├─ Memory cache hit  → return blob URL immediately (no IDB, no network)
      │
      ├─ Alias map lookup  → song coverArtId → album coverArtId (Navidrome mf- vs al- IDs)
      │
      ├─ Dedup map         → if a request for this ID is already in-flight, reuse it
      │
      └─ _resolveImage()
            │
            ├─ IDB hit     → createObjectURL(blob), add to memory cache, return blob URL
            │
            └─ IDB miss    → fetchAndCacheQueued() [throttled, ≤4 concurrent]
                                  │
                                  ├─ fetch(serverUrl) → store blob in IDB
                                  └─ return blob URL (or server URL as fallback)
```

### Key limits

| Parameter | Value |
|---|---|
| Max concurrent server fetches | 4 |
| Memory cache size | 100 entries |
| IDB cache TTL | 7 days |
| DB name | `XylonicImageCache` |
| IDB store key | `[userId, coverArtId]` |

---

## Change: 429 Rate Limiting Fix

**Problem:** Two concurrent HTTP requests were fired for every uncached image, reliably triggering Navidrome's rate limiter (HTTP 429) when a list with 20+ uncached albums was visible.

**Root cause — double fetch:**

1. `AlbumArt.tsx` set `imageUrl = directUrl` immediately, causing the browser `<img>` element to fire an HTTP request.
2. Simultaneously, `_resolveImage()` called `fetchAndCacheQueued()` as fire-and-forget, firing a second HTTP request for the same image.

With 20 visible uncached albums, 40+ concurrent requests hit the server.

### Fix in `imageCacheService.ts`

`fetchAndCacheQueued` was rewritten from a `void` fire-and-forget into a `Promise<string>` that resolves to the blob URL (or server URL as fallback):

```typescript
private fetchAndCacheQueued(coverArtId: string, url: string): Promise<string> {
  if (this.isCleanedUp) return Promise.resolve(url);

  return new Promise<string>((resolve) => {
    const run = async () => {
      if (this.isCleanedUp) { resolve(url); return; }
      this.activeFetchCount++;
      try {
        await this.fetchAndCache(coverArtId, url);
        const cached = await this.getCachedImage(coverArtId);
        if (cached) {
          const blobUrl = URL.createObjectURL(cached.blob);
          this.addToMemoryCache(coverArtId, blobUrl);
          resolve(blobUrl);
        } else {
          resolve(url);
        }
      } catch {
        resolve(url);
      } finally {
        this.activeFetchCount--;
        const next = this.fetchQueue.shift();
        if (next) next();
      }
    };

    if (this.activeFetchCount < this.maxConcurrentFetches) {
      run();
    } else {
      this.fetchQueue.push(run);
    }
  });
}
```

`_resolveImage` now **awaits** `fetchAndCacheQueued` instead of calling it as fire-and-forget:

```typescript
networkStatsService.recordImageSubsonicFetch();
const serverUrl = serverFetchFn();
const result = await this.fetchAndCacheQueued(effectiveId, serverUrl);
if (requestedId !== effectiveId) this.addToMemoryCache(requestedId, result);
return result;
```

### Fix in `AlbumArt.tsx`

Removed premature `setImageUrl(directUrl)` calls that were triggering unthrottled `<img>` element HTTP requests before the IDB/queue lookup. The component now always waits for `getCachedImage()` (which internally awaits `fetchAndCacheQueued`) before setting a URL:

```typescript
// Before (caused double-fetch):
if (!cancelled) { setImageError(false); setImageUrl(directUrl); }
if (imageCacheInitialized) { /* update if blob found later */ }

// After (single request through the queue):
if (imageCacheInitialized) {
  try {
    const cachedUrl = await getCachedImage(coverArtId, () => directUrl);
    if (!cancelled && cachedUrl) setImageUrl(cachedUrl);
  } catch {
    if (!cancelled) setImageUrl(directUrl);
  }
}
```

### Logout safety — `isCleanedUp` flag

A private `isCleanedUp: boolean` field was added. When `cleanup()` is called on logout, it:
1. Sets `isCleanedUp = true`
2. Drains the fetch queue (`fetchQueue.length = 0`)
3. Resets `activeFetchCount = 0`
4. Clears `pendingRequests`

Any queued `run()` functions that fire after this check `isCleanedUp` and immediately `resolve(url)` without making network requests — preventing hung promises after logout.

---

## Change: Android / Capacitor Stats Fix

**Problem:** The "Performance Cache" section in Settings showed a perpetual loading spinner on Android (Capacitor). Stats never appeared.

**Root cause — hung Promise in `getCacheStats()`:**

On Android's System WebView, blobs retrieved from IndexedDB can occasionally be `null` or lack a `size` property (known WebView/IDB compatibility issue in older API levels). Accessing `image.blob.size` inside the IDB cursor's `onsuccess` handler threw a `TypeError`. Because this error was thrown inside an IDB event callback, it was not caught by the surrounding `Promise` constructor — the Promise simply never resolved or rejected. `getPerformanceStats()` awaited it forever, `.catch(() => {})` in `SettingsView` caught the eventual timeout/rejection silently, and `perfCacheStats` stayed `null`.

### Fix

**`getCacheStats()` cursor handler** — wrapped in try/catch with defensive optional chaining:

```typescript
request.onsuccess = (event) => {
  try {
    const cursor = (event.target as IDBRequest).result;
    if (cursor) {
      const image = cursor.value as CachedImage;
      totalImages++;
      cacheSize += image?.blob?.size ?? 0;   // safe on Android
      // ... timestamp tracking ...
      cursor.continue();
    } else {
      resolve({ totalImages, cacheSize, oldestImage, newestImage });
    }
  } catch {
    resolve({ totalImages, cacheSize, oldestImage, newestImage }); // partial result
  }
};

request.onerror = () => {
  logger.error('[ImageCache] Error getting stats:', request.error);
  resolve({ totalImages: 0, cacheSize: 0, oldestImage: null, newestImage: null }); // zeros, not reject
};
```

**`getPerformanceStats()`** — wraps `getCacheStats()` in its own try-catch so a failure returns a valid (zero) stats object instead of propagating:

```typescript
async getPerformanceStats(): Promise<PerformanceCacheStats> {
  let totalImages = 0;
  let cacheSize = 0;
  try {
    ({ totalImages, cacheSize } = await this.getCacheStats());
  } catch {
    // IDB unavailable or corrupt on this platform — show zeros
  }
  const ns = networkStatsService.getStats();
  // ... rest of stats assembled from networkStatsService + searchCacheService
}
```

**Result:** The stats section now always renders on Android. If IDB is unavailable or blobs are corrupt, image count and cache size show as 0; network hit/miss counters and search index stats (which don't touch IDB) still display correctly.

---

## Change: True LRU Eviction Fix (July 2026)

**Problem:** `addToMemoryCache` used `Map.keys().next().value` (insertion order) for eviction. Re-accessing a cached image did NOT move it to the MRU position — eviction was actually FIFO. Frequently-viewed album art could be evicted while rarely-viewed art stayed, defeating the purpose of the 100-entry cap.

**Fix — promote on read** (`getImage`):

```typescript
const memoryCached = this.memoryCache.get(coverArtId);
if (memoryCached) {
  // Promote to MRU: delete + re-insert at Map tail
  this.memoryCache.delete(coverArtId);
  this.memoryCache.set(coverArtId, memoryCached);
  networkStatsService.recordImageMemoryHit();
  return memoryCached;
}
```

**Fix — promote on write** (`addToMemoryCache`):

```typescript
private addToMemoryCache(coverArtId: string, blobUrl: string): void {
  if (this.memoryCache.has(coverArtId)) {
    this.memoryCache.delete(coverArtId); // re-insert at tail = MRU
  } else if (this.memoryCache.size >= this.maxMemoryCacheSize) {
    // Evict least-recently-used (Map head = LRU position)
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
```

Both changes together give true O(1) LRU semantics using JavaScript `Map` insertion order as a doubly-ended queue. Cost: 2 extra `Map` operations per cache hit — negligible.

**Impact:** Frequently browsed album art stays in the 100-entry memory cache across page navigation; cold art (not recently viewed) is the first to be evicted.

---

## Alias Map

`buildAliasMap(albums, songs)` builds a `coverArtAliasMap: Map<string, string>` that maps Navidrome song-level cover art IDs (e.g. `mf-abc`) to their parent album's cover art ID (e.g. `al-xyz`). This means a song displayed in a list reuses the album art blob already cached during album browsing — no duplicate fetches.

Must be called after the search index is populated. Called by `ImageCacheContext` once the search cache is ready.

---

## Batch Prewarm

`prewarmBatch(coverArtIds: string[])` opens a **single read-only IDB transaction** and fires all `store.get()` calls concurrently (using `Promise.all`). This pre-populates the memory cache before rendering a song list, so `AlbumArt` components render with blob URLs on the first paint with no flash-of-placeholder.

---

## `AlbumArt` Component Integration

`AlbumArt.tsx` uses two paths:

| Scenario | Behaviour |
|---|---|
| Memory cache hit (sync) | Initialises `imageUrl` state directly in `useState(() => ...)` — zero-flash first paint |
| IDB hit | `getCachedImage()` resolves quickly; blob URL set before paint |
| Server fetch (uncached) | Component shows grey placeholder (`album-art-loading`) while the request runs through the throttled queue |
| Blob URL error (edge case) | `onError` handler falls back to `serverUrlFallback.current` (the plain HTTPS server URL) |

The component never sets `imageUrl` to the raw server URL before the queue resolves, ensuring all server traffic flows through the 4-concurrent throttle.

---

## File Summary

| File | Role |
|---|---|
| `src/services/imageCacheService.ts` | Core service — IDB, memory cache, throttled queue |
| `src/components/common/AlbumArt.tsx` | Consumer — renders blob URL or placeholder |
| `src/context/ImageCacheContext.tsx` | React context — exposes `getCachedImage`, `isInitialized` |
