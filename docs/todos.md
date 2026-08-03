# Todos

## In Progress
- [ ] Re-download library to populate `artistCoverArtId` in cache metadata for existing songs
      (songs downloaded before the Jul 3 fix have null — re-downloading stores ar-xxx so offline artist photos work)
- [ ] **iOS auto-offline on cellular** — needs device test on cellular data (was on WiFi during testing)
- [ ] **iOS background downloads — device test** — new IPA includes `probeConnection` local-network permission fix + throttled progress events + ATS config; sideload and verify: (1) local-network dialog appears on first download, (2) downloads complete, (3) downloads continue when app is backgrounded, (4) orphan recovery on cold-start

## Backlog
- [ ] Replace `npm test` — no test runner configured after removing react-scripts; add Vitest if needed
- [ ] Investigate upgrading Capacitor beyond 8.4.0 if a 9.x release lands
- [ ] AudioMixerAttributes / bit-perfect USB audio (deferred feature)
- [ ] Complete v1→v2 audio file migration UI (metadata migrates; file copying needs progress dialog)
- [ ] Android 14 long downloads (>10 min) — may need migration to `FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING`
- [ ] AllAlbumsGrid.tsx / AllSongsGrid.tsx: also pass `artistCoverArtId` when queueing downloads
      (lower priority — ArtistList and AlbumList views cover the main download path)
- [ ] Compress search index in IndexedDB — `CompressionStream('deflate')` (Chromium built-in) would give 3–5× smaller IDB storage for large libraries; write path stores `ArrayBuffer`; read path handles both compressed v2.0 and legacy v1.0 records for migration

## Done (this cycle, cont.)

- [x] iOS local-network permission probe (Aug 2): `probeConnection()` method added to `BackgroundDownloadPlugin`; fires a foreground `URLSession.shared` HEAD request before first background download; iOS 14+ background sessions bypass the local-network permission dialog — foreground probe triggers it; `iosNetworkProbed` flag (reset each JS session) prevents repeat probes
- [x] Android CI APK never uploaded (Aug 2): root `.gitignore` had stale non-anchored `app/` pattern (meant for Electron) matching `android/app/` — entire `:app` Gradle module source missing from git; Gradle built 121 library tasks but produced no APK; fixed by anchoring pattern to `/app/` and committing `android/app/` source; `android/.gitignore` excludes generated `capacitor.build.gradle`
- [x] Android CI APK upload path (Aug 2): added dynamic `find`-based `Locate debug APK` step + `APK_PATH` env var; `if-no-files-found: error` on upload step surfaces path issues immediately instead of silently skipping

## Done (this cycle)
- [x] iOS album art in Control Center / lock screen (Jul 31): `fetch()` + `response.body.getReader()` streaming reader assembles image bytes → `btoa` → `data:` URL in `MediaMetadata.artwork`; `MPNowPlayingInfoCenter` receives raw bytes inline; confirmed working on device. (`CapacitorHttp.request(arraybuffer)` tried first but has no native iOS impl — falls back to broken `response.blob()` path)
- [x] Auto-offline on cellular bugs fixed (Jul 31): `autoOfflineOnCellular` missing from initial config state (falsy before `initCache` resolved); `isCellular` always false on iOS (`navigator.connection` unsupported in WKWebView); fixed with `@capacitor/network` + initial state seed + `cacheInitialized` dep in launch effect
- [x] iOS app version in Info.plist (Jul 31): `PlistBuddy` step in `ios.yml` writes `package.json` version to `CFBundleShortVersionString` + `CFBundleVersion` after `cap sync`
- [x] devDep install fix (Jul 31): `.npmrc` `include=dev` — `npm install` now works with `NODE_ENV=production` set globally
- [x] Auto-offline on mobile data setting (Jul 31): `autoOfflineOnCellular` toggle in Settings → Offline & Cache; defaults ON once songs cached; gated by direct `totalSongs > 0` check replacing `isFirstTimeUser()` proxy
- [x] iOS downloads routed to JS path (Jul 31): `NativeDownloader` guard changed from `isNativePlatform()` to `getPlatform() === 'android'`; iOS now uses `downloadSongJS` → `Filesystem.writeFile(Directory.Data)`
- [x] iOS safe-area layout, bottom nav, MediaSession art, app icon, zoom lock, Licenses + Download Manager modal fixes (Jul 30) — all UI issues from first iOS device install resolved; icons working with dark/light/tinted adaptive variants; viewport zoom locked in WKWebView; both full-screen-blocking modals converted to closeable overlays
- [x] Full CI pipeline (Jul 28): Android APK, iOS unsigned IPA, Windows portable, Linux AppImage/deb/tar.gz, macOS dmg/zip (x64+arm64) all building on push; `scripts/download-ios-ipa.sh` added; IOS_SETUP.md rewritten for Sideloadly-on-Windows; Node bumped to 24, Java to 21
- [x] Cache integrity verification (Jul 6): `verifyPermanentCache()`, "Verify Cache" button in Download Manager, auto-run after queue drains, live progress + result banner; works on all platforms
- [x] Download system fixup (Jul 4): 6 correctness bugs fixed
      1. Duplicate event guards: `songDownloaded`/`songFailed` handlers now idempotent
      2. `totalSize` double-count in `registerNativeDownload` + `addToCache` — subtracts old size before re-registering
      3. Debounced saves: `queueIndexSave`/`queueRegistrySave` collapse ~5000 writes to ~handful per batch; `flushAll()` forces final write
      4. Queue dedup: `addAlbumToQueue`/`addSongToQueue` skip already-cached and already-queued songs
      5. Stale `batchCall`/`broadcastPlugin` nulled after `bc.resolve()` in `DownloadService.java`
      6. `clearAllCache` refactored to single flush at end via `removeFromCacheCore` loop instead of per-song saves
- [x] Download wakelock expiry after 30 min — removed `!isHeld()` guard, watchdog refreshes every 2 s
- [x] WebView OOM crash — serial registrationQueue prevents concurrent JSON serialization
- [x] Clear All App Data button — Danger Zone in Settings, clears JS + native Android data
- [x] Cache stats layout jump — grid replaces flex-wrap for stable column widths
- [x] Offline artist cover art — two-pass builder prefers solo songs; correct ar-xxx ID stored on download
- [x] Orphan recovery — native completion log + JS pending map; reconcileOrphans() on startup re-registers
      songs whose songDownloaded event was lost to a renderer process crash (extended screen-off OOM)
- [x] Download Manager "Done: 0" — batch hijack: new JS session redirects broadcastPlugin/batchCall
      on the running DownloadService instead of queuing a duplicate batch; isCached filter skips
      already-recovered songs so they're counted immediately without re-downloading
- [x] Discover page: sequential section loading
- [x] Discover page: module-level session cache (5 min TTL)
- [x] Download Manager: disk-space indicator on Electron desktop
- [x] Virtual scrolling in SongList (Jul 11): react-window v2 hybrid — ≤60 songs natural render; >60 songs use `List`+`AutoSizer`; constant DOM node count for large albums
- [x] Web Worker for search (Jul 11): `searchWorker.ts` runs filter passes off main thread; `searchCacheService.search()` async Promise; main-thread fallback; zero jank on 25K+ song libraries
- [x] Fisher-Yates shuffle queue (Jul 11): `buildShuffleQueue()` in `PlayerContext.tsx` pre-shuffles index; each song plays once per cycle before repeats; rebuilt on shuffle toggle or playlist change
- [x] Gapless preload safety-net (Jul 11): `timeupdate` listener triggers next-song preload 15 s before current song ends
- [x] Electron IPC position throttle (Jul 11): metadata effect fires immediately; position effect gated at 2 fps (500 ms); IPC drops 3600→120 calls/min
- [x] True LRU image memory cache (Jul 11): `imageCacheService.ts` promote-on-read + promote-on-write; real LRU eviction (was FIFO/insertion-order)
- [x] IDB batch writes during preload (Jul 11): `cacheImagesBatch` with `IDB_WRITE_BATCH=50` reduces IDB transaction overhead
- [x] In-memory metadata TTL cache (Jul 11): `metadataCache.ts`; 30-min TTL; covers artists/albums/songs/pages; eliminates redundant API calls on navigation; invalidated on login/logout
- [x] getSongCount elimination (Jul 11): uses `searchCacheService.getSearchIndex()?.songs.length` when loaded
- [x] NowPlayingOverlay redesign (Jul 17): fullscreen overlay with ambient blurred art, three-card carousel, audio stats row, circular playlist button, remote mode support, repeat badge
- [x] Repeat mode persistence (Jul 17): user-scoped localStorage key; restored on start; cleared on logout
- [x] imageCacheService.syncWithAppMode() (Jul 17): mode-aware maxConcurrentFetches + maxMemoryCacheSize; called on init and `appModeChanged` event
- [x] Mode-aware cover art lookahead (Jul 17): normal=4 / perf=2 / power-saver=0 songs ahead; native artwork preload skipped in power-saver
- [x] Performance + power-saver CSS hardening (Jul 17): text-shadow/font-smoothing rules in perf mode; pixelated image rendering in power-saver mode
- [x] Offline mode audio swap on toggle (Jul 22): `offlineModeEnabled` effect swaps `audio.src` to local cache; OfflineModeContext seeds state from localStorage synchronously; startup-prime effect covers fresh launch
- [x] Liked status race fix (Jul 22): `cancelled` guard in `checkLikedStatus` effect; `cacheInitialized` added to deps for offline startup correctness
- [x] Capacitor bridge log throttle (Jul 22): `updateMediaPlaybackState` gated at 1 fps for position; play/pause changes fire immediately; eliminates 4× `undefined` per second in logcat
