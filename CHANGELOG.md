# Changelog

All notable changes to Xylonic are documented here.

## [Unreleased]

### Added
- **Concurrent downloads setting** — new "Concurrent Downloads" control in Settings → Downloads (1-8, default 3). Electron/web now run a bounded worker pool (`processConcurrentJS`/`downloadWorkerJS` in `downloadManagerService.ts`) instead of downloading one song at a time; each worker claims the next pending item synchronously (no double-claim race) and reuses the existing `downloadSong()` retry/backoff/completion logic per item. iOS applies the cap via `URLSessionConfiguration.httpMaximumConnectionsPerHost` (set from a value persisted in `UserDefaults` via a new `setMaxConcurrentDownloads` plugin method — takes effect on next app launch since it's fixed for the session's lifetime, previously unbounded). The stuck-download detector now tracks per-item abort controllers and last-progress timestamps (`activeAbortControllers`/`activeLastProgressMs`, keyed by item ID) so a single stalled download aborts independently without disturbing others running concurrently. `DownloadProgress.currentDownloads` exposes all in-flight items; `DownloadManagerWindow` renders one active-download card per concurrent download instead of a single card. Android's download service remains single-threaded for now — its executor and notification/wakelock state are tightly coupled to a sequential assumption that needs a dedicated pass to convert safely.
- **iOS native batch downloads** — `BackgroundDownloadPlugin.swift` gained `startBatch`/`cancelBatch`, enqueuing every pending song's `URLSessionDownloadTask` on the shared background `URLSession` up front instead of the JS queue chaining one `startDownload` call at a time via `setTimeout`; `downloadManagerService.ts` gained `downloadBatchNativeIOS()` (mirrors the existing Android `downloadBatchNative` pattern) and dispatches iOS to it in `processQueue()`, removing the dependency on WKWebView JS timers firing reliably between songs while backgrounded
- **Electron desktop download progress** — dock/taskbar progress bar (`BrowserWindow.setProgressBar`), a tray icon with a live tooltip (reusing the previously-unused `assets/icon-tray.png`), and a macOS dock badge; wired through new `set-download-progress`/`clear-download-progress` IPC handlers in `public/electron.js` and implemented in `electronBridge.ts`, filling in a `showDownloadNotification`/`hideDownloadNotification` bridge seam that was previously a no-op on Electron

### Fixed
- **iOS custom native plugins not registering under Capacitor 8** — root cause of a much bigger, previously-undiagnosed problem: `BackgroundDownloadPlugin.swift` and `BackgroundKeepAlivePlugin.swift` used the pre-Capacitor-7 Objective-C `CAP_PLUGIN` macro registration pattern (a separate `.m` file per plugin), which relies on Objective-C runtime class-scanning that Capacitor 8's SPM-oriented bridge does not reliably perform. Every single method on both plugins — including ones that predate this session, like `probeConnection` and `readCompletionLog` — was throwing `"X" plugin is not implemented on ios` at runtime despite compiling and linking successfully in CI. Migrated both plugins to the current `CAPBridgedPlugin` protocol (explicit `identifier`/`jsName`/`pluginMethods` declared directly in Swift, per Capacitor's official iOS plugin guide); deleted the now-obsolete `.m` files; updated `ios.yml` to stop copying/registering them. **Confirmed via CDP-based live device debugging** (see `IOS_SETUP.md` → "Debugging on Linux") that this is a real, verified fix for plugin registration — however, as of the latest installed build, downloads are still not completing, so there is at least one more bug in the download flow itself beyond plugin registration. Diagnostic tracing (`xyDebugTrace` event, routed through Capacitor's `notifyListeners` bridge instead of `NSLog` — which is not reliably visible via `idevicesyslog` for sideloaded/non-Xcode-attached processes) remains in `BackgroundDownloadPlugin.swift` for the next debugging session.
- **iOS portrait lock** — `Info.plist` `UISupportedInterfaceOrientations` set to portrait-only for iPhone via new PlistBuddy step in `ios.yml`; iPad retains all four orientations via separate `~ipad` key; prevents WKWebView from hitting the 767px CSS breakpoint that activates the desktop/sidebar layout when the phone is rotated to landscape
- **iOS background downloads** — new `BackgroundDownloadPlugin` (Swift + Obj-C bridge) injected into the Xcode project by CI; uses `URLSessionConfiguration.background(withIdentifier:)` so `URLSessionDownloadTask` continues downloading through the iOS networking daemon even when WKWebView is suspended; files written directly to `permanent_cache/audio/<hash>/audio<ext>` in Documents; JS side (`downloadManagerService.ts`) routes iOS platform to the new native path instead of `downloadSongJS`; completion log in `UserDefaults` + `reconcileIOSOrphans()` startup pass recovers downloads that completed while the WebView was dead; `AppDelegate.swift` override wires the OS background-session wakeup to the plugin
- **iOS background keep-alive** — `UIBackgroundModes: audio` declared in `Info.plist` via PlistBuddy step in `ios.yml`; new `BackgroundKeepAlivePlugin` (Swift + Obj-C bridge) plays a programmatically generated looping silent `AVAudioPCMBuffer` via `AVAudioEngine` with `.mixWithOthers` so it does not interrupt music; `arm()` / `disarm()` called by `downloadManagerService.ts` when the iOS download queue starts / drains; engine only starts on `UIApplication.didEnterBackgroundNotification` while armed, stops on `UIApplication.willEnterForegroundNotification`; keeps the main app process alive so `notifyListeners` in `BackgroundDownloadPlugin` can deliver real-time completion events to JS without waiting for the cold-start completion log reconcile
- **`@capacitor/network` plugin** — replaces `navigator.connection` for cellular detection; `navigator.connection` is unsupported in WKWebView (iOS); `Network.getStatus()` + `Network.addListener()` return accurate `connectionType: 'cellular'` via native iOS/Android APIs
- **`.npmrc` `include=dev`** — devDependencies (vite, typescript, electron, etc.) now install correctly when `NODE_ENV=production` is set in the shell environment, enabling clean `npm install` on any dev machine
- **iOS local-network permission probe** — added `probeConnection()` method to `BackgroundDownloadPlugin` (Swift + Obj-C bridge); makes a foreground `URLSession.shared` HEAD request before the first background download per session; iOS 14+ does not show the local-network permission dialog for background `URLSession` tasks (the system daemon handles the connection and bypasses the prompt); the foreground probe triggers the dialog so subsequent background-session downloads are permitted; `iosNetworkProbed` flag ensures the probe runs once per JS session

### Fixed
- **iOS downloads broken after progress-event addition** — three root causes fixed: (1) `didWriteData` delegate fired on every URLSession data chunk (hundreds/sec on LAN) flooding `DispatchQueue.main.async` and potentially delaying `backgroundDownloadCompleted` delivery — throttled to ≤ 2 Hz (0.5 s gate on `lastProgressNotifyTime`); (2) `timeoutPromise`'s `setTimeout` was never cleared when the download completed, leaving a dangling unhandled rejection after 5 minutes — merged into a single Promise with `clearTimeout` on every exit path; (3) `NSAppTransportSecurity` was absent from Capacitor's SPM `Info.plist` template, causing ATS to silently block native `URLSessionDownloadTask` connections to HTTP Subsonic servers — added `NSAllowsArbitraryLoads: true` via new PlistBuddy step in `ios.yml`
- **iOS local-network permission dialog never appeared** — background `URLSession` tasks bypass the iOS 14+ local-network permission prompt; fixed by firing a foreground `URLSession.shared` HEAD probe to the server before the first background download; without this the OS silently denied local-network access and downloads failed with a connection error
- **Android CI: APK never uploaded** — root cause was a stale `app/` entry in the root `.gitignore` (intended for an Electron `app/` directory that no longer exists); the non-anchored pattern matched `android/app/` too, causing the entire Android app module source (`build.gradle`, `AndroidManifest.xml`, all Java source, all resources) to be absent from the repository; Gradle built the library modules successfully but treated `:app` as an empty project with no tasks — producing no APK; fixed by anchoring the pattern to `/app/` and committing the previously hidden `android/app/` module source; `android/.gitignore` updated to explicitly exclude `app/capacitor.build.gradle` (generated by `cap sync`)
- **Android CI: APK upload silently skipped when path wrong** — `upload-artifact` step had no `if-no-files-found` setting (defaulted to `warn`); changed to `error` to surface path issues; added a `Locate debug APK` step with `find` that discovers the actual APK path and exports it as `APK_PATH`, making the upload robust to Gradle output path variations
- **Auto-offline on cellular broken** — two root causes: (1) `OfflineModeContext` initial config state was missing `autoOfflineOnCellular: true`, so the field was `undefined` (falsy) when the App.tsx launch effect ran before `initCache()` resolved; (2) `isCellular` was always `false` on iOS because WKWebView doesn't support `navigator.connection`; fixed by seeding `autoOfflineOnCellular: true` in the initial state + logout reset, switching to `@capacitor/network` on native platforms, and adding `cacheInitialized` to the launch effect deps so it re-fires after the saved config is loaded
- **Album art missing in iOS Control Center / lock screen** — two iterations: (1) previous "fast path" set an HTTPS URL in `MediaMetadata.artwork`; iOS `MPNowPlayingInfoCenter` tried to fetch natively, bypassing CapacitorHttp, silently blocked by ATS on LAN HTTP servers; (2) switched to `CapacitorHttp.request({ responseType: 'arraybuffer' })` but that plugin has no native iOS implementation and falls back to the JS web class which internally calls `response.blob()` — the known broken path; (3) final fix: `fetch()` + `response.body.getReader()` streaming reader (same path `downloadSongJS` uses for audio), assembles `Uint8Array` chunks, converts to base64 via chunked `String.fromCharCode` + `btoa`, constructs `data:<mime>;base64,…` URL — `MPNowPlayingInfoCenter` receives raw bytes inline, no outbound request, MIME type from response `Content-Type` header
- **iOS app version mismatch** — `Info.plist` `CFBundleShortVersionString` was never updated in CI (Capacitor scaffolds it with a default); added a `PlistBuddy` step in `ios.yml` after `cap sync` that writes the `package.json` version to both `CFBundleShortVersionString` and `CFBundleVersion`

---

## [26.7.31] - 2026-07-31

### Added
- **Auto-offline on mobile data setting** — new toggle in Settings → Offline & Cache: "Auto-offline on mobile data"; when enabled (default once songs are cached), the app automatically switches to offline mode on cellular and shows the "Mobile Data Detected" prompt; disabled with an explanatory hint when no songs are cached; persisted in `OfflineModeConfig.autoOfflineOnCellular`

### Fixed
- **iOS downloads** — `NativeDownloader` was registered on all native platforms (`isNativePlatform()`), but the native plugin only exists on Android; iOS tried the native path and silently failed; changed guard to `getPlatform() === 'android'` so iOS falls back to the JS fetch path (`downloadSongJS` → `Filesystem.writeFile(Directory.Data)`); `Directory.Data` is the app's private sandbox — no entitlement needed

### Changed
- **Cellular auto-offline guard** — replaced the `isFirstTimeUser()` localStorage proxy with a direct `offlineCacheService.getCacheStats().totalSongs > 0` check in both the launch and mid-session cellular effects; behavior is identical for users with cached songs but is now accurately scoped to "has songs to play offline" rather than "has preloaded search cache"

---

## [26.7.30] - 2026-07-30

### Added
- **iOS adaptive app icons** — three 1024×1024 PNG variants (`resources/ios-icons/`) injected into the Xcode project by the iOS CI workflow: `AppIcon.png` (light/white), `AppIcon~dark.png` (`#121212`), `AppIcon~tinted.png` (grayscale for iOS tint); `Contents.json` uses the iOS 18 universal single-icon adaptive format so the home screen always shows the correct variant
- **iOS CI: custom icon injection step** — added a `cp` step in `ios.yml` (after `cap sync`, before CocoaPods) that copies the three icon files into `ios/App/App/Assets.xcassets/AppIcon.appiconset/`

### Fixed
- **iOS safe-area layout** — `viewport-fit=cover` + `contentInset: 'never'` established as the canonical WKWebView strategy; `.app` gets `padding-top: env(safe-area-inset-top)` (content starts below Dynamic Island) and `padding-bottom: calc(56px + env(safe-area-inset-bottom))` (reserves nav + home indicator space); `.header` and `.main-content` get `padding-left/right: calc(12px + env(safe-area-inset-*))` for side safe areas
- **iOS bottom nav clipping** — `padding-bottom` expansion collapsed the 56 px button area to 22 px under `box-sizing: border-box`; replaced with `bottom: env(safe-area-inset-bottom)` lift and an `::after` pseudo-element that fills the home-indicator strip with `var(--surface)`
- **iOS MediaSession album art** — `CapacitorHttp` intercepts `fetch()` and `response.blob()` returns malformed data on iOS; added an iOS fast path that passes the HTTPS cover-art URL directly to `MediaMetadata`, letting `MPNowPlayingInfoCenter` load the image natively; existing data-URL pipeline kept for Electron/web/offline
- **iOS viewport zoom lock** — `minimum-scale=1, maximum-scale=1` added to both `index.html` viewport metas (WKWebView enforces these unlike Safari browser); `gesturestart/change/end` JS event blockers and `touch-action: pan-x pan-y` CSS added as belt-and-suspenders to prevent pinch-zoom from sticking
- **Licenses modal uncloseable on mobile** — was `height: 100vh; top: 0` full-screen; now a bottom sheet: `max-height: 82vh; bottom: 0; border-radius: 16px 16px 0 0` with `qp-slide-up` animation; horizontal tab bar preserved
- **Download Manager modal uncloseable on mobile** — `.mobile` class and `@media (max-width: 768px)` both rendered `height: 100%; width: 100%; border-radius: 0; background: transparent`; replaced with centered dialog matching the theme-picker style: `width: 92%; max-height: 80vh; border-radius: 16px; backdrop-filter: blur(4px); background: rgba(0,0,0,0.75)`

### Known issues
- **iOS downloads not functional** — no storage-permission entitlement configured for iOS; downloaded songs cannot be written to persistent storage; to be addressed in a future session

---

## [26.7.28] - 2026-07-28

### Added
- **Desktop CI workflow** (`.github/workflows/desktop.yml`) — parallel jobs build all desktop targets on every push to `main`: Windows portable `.exe`, Linux AppImage + deb + tar.gz, macOS `.dmg` + `.zip` (x64 + arm64); manual dispatch has a per-platform selector
- **macOS electron-builder config** — `electron-builder.json` now has a `mac` section with dmg + zip targets for both Intel (`x64`) and Apple Silicon (`arm64`); icon auto-generated from `assets/icon.png` on the macOS runner
- **`scripts/download-ios-ipa.sh`** — uses `gh` CLI to find the latest successful iOS CI run, download the IPA artifact, and print the exact file path + Sideloadly instructions; run with `bash scripts/download-ios-ipa.sh [output-dir]`

### Changed
- **iOS CI** (`ios.yml`) — debug build now targets real device (`-sdk iphoneos`) instead of the simulator; both debug and release paths archive and package into an unsigned `.ipa` (Payload zip) ready for Sideloadly; `xcpretty` installed alongside CocoaPods; `set -o pipefail` on all `xcodebuild` steps so real failures are no longer masked; dynamic project-type detection after `cap sync` sets `XCODE_BUILD_FLAG`/`XCODE_BUILD_PATH` to `-workspace`/`.xcworkspace` (CocoaPods) or `-project`/`.xcodeproj` (SPM, Capacitor 8 default) so xcodebuild never fails on a missing workspace file
- **Android CI** (`android.yml`) — release APK upload uses `*.apk` glob instead of two explicit paths; added `if-no-files-found: warn` so the step doesn't hard-fail when only the unsigned variant exists; Java bumped 17 → 21 (Capacitor Android 8 sets `sourceCompatibility = JavaVersion.VERSION_21`)
- **All CI workflows** — Node.js bumped 20 → 24 (Node 20 deprecated on GitHub Actions runners; Capacitor CLI also requires ≥ 22)
- **IOS_SETUP.md** — rewritten to reflect the Sideloadly-on-Windows install flow, correct the Linux limitation (Sideloadly is Windows/macOS only), document the 7-day refresh cycle, and reference the download script

### Known issue
- **App renders fullscreen with no UI controls on device** — after installing the CI-built IPA on iPhone, the app opens fullscreen but the in-app playback controls and navigation are not visible; media/lock-screen controls do appear and respond, indicating audio and the native media session are working; root cause unknown, to be investigated next session

---

## [26.7.22] - 2026-07-22

### Fixed
- **Offline mode audio swap** — toggling to offline mode while a song is streaming now immediately switches `audio.src` to the local cached file (`_capacitor_file_` URL), preserving playback position and play/pause state; previously the current song continued streaming from the internet until it ended
- **Offline mode on fresh app launch** — `OfflineModeContext` now seeds `config.enabled` from `localStorage` synchronously in the `useState` initializer (was hardcoded `false`), ensuring the offline guard in `PlayerContext` is active from the very first render before `offlineCacheService.initialize()` resolves; a startup-prime effect in `PlayerContext` also sets `audio.src` from the local cache when `cacheInitialized` flips true and the audio element is still empty
- **Liked status race condition** — rapid song skipping could show the heart button's liked state from a previous song because the async `isSongLiked()` call resolved after the next song had already loaded; fixed with a `cancelled` cleanup flag in the `checkLikedStatus` effect
- **Liked status at startup** — added `cacheInitialized` to the `checkLikedStatus` effect dependencies so liked status re-checks once the offline cache finishes loading from disk (was always showing `false` at cold start in offline mode)
- **Capacitor native bridge log flood** — `updateMediaPlaybackState` called `MediaControl.updatePlaybackState()` on every `currentTime` change (~4 Hz); Capacitor's debug bridge logs every void plugin response, producing 4 `"undefined"` lines/second in logcat; position updates now throttled to 1 fps (1,000 ms) while play/pause transitions still fire immediately
- **Performance cache stats always zero** — Settings → Performance Cache showed 0 cached and 0 internet requests every session; root cause: `AlbumArt.tsx` called `imageCacheService.getFromMemoryCache()` directly at three early-exit points (albumId path, online path, offline path) before ever reaching `getCachedImage()` which is the path that records stats; once the LRU warms up on first browse all subsequent image loads hit these early exits and bypass `networkStatsService` entirely; fixed by adding `networkStatsService.recordImageMemoryHit()` at each of the three early-exit sites
- **`getFromMemoryCache()` skipped LRU promotion** — the three `getFromMemoryCache()` callers in `AlbumArt.tsx` were getting cache hits without promoting the entry to MRU position in the Map, so entries served via the fast path were effectively FIFO-ordered and evicted earlier than entries served through `getImage()`; `getFromMemoryCache()` now does `delete()` + `set()` on hit (both direct-key and alias-resolved paths) to match the promotion behaviour of `getImage()`

---

## [26.7.17] - 2026-07-17

### Added
- **NowPlayingOverlay** — brand-new full-screen now-playing component (`src/components/Player/NowPlayingOverlay.tsx` / `NowPlayingOverlay.css`):
  - Ambient blurred album art background (blurred, darkened, saturated art wash behind the UI; dark scrim gradient for text legibility)
  - Drag handle bar at top (tap or swipe down to close with spring-back animation)
  - Three-card art carousel showing previous / current / next tracks; swipe left/right to skip with directional hint icons; spring-back below the 50 px threshold; swipe-down direction lock prevents carousel from triggering close
  - Info row: song title + artist with fade-in animation on song change; heart like button; small circular "add to playlist" icon button (replaces old full-width row)
  - Progress bar with current / total time labels
  - Controls row: shuffle, previous, play/pause (72 px primary), next, repeat with "1" badge in repeat-one mode
  - Streaming quality + playback speed selector row (pill buttons)
  - Quality change toast (3.5 s auto-dismiss)
  - Audio stats row always visible: Format, Bitrate, Sample Rate, Bit Depth, File Size (song object → Subsonic `getSong` API fallback; offline songs derive bitrate from download quality)
  - Remote mode support: all controls route through `RemoteModeContext`; remote-pending spinner on play/skip until next broadcast arrives (1.5 s safety timeout)
  - Escape key closes overlay
- **Repeat mode persistence** — repeat preference (`'off'` / `'all'` / `'one'`) saved to user-scoped localStorage key (`repeat_pref_<username>`); restored on app start; cleared on logout alongside queue, index, and shuffle keys (`getRepeatKey()` / `saveRepeat()` / `loadRepeat()` helpers in `PlayerContext.tsx`)
- **`imageCacheService.syncWithAppMode()`** — adjusts `maxConcurrentFetches` (4 / 2 / 1) and `maxMemoryCacheSize` (400 / 200 / 100) based on active power mode (normal / performance / power-saver); called at `initialize()` and via a `appModeChanged` DOM event listener registered at module load
- **Mode-aware cover art lookahead** — `PlayerContext` prefetches cover art for the next N songs in the queue where N = 4 (normal), 2 (performance mode), 0 (power-saver); native notification artwork preload skipped entirely in power-saver mode (`isPowerSaverEnabled()` guard)
- **Performance mode CSS hardening** — two new rules in `index.css`: removes all `text-shadow` (rule 12) and disables sub-pixel font anti-aliasing (rule 13) for cheaper glyph rasterisation when `body.performance-mode` is active
- **Power-saver mode CSS** — `image-rendering: pixelated` applied to all `img` and `.album-art` elements when `body.power-saver-mode` is active; eliminates GPU bilinear interpolation on scaled images

### Changed
- **NowPlayingOverlay album art sizing** — double horizontal padding eliminated (wrap + card each had 20 px padding; card now uses 8 px); all three responsive breakpoints (`≤900px`, `≤680px`, `≤560px`) now use `min()/max()` expressions driven by `100vh` and `100vw` instead of fixed `px` values so the art grows to fill available screen height; `.npo-art-wrap` gets `flex: 1 1 auto` to absorb remaining vertical slack; on a 412 × 869 px CSS phone the art grows from 332 px → 396 px wide (+19%)

---

## [26.7.16] - 2026-07-11

### Added
- **In-memory metadata TTL cache** (`src/services/metadataCache.ts`) — module-level Map-based cache with 30-minute TTL eliminates repeated Subsonic API calls when navigating between artists, albums, and song lists; covers artists list (`artists_<serverUrl>`), artist albums + coverArt (`artist_<artistId>`), album songs (`album_<albumId>`), and paginated All Albums pages (`albumsPage_<serverUrl>_<page>`)
- **getSongCount elimination** — `ArtistList.tsx` and `MainApp.tsx` now use `searchCacheService.getSearchIndex()?.songs.length` when the search index is loaded, avoiding an extra `getAlbumList2` API call to sum album song counts
- **Metadata cache invalidation on auth change** — `metadataCache.invalidate()` called as the first line of both `AuthContext.login()` and `AuthContext.logout()`, preventing stale data from leaking between user sessions or servers
- **Web Worker for search** (`src/services/searchWorker.ts`) — real-time search filter (3 `.filter()` passes over artists, albums, and songs) runs entirely off the main thread; `searchCacheService.search()` is now async (returns a Promise); main-thread fallback on worker failure; zero UI jank on 25K+ song libraries; worker receives the full index once via an `init` message and answers subsequent `search` messages with a result ID for Promise resolution
- **Virtual scrolling in SongList** — albums with ≤ 60 songs render naturally (no overhead); albums with > 60 songs use a `react-window v2` `List` + `react-virtualized-auto-sizer v2` `AutoSizer` hybrid so the DOM node count stays near constant regardless of album size; uses `rowComponent` + `rowProps` API (v2 is incompatible with v1)
- **Fisher-Yates shuffle queue** — `buildShuffleQueue(length, currentIdx)` in `PlayerContext.tsx` pre-shuffles an index array at shuffle-on or playlist-change time; `shuffleQueueIndexRef` steps through it linearly so each song plays exactly once per cycle before any repeats begin; eliminates `Math.random()` on every next-track call
- **Gapless preload safety-net** — `timeupdate` listener added in `PlayerContext.tsx`; when remaining time drops below 15 s, `preloadRef.current.src` is set if not already assigned; ensures next-song buffering begins even when the next song was not known at the start of the current track
- **True LRU image memory cache** — `imageCacheService.ts` now promotes cache entries on both read (`getImage`) and write (`addToMemoryCache`) via Map `delete()` + `set()` (re-insert at tail = MRU); eviction removes the actual least-recently-used entry rather than the oldest-inserted entry (FIFO bug fixed)
- **IDB batch writes during image preload** — `cacheImagesBatch` writes images in configurable batches (`IDB_WRITE_BATCH = 50`) instead of one write per image, significantly reducing IndexedDB transaction overhead during the cache preload phase

### Changed
- **Electron IPC player-state throttle** — `PlayerContext.tsx` splits the single player-state `useEffect` into two: (A) metadata effect fires immediately on song/play-state/control changes; (B) position effect is gated at 500 ms so position updates reach the mini player at most 2 fps; IPC call rate drops from ~3,600/min to ~120/min during playback without any visible lag on the mini player

## [26.7.6] - 2026-07-06

### Added
- **Cache integrity verification** — new `verifyPermanentCache()` in `offlineCacheService.ts` performs real filesystem existence checks (`Filesystem.stat` on Android, main-process IPC on Electron) on every cached song entry; removes orphaned index entries and decrements ref counts for missing files; emits `cache-verify-started`, `cache-verify-progress` (every 25 songs), and `cache-verify-complete` events
- **"Verify Cache" button** in Download Manager → Manage Cache section; shows live "X / Y songs" progress counter while running; displays result banner with verified count, orphaned entries removed, and elapsed time when done
- **Auto-verification after downloads** — when the download queue fully drains, cache verification runs automatically in the background; the `isVerifying` guard prevents concurrent runs if the queue cycles quickly

---

## [26.7.4] - 2026-07-04

### Fixed
- **Duplicate event guards** — `songDownloaded` and `songFailed` handlers in `downloadManagerService.ts` now check `item.status` at entry; repeat Capacitor events (possible after renderer restart / batch hijack) can no longer double-increment `sessionCompleted`/`sessionFailed`
- **`totalSize` double-count** — `registerNativeDownload` and `addToCache` in `offlineCacheService.ts` now subtract the existing song's `fileSize` before overwriting; re-registration (reconcileOrphans, rescues) no longer inflates cache size stats
- **Debounced saves** — `queueIndexSave()` / `queueRegistrySave()` collapse ~5000 IPC writes during a large batch (e.g. 2484-song download) to a handful; `flushAll()` forces an immediate write at batch end
- **Queue dedup** — `addAlbumToQueue` and `addSongToQueue` skip songs that are already cached or already `pending`/`downloading` in the queue; prevents `sessionTotal` inflation and re-downloads when "Download Missing" runs during an active batch
- **Stale reference cleanup** (Android) — after `bc.resolve()` in `DownloadService.java`, `batchCall` and `broadcastPlugin` are set to `null` to release GC references and prevent accidental double-resolve
- **`clearAllCache` single flush** — `removeFromCacheCore()` extracted as an in-memory-only private method; `clearAllCache` calls it per song then writes both files exactly once at the end instead of one write per song

---

## [26.7.3] - 2026-07-03

### Added
- **Orphan recovery** (`reconcileOrphans()`) — on app startup, reads `permanent_cache/completion_log.ndjson` (written by `DownloadService.java` after every successful native download) and cross-references a `pendingBatch` map persisted to localStorage; registers any audio files that landed on disk but whose `songDownloaded` event was lost to a renderer OOM kill; called in `MainApp.tsx` before `tryResumeQueue()`
- **Clear All App Data** — "Danger Zone" button in Settings clears all Xylonic data: JS download queue, audio cache index, image IndexedDB, search IndexedDB, localStorage; on Android also calls `clearAllNativeData()` plugin method which deletes `permanent_cache`, WebView HTTP cache, WebView cookies, WebStorage SQLite, and SharedPreferences

### Fixed
- **Download wakelock expiry after ~30 min (Android)** — removed the `!isHeld()` guard so `acquireWakeLock()` always resets the 2-hour timeout; watchdog `Runnable` in `DownloadService.java` now calls `acquireWakeLock()` every 2 s independently of WebView/JS activity, preventing downloads from stalling when Android backgrounds the WebView
- **WebView OOM crash during large batch registrations (Android)** — added a serial `registrationQueue: Promise<void>` chain in `downloadManagerService.ts` so `registerNativeDownload` calls run one at a time; 1171 concurrent fire-and-forget registrations each serializing the full cache JSON caused V8 heap exhaustion; now only one is in flight at a time
- **Offline artist cover art** — `artistCoverArtId` (the `ar-xxx` ID matching IDB-preloaded artist photos) was never stored in cache metadata; `ArtistList.tsx` bulk download now builds an `artistCoverArtById` map from loaded state; `AlbumList.tsx` reads `artist.coverArt` from the `getArtist` response; `SongList.tsx` calls `getArtist(album.artistId)` to retrieve the `ar-xxx` ID; artist photos now display correctly in offline mode for newly downloaded songs
- **Offline ArtistList display** — two-pass cover art builder prioritizes `artistCoverArtId` → solo-song `coverArtId` → lead-song → any song, preventing a duet/collaboration song's album cover from appearing as the artist image
- **Download Manager "Done: 0" after renderer restart (Android)** — when the WebView OOM-kills, `DownloadService` continues writing files; a new JS session calling `startBatch` was queued behind the old batch in `downloadExecutor`; `DownloadService.java` now updates `broadcastPlugin` and `batchCall` fields in-place so the running thread broadcasts to the new WebView; newly recovered (reconciled) songs are immediately counted in `sessionCompleted` without re-downloading

---

## [26.6.29] - 2026-06-28

### Changed
- **Vite 8 replaces CRA / react-scripts** — dev server starts in milliseconds (no Webpack bundling on startup), near-instant HMR, Rollup + esbuild production builds
- **React 19.2.7** (up from 18.2.0) — new JSX transform; no longer need to `import React` in every file
- **TypeScript 6.0.3** (up from 4.9.5) — stricter type checking, `moduleResolution: "bundler"` for Vite-compatible imports
- **electron-builder 26.x** (up from 24.x)
- **Build output directory** changed from `build/` to `dist/` — all Electron and Capacitor config updated accordingly
- **`@vitejs/plugin-legacy`** generates a Babel-transformed legacy bundle targeting `android >= 7, chrome >= 56`, ensuring compatibility with Android 7/8/9 (Android Go) WebView

### Fixed
- **Blank screen on Vite migration** — `src/platform/bridge.ts` used CRA/Webpack dynamic `require()` which is undefined in Vite's ESM environment; replaced with static ES imports and runtime selection in `getBridge()`
- **Dev server port** — Vite configured to serve on port 3000 (matching the existing Electron `loadURL` config) so `electron:serve` works without any changes to `public/electron.js`

## [26.6.25] - 2026-06-25

### Added
- **Remote Control on Electron desktop** — Electron now fully participates in LAN remote mode as both a target ("Be Controlled") and a controller ("Control Others"), not just Android
- **"Be Controlled" / "Control Others" toggles** — two independent remote mode toggles in the hamburger menu and Settings; "Control Others" is desktop-only (Android acts as controller via its existing bottom-nav flow)
- **Remote button in desktop header** — pill button in the header shows device count or "Connected" state; click to open the device picker
- **Remote section in Settings** — dedicated Remote section with toggles, device picker, and firewall setup in the Settings view
- **FirewallSetupDialog** — built-in dialog with ready-to-paste firewall commands for Linux (ufw, firewalld, nftables, iptables) and Windows (netsh CMD, PowerShell) to open UDP 7766 and TCP 7767
- **Device name format** — devices now advertise as `hostname,OSType` (e.g. `mypc,Linux`) so you can distinguish them in the picker
- **Startup device snapshot IPC** — `remote-get-devices` IPC handler seeds the renderer with devices discovered by the main process before the renderer finished loading

### Fixed
- **Desktop cannot discover phone** — Electron was calling `addMembership()` without an interface, which only joined the default-route adapter; now iterates all non-loopback IPv4 interfaces and joins multicast group `239.255.85.89` on each, so the phone's multicast broadcasts are received correctly
- **Desktop cannot pair with / control phone** — `remote-send-command` IPC was serialising the `data` field as a JSON string; Android's `handleCommand()` called `getJSONObject("data")` which threw `JSONException` and returned no response, causing a 5-second timeout on the desktop side; fixed by parsing `data` back to an object before building the HTTP body
- **Device name mismatch** — `buildDeviceName()` in the renderer returned `'Desktop'` while the main process used the real hostname; name is now synced from the main process via `remoteGetDeviceName()` during `initElectron()` so UDP broadcasts and pair handshakes show the same name

## [26.6.24] - 2026-06-24

### Added
- **Right-click context menu on song rows** — right-click any song in album views or search results to open a context menu with: Play Now, Play Next, Add to Queue, Add to Playlist, and Download
- **Play Next** — new queue operation that inserts a song immediately after the current track instead of appending to the end of the queue
- **Liked Songs View** — dedicated paginated view listing all starred/liked songs, with full context menu support and offline cache awareness

### Fixed
- **Discover — Recently Played always empty** — API type was incorrectly set to `recentlyPlayed`; corrected to `recent` per the Subsonic spec
- **Download Manager cache location on Android** — called an Electron-only IPC method, showing "Error loading location"; now reads the real path via the platform bridge so it works on all platforms; Change Location button remains Electron-only
- **Equalizer bars off-center in song rows** — bar spans were left-packed inside their flex container, shifting them left of the album art center; fixed by adding `justify-content: center`
- **Text selection and tap highlight** — added global `user-select: none` and `-webkit-tap-highlight-color: transparent` so no UI element can be accidentally highlighted or show a blue flash on tap, including the Now Playing bar

### Changed
- Context menu restyled to match the app theme: correct background color, border radius, shadows, and inherited font; touch targets increased to 48 px tall on desktop and 56 px on mobile
- Album view and Search Results both support the new context menu; keyboard-driven workflow unchanged
- Queue panel "Add to Queue" button on song rows still appends to end; right-click → Play Next inserts at position 1

---

## [26.6.20] - 2026-06-20

### Added
- Sleep timer — auto-stop playback after 15, 30, 45, or 60 minutes with live countdown badge in hamburger menu
- Discover / Home view — curated carousels for Recently Added, Recently Played, Most Played, and Random Mix; refreshable on demand
- Sidebar navigation — persistent left-side nav with Home, Library, Downloads, and Settings sections
- Remote Control (Android / LAN) — UDP device discovery on port 7766 and HTTP command server on port 7767 for cross-device playback control
- Dedicated Settings panel — offline mode, performance, cache, theme, and debug options in one place
- Performance Mode / Power Saver Mode — CPU core-affinity control for performance vs. battery life
- MPRIS2 integration — native Linux D-Bus media controls and taskbar integration (compatible with playerctl)
- Missing songs banner — detects un-cached songs and offers one-click bulk download
- New content detection — compares server library counts with local index on launch and prompts a cache refresh
- Switch Server — quickly switch between saved connections from the hamburger menu without full logout
- Rebuild Cache — re-fetches library index without deleting downloaded audio files
- Linux .deb and AppImage packages

---

## [26.6.5] - 2026-06-05

### Added
- Queue management — view, drag-to-reorder, remove, and clear the playback queue
- Queue persistence — queue survives app restarts (saved to localStorage per user)
- Recently Played history — auto-tracked last 50 songs, re-playable, clearable, with time-ago display
- Playlist management — create, rename, delete, and reorder songs in saved playlists
- Add to Queue / Add to Playlist buttons on all song rows
- Save Queue as Playlist — one-click saves the current queue into a named playlist
- In-panel search/filter — filter songs in Queue, History, and Playlists panels in real-time
- Right Panel — slide-in side panel with Queue, Recently Played, and Playlists tabs
- Now Playing fullscreen overlay — tap/click the player bar to open a full-screen Now Playing view
- Swipe to skip — swipe left/right on album art in Now Playing overlay to change tracks
- Playback speed control — 0.5× to 2× in seven steps, available in playback bar and Now Playing overlay
- Library view toggle — switch between Artists, All Albums grid, and All Songs grid
- All Albums grid — browse every album across all artists with pagination
- All Songs grid — browse entire song library with pagination
- Last.fm scrobbling — automatic scrobbling via user-supplied API key and secret
- Internet artwork fallback — album art fetched from iTunes API when server art is unavailable
- Android support — Capacitor bridge for native Android builds
- Mobile bottom navigation — bottom tab bar for Home, Library, Search, Queue, Playlists, and Remote
- Animated equalizer bars on the currently playing song row
- Panel keyboard shortcuts — Q (Queue), H (History), P (Playlists)
- Ctrl+K to focus the search bar
- Ctrl+Shift+Delete to wipe image cache and search index (preserves offline songs)

---

## [26.2.16] - 2026-02-16

### Added
- Encrypted credential storage — OS-native secure storage (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- HTTPS enforcement — all external connections require HTTPS
- Offline mode login — enter offline mode with encrypted stored credentials
- Multi-user offline cache — each Subsonic user has an isolated offline cache
- Cover art aliasing — storage-efficient deduplication: multiple songs in the same album reference a single image file
- Logout state management — clears playback, resets navigation, preserves username
- Theme-aware cache indicators — badges and quality indicators respect custom theme colors
- Loading spinner (throbber) on play button while buffering

---

## [26.2.7] - 2026-02-07

### Added
- Initial release
- Stream music from any Subsonic-compatible server (Navidrome, Airsonic, Gonic, etc.)
- Full playback controls: play, pause, next, previous, seek, volume, mute
- 8 preset themes + 4 custom theme slots with live color picker
- True random shuffle (All library + per album)
- Keyboard shortcuts with in-app Help dialog
- Mini Player mode (always-on-top compact window)
- Offline mode — download albums to permanent cache at selectable bitrates
- Download Manager with pause/resume/retry
- Streaming quality selector (Original, 320, 256, 192, 128, 64 kbps)
- Library browser: Artists → Albums → Songs hierarchy with pagination (50 per page)
- Real-time search across artists, albums, and songs
- Favorites/starred songs
- Beautiful album art with animated equalizer on the current song row
- MPRIS2 Linux D-Bus integration
