# Session Summary

## Current Focus (September 6, 2026 — WS-ARCH / WS-PERF in progress)

**RESUME HERE (next session):** last uncommitted change is the `getAllSongs`
concurrency (`subsonicApi.ts` + test + CHANGELOG + ROADMAP box) — user commits it
as `perf(subsonic): fetch getAllSongs pages in concurrent batches of 4`. Then
continue **WS-ARCH: split `downloadManagerService` (2064)** → `downloadQueue` /
`downloadTransport` / `downloadReconciler` (the reconciler unblocks the
idempotent-`songDownloaded`/`songFailed` + orphan-recovery tests). Order for the
rest: finish `downloadManagerService`, then `PlayerContext` hooks
(`useMediaSession` / `usePlaybackEngine` / `useQueue`), then `electron.js` →
`ipc/*` (user smoke-tests — no Electron on Linux), `SettingsView` split,
`react-router` + `LayoutModeContext`. Then WS-PERF proper, WS-UX, WS-FEAT/DOCS,
and WS-SEC-leftovers + WS-TV last. 100 tests green, `npm run lint` 0 errors, CI
workflow live. iPhone 15 Pro Max available for on-device iOS verification.

---

## Focus (September 6, 2026 — WS-ARCH first slice)
Working the roadmap in order (security + Android TV deferred to last, per user).
WS-QUAL core + WS-TEST baseline (76 tests, CI) committed through `3b3a393`.
**Now WS-ARCH**, starting with the lowest-risk cut: extracted `PlayerContext`'s
pure queue math into `src/context/playerQueue.ts` (`buildShuffleQueue`,
`computeNextIndex`) + 10 unit tests; `PlayerContext` wired to it, behaviour
preserved. 86 tests total, build + lint clean. This doubles as the WS-TEST
"PlayerContext queue" coverage and is step 1 of the four-way `PlayerContext` split.

### WS-ARCH plan (one god-object per commit, safest first)
1. `PlayerContext` (1555) → `playerQueue.ts` (10 tests) + `playerPersistence.ts`
   (8 tests, in-app verified) + `utils/dataUrl.ts` (5 tests — dedup of the
   FileReader→dataURL / chunked-base64 copies) all done → then `useQueue` (state)
   / `usePlaybackEngine` (audio element / src swap / gapless) / `useMediaSession`
   (large; needs 3-platform manual verification). `PlayerProvider` composes;
   `usePlayer()` API unchanged. 99 tests total.
- NOTE: lint now surfaces ~17 "Unused eslint-disable directive" warnings — these
  are dead `// eslint-disable-line react-hooks/exhaustive-deps` comments; cleaning
  them is the WS-QUAL exhaustive-deps audit, deferred (risky bulk edit, low value).
2. `downloadManagerService` (2064) → `downloadQueue` / `downloadTransport` /
   `downloadReconciler` (the last unblocks the idempotent-events + orphan tests).
3. `public/electron.js` (2196) → `public/ipc/*` by domain — **unverifiable in this
   env (no Electron run); needs the user to smoke-test after**.
4. `SettingsView` (1226) → one component per section.
5. `react-router` + `LayoutModeContext`.
6. Split `ARCHITECTURE.md`; ADRs.

### WS-PERF started (interleaved)
- `getAllSongs` (`subsonicApi.ts`): serial pagination → probe page 0, then batches
  of 4 concurrent `search3` requests; stop on first short page. Order + `failed`
  handling + offline guard preserved. 100 tests total.
- User confirmed (this session): they have a **physical iPhone 15 Pro Max 256GB**
  + the CDP on-device debug workflow — proceed with iOS-affecting refactors
  without blocking on Linux-side verification; verify together on-device later.
  (Memory: `reference_ios_debug_device`.)

### Earlier this session (superseded focus below)

### This increment
- `vitest.config.ts` (jsdom, globals, `@` alias, coverage → `src/services`/`src/context`),
  `src/test/setup.ts` (`@testing-library/jest-dom/vitest`). Scripts: `test`,
  `test:watch`, `test:coverage`, `typecheck`. Deps: `vitest`, `@vitest/coverage-v8`,
  `@testing-library/{react,jest-dom,user-event}`, `jsdom`.
- Import-chain strategy: `vi.mock('../utils/logger', …)` + `vi.mock` the
  platform-touching deps so service tests don't drag in `@capacitor/*`.
- Suites (**61 tests, 8 files**): `subsonicApi` (8), `credentialsService` (8),
  `cfgParser` (5), `offlineCacheService` (7 — totalSize: no double-count on
  re-register, replace-on-quality-change, sum, decrement-on-remove, never-negative),
  `downloadManagerService` (5 — queue dedup), `cacheHelpers` (16 — hash
  determinism + trailing-slash normalization, userId, formatBytes,
  content-type→ext), `fallbackBridge` (7 — interface contract), `searchCacheService`
  (5 — main-thread fallback filter correctness + 20/20/50 caps).
- Patterns: god-objects → mock `getBridge` with a minimal in-memory fake,
  `vi.resetModules()` + dynamic import per test, `pauseQueue()` to stop
  `processQueue`; `searchCacheService` → inject a synthetic `searchIndex` +
  null `worker` to hit the fallback branch without IndexedDB (jsdom has none);
  debounce tests → `vi.useFakeTimers()` + `advanceTimersByTimeAsync`.
- Also added: `electronBridge` (7) + `capacitorBridge` (6) contracts,
  `offlineCacheService` debounced-save (2), `.github/workflows/ci.yml` (lint +
  test + build gate; typecheck non-blocking until TS 5.x). **76 tests, 10 files.**
- Coverage (`--coverage`) reports ~10% aggregate — targeted unit tests of a few
  large modules don't move the number; no threshold gate until WS-ARCH splits
  `PlayerContext`/`downloadManagerService` into unit-testable pieces. A
  full-flow `downloadBatchNative` idempotency test was attempted and dropped
  (fake-timer + nested-await deadlock, 20s timeouts) — the guard is a one-liner,
  revisit via `downloadReconciler` in WS-ARCH.
- **WS-TEST is a working harness with the high-value regression tests + CI, not
  its full DoD** (60% coverage / PlayerContext queue / MSW outstanding). Enough
  baseline behavioural pinning to start WS-ARCH carefully; note the pinning is
  partial when splitting `PlayerContext` / `downloadManagerService`.
- **Regression fix**: `44aebfd`'s `any`→`unknown` on `customThemes` in
  `cfgParser.ts` / `colorConfigManager.ts` broke `tsc` (11 errors, invisible to
  the esbuild build). Reverted to `any` + `eslint-disable`. `tsc --noEmit`
  baseline is now back to ~59 pre-existing errors (mostly `moduleResolution:
  bundler` unsupported on TS 4.9 — clears with the WS-PERF TS 5.x bump — plus
  `HistoryEntry`/`CompressionStream` lib gaps).

### Next (WS-TEST)
- `offlineCacheService` size accounting (no double-count on re-register), debounced
  save flush, orphan register.
- `downloadManagerService` queue dedup, idempotent `songDownloaded`/`songFailed`,
  `reconcileOrphans`, batch-hijack.
- `PlayerContext` Fisher-Yates queue / repeat / boundaries (needs RTL + heavy
  context mocking).
- `searchCacheService`/`searchWorker` fallback; `src/platform/` bridge contract
  tests; mock Subsonic server (MSW); wire `test` + `typecheck` into CI.

---

## Previous Focus (September 6, 2026 — WS-QUAL phase 1a)
Working WS-QUAL in roadmap order. Committed: console→logger sweep + dead-file
deletion (`be0c11a`). This increment (uncommitted): ESLint flat config + Prettier
config + scripts/devDeps, and the roadmap-named silent-`catch {}` starting points.
Still open in WS-QUAL: run/tune lint (needs `npm install`), the remaining ~114
silent catches, `any` reduction (< 30; type `src/types/subsonic.ts`), Vite prod
log-strip, CI wiring. WS-TEST (phase 1b) not started — also needs `npm install`.

### This increment
- `eslint.config.mjs` — ESLint 9 flat, `typescript-eslint` 8 recommended (no
  type-checked rules, for speed). `no-console: error` (logger.ts exempt);
  `no-empty` (allowEmptyCatch:false), `no-explicit-any`, `exhaustive-deps` = warn.
  `eslint-config-prettier` last.
- `.prettierrc.json` (singleQuote, semi, printWidth 100, tabWidth 2, trailingComma
  all) + `.prettierignore`. **No `prettier --write` run** — that's a whole-repo
  reformat the user should do + commit as its own change.
- `package.json` — `lint`/`lint:fix`/`format`/`format:check` scripts; devDeps
  `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`,
  `globals`, `prettier`, `eslint-config-prettier` (versions are best-guess majors,
  verify on install).
- Silent catches → `logger.error`: `MainApp.tsx` (missing-songs check,
  queue-missing) and `App.tsx` (the duplicated missing-songs check + queue-missing
  — note App.tsx and MainApp.tsx still carry near-identical copies of this logic,
  a known landmine, left as-is).

Build clean each step (`npm run build`). `npm install` + `npm run lint` were run
(user asked): lint **passes, 0 errors** after 3 fixes (`{}` type →
`Record<string, never>` in `global.d.ts` + `remoteDiscoveryService.ts`; one
`let`→`const` in `cfgParser.ts`). 268 warnings: 146 `no-explicit-any`, 55
`no-unused-vars`, 37 `no-empty`, 29 `react-hooks/exhaustive-deps` — the
warn-now-error-later backlog. `npm audit`: 24 vulns (3 critical / 13 high / 8
moderate) reported at install — that's a WS-SEC "Should" item, untriaged.

### What changed
- **`console.*` → `logger.*`** — 193 calls across 35 files (script in scratchpad,
  import-insertion made multi-line-import-aware after a first bad run was reverted
  via `git checkout -- src/`). Files with an existing `./logger` import got a
  duplicate that was then removed (`cfgParser.ts`, `settingsManager.ts`).
- **`utils/logger.ts`** — `error`/`warn` no longer gated on `loggingEnabled`; they
  always `console.error`/`console.warn` (the pre-sweep behaviour for those two,
  which always hit the console). `log`/`info` stay gated — that is the actual
  noise reduction. File sink still only runs when logging is enabled.
- **Deleted** `src/services/offlineCacheService.v1.backup.ts.txt` and
  `offlineCacheService.v2.ts` (0 external refs; `npm run build` clean without them).

Build: `npm run build` clean (~26 s).

### Deferred (still WS-QUAL / phase 1)
- ESLint + `typescript-eslint` + Prettier config + `lint`/`format` scripts + CI
  wiring (needs `npm install`).
- `no-empty` / silent-`catch {}` sweep → `logger.error('[area]', e)` + retry
  affordances (ties to WS-UX).
- `any` reduction (< 30 target; type the Subsonic response surface).
- Vite `define` / transform to drop `logger.log`/`info` calls entirely in prod.

---

## Previous Focus (September 6, 2026 — WS-SEC phase 1)
Started executing `docs/ROADMAP.md`. User asked to "implement all of it"; scoped
down to WS-SEC (credentials) phase 1 since the roadmap gates the full plaintext
removal behind WS-TEST, and JKS rotation / history purge / `webSecurity:true` are
either the user's job or need a 4-target desktop device pass. Landed the single
credential-path foundation + isolated hardening; build clean; web login flow
screenshot-verified on the Vite dev server (user logs in manually).

---

## What Changed This Session (September 6, 2026 — WS-SEC)

### New: `src/services/credentialsService.ts` + `src/hooks/useCredentials.ts`
One authoritative accessor for `{serverUrl, username, password}`:
- `getCached()` — synchronous best-effort read from a module-level cache that is
  hydrated from `localStorage` at import (preserves the exact timing the ~30
  existing call sites had when they read `localStorage` directly).
- `get()` — async; prefers the encrypted backend (`secureCredentialService` →
  Electron `safeStorage`) for the password, refreshes the cache.
- `set()` / `clear()` — keep the encrypted store, the sync cache, and legacy
  `localStorage` in step. `hydrate()` runs once at boot from `AuthContext`.
- `useCredentials()` — `useSyncExternalStore` over the `auth-changed`/`logout`
  events `AuthContext` already dispatches.

### Migrated every `localStorage.getItem('password')` in app code → `getCached()`
App.tsx, MainApp.tsx, all `components/Library/*` list+grid views, MiniPlayer,
CachePreloadDialog, SearchContext, useScrobbler, useSongList, likedSongsService,
apiErrorHandler, downloadManagerService (2 sites), subsonicApi (`search()`),
`utils/storage.ts` (`getFromStorage()` now delegates — migrates its 10 consumers
incl. PlayerContext for free). Mechanical block-level transform (scratchpad
script) + hand edits for the irregular ones. `AuthContext.login/logout` now go
through `credentialsService.set/clear`. **Plaintext `localStorage` is still
written** as the sync hydration source — removing plaintext-at-rest needs the
WS-TEST harness + a guaranteed secure-hydrate-before-first-read, deferred.

### Isolated hardening
- `subsonicApi.generateAuthParams` + 2 cover-art fetches in
  `downloadManagerService`: salt now `crypto.getRandomValues` 16-byte hex, was
  `Math.random().toString(36)`.
- `subsonicApi.search()`: removed the `console.log` of `localStorage` (password
  included) and the duplicated inline auth-param block.
- `public/electron.js`: `setWindowOpenHandler` → default-deny on both windows
  (mini-player had none); production-only CSP via `onHeadersReceived`
  (`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
  `frame-ancestors 'none'`, no `unsafe-eval`; `'unsafe-inline'` still allowed for
  script/style, dev skipped). `index.html` meta-CSP deferred.

Build: `npm run build` clean (~26 s). Web dev server login page renders, no JS
errors (lone 404 is the favicon; "Secure storage not available" is expected on
web/fallbackBridge).

### Not done (tracked)
- Full plaintext-at-rest removal (WS-TEST-gated).
- `xylonic://` protocol + `webSecurity:true` (4-target desktop pass).
- JKS rotation + `git filter-repo` history purge (user).
- `npm audit` CI gate; Capacitor `Preferences`-group Keychain/Keystore backend.

---

## Previous Focus (September 6, 2026)
User-reported iOS bug: switching from offline mode back to online mode leaves a library view stuck on "Loading…" indefinitely (everything else — background downloads, offline playback — works). Diagnosed as a three-part bug and fixed in the shared frontend layer; awaiting an iOS device test. The Aug 5 iOS-downloads investigation is still open and unchanged — pick that up separately via CDP debugging.

---

## What Changed This Session (September 6, 2026)

### iOS: infinite "Loading…" on offline → online switch
Root-cause chain, all in the shared Vite/React layer:

1. **Stale `isOnline` on iOS.** `OfflineModeContext` only updated `isOnline` from `navigator.onLine` + the `window` `online`/`offline` events. The `@capacitor/network` listener it registers (added Jul 31 for cellular detection) only ever called `setIsCellular` — never `setIsOnline`. WKWebView is unreliable about `navigator.onLine` and those events, so after launching with no connection `isOnline` was frozen at `false`.
2. **`toggleOfflineMode()` never re-checked connectivity.** Going offline→online flipped `config.enabled` but didn't touch `isOnline` or call `checkConnectivity()`. Result: `offlineModeEnabled === false` while `isOnline === false`. `ArtistList` gates on `offlineModeEnabled || !isOnline`; the grids go straight to the network path.
3. **No axios timeout anywhere in the app.** `src/index.tsx` set a response interceptor but never `axios.defaults.timeout`. The first WKWebView XHR after the transition hangs (WebView network stack not recovered even though native `URLSession` downloads work — different stack), the promise never settles, and the component's `loading` state is never cleared. The interceptor only reacts to `ERR_NETWORK`/`Network Error`, which a hung (never-resolving) socket never emits.

Fixes:
- `src/index.tsx` — `axios.defaults.timeout = 15000`; interceptor now also fires `app:connectivity-error` on `err.code === 'ECONNABORTED'` (the timeout) so `App.tsx` re-runs `checkConnectivity()`.
- `src/context/OfflineModeContext.tsx` — native branch now calls `setIsOnline(s.connected)` from both `Network.getStatus()` and the `networkStatusChange` handler, alongside the existing `setIsCellular`.
- `src/context/OfflineModeContext.tsx` — `toggleOfflineMode()` calls `checkConnectivity().catch(() => {})` when `wasOffline && !newConfig.enabled`.

Build verified clean (`npm run build`, ~25 s, zero errors). **Not yet tested on an iOS device.**

Android was almost certainly never affected (its WebView fires `online`/`offline` reliably and recovers its network stack immediately, so the same XHR resolves), but it gets the same hardening for free.

### Noted but not changed
- The `if (!cacheInitialized) return;` lines in `ArtistList`/`AllSongsGrid`/`AllAlbumsGrid` carry a comment claiming they "keep the spinner until cache is ready" — but the `finally` blocks clear `loading` anyway, so the comment is misleading. Harmless; left alone.
- `checkConnectivity()` pings `https://www.google.com/favicon.ico` (also untimed) — pinging the user's own Subsonic server `ping.view` would be more appropriate. Left alone.

---

## Previous Focus (August 5, 2026)
iOS downloads are still broken on the latest installed build. This session found and fixed two real bugs (native batch download queue, and a project-wide Capacitor 8 plugin-registration incompatibility affecting every custom iOS plugin) but a download failed again after installing the build with both fixes — there is at least one more bug. Next session should pick up with live CDP debugging (tooling already documented in `IOS_SETUP.md`) rather than re-diagnosing from scratch.

---

## What Changed This Session (August 5, 2026)

### iOS: native batch download queue
`BackgroundDownloadPlugin.swift` gained `startBatch`/`cancelBatch`, enqueuing every pending song's `URLSessionDownloadTask` on the background `URLSession` up front — mirrors Android's existing `NativeDownloader.startBatch` pattern. `downloadManagerService.ts` gained `downloadBatchNativeIOS()` and a three-way dispatch in `processQueue()` (Android batch / iOS batch / single-song fallback), removing the dependency on a JS `setTimeout` chain firing reliably between songs while the app is backgrounded. This was the originally-suspected bug (WKWebView JS timers throttling in the background) — real, and fixed, but not sufficient on its own; see below.

### Electron: desktop download progress UI
Filled in `showDownloadNotification`/`hideDownloadNotification` in `electronBridge.ts` (previously no-ops) — dock/taskbar progress bar, tray icon with live tooltip, macOS dock badge. New `set-download-progress`/`clear-download-progress` IPC handlers in `public/electron.js`. Independent of the iOS work; ships fine on its own.

### iOS: found and fixed a project-wide plugin registration bug
Extensive live-device debugging (see "Debugging on Linux" section of `IOS_SETUP.md` for the tooling — `idevicesyslog` + `pymobiledevice3 webinspector cdp`) revealed that **every** custom native Swift plugin in the project — not just downloads — was throwing `"X" plugin is not implemented on ios` at runtime, including methods that predate this session (`probeConnection`, `readCompletionLog`, `BackgroundKeepAlive.arm`). Root cause: `BackgroundDownloadPlugin.swift` and `BackgroundKeepAlivePlugin.swift` used the old pre-Capacitor-7 Objective-C `CAP_PLUGIN` macro registration pattern (separate `.m` files), which doesn't reliably register under Capacitor 8's SPM-oriented bridge (confirmed via Capacitor's own docs — the current pattern requires `CAPBridgedPlugin` conformance with explicit `identifier`/`jsName`/`pluginMethods` declared in Swift). Migrated both plugins, deleted the obsolete `.m` files, updated `ios.yml`.

**This means iOS background downloads (and the audio keep-alive trick) likely never actually worked on a real device before this session, regardless of any of the earlier "iOS background downloads working" implementation notes** — those were never verified against a real plugin call actually reaching native code.

### Still broken
After installing the build containing both fixes above, the user reported a download still failed. The plugin-registration fix is verified correct (confirmed via CDP that plugin methods no longer throw "not implemented" for at least some calls), so whatever's left is a bug in the download flow itself, not registration. Diagnostic tracing (`xyDebugTrace` Capacitor event, in `BackgroundDownloadPlugin.swift`) is already in place for the next session to pick up with live CDP debugging.

---

## What Changed Previously (August 2, 2026)

### iOS: local-network permission probe
`BackgroundDownloadPlugin.swift` / `.m` — new `probeConnection(url:)` method fires a foreground `URLSession.shared` HEAD request before the first background download. iOS 14+ background URL sessions are handled by `nsurlsessiond` (a system daemon) which bypasses the local-network permission prompt entirely — the OS never asks. The foreground probe triggers the dialog while the app is in the foreground. `BackgroundDownloadPlugin.m` registers the new method. TypeScript interface gets `probeConnection` signature. `downloadManagerService.ts` gets `iosNetworkProbed` flag (reset each JS session) and calls the probe at the start of `downloadSongNativeIOS` once per session.

### Android CI: APK never uploaded (gitignore root cause)
Root `.gitignore` had `app/` (non-anchored, intended for a long-gone Electron `app/` directory). The pattern matched `android/app/` too, silently excluding the entire Android `:app` module source from git: `build.gradle`, `AndroidManifest.xml`, all Java source files, all resources. On CI, Gradle found `:app` in `settings.gradle` but with no `build.gradle` treated it as an empty project — 121 library tasks ran, zero app tasks, no APK produced. Fix: anchored to `/app/` in root `.gitignore`; committed all `android/app/` source; added `app/capacitor.build.gradle` to `android/.gitignore` (generated by `cap sync`, not needed in git).

### Android CI: APK upload robustness
Added `Locate debug APK` step using `find android/app/build/outputs -name "*.apk"` that exports `APK_PATH`; upload step uses `${{ env.APK_PATH }}` instead of hardcoded path; `if-no-files-found: error` so a missing APK fails visibly.

---

## What Changed Previously (July 17, 2026)

### NowPlayingOverlay — new full-screen component
`src/components/Player/NowPlayingOverlay.tsx` and `NowPlayingOverlay.css` (new files).

| Feature | Detail |
|---|---|
| Ambient background | Blurred (50px), darkened (0.22 brightness), saturated (1.8×) art wash; dark scrim gradient for text legibility |
| Drag handle | Top bar; tap or swipe down closes with spring-back animation |
| Three-card carousel | Previous / current / next art; swipe left/right to skip; directional arrows as hints; spring-back below 50 px threshold; swipe-down direction lock prevents carousel triggering close |
| Info row | Song title + artist, fade-in on song change; heart like button; circular playlist icon button (replaces old full-width row) |
| Controls | Shuffle, previous, play/pause (72 px primary), next, repeat with "1" badge in repeat-one mode |
| Quality / speed | Streaming quality selector + playback speed selector pill buttons |
| Quality toast | 3.5 s auto-dismiss toast on quality change |
| Audio stats row | Format, Bitrate, Sample Rate, Bit Depth, File Size always visible; song object → Subsonic `getSong` fallback; offline: bitrate from download quality |
| Remote mode | All controls route through `RemoteModeContext`; primary button pulses (throb animation) while remote-pending; 1.5 s safety timeout + 400 ms minimum delay |
| Keyboard | Escape key closes overlay |

### Dynamic album art sizing
- `.npo-art-wrap { flex: 1 1 auto; }` — grows to absorb remaining vertical slack in default (large-screen) layout
- Double horizontal padding eliminated: card uses `padding: 0 8px 8px` (was 20 px on both wrap and card)
- All three responsive breakpoints (`≤900px`, `≤680px`, `≤560px`) use `min()/max()` expressions driven by `100vh` and `100vw`
- On a 412 × 869 px CSS phone: art grows from 332 px → 396 px wide (+19%)

### Repeat mode persistence
`getRepeatKey()` / `saveRepeat()` / `loadRepeat()` helpers in `PlayerContext.tsx`; key `repeat_pref_<username>` in localStorage; state initialised with `useState(loadRepeat)` (was hardcoded `'off'`); cleared on logout alongside queue, index, and shuffle keys; saved in the existing debounced persistence effect.

### imageCacheService.syncWithAppMode()
New public method called at `initialize()` and on `appModeChanged` DOM event:
- power-saver → `maxConcurrentFetches=1`, `maxMemoryCacheSize=100`
- performance → `maxConcurrentFetches=2`, `maxMemoryCacheSize=200`
- normal → `maxConcurrentFetches=4`, `maxMemoryCacheSize=400`

### Mode-aware cover art lookahead (PlayerContext)
`maxAhead` = 4 (normal) / 2 (performance) / 0 (power-saver); native notification artwork preload skipped entirely in power-saver mode.

### CSS performance / power-saver rules (index.css)
- Performance mode rule 12: `text-shadow: none !important` on all `*`
- Performance mode rule 13: `-webkit-font-smoothing: none; font-smooth: never` on `body`
- Power-saver: same text-shadow + font-smoothing rules; plus `image-rendering: pixelated` on `img` and `.album-art`; `body.power-saver-mode .npo-bg { filter: none !important }` to skip the 50px blur on the overlay background

### Still TODO (next session)
- APK build + install with all Jul 17 changes
- `#9` — CompressionStream search index (planned but not implemented)

---

## Previous Focus (July 11, 2026)
Performance improvement series (8 items) + in-memory metadata TTL cache + full documentation update.

## What Changed This Session (July 11, 2026)

### Performance improvements

All 8 performance improvements confirmed implemented and building clean (`npm run build` → 27.59 s, zero errors).

| Feature | Key file(s) | Impact |
|---|---|---|
| Virtual scrolling hybrid | `SongList.tsx` | ≤60 songs: natural; >60: react-window v2 `List`+`AutoSizer`; ~15 DOM nodes always |
| IPC position throttle | `PlayerContext.tsx` | Metadata instant; position 2 fps gate; 3600→120 IPC calls/min |
| Gapless preload safety-net | `PlayerContext.tsx` | `timeupdate` listener starts buffering 15 s before end |
| Web Worker search | `searchWorker.ts`, `searchCacheService.ts`, `SearchContext.tsx` | Off-main-thread filter; async Promise API; fallback on failure |
| Fisher-Yates shuffle queue | `PlayerContext.tsx` | Pre-shuffled index; 1 play per song per cycle; rebuilt on shuffle toggle |
| True LRU image cache | `imageCacheService.ts` | Promote-on-read + promote-on-write; real LRU eviction (was FIFO) |
| IDB batch writes | `imageCacheService.ts` | `cacheImagesBatch` / `IDB_WRITE_BATCH=50`; fewer IDB transactions |
| In-memory metadata TTL cache | `metadataCache.ts`, `ArtistList.tsx`, `AlbumList.tsx`, `SongList.tsx`, `AllAlbumsGrid.tsx`, `AuthContext.tsx` | 30-min TTL; zero API calls on warm navigation; invalidated on login/logout |

### getSongCount elimination
`ArtistList.tsx` + `MainApp.tsx`: when search index is loaded, `searchCacheService.getSearchIndex()?.songs.length` provides the song count — no extra `getAlbumList2` API call.

### Documentation update (all .md files updated, no code touched)
- `README.md` — new Performance & Power bullets; Roadmap updated with all 10 implemented features
- `ARCHITECTURE.md` — new sections 6–10 in Performance Optimizations; Key Architectural Innovations list extended to 11 items
- `CACHE_V21_IMPLEMENTATION.md` — new In-Memory Metadata Cache section
- `IMAGE_CACHE_IMPLEMENTATION.md` — new True LRU Eviction Fix section
- `CHANGELOG.md` — new `[26.7.11]` entry at top
- `docs/todos.md` — 11 items moved to Done; compression added to Backlog
- `docs/session_summary.md` — this file
- `docs/module_notes.md` — 3 new services added to Key Services

### Still TODO (next session)
- `#9` — CompressionStream search index: fully planned (see plan file), not yet implemented
  - `searchCacheService.ts`: add `compress()`/`decompress()` private helpers using `CompressionStream('deflate')`
  - Write path stores `{ userId, timestamp, version: '2.0', compressed: ArrayBuffer }`
  - Read path handles both compressed v2.0 and legacy v1.0 records (migration via rebuild)
  - Fallback: if `CompressionStream` unavailable, write uncompressed record (v1.0 path)
- APK build + install with all Jul 11 changes

---

## Previous Focus (July 6, 2026)
Cache integrity verification system + documentation update for all platforms.

## What Changed This Session (July 6, 2026)

### Cache integrity verification
- **`src/types/offline.ts`** — added 3 event types: `cache-verify-started`, `cache-verify-progress`, `cache-verify-complete`; 2 optional fields on `DownloadEvent`: `verifyProgress`, `verifyResult`
- **`src/services/offlineCacheService.ts`** — replaced stub `rebuildAndVerifyCache()` with real `verifyPermanentCache(onProgress?)`: iterates all `cacheIndex.songs`, calls `getBridge().getAudioFilePath()` (real FS check on all platforms), removes orphaned entries via `removeFromCacheCore()`, reports `{ verified, removed, total, durationMs }`
- **`src/services/downloadManagerService.ts`** — added `isVerifying` guard, `runCacheVerification()` (private, emits all 3 event types), `triggerCacheVerification()` (public, called by button); auto-triggers in `processQueue()` when queue drains with ≥1 completed song
- **`src/components/Library/DownloadManagerWindow.tsx`** — added `verifyState` state, event handlers for 3 new events, "Verify Cache" button with live `X / Y` counter and result banner in the Manage Cache section
- **`src/components/Library/DownloadManagerWindow.css`** — added styles for `.cache-verify-section`, `.verify-result`, `.verify-removed`, `.verify-duration`
- Build verified clean: `npm run build` in 24.91 s, zero errors

---

## Previous Focus (July 3–4, 2026)
Android bug fixes — wakelock refresh, WebView OOM, Clear All Data, offline artist images, batch hijack.

## What Changed This Session (July 3, 2026)

### Download wakelock refresh (DownloadService.java)
- Removed `!wakeLock.isHeld()` guard so `acquireWakeLock()` always resets the 2-hour timeout.
- Watchdog Runnable calls `acquireWakeLock()` every 2 s independently of WebView/JS activity.
- Fixes downloads stalling after 30 min when Android backgrounded the WebView.

### WebView OOM fix (downloadManagerService.ts)
- Added serial `registrationQueue: Promise<void>` chain for `registerNativeDownload` calls.
- 1171 concurrent fire-and-forget registrations each serialized the full cache JSON → V8 heap OOM.
- Now only one registration is in flight at a time; batch drains before declaring done.

### Clear All App Data (SettingsView.tsx + NativeDownloaderPlugin.java)
- "Danger Zone" section added to Settings with a "Clear All App Data" button.
- JS side: clears download queue, audio cache, image IndexedDB, search IndexedDB, localStorage.
- Native side: `clearAllNativeData()` plugin method deletes `permanent_cache`, WebView HTTP cache,
  WebView cookies, WebStorage (localStorage SQLite), and SharedPreferences.
- Covers all Xylonic-specific data including orphaned files from other users / old versions.

### Cache stats layout (DownloadManagerWindow.css/tsx)
- Changed from flex-wrap to `display: grid; grid-template-columns: 1fr 1fr` — stats no longer
  jump around as digit counts change during cache clear operations.

### Offline artist cover art fix (ArtistList.tsx, AlbumList.tsx, SongList.tsx)
- **Root cause**: `artistCoverArtId` (the `ar-xxx` ID matching IDB preloaded artist photos) was
  never stored in cache metadata. Downloads defaulted to duet/collaboration song cover art for
  artists like MIKA and Jessie J, showing Ariana Grande's album cover for both.
- **ArtistList.tsx offline display**: Two-pass rebuild — collects ALL songs per artist, then
  prioritizes `artistCoverArtId` → solo-song `coverArtId` → lead-song `coverArtId` → any song.
  Avoids picking a duet song's album cover as the artist image.
- **ArtistList.tsx bulk download**: Builds `artistCoverArtById` map from loaded artist state so
  the `ar-xxx` cover art ID is now passed to `addAlbumToQueue`.
- **AlbumList.tsx**: Stores `artist.coverArt` from the `getArtist` response; passes it as
  `artistCoverArtId` when downloading albums.
- **SongList.tsx**: Calls `getArtist(album.artistId)` to get the `ar-xxx` cover art ID instead
  of using the raw artist numeric ID. Future downloads from album view will store the correct ID.

### Orphan recovery — renderer crash during extended screen-off (Jul 3)

Root cause: Android OOM kills the WebView renderer process during long downloads with screen off.
The foreground service (in the main app process) continues writing files to `permanent_cache/audio/`
but `songDownloaded` events have nowhere to go — JS is dead. On next launch, those songs appear as
failed even though their audio files exist on disk (confirmed: 1106 orphaned files from the July 1 crash).

Three-part fix:

- **`DownloadService.java`**: `appendCompletionLog()` appends `{hash,songId,extension,bytesReceived}`
  to `permanent_cache/completion_log.ndjson` after every successful download, BEFORE notifying JS.
  File survives renderer death because it's written by the foreground service (main process).

- **`NativeDownloaderPlugin.java`**: `readCompletionLog()` returns the log as a JS array;
  `clearCompletionLog()` deletes it after reconciliation.

- **`downloadManagerService.ts`**: Before submitting a batch to native, `savePendingBatch()` persists
  `{song, quality, artistId, artistCoverArtId}` keyed by `songId` to localStorage. On `startBatch`
  success, `clearPendingBatch()` removes it. On renderer crash, the map stays.
  `reconcileOrphans()` (public): reads completion log + pending map → registers any unindexed
  songs via `offlineCacheService.registerNativeDownload()` → clears both stores.

- **`MainApp.tsx`**: startup effect now calls `reconcileOrphans()` before `tryResumeQueue()`.

### Download Manager "Done: 0" bug — batch hijack fix (Jul 3)

Root cause: when the WebView renderer OOM-kills (separate sandboxed process from the foreground
service), `DownloadService` continues writing files. On renderer restart, `downloadBatchNative`
submits a new `startBatch` call. But `DownloadService.isFileDownloading == true` so the new
batch was QUEUED behind the old one in `downloadExecutor`. The old batch fired `songDownloaded`
events to the dead old plugin/WebView. New JS session saw Done: 0 indefinitely.

Two-part fix:

- **`DownloadService.java`**: Added `volatile broadcastPlugin` and `batchCall` fields.
  `submitBatch` (batch mode only) updates these fields first; if `isFileDownloading` is already
  true, returns immediately — the running thread now broadcasts to the new WebView and resolves
  the new JS call when done. Single-song-compat path is unchanged.

- **`downloadManagerService.ts`**: At the start of `downloadBatchNative`, songs already in cache
  (recovered by `reconcileOrphans()`) are immediately marked completed and counted in
  `sessionCompleted`. Only uncached songs are sent to native. This prevents re-downloading
  and shows the correct Done count the moment the batch starts.

### Download system fixup (Jul 4)

Six correctness and performance bugs fixed:

1. **Duplicate event guards** (`downloadManagerService.ts`): `songDownloaded` and `songFailed` handlers now check `item.status` at entry — repeat Capacitor events (possible on hijack) can no longer double-increment `sessionCompleted`/`sessionFailed`.

2. **`totalSize` double-count** (`offlineCacheService.ts`): `registerNativeDownload` and `addToCache` now subtract the existing song's `fileSize` before overwriting — re-registration (reconcileOrphans, validateFailed rescues) no longer inflates cache size stats.

3. **Debounced saves** (`offlineCacheService.ts`): `queueIndexSave()` and `queueRegistrySave()` replace direct `saveIndex()`/`saveRegistry()` calls in all batch-context paths (`registerNativeDownload`, `addToCache`, `cacheCoverArt`, `createCoverArtAlias`, `getCachedFilePath`). A 500 ms debounce collapses ~5000 IPC writes during a 2484-song batch to ~handful. `flushAll()` (new public method) forces immediate write when needed. Called in `downloadManagerService.ts` after `await this.registrationQueue` at batch end.

4. **Queue dedup** (`downloadManagerService.ts`): `addAlbumToQueue` filters out songs that are already cached or already `pending`/`downloading` in the queue. `addSongToQueue` does the same two checks. Prevents `sessionTotal` inflation and re-downloads when "Download Missing" or Download Album is triggered while a batch runs.

5. **Stale reference cleanup** (`DownloadService.java`): After `bc.resolve(res)` in the batch-completion `handler.post`, `batchCall = null` and `broadcastPlugin = null` to release GC references and prevent any accidental double-resolve.

6. **`clearAllCache` single flush** (`offlineCacheService.ts`): Extracted `removeFromCacheCore()` (in-memory only, no saves) as a private method. `clearAllCache` calls it per song then writes both files exactly once at the end. `removeFromCache` (single-song UI delete) keeps its immediate-save behaviour.

## Known Notes
- Existing cached songs (2643) still have `artistCoverArtId = null`; they will benefit from the
  improved solo-song cover art selection but will NOT show actual artist photos until re-downloaded.
- Artist photos (from IDB preload) will work correctly after the next bulk download from the
  ArtistList or AlbumList views, which now store the `ar-xxx` ID.
