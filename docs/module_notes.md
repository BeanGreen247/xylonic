# Module Notes

## Build System
- **Vite 8** replaces CRA (`react-scripts`). Config at `vite.config.ts`.
- `@vitejs/plugin-legacy` targets `android >= 7, chrome >= 56` for Android Go device support.
- Output dir is `dist/` (was `build/`). Electron and Capacitor both read from `dist/`.
- `base: './'` in vite.config.ts enables file:// protocol loading in Electron production mode.

## Electron Main Process
- Entry: `public/electron.js` (referenced by `package.json` `main` field).
- Preload: `public/preload.js`.
- Dev server: `http://localhost:3000` (Vite configured to match — no port changes needed).
- Production: loads `dist/index.html` via file:// protocol.

## Android / Capacitor
- Capacitor 8, `webDir: dist` in `capacitor.config.ts`.
- `minSdkVersion = 24` (Android 7.0) in `android/variables.gradle`.
- Native plugins: `MediaControlPlugin`, `RemoteDiscoveryPlugin`, `DownloadNotificationPlugin`, `NativeDownloaderPlugin`.
- Background downloads use `DownloadService` (foreground service, dataSync type).

## Key Services
- `offlineCacheService.ts` — v2.1 reference-counted audio cache with per-user metadata; `registerNativeDownload()` for Android native path; `verifyPermanentCache(onProgress?)` for real FS existence checks; `removeFromCacheCore()` (private, in-memory only, safe for batch paths).
- `downloadManagerService.ts` — download queue; `triggerCacheVerification()` (public); `reconcileOrphans()` called on startup for Android OOM recovery; `registrationQueue` serializes `registerNativeDownload` calls to prevent WebView OOM on large batches.
- `imageCacheService.ts` — IndexedDB image cache, composite key `[userId, coverArtId]`; true LRU memory cache (promote-on-read + promote-on-write via Map delete+re-insert); `cacheImagesBatch` with `IDB_WRITE_BATCH=50` for preload efficiency; `syncWithAppMode()` adjusts `maxConcurrentFetches` (4/2/1) and `maxMemoryCacheSize` (400/200/100) per power mode; called at `initialize()` and on `appModeChanged` DOM event.
- `searchCacheService.ts` — manages search index in IDB; `search(query)` is async (returns `Promise<SearchResult3 | null>`); sends full index to `searchWorker` via `init` message on load; answers `search` messages; falls back to synchronous main-thread filtering if worker is unavailable.
- `searchWorker.ts` — Web Worker; receives full index once via `{ type: 'init', index }`; answers `{ type: 'search', id, query }` messages with `{ type: 'result', id, artists, albums, songs }`; bundled by Vite as a separate chunk (`searchWorker-*.js`).
- `metadataCache.ts` — module-level in-memory TTL cache (30-min default) for Subsonic API metadata responses; `get<T>(key)` / `set(key, data, ttlMs?)` / `invalidate(prefix?)`; covers artists list, artist albums, album songs, paginated all-albums pages; `invalidate()` called in `AuthContext.login()` and `AuthContext.logout()`.
- `likedSongsService.ts` — starred songs cache with 30s background poll and offline queue.
- `remoteDiscoveryService.ts` — LAN UDP (7766) discovery + HTTP (7767) command server.
- `subsonicApi.ts` — Subsonic API client, MD5 salted token auth.

## Key Components

- **`NowPlayingOverlay.tsx` / `NowPlayingOverlay.css`** — Full-screen now-playing overlay. Opened by `nowPlayingOpen` from `UIContext`. Features:
  - Ambient blurred/darkened/saturated album art background; dark scrim gradient
  - Three-card art carousel (prev/current/next); swipe left/right to skip; direction lock prevents swipe-down close from triggering on horizontal swipe; spring-back below 50 px threshold
  - Drag handle at top; swipe-down to close (spring animation); Escape key close
  - Info row: title + artist (fade-in on song change), heart button, circular playlist icon button
  - Controls: shuffle, prev, play/pause (72 px), next, repeat with "1" badge for repeat-one
  - Streaming quality selector + speed selector; quality change toast (3.5 s)
  - Audio stats row (format, bitrate, sample rate, bit depth, file size) — always visible
  - Remote mode: routes through `RemoteModeContext`; primary button uses `npo-throb` pulsing animation while pending
  - Dynamic art sizing via `min()/max()` CSS at `≤900px`, `≤680px`, `≤560px` breakpoints; `flex: 1 1 auto` absorbs vertical slack at wider sizes
  - Power-saver mode: `body.power-saver-mode .npo-bg { filter: none !important }` skips the 50 px blur

## Environment Variables
- `VITE_BUILD_VARIANT=appstore` — set in `android:build:appstore` script; read via `import.meta.env.VITE_BUILD_VARIANT` in `src/config/buildVariant.ts`.
