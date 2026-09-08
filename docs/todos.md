# Todos

> Strategic plan: see `docs/ROADMAP.md` (all-axes-to-9+, plus Android TV).
> When a roadmap workstream starts, break its tasks into this list.

## In Progress
- [ ] **WS-QUAL phase 1a cont.** — console sweep, dead-file deletion, ESLint/Prettier
      config + scripts, and the roadmap-named silent-`catch {}` starting points all
      done (see Done). `npm run lint` passes (0 errors, **~201 warnings**; trivial `any`→`unknown` +
      unused-import cleanup done). Remaining tail (roadmap frames as warn→error
      gradual, much folds into ARCH/UX): **111** `no-explicit-any` — the Subsonic
      response envelope is now typed in `src/types/subsonic.ts` (`SubsonicEnvelope`
      + `axios.get<SubsonicEnvelope>` across `subsonicApi.ts`, consumer callback
      `any`s dropped — commit `e84a93e`); the remaining 111 are spread across
      unrelated files (`global.d.ts`, `RemoteModeContext`, `platform/bridge`,
      `colorConfigManager`, `settingsManager`, `ImageCacheContext`, download-queue
      buffer `songs: any[]` in App/MainApp/ArtistList, `(s as any)` audio-meta
      casts in `AllSongsGrid`) — per-site, not a single pass; **35** `no-unused-vars` (several
      flag incomplete wiring, check per-site); 37 `no-empty` (silent-`catch {}` →
      `logger.error` + retry affordances; PlayerContext/downloadManagerService
      ones fold into WS-ARCH); 29 `react-hooks/exhaustive-deps` (2026-09-08: 6 of
      the ~17 dead `eslint-disable` directives removed — App/AlbumList/ArtistList/
      SongList/DesktopNowPlaying/OfflineModeContext; PlayerContext's 8 left for
      its WS-ARCH split); then flip each rule warn→error;
      (b) one-time `prettier --write` + commit; (c) wire `lint` + `format:check`
      into CI as required checks; (d) Vite `define`/transform to strip
      `logger.log`/`info` in prod bundles.
- [ ] **WS-TEST phase 1b** — harness + `.github/workflows/ci.yml` (lint+test+build
      gate; typecheck non-blocking). `npm test` green (**76 tests, 10 files**:
      `subsonicApi`, `credentialsService`, `cfgParser`, `offlineCacheService`
      (totalSize accounting + debounced save), `downloadManagerService` queue
      dedup, `cacheHelpers`, `fallbackBridge` + `electronBridge` + `capacitorBridge`
      contracts, `searchCacheService` fallback). Remaining, most now best done
      *with* WS-ARCH: `PlayerContext` Fisher-Yates queue / repeat / boundaries
      (do when it splits into `useQueue`); idempotent `songDownloaded`/`songFailed`
      + `reconcileOrphans` + batch-hijack (do when `downloadManagerService` splits
      into `downloadReconciler` — full batch-flow test proved too timing-brittle);
      mock Subsonic server (MSW); flip `typecheck` to blocking after the TS 5.x
      bump; coverage floor (40%→60%) once the splits make big modules unit-testable.
- [ ] **WS-ARCH — god-object splits** (one per commit, safest first, build+test
      verified each time). Done: (1) `PlayerContext` queue math → pure
      `src/context/playerQueue.ts` (`buildShuffleQueue`/`computeNextIndex`, 10
      tests); (2) `PlayerContext` persistence → `src/context/playerPersistence.ts`
      (8 tests, in-app verified); (3) shared `data:` URL helpers →
      `src/utils/dataUrl.ts` (5 tests, dedupes 5 copies in PlayerContext +
      capacitorBridge). Steps toward the `usePlaybackEngine` / `useQueue` /
      `useMediaSession` / `usePlayerPersistence` split. Remaining: compose the
      remaining `PlayerContext` pieces into hooks (playback engine — audio element
      / src swap / gapless; media session — large, needs Electron-MPRIS +
      Android-notif + iOS-Control-Center verification the model can't fully do;
      queue state); split
      `downloadManagerService` (2064) → `downloadQueue` /
      `downloadTransport` / `downloadReconciler`; split `public/electron.js`
      (2196) → `public/ipc/*` (unverifiable here — Electron doesn't run in this
      env; needs the user to smoke-test); split `SettingsView` (1226) per section;
      add `react-router` (memory history on native, replaces the
      `topView/drillView/...` machine + custom back-stack); `LayoutModeContext`
      (`compact|medium|expanded|tv`); provider `useMemo` audit; split
      `ARCHITECTURE.md`; ADRs in `docs/decisions/`. `ImageCacheProvider` collapsed
      (2026-09-08) to a module store + `useSyncExternalStore` hook — one fewer
      wrapper in `App.tsx`, `useImageCache()` API unchanged; `RemoteModeProvider`
      left as context (auth-context dependency + device-only discovery state).
- [ ] **WS-SEC phase 2 — remove plaintext-at-rest** — `credentialsService` +
      `useCredentials()` landed and every app-code `localStorage.getItem('password')`
      now routes through `credentialsService.getCached()` (see Done). Still to do:
      (a) guarantee the secure backend hydrates the cache *before* the first
      read so plaintext `localStorage` can be dropped — needs WS-TEST coverage
      first; (b) Capacitor `Preferences`-group Keychain/Keystore backend (mobile
      currently falls through to the cache like web); (c) `xylonic://` protocol +
      re-enable `webSecurity: true` on both `BrowserWindow`s (needs a 4-target
      desktop device pass); (d) `index.html` meta-CSP for Capacitor; (e) tighten
      the Electron CSP off `'unsafe-inline'` once `xylonic://` exists; (f) JKS
      rotation + `git filter-repo` history purge — **user**; (g) `npm audit`
      CI gate.
- [ ] **Android concurrent downloads** — `DownloadService.java` still downloads one song at a time (`Executors.newSingleThreadExecutor()`); making it match the new Electron/iOS concurrency cap needs a careful rework since its notification/wakelock/cancellation state currently assumes exactly one active transfer. Not started — no device available to test against this session.
- [x] **iOS downloads — RESOLVED (Sep 8, verified on device via CDP)** — the Aug 5
      batch-download queue fix + `CAPBridgedPlugin` registration migration did fix
      it; it was just never re-verified on a build carrying them. On the `26.08.01`
      build (which has both): `BackgroundDownload.startBatch` of a 19-track album →
      Download Manager "Done: 19, 0 errors"; on-disk
      `permanent_cache/audio/<hash>/audio.ogg` files present with byte sizes
      exactly matching `cache_index.json` `fileSize`; 60-dir sample = 0 empty / 0
      zero-byte; offline playback of a just-downloaded track confirmed working by
      the owner. Nothing to fix in the download flow.
- [ ] Re-download library to populate `artistCoverArtId` in cache metadata for existing songs
      (songs downloaded before the Jul 3 fix have null — re-downloading stores ar-xxx so offline artist photos work)
- [ ] **iOS auto-offline on cellular** — needs device test on cellular data (was on WiFi during testing)
- [x] **iOS infinite "Loading…" on offline→online (Sep 6) — verified on device (Sep 8)** —
      all three fix markers confirmed present in the `26.08.01` build's bundle
      (`ECONNABORTED` handling, `toggleOfflineMode`→`checkConnectivity`, `axios`
      15s timeout as `15e3`). Owner toggled offline→online on Wi-Fi and navigated
      Discover / Artists / album / song with no stuck spinner. (Cellular path
      still covered by the separate auto-offline item below.)

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

- [x] **WS-QUAL — ESLint/Prettier config + `catch {}` sweep start** (Sep 6):
      `eslint.config.mjs` (flat, ESLint 9 + typescript-eslint 8; `no-console` error,
      `no-empty`/`no-explicit-any`/`exhaustive-deps` warn; logger.ts exempt),
      `.prettierrc.json` + `.prettierignore`, `lint`/`lint:fix`/`format`/`format:check`
      scripts + devDeps. Not run (needs `npm install`); not in CI yet; no
      `prettier --write` reformat done. Silent catches in `MainApp.tsx` +
      `App.tsx` (missing-songs check, queue-missing) now `logger.error`.
- [x] **WS-QUAL — `console.*`→`logger.*` sweep** (Sep 6): 193 `console.log/error/warn/info`
      calls across 35 `src/` files funnelled through `utils/logger`. `logger.error`/`warn`
      changed to always emit to console (were gated on `loggingEnabled`, which
      would have hidden errors in dev); `logger.log`/`info` stay gated — that is
      the noise reduction. Deleted dead `offlineCacheService.v1.backup.ts.txt` +
      `.v2.ts` (0 refs). Build clean. ESLint config / `catch {}` sweep / `any`
      reduction / prod log-strip still pending (see In Progress).
- [x] **WS-SEC phase 1 — single credential path** (Sep 6): new
      `src/services/credentialsService.ts` (`get`/`getCached`/`set`/`clear`/`hydrate`)
      + `src/hooks/useCredentials.ts`; wraps the existing `secureCredentialService`
      (Electron `safeStorage`) with a synchronous `localStorage`-hydrated cache so
      the ~30 existing call sites keep their timing. Every
      `localStorage.getItem('password')` in app code migrated to
      `credentialsService.getCached()` (App/MainApp, all `Library/*` views,
      MiniPlayer, CachePreloadDialog, SearchContext, useScrobbler, useSongList,
      likedSongsService, apiErrorHandler, downloadManagerService, subsonicApi,
      `utils/storage.getFromStorage`). `AuthContext.login/logout` route through
      `set`/`clear`. Isolated hardening: `crypto.getRandomValues` salt in
      `subsonicApi` + `downloadManagerService` cover-art fetches; removed the
      password `console.log` in `subsonicApi.search()`; Electron
      `setWindowOpenHandler` default-deny on both windows; production-only
      `onHeadersReceived` CSP. Build clean; web login page screenshot-verified.
      Plaintext-at-rest removal is phase 2 (see In Progress).

- [x] iOS infinite "Loading…" on offline→online switch (Sep 6): three-part fix in the shared layer — (1) `axios.defaults.timeout = 15000` in `src/index.tsx` so a hung WKWebView XHR rejects instead of leaving a view spinning (interceptor also treats `ECONNABORTED` as a connectivity error); (2) `OfflineModeContext` native branch now drives `isOnline` from `Network` plugin `status.connected` (previously only `isCellular` was updated on native, so `isOnline` stayed a stale `false` on iOS); (3) `toggleOfflineMode()` calls `checkConnectivity()` on the offline→online transition. Builds clean; iOS device test still pending.
- [x] iOS `CAPBridgedPlugin` registration migration (Aug 5): found via live CDP debugging that every custom native iOS plugin (not just downloads) was throwing "not implemented" at runtime because `BackgroundDownloadPlugin`/`BackgroundKeepAlivePlugin` used the old pre-Capacitor-7 Objective-C `CAP_PLUGIN` macro pattern, incompatible with Capacitor 8's SPM-oriented bridge; migrated both to `CAPBridgedPlugin` with explicit `identifier`/`jsName`/`pluginMethods`, deleted the obsolete `.m` files, updated `ios.yml` — real fix, confirmed via device testing, but downloads still fail for a separate reason (see In Progress)
- [x] iOS native batch download queue (Aug 5): `startBatch`/`cancelBatch` added to `BackgroundDownloadPlugin.swift`; `downloadBatchNativeIOS()` added to `downloadManagerService.ts`, mirroring Android's existing batch pattern; removes dependency on a JS `setTimeout` chain between songs
- [x] Electron desktop download progress UI (Aug 5): dock/taskbar progress bar, tray icon + tooltip, macOS dock badge; filled in previously no-op `showDownloadNotification`/`hideDownloadNotification` bridge methods
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
