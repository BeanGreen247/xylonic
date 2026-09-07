# Performance Optimizations

### 1. Cache-First Playback

Cached songs play instantly without network delay.

**Benchmark:**
- Cached playback: ~50ms (read from disk)
- Streamed playback: ~500-2000ms (network latency)

### 2. Reference-Counted Deduplication

Prevents duplicate audio files across users.

**Storage Savings:**
- 1 album (12 songs, 50MB) downloaded by 3 users:
  - **Without deduplication**: 150MB (50MB × 3)
  - **With deduplication**: 50MB (stored once, referenced 3 times)

### 3. Cover Art Aliasing

All songs in an album reference the same cover art file.

**Storage Savings:**
- 12-song album with 1MB cover art:
  - **Without aliasing**: 12MB (1MB × 12 songs)
  - **With aliasing**: 1MB (stored once, referenced 12 times)

### 4. IndexedDB Image Cache (Multi-User)

Album artwork is cached in browser IndexedDB with **multi-user support**, preventing repeated server requests while isolating each user's data.

**Multi-User Architecture:**
- Uses composite key: `[userId, coverArtId]` for isolation
- User A: `["userA_server1", "ar-123"]`
- User B: `["userB_server2", "ar-123"]`  
- Same album art ID cached for multiple users simultaneously
- **No purging**: All users' cache data coexists peacefully

**User Switching Behavior:**
- Switching users: Database stays open, only updates context
- Memory cache (blob URLs): Cleared to free RAM
- IndexedDB data: **Preserved for all users**
- User returns: Instant cache access (no re-downloading)

**Performance Benefits:**
- First load: Fetch from server (~200-500ms)
- Subsequent loads: IndexedDB cache (~10-20ms)
- Multi-user machine: Each user builds cache once
- Reduces server load and bandwidth usage
- Works offline once cached
- Automatic cleanup of stale images (7-day expiry per user)

### 5. Lazy Loading

Components and data load only when needed.

```typescript
// Don't load all artists on app start
useEffect(() => {
  if (view === 'artists') {
    // Only fetch when user navigates to artists view
    fetchArtists();
  }
}, [view]);
```

### 6. Web Worker for Search

Real-time library search runs on a dedicated background thread, keeping the main thread free for rendering and interaction.

**Architecture:**

```
SearchContext.tsx (main thread)
      │  search(query) → async Promise
      ▼
searchCacheService.ts
      │  postMessage({ type: 'search', id, query })
      ▼
searchWorker.ts (Web Worker thread)
      │  filter artists[], albums[], songs[]
      │  postMessage({ type: 'result', id, artists, albums, songs })
      ▼
searchCacheService.ts
      │  resolve pending Promise (keyed by id)
      ▼
SearchContext.tsx
      └─ setState(results)
```

- Worker receives the full index once via `{ type: 'init', index }` on load
- Every subsequent `search(query)` call posts `{ type: 'search', id, query }` and returns a Promise resolved when the worker replies
- Pending-map: `Map<id, resolve>` — correlates async replies to their callers
- Falls back to synchronous main-thread filtering if the worker fails to initialise
- Bundled by Vite as a separate chunk: `searchWorker-*.js`

**Impact:** 75,000+ `.includes()` comparisons on a 25K-song library no longer block the UI thread.

### 7. Virtual Scrolling (SongList Hybrid)

Per-album song lists use a hybrid approach to balance simplicity and performance:

- **≤ 60 songs**: Natural `div.map()` render — no overhead, full CSS flexibility
- **> 60 songs**: `react-window v2` `List` + `react-virtualized-auto-sizer v2` `AutoSizer` — only ~15 DOM nodes rendered at any time

```typescript
// react-window v2 API (incompatible with v1):
// List uses rowComponent + rowProps, not children prop
<AutoSizer renderProp={({ height, width }: { height: number | undefined; width: number | undefined }) => (
  <List
    height={height ?? 600}
    width={width ?? 400}
    rowCount={songs.length}
    rowHeight={ITEM_HEIGHT}
    rowComponent={SongRow}
    rowProps={{ songs, currentSongId, onPlay, onContextMenu, formatDuration }}
  />
)} />
```

**Impact:** A 300-song album maintains the same DOM footprint (~15 nodes) as a 10-song album.

### 8. Fisher-Yates Shuffle Queue

Guarantees each song in the current playlist plays exactly once before any repeats.

```typescript
// PlayerContext.tsx
const buildShuffleQueue = useCallback((length: number, currentIdx: number) => {
  const indices = Array.from({ length }, (_, i) => i).filter(i => i !== currentIdx);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  shuffleQueueRef.current = indices;
  shuffleQueueIndexRef.current = 0;
}, []);
```

- Queue rebuilt when shuffle is toggled on or the playlist changes
- `shuffleQueueIndexRef` steps linearly through the pre-shuffled array — no `Math.random()` per next-track call
- When the queue is exhausted, it rebuilds (next cycle of all songs)

**Impact:** No song repeats before the entire playlist is heard; distributes playback evenly.

### 9. Electron IPC Position Throttle

Reduces IPC traffic between the main window and the mini player from ~3,600 calls/min to ~120 calls/min.

**Before:** A single `useEffect` with `[currentSong, isPlaying, ..., currentTime]` in deps fired at near-RAF rate (up to 60fps) because `currentTime` updates every animation frame.

**After:** Two separate effects:

```typescript
// Effect A — metadata (fires immediately on song/state change)
useEffect(() => {
  if (!bridge.isElectron) return;
  bridge.sendPlayerState({ currentSong, isPlaying, isLoading, currentTime,
    duration, volume, shuffle, repeat, muted, coverArtUrl });
}, [currentSong, isPlaying, isLoading, duration, volume, shuffle, repeat, muted]);

// Effect B — position (gated at 2 fps = 500 ms)
const lastIpcTimeRef = useRef(0);
useEffect(() => {
  if (!bridge.isElectron) return;
  const now = Date.now();
  if (now - lastIpcTimeRef.current < 500) return;
  lastIpcTimeRef.current = now;
  bridge.sendPlayerState({ currentSong, isPlaying, currentTime, ... });
}, [currentTime]);
```

**Impact:** Mini player song title and album art update instantly on track change; seek bar updates smoothly at 2 fps with 30× fewer IPC calls.

### 10. In-Memory Metadata TTL Cache

`src/services/metadataCache.ts` — module-level singleton that caches Subsonic API responses in RAM with a 30-minute TTL, eliminating redundant network round-trips during library navigation.

**Cache key patterns:**

| Key | Contents | Set by |
|-----|----------|--------|
| `artists_<serverUrl>` | Artists list + song count | `ArtistList.tsx` |
| `artist_<artistId>` | Artist albums array + `coverArt` ID | `AlbumList.tsx`, `SongList.tsx` |
| `album_<albumId>` | Album songs array | `SongList.tsx` |
| `albumsPage_<serverUrl>_<page>` | Paginated All Albums page | `AllAlbumsGrid.tsx` |

**Implementation:**

```typescript
class MetadataCache {
  private store = new Map<string, { data: unknown; expiresAt: number }>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return entry.data as T;
  }

  set(key: string, data: unknown, ttlMs = 30 * 60 * 1000): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  invalidate(prefix?: string): void {
    if (!prefix) { this.store.clear(); return; }
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}
export const metadataCache = new MetadataCache();
```

**Cache invalidation:** `metadataCache.invalidate()` is called in `AuthContext.login()` and `AuthContext.logout()` to prevent stale data from leaking between user sessions or server connections.

**getSongCount elimination:** `ArtistList.tsx` and `MainApp.tsx` use `searchCacheService.getSearchIndex()?.songs.length` when the search index is loaded, skipping the extra `getAlbumList2` API call that was used solely to sum song counts.

**Impact:** Navigating Artists → Albums → Songs → back → another artist → back serves all list data from RAM after the first visit. A round-trip through the full hierarchy with a warm cache makes zero network calls.

### 11. Mode-Aware Image Cache Sizing (`syncWithAppMode`)

`imageCacheService.syncWithAppMode()` adjusts two runtime parameters based on the active power mode, preventing wasted concurrent fetches and oversized memory caches on constrained devices.

| Mode | `maxConcurrentFetches` | `maxMemoryCacheSize` |
|------|------------------------|----------------------|
| Normal | 4 | 400 |
| Performance | 2 | 200 |
| Power-saver | 1 | 100 |

Called at: `imageCacheService.initialize()` (first fetch) and via a module-level `window.addEventListener('appModeChanged', ...)` that fires whenever the user switches modes mid-session.

**Impact:** On a power-saver session a library browse triggers at most 1 concurrent image fetch and retains at most 100 blob URLs in memory, cutting peak RAM usage to ¼ of the normal-mode ceiling.

### 12. Mode-Aware Cover Art Lookahead + Native Artwork Skip

`PlayerContext` prefetches cover art for the next N songs in the queue so art is ready before a track starts. The depth is mode-controlled:

```typescript
const maxAhead = isPowerSaverEnabled() ? 0 : isPerformanceModeEnabled() ? 2 : 4;
```

The native notification artwork preload (OS media notification thumbnail) is skipped entirely in power-saver mode:

```typescript
if (isPowerSaverEnabled()) return;
```

**Impact:** In power-saver mode, all art prefetch network calls are suppressed, freeing bandwidth and CPU for the audio stream. In performance mode lookahead is halved (2 songs) to balance quality with resource use.

---
