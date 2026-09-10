# Changelog

All notable changes to Xylonic are documented here.

## [Unreleased]

### Fixed
- **Circular control buttons had no visible outline in dark mode (WS-UX)** — the
  dark-theme `--border*` / `--*-overlay` tokens were defined as
  `var(--border-subtle)` etc. (self-referential → invalid), so the header pill
  buttons' `2px solid var(--active-overlay)` ring rendered as nothing. Restored
  real dark values and gave the previously borderless round controls
  (`.playback-controls button`, `.album-action-icon`, `.current-song-like`) a
  `1px solid var(--border)` ring.

### Changed
- **Lint: `no-empty` enforced as error (WS-QUAL)** — the 27 remaining empty
  `catch {}` blocks (all deliberate plugin / IPC / `localStorage` best-effort
  guards) are now annotated with a one-line reason, and `no-empty` is an error in
  `eslint.config.mjs` alongside `no-console`. Also dropped a few unused `catch`
  bindings and two dead local helpers.
- **Performance tiers: Gaming / Balanced / Eco (WS-PERF)** — the two separate,
  mutually-exclusive toggles (Game/Performance mode + Power Saver) are now one
  three-way selector in Settings → Advanced, backed by a single
  `perfModeService`.
  - **Balanced** — the former Normal: 60 fps, full effects, prefetch depth 4.
  - **Gaming** — trims Xylonic's system load to the minimum so a foreground game
    keeps the machine: 15 fps RAF cap, GPU effects stripped (`performance-mode`
    stylesheet) *plus* every translucent surface flattened to opaque and the
    ambient blur removed (`gaming-mode` supplement — fewer draw calls, less
    VRAM), zero look-ahead prefetch, one concurrent image fetch, image-memory
    cache 120 (was 400), native CPU priority yielded. Audio + basic control
    still work.
  - **Eco** — the former Power Saver (old middle "Performance" tier folded in):
    10 fps, everything stripped via `power-saver-mode`, pixelated art, no
    prefetch, CPU priority yielded — maximum battery life.
  - Saved `xylonic_performance_mode` / `xylonic_power_saver_mode` values migrate
    to `eco` on first launch.
- **Subsonic `Song` typing (WS-QUAL)** — the technical-metadata fields
  (`bitRate`, `suffix`, `size`, `samplingRate`, `channelCount`, `bitDepth`,
  `year`, `track`, `discNumber`) are now declared on the `Song` interfaces
  instead of reached via `(song as any).x` at the playback call sites in
  `SongList` / `AllSongsGrid`. −20 lint warnings, no behaviour change.
  (Consolidating the ~3 duplicate local `Song` interfaces onto one canonical
  type is a follow-up.)
- **Navigation stays hand-rolled** — the `react-router` memory-history migration
  (ADR 0008) is **Rejected**; the `App.tsx` navigation state machine is kept.
- **Type scale migration (WS-UX · UI-03)** — all 174 exact-match
  `font-size: {11,13,15,18,22,28}px` declarations across 28 stylesheets now use
  `var(--font-size-xs…2xl)`. No rendered change (each token equals the literal it
  replaced); off-ramp sizes left alone.
- **`PlayerContext` — playback engine + queue actions extracted (WS-ARCH)** — the
  `<audio>` element creation + media-event wiring moved to
  `src/context/usePlaybackEngine.ts`; the five queue-mutation callbacks
  (`addToQueue` / `insertNext` / `removeFromQueue` / `moveInQueue` / `clearQueue`)
  moved to `src/context/useQueueActions.ts`. Both are verbatim lift-and-shift
  behind a params object — no behaviour change. `PlayerContext.tsx` 1023 → 924.
- **`downloadManagerService` — cover-art downloading extracted (WS-ARCH)** — the
  album/artist artwork fetch + per-batch dedup/alias bookkeeping (`downloadCoverArt`
  + its 4 tracking Sets/Maps + `randomSalt`) moved to a `CoverArtDownloader` class
  in `src/services/coverArtDownloader.ts`. The manager now calls
  `this.coverArt.download(...)` per song and `this.coverArt.reset()` when it clears
  the queue. Method body is verbatim — the synchronous "claim before await" race
  guards are unchanged. `downloadManagerService.ts` 2012 → 1894.

### Performance
- **Persistent metadata cache (WS-PERF)** — new `persistentCache` service: a
  two-tier (in-memory + IndexedDB) stale-while-revalidate key/value store.
  `metadataCache` is now a thin facade over it, so the artist / album / song
  lists (ArtistList, AlbumList, SongList, AllAlbumsGrid) **survive a reload or
  app restart** and paint from disk instead of showing skeletons while the
  sequential Subsonic fetches run. Hydrated before first paint with a 200 ms
  cap so a slow disk can't stall startup. Bounded to 400 entries; entries past
  8× their TTL are discarded.
- **Library views use stale-while-revalidate (WS-PERF)** — ArtistList, AlbumList,
  AllAlbumsGrid and SongList now read metadata through `persistentCache.swr()`:
  a cached (even stale) list paints immediately, a background refresh runs when
  it's stale, and `onRevalidated` repaints in place when the fresh data lands.
  Concurrent loads of the same key are deduped to one request.
- **Subsonic metadata response cache (WS-PERF)** — `getArtists`, `getAlbumList2`
  (every list type, including "recently added"), and `getStarred2` now serve from
  a 60 s in-memory TTL cache on repeat navigation instead of refetching. Keyed by
  endpoint + server + user + params; the rotating auth token is never part of the
  key. Starring / unstarring purges the starred cache immediately.
  `clearApiCache(prefix?)` is exported for logout / server-switch wiring.
- **Font Awesome solid subset (WS-PERF)** — `scripts/build-fa-subset.mjs` scans
  the source for every `fa-*` reference (static classes, `fa-${…}` /
  `fa-<stem>-${…}` dynamic literals, `icon: 'fa-*'` config), resolves them against
  the FA7 metadata and runs `subset-font`. `src/index.tsx` now imports
  `styles/fa-solid-subset.css` instead of FA's `solid.min.css`, swapping the full
  112 kB `fa-solid-900` webfont (~1400 glyphs) for an **8.5 kB** subset of the
  ~104 glyphs the app uses. Regenerate with `npm run fa:subset`. **−104 kB.**
- **RightPanel song rows skip off-screen rendering (WS-PERF)** — `.panel-song-row`
  (Queue / Playlists / History tabs) gets `content-visibility: auto` +
  `contain-intrinsic-size`. The Queue tab can hold the entire library (25k+ rows)
  after "play all"; the browser now skips layout/style/paint for rows outside the
  viewport. No visual change. A full `react-window` pass on the queue is still a
  follow-up (needs an on-device row-height check).

### Changed
- **`SettingsView` finished splitting (WS-ARCH)** — extracted `SwitchServerSection`
  (Account "Switch Server" row + its connection-picker / password-prompt modals),
  `RemoteSettingsSection` (be-controlled / control-others toggles + firewall
  dialog), `StreamingDownloadsSection` (streaming bitrate + download
  quality/concurrency) and `LibrarySection` (default view) into
  `components/common/settings/`. Each owns its own state. `SettingsView.tsx` is now
  a 359-line shell (was 1226). Two dead helpers removed. No behaviour change.
- **Image cache is a hook, not a provider (WS-ARCH)** — `ImageCacheContext.tsx`
  collapsed from a React context provider wrapping the whole app to a module-level
  singleton store read through a `useSyncExternalStore` hook. `useImageCache()`
  keeps the exact same API (`isInitialized` + `getCachedImage`/`clearCache`/
  `getCacheStats`), so `AlbumArt`/`AlbumList`/`ArtistList` are untouched; the
  `App.tsx` provider tree loses one layer. No behaviour change.

### Added
- **Headless iOS build → sign → install on Linux (`scripts/ios-autoload.sh` +
  `scripts/ios-extract-signing.py`)** — one command pulls the latest CI IPA,
  signs it for the connected iPhone, and installs it over USB — no Mac, no
  Windows, no Sideloadly. `ios-extract-signing.py` rebuilds the signing assets
  from what's already on the machine: the private key **iLoader**
  (github.com/nab138/iloader) keeps in the Secret Service keyring, plus the
  leaf certificate carried inside the provisioning profile that
  `pymobiledevice3 provision dump` pulls off the device. `zsign` then signs,
  rewriting the bundle id to `<bundleid>.<teamid>` (iLoader's mangled form).
  Full setup and credits to the upstream projects (pymobiledevice3,
  libimobiledevice, zsign, iLoader/isideload, apple-codesign-quick/Sideloader,
  Impactor) are in `IOS_SETUP.md` → "One-command auto-load on Linux" and
  `README.md` → Acknowledgments. Verified end-to-end on an iPhone 15 Pro Max.
- **`scripts/ios-debug.sh` — packaged WebView debugging on Linux** — auto-starts
  the RSD tunnel (shared `scripts/ios-tunnel.sh`) + a `pymobiledevice3
  webinspector cdp` server, waits for the `capacitor://localhost` WebView, and
  drives it via `scripts/ios-cdp.py`: `eval '<js>'`, `listen`/`net` console/network
  streams, and `verify` (a canned health check — `scripts/ios-verify.js`: plugin
  registration, `localStorage`, DOM render, and a cache-integrity pass that
  `stat`s the newest cached audio files against the index). `ios-autoload.sh` now
  auto-starts the same tunnel (`XYLONIC_AUTO_TUNNEL=0` to opt out).

### Fixed
- **CI `lint · test · build` job was red on every push** — `npm ci
  --legacy-peer-deps` skipped `@testing-library/dom` (a peer of
  `@testing-library/react@16`, recorded peer-only in the lockfile), so
  `LayoutModeContext.test.tsx` failed with `Cannot find module
  '@testing-library/dom'`. `ci.yml` now runs plain `npm ci` (conflict-free
  against the committed lockfile); the other workflows keep the flag since they
  don't run the test suite.

### Verified (on device, no code change)
- **iOS background downloads work end-to-end** — batch download of an album
  writes `permanent_cache/audio/<hash>/audio<ext>` with byte sizes matching the
  cache index, and offline playback of a downloaded track plays from cache. The
  Aug 5 `CAPBridgedPlugin` migration + native batch queue were the fix; the
  "still broken" note was stale (tested on a build without them).
- **iOS offline → online no longer hangs on "Loading…"** — the Sep 6 fix
  (`axios` 15 s timeout + `Network`-driven `isOnline` + `checkConnectivity()` on
  the offline→online transition) confirmed on device.

### Changed
- **Subsonic 1.16.1 response envelope is typed (WS-QUAL)** — `src/types/subsonic.ts`
  gains `SubsonicEnvelope` (`{ 'subsonic-response': SubsonicResponseBody }`) with
  `SubsonicChild` / `SubsonicAlbum` / `SubsonicArtistSummary` /
  `SubsonicArtistWithAlbums` / `SubsonicStarred2` / `SubsonicAlbumList2` /
  `SubsonicSearchResult3Raw` / `SubsonicPlaylist*` / `SubsonicArtistsContainer`.
  Every `axios.get(url)` in `subsonicApi.ts` is now `axios.get<SubsonicEnvelope>(url)`;
  `getAllSongs` / `getServerPlaylist` return `SubsonicChild[]`. `(index: any)` /
  `(song: any)` / `(artist: any)` callback annotations dropped across ~10
  consumers. `no-explicit-any` lint warnings 132 → 111. No behaviour change.
- **`likedSongsService` — 7 unused `catch (e)` bindings removed** (bare `catch {`).
- **Every build stamps the version from the build date** — `node
  scripts/set-version-date.js` now runs at the start of `npm run build`, every
  `electron:build:*`, `build-android.sh`, `build-ios.sh`,
  `scripts/build-{debug,release}.js`, and the Android/iOS/desktop CI workflows,
  so artifacts always carry `YY.MM.DD` of the build instead of whatever
  `package.json` was last hand-bumped to. The script is idempotent (no-op once
  it's today's date), so it dirties the tree at most once per day;
  `git checkout package.json` reverts it. The committed `package.json` version
  stays the "last released" marker, bumped by hand with the CHANGELOG. iOS
  `CFBundleVersion` is the workflow run number (monotonic for same-day
  rebuilds); `CFBundleShortVersionString` is the CalVer date.

## [26.09.07] - 2026-09-07

### Security
- **Single credential path (WS-SEC, phase 1)** — new `src/services/credentialsService.ts` is now the one authoritative accessor for `{serverUrl, username, password}`: `get()` prefers the encrypted backend (Electron `safeStorage` via the existing `secureCredentialService`), `getCached()` is a synchronous best-effort read for the many existing call sites, `set()`/`clear()` keep the encrypted store, the sync cache and legacy `localStorage` in step, and `hydrate()` refreshes the cache from the encrypted store at boot. `useCredentials()` hook exposes it reactively. Every `localStorage.getItem('password')` in application code (App/MainApp, all `Library/*` list & grid views, `MiniPlayer`, `CachePreloadDialog`, `SearchContext`, `useScrobbler`, `useSongList`, `likedSongsService`, `apiErrorHandler`, `downloadManagerService`, `subsonicApi`, `utils/storage`) now routes through `credentialsService.getCached()` — the copy-pasted `serverUrl/username/password` triple collapses to one destructure. Plaintext `localStorage` is still written as the sync hydration source (removing plaintext-at-rest is gated on WS-TEST + the `webSecurity:true`/`xylonic://` desktop pass — see `docs/ROADMAP.md`).
- **Cryptographic auth salt** — `subsonicApi.generateAuthParams` and the two cover-art fetch paths in `downloadManagerService` now derive the Subsonic auth salt from `crypto.getRandomValues` (16-byte hex) instead of `Math.random().toString(36)`.
- **Electron `setWindowOpenHandler` default-deny** — both `BrowserWindow`s now deny every `window.open` target, handing only `http(s)` URLs to the system browser (previously non-web schemes returned `{action:'allow'}`; the mini-player window had no handler at all).
- **Content-Security-Policy (partial, Electron production)** — `session.defaultSession.onHeadersReceived` injects a CSP (`default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, no `unsafe-eval`) on production desktop builds. Dev is skipped so the Vite dev server keeps working; `script-src`/`style-src` still allow `'unsafe-inline'` and the `index.html` meta-CSP for Capacitor is deferred pending the `xylonic://` protocol + `webSecurity:true` work and a 4-target desktop device pass.
- **Removed credential logging** — `subsonicApi.search()` no longer `console.log`s `localStorage` contents (including the password) and no longer duplicates the auth-param logic.

### Added
- **Motion: `prefers-reduced-motion` honoured app-wide (WS-UX)** — a global block
  in `index.css` collapses every animation and transition to ~0.01 ms when the OS
  asks to reduce motion (state still lands, just without the travel); component
  blocks like the skeleton loader refine further.
- **UI polish (`docs/design/0002`)** — tabular figures (`tabular-nums`) on every
  running-number display (player time, durations, track numbers, counts,
  download stats) so digits stop jittering; a theme-flipping `--elevation-modal`
  shadow token replaces 28 heavy `rgba(0,0,0,0.4–0.8)` modal drop-shadows that
  read as grey blobs in light mode.

### Fixed
- **Light-theme colour audit (WS-UX)** — six new theme-flipping surface tokens
  (`--border`, `--border-subtle`, `--border-strong`, `--hover-overlay`,
  `--active-overlay`, `--scrim`) replace ~250 hardcoded `rgba(255,255,255,…)`
  border/hover literals and ~15 `rgba(0,0,0,…)` backdrop fills across 30
  component stylesheets, so panel borders, row dividers, hover states and
  scrims are now visible and correctly weighted in light mode. Dark mode is
  unchanged (token values equal the old literals). The login screen (on the
  accent gradient) and the dev perf overlay keep their fixed colours.

### Performance
- **Font Awesome trimmed (WS-PERF)** — `src/index.tsx` imports only
  `fontawesome.min.css` + `solid.min.css` instead of `all.min.css`. The two
  brand glyphs the app uses (GitHub, Last.fm) are now inline SVG
  (`components/common/BrandGlyph`), and the *regular* family had no call sites.
  Result: the `fa-brands-400` (110 kB) and `fa-regular-400` (19 kB) webfonts are
  no longer shipped and `index.css` drops ~22 kB (11 kB gzip); only
  `fa-solid-900` remains.
- **Bundle-size gate (WS-PERF)** — `npm run size`
  (`scripts/check-bundle-size.js`) fails the build if the modern/legacy JS,
  legacy polyfills, or CSS chunk exceeds its ceiling; runs in CI after the build.
  `docs/PERF_LEDGER.md` now tracks every optimisation with before/after numbers.
- **`content-visibility` on Settings sections** — the ~10 stacked
  `.settings-section` blocks skip layout/paint until scrolled near.

### Changed
- **`PlayerContext` further decomposed (WS-ARCH)** — 1555 → **1026 lines**. Three
  more self-contained slices moved to dedicated hooks: `context/useSleepTimer.ts`
  (countdown + `setSleepTimer`), `context/usePlaybackPrefs.ts` (per-user bitrate
  + playback speed, load/apply/persist), `context/useNeighborSongs.ts`
  (`nextSong` / `prevSong` derivation + the four look-ahead preload effects —
  audio buffer, 15 s-before-end safety net, cover-art prefetch, native-
  notification artwork). All lift-and-shift — no behaviour change; the
  `usePlaybackEngine` / `useQueue` core split stays gated on test coverage.
- **`ARCHITECTURE.md` split (WS-ARCH / WS-DOCS)** — the 2614-line monolith is now
  14 per-subsystem docs under `docs/architecture/` (`01-overview` …
  `14-android-native`) with a rewritten index table. The root `ARCHITECTURE.md`
  is a redirect stub so existing links keep working; README / CLAUDE.md pointers
  updated. Provider contexts `Auth` / `UI` / `OfflineMode` / `ImageCache` now
  memoize their context value (`useMemo` + `useCallback`), completing the
  provider-tree memoization pass. `SettingsView` shed its About and Advanced
  sections to `components/common/settings/` (974 → 745 lines).

### Added
- **`npm run version:date`** — `scripts/set-version-date.js` stamps
  `package.json` `version` with today's local date as `YY.MM.DD` (the project's
  CalVer scheme, one version per calendar day). Run it when cutting a build, like
  the CHANGELOG bump; it is deliberately not part of `npm run build`. Everything
  downstream (`write-build-info.js` → `build-info.json` + Settings "About",
  Electron window titles, electron-builder artifact versions) already reads
  `package.json`, so it stays the single source of truth. `--dry` previews.

### Changed
- **Three responsive layouts (WS-UX, `docs/design/0001`)** — `LayoutModeContext`
  is now wired in: `App` stamps `data-layout="compact|medium|expanded"` on `.app`
  and layout CSS keys off it (`forceMode` still overrides, `@media` kept as the
  pre-hydration fallback).
  - **medium** (768–1199 px): `AppNav` becomes a 64 px icon rail — no collapse
    toggle, no user/server block; labels via `title`/`aria-label`. Reclaims
    ~136 px for content on tablets and half-screen desktop windows.
  - **expanded** (≥1200 px): the queue / history / playlists `RightPanel` now
    **docks** — a flex child of `.app-body` with no backdrop that reserves
    `clamp(300px, 26vw, 380px)` only while open, so the content column shrinks
    instead of being covered. Below 1200 px it stays the overlay drawer. Closed
    by default at every width; header toggle unchanged.
  - **compact** (≤767 px): unchanged — bottom nav, overlay drawer.
  - Card grids (`.artists-grid`, `.albums-grid`, the skeleton grid) now reflow
    off the content column via a `@container` query on `.main-content`, stepping
    the column minimum 150 → 180 → 200 px; opening the docked panel or the rail
    re-flows the cards with no viewport media query. The `min-width: 1366px`
    `!important` grid override is gone.
- **Skeleton loaders for library lists/grids (WS-UX)** — new
  `src/components/common/Skeleton.tsx` (`grid` and `list` variants) replaces the
  centred spinner + "Loading …" text in `ArtistList`, `AlbumList`,
  `AllAlbumsGrid`, `SongList`, `AllSongsGrid`, and `LikedSongsView`. The shimmer
  is transform-based (reuses the existing `album-art-shimmer` keyframes) and
  freezes under `prefers-reduced-motion` and the app's `performance-mode`; the
  wrapper is a `role="status"` region so the load is still announced.
- **Shared list/grid state styling (WS-UX token discipline)** — the error, empty,
  and inline-error blocks in `ArtistList` / `AlbumList` / `SongList` /
  `AllAlbumsGrid` / `AllSongsGrid` / `LikedSongsView` each carried the same
  hand-written inline `style={{}}` objects (`padding: 40px`, `fontSize: 48px`,
  `color: #ff3b30`, `borderRadius: 8px`, `marginTop: 20px`, …). Those collapse to
  four shared classes — `.library-state`, `.library-state-icon`,
  `.library-state.is-error`, `.library-inline-error` — in `src/styles/index.css`.
  `MainApp`'s `style={{ marginBottom: '24px' }}` view-toggle wrapper is now
  `.library-view-toggle-row` on `var(--spacing-lg)`. App-wide static inline style
  objects dropped from 115 to 79 (the rest are genuinely dynamic).

### Added
- **Accessibility pass (WS-UX)** — one global `:focus-visible` keyboard-focus
  ring in `src/styles/index.css` (2px accent outline, `!important` so the many
  component-level `:focus { outline: none }` rules can't hide it; plain mouse
  `:focus` stays ringless). Every icon-only `<button>` that previously exposed
  its label only via `title` now also has a matching `aria-label` (40 buttons
  across 17 files); buttons that already show visible text were left with just
  `title` to avoid WCAG 2.5.3 "label in name" mismatches. Icon-only buttons that
  had *no* accessible name — `VolumeControl` mute toggle (dynamic Mute/Unmute),
  the Theme / Custom-theme / Keyboard-help modal close buttons — are now named.
  Track / album / artist name text (`.song-title`, `.panel-song-title`,
  `.mini-player-title`, …) is now selectable despite the app-wide
  `user-select: none` chrome default. `role="status" aria-live="polite"` added
  to the download-manager progress stats and the queue song-count label.
- **`LayoutModeContext` (WS-ARCH)** — `src/context/LayoutModeContext.tsx`:
  `compact | medium | expanded | tv` derived from viewport `matchMedia` (767 /
  1199 px) + `(hover:none) and (pointer:coarse)`, with a `forceMode` prop for
  TV / tests. `LayoutModeProvider` wraps the app; `useLayoutMode()` returns the
  mode + `isCompact`/`isMedium`/`isExpanded`/`isTv`/`isCoarsePointer`. The single
  seam for layout/form-factor branching — WS-UX and WS-TV consume it. 6 tests
  (first RTL component test in the suite). Nothing reads it yet.
- **ADRs (`docs/decisions/`) + architecture index (WS-ARCH / WS-DOCS)** — seven
  decision records (platform bridge, offline-cache v2 hashing, download orphan
  reconciliation, single credential service, Vitest + CI gate, `electron.js` →
  `public/ipc/*`, `LayoutModeContext`). `docs/architecture/README.md` is a
  navigable index of the 2600-line `ARCHITECTURE.md` with a per-section
  freshness table; the IPC section now carries a structure-note pointing at
  ADR 0006. Physical split of `ARCHITECTURE.md` still pending.

- **Light theme + `prefers-color-scheme` (WS-UX, first pass)** — structural
  tokens (background / surface / text / elevation / scrollbar) now flip to a
  light palette under `@media (prefers-color-scheme: light)` unless the user has
  forced dark, plus an explicit `:root[data-theme="light"|"dark"]` override.
  `ThemeContext` gained `themeMode: system|light|dark` (persisted, applied to
  `<html data-theme>` synchronously at module load — no flash) and keeps
  `<meta name="theme-color">` in sync (default `#121212`). Toggle in
  Settings → Appearance → Mode; "Theme" row renamed "Accent Theme". Accent
  colours are unchanged in both modes (user-controlled). A per-component
  hardcoded-colour audit for full light-mode polish is the follow-up — the
  login screen is verified clean.
- **`100vh` → `100dvh` (WS-UX)** — the six full-height container rules (`.app`,
  `.login-container` incl. its media queries, `.App`, `.mini-player`) now emit
  `height: 100vh; height: 100dvh;` — dynamic viewport height where supported, the
  `vh` value as fallback on old engines. Fixes the address-bar-collapse gap on
  mobile. Safe-area / `viewport-fit` handling unchanged.
- **Memoised context values in `ThemeContext` / `SearchContext` /
  `RemoteModeContext` (WS-ARCH/perf)** — each provider was building a fresh
  `value={{…}}` object on every render, re-rendering all consumers. Now
  `useMemo`'d; the few bare handlers (`setTheme`, `updateCustomTheme`,
  `resetCustomTheme`, `clearSearch`, `returnToSearch`) are `useCallback`'d so
  the memo actually holds. Object contents unchanged; 127 tests + lint green.
  The other providers (UI / OfflineMode / ImageCache / Auth) need `useCallback`
  on more handlers first — separate pass.
- **Production debug-log stripping (WS-PERF)** — prod builds now minify with
  terser and `pure_funcs: ['logger.log','logger.info','logger.debug']`, so
  those disabled-by-default calls *and* their template-literal arguments are
  removed from the modern bundle (609 → 597 kB raw). `error`/`warn` still
  emit. The `plugin-legacy` chunk keeps them (separate minify path).
### Changed
- **`SettingsView` split, first pass (WS-ARCH)** — three self-contained,
  props-only pieces lifted into `src/components/common/settings/`:
  `LicensesDialog`, `TechStackDialog` (the two portal modals) and
  `PerformanceCacheSection` (the read-only cache-stats block). **`SettingsView.tsx`
  1226 → 953 lines.** The remaining sections are small and tightly coupled to the
  component's state/handlers — left inline for now.
- **`PlayerContext` → `useMediaSession` hook (WS-ARCH)** — the eight OS
  media-session effects (`navigator.mediaSession` action handlers + metadata +
  playback/position state, plus the Capacitor foreground-service / notification
  bridge calls and the layered cover-art → `data:` URL resolver) moved verbatim
  into `src/context/useMediaSession.ts`. `PlayerContext` now calls
  `useMediaSession({ currentSong, isPlaying, …, audioRef, playNextRef, … })`;
  the 1-fps throttle refs are internal to the hook. **`PlayerContext.tsx`
  1565 → 1219 lines.** Behaviour unchanged; build + 121 tests + lint clean.
  (Eyeball the MPRIS widget / iOS Control Center on the next device pass.)
- **`electron.js` split complete (WS-ARCH)** — the 2232-line main-process file is
  now **533 lines of wiring** (requires, `createWindow` / `createMiniPlayer`, app
  lifecycle, protocol + CSP, nine `register*Ipc()` calls). Nine cohesive
  subsystems moved to `public/ipc/*`:
  - `public/ipc/remote.js` (~400 lines) — Remote Mode: LAN discovery (UDP 7766),
    HTTP command server (7767), 8 `remote-*` IPC handlers. Injected
    `getMainWindow` + `getLastPlayerState`; `startRemoteDiscovery()` from
    `app.whenReady()`.
  - `public/ipc/logging.js` — file logging + its 5 IPC handlers
    (`write-log` / `get-log-path` / `get-logging-enabled` / `set-logging-enabled`
    / `open-log-folder`) + the `console.*` overrides. `_logging.initLogging()`
    from `app.whenReady()`.
  - `public/ipc/settings.js` — `settings.cfg` + per-user color-config file
    handling (`ensureSettingsFile` / `ensureSettingsDir` / `ensureColorConfig`)
    and its 6 IPC handlers. Path helpers stay in `electron.js` (shared with the
    cache-location code) and are injected.
  - `public/ipc/credentials.js` — `safe-storage-available` / `-encrypt` /
    `-decrypt` (Electron `safeStorage`).
  - `public/ipc/system.js` — per-process priority / CPU-affinity + `get-system-stats`.
  - `public/ipc/misc.js` — `get-os-platform`, `detect-linux-firewall`,
    `save-song`, `get-download-dir`.
  - `public/ipc/downloadNotification.js` — dock/taskbar progress bar + Tray
    tooltip + macOS dock badge (`set-download-progress` / `clear-download-progress`)
    and `set-download-active` (drives the power-save blocker via an injected
    callback).
  - `public/ipc/cache.js` — the **~31-handler offline-cache filesystem block**
    (cache-location config, shared audio/cover-art registry, per-user cache index
    + metadata, file save/read/delete, disk space, embedded-art extraction).
    `getCacheBasePath` / `saveCacheBasePath` / `dialog` / `getMainWindow`
    injected; `pathToFileUrl` moved here and re-exported (the MPRIS-art code still
    in `electron.js` imports it back).
  - `public/ipc/playerWindow.js` — mini-player toggle, player-state sync between
    the two windows, and the layered MPRIS cover-art → `file://` resolver
    (`toggle-mini-player` / `is-mini-player` / `request-player-state` /
    `player-state-update` / `player-control`). The most coupled slice — both
    `BrowserWindow`s, `lastPlayerState`, the power-save blocker and the `mpris`
    module are all injected.
  `electron-builder.json` `files` now includes `public/ipc/**/*.js`. Every module
  has a standalone plain-node functional check; `npm run electron:serve` runs the
  full main process with no exception at each step.
- **`vite.config.ts` → `vite.config.mts`** — native ESM config load; silences the
  Vite `configLoader: 'native'` / "ESM syntax in a file loaded as CommonJS"
  warning. `__dirname` → `import.meta.dirname` (Node 22).
- **`downloadManagerService` split (WS-ARCH, slices 1–2)** — pure helpers →
  `src/services/downloadManagerHelpers.ts` (`qualityToBitrate`, `formatSpeed`,
  `sanitizeFilename` (was dead), rolling speed-window math, enqueue filter,
  numeric half of `getProgress()`; +10 tests). Orphan-recovery planning →
  `src/services/downloadReconciler.ts` (`planOrphanReconciliation`,
  `mergePendingBatch`, `parsePendingBatch`, `pendingBatchFromQueueArray`; +11
  tests) — the Android and iOS `reconcile*Orphans` paths, previously two
  near-identical inline copies, now normalise their native completion-log shapes
  and share one pure planner. Behaviour unchanged (dedup / getProgress-invariant
  tests still pass). `downloadManagerService.ts` 2064 → ~1990 lines. Remaining
  slice: the stateful transport layer (`processQueue`, native/JS batch paths,
  worker pool).
- **`getAllSongs` fetches pages concurrently (WS-PERF)** — was a fully serial
  `while` loop (one 500-song page after another — ~50 round-trips of latency for a
  25k library). Now probes page 0 serially (small libraries finish in one
  request), then fetches the rest in batches of 4 concurrent requests, stopping
  on the first short page. Order preserved, `failed`-status + offline-mode guard
  unchanged. Used by the missing-songs check and "Download Missing". +tests.
- **Shared `data:` URL helpers (WS-ARCH cleanup)** — `blobToDataUrl` /
  `bytesToBase64` (stack-safe, chunked) / `chunksToDataUrl` extracted to
  `src/utils/dataUrl.ts` + 5 tests. Replaces 3 copies of the
  `new FileReader()…readAsDataURL` promise dance and 2 hand-rolled chunked-base64
  loops across `PlayerContext` (media-session + foreground-service artwork) and
  `capacitorBridge`. Behaviour preserved (verified in-app: `navigator.mediaSession`
  metadata + artwork still populate).
- **`PlayerContext` persistence extracted (WS-ARCH, slice 2)** — the per-user
  queue / index / shuffle / repeat `localStorage` helpers moved verbatim into
  `src/context/playerPersistence.ts` (`saveQueue`/`loadQueue` (generic),
  `saveIndex`/`loadIndex`, `saveShuffle`/`loadShuffle`, `saveRepeat`/`loadRepeat`,
  `clearPlayerPersistence`). Keys and semantics unchanged; a `tryStorage` wrapper
  replaces the scattered bare `try/catch {}`. 8 unit tests (round-trips, per-user
  namespacing, guest fallback, corrupt-payload, unknown-repeat coercion, clear).
  Verified in-app: a 10-track queue + index + shuffle state still survive reload.
- **`PlayerContext` queue math extracted (WS-ARCH, slice 1)** — Fisher-Yates
  shuffle-queue build + "what plays next" index logic pulled out of
  `PlayerContext.tsx` into a pure, React-free `src/context/playerQueue.ts`
  (`buildShuffleQueue`, `computeNextIndex`). `PlayerContext` keeps ref/state
  ownership and just routes through it. **Behaviour preserved exactly**, including
  the quirk that sequential playback wraps to index 0 at the end even with
  repeat off (flagged in a comment; a fix is a separate behaviour change).
  Now unit-tested (10 tests: permutation correctness / every-song-once-per-cycle,
  cursor advance, rebuild-on-exhaust, repeat-one replay, empty-playlist no-op,
  end wrap). This is step 1 of the eventual `usePlaybackEngine` / `useQueue` /
  `useMediaSession` / `usePlayerPersistence` split.

### Added
- **Test harness (WS-TEST, phase 1b start)** — Vitest 3 + jsdom + Testing Library; `vitest.config.ts` (separate from `vite.config.ts` to avoid `@vitejs/plugin-legacy`), `src/test/setup.ts`. Scripts: `test`, `test:watch`, `test:coverage`, `typecheck` (`tsc --noEmit`). **`.github/workflows/ci.yml`** runs `lint` + `test` + `build` on push/PR to `main` (real gates); `typecheck` runs non-blocking until the TS 5.x bump clears the ~59 pre-existing `moduleResolution` errors. Suites (**70 tests, green**): `subsonicApi` (auth-param shape — 32-char hex salt, `t = md5(pw+salt)`, fresh salt per call; `getAllSongs` pagination termination + `songOffset` stepping + `failed` handling; offline-mode network guard), `credentialsService` (sync-cache hydration, `set`/`clear`/`get` + encrypted-backend delegation), `cfgParser` (parse / round-trip), `offlineCacheService` (**`totalSize` no double-count on re-register**, size replacement on quality change, sum across songs, decrement on remove, never-negative, `isCached`), `downloadManagerService` (queue dedup — same song not re-queued while pending, cached songs skipped, `addAlbumToQueue` filters cached + already-queued, `getProgress` invariants), `cacheHelpers` (hash determinism + trailing-slash normalization + audio/cover-art non-collision, `generateUserId`, `formatBytes`, content-type→extension), `fallbackBridge` (interface contract — read shapes, unsubscribe fns, no throws), `searchCacheService` (main-thread fallback: match by artist/album/album-artist/song title/song artist/song album, case-insensitive, 20/20/50 caps), `electronBridge` + `capacitorBridge` (pass-through / Preferences-backed contracts), `offlineCacheService` debounced-save (rapid registers coalesce to one `writeUserCacheIndex` after 500ms; `flushAll()` forces immediate). **76 tests, 10 files.** Coverage reporting is on (`--coverage`) but no threshold gate yet — aggregate is ~10% (targeted unit tests of a few large modules); a floor waits until `PlayerContext`/`downloadManagerService` are split (WS-ARCH) into unit-testable pieces. Still out: `PlayerContext` Fisher-Yates queue, idempotent native `songDownloaded`/`songFailed` (guard is a one-liner; the full-batch-flow test was too timing-brittle — revisit when `downloadManagerService` splits into `downloadReconciler`), a mock Subsonic server.

### Fixed
- **`tsc` regression from the previous quality commit** — the "trivial `any`→`unknown`" pass had changed `customThemes: Record<string, any>` to `Record<string, unknown>` in `cfgParser.ts` / `colorConfigManager.ts`, which `npm run build` (esbuild, no type-check) didn't catch but introduced 11 `tsc --noEmit` errors (property access on `unknown`). Reverted those two fields to `any` with an explicit `eslint-disable` (raw on-disk theme blobs — loose by design). Added the `typecheck` script so this class of error is visible.

### Changed
- **All `console.*` → `logger.*` (WS-QUAL)** — 193 raw `console.log/error/warn/info` calls across 35 files in `src/` now route through `utils/logger` (categorised, file-sink-capable, gated). `logger.error`/`logger.warn` were changed to **always** reach the browser console (low volume, must stay visible); `logger.log`/`info` remain suppressed unless logging is enabled, so the noisy debug chatter is silent by default in dev and prod. Dead code removed: `src/services/offlineCacheService.v1.backup.ts.txt` and `offlineCacheService.v2.ts` (zero references; history retains them).
- **ESLint (flat) + Prettier config (WS-QUAL)** — `eslint.config.mjs` (ESLint 9 + `typescript-eslint` 8, non-type-checked): `no-console` **error** (enforceable now the sweep is done; `src/utils/logger.ts` exempt), `no-empty`/`@typescript-eslint/no-explicit-any`/`react-hooks/exhaustive-deps` as **warn** to tighten over time. `.prettierrc.json` + `.prettierignore`. New scripts: `lint`, `lint:fix`, `format`, `format:check`; devDeps installed. `npm run lint` **passes (0 errors)** after fixing 3 recommended-rule violations (`{}` object type in `global.d.ts` + `remoteDiscoveryService.ts` → `Record<string, never>`; one `let`→`const`); 268 warnings remain (146 `no-explicit-any`, 55 `no-unused-vars`, 37 `no-empty`, 29 `react-hooks/exhaustive-deps`) — the "warn now, error later" bucket. Not yet wired into CI; no `prettier --write` reformat done.
- **Silent `catch {}` sweep (WS-QUAL, started)** — the roadmap-named starting points (`MainApp.tsx` missing-songs check + queue-missing, `App.tsx` bootstrap equivalents) now `logger.error('[area]', e)` instead of swallowing. ~114 silent catches across `src/` remain for a dedicated pass. `any` reduction still pending.

### Added
- **Concurrent downloads setting** — new "Concurrent Downloads" control in Settings → Downloads (1-8, default 3). Electron/web now run a bounded worker pool (`processConcurrentJS`/`downloadWorkerJS` in `downloadManagerService.ts`) instead of downloading one song at a time; each worker claims the next pending item synchronously (no double-claim race) and reuses the existing `downloadSong()` retry/backoff/completion logic per item. iOS applies the cap via `URLSessionConfiguration.httpMaximumConnectionsPerHost` (set from a value persisted in `UserDefaults` via a new `setMaxConcurrentDownloads` plugin method — takes effect on next app launch since it's fixed for the session's lifetime, previously unbounded). The stuck-download detector now tracks per-item abort controllers and last-progress timestamps (`activeAbortControllers`/`activeLastProgressMs`, keyed by item ID) so a single stalled download aborts independently without disturbing others running concurrently. `DownloadProgress.currentDownloads` exposes all in-flight items; `DownloadManagerWindow` renders one active-download card per concurrent download instead of a single card. Android's download service remains single-threaded for now — its executor and notification/wakelock state are tightly coupled to a sequential assumption that needs a dedicated pass to convert safely.
- **iOS native batch downloads** — `BackgroundDownloadPlugin.swift` gained `startBatch`/`cancelBatch`, enqueuing every pending song's `URLSessionDownloadTask` on the shared background `URLSession` up front instead of the JS queue chaining one `startDownload` call at a time via `setTimeout`; `downloadManagerService.ts` gained `downloadBatchNativeIOS()` (mirrors the existing Android `downloadBatchNative` pattern) and dispatches iOS to it in `processQueue()`, removing the dependency on WKWebView JS timers firing reliably between songs while backgrounded
- **Electron desktop download progress** — dock/taskbar progress bar (`BrowserWindow.setProgressBar`), a tray icon with a live tooltip (reusing the previously-unused `assets/icon-tray.png`), and a macOS dock badge; wired through new `set-download-progress`/`clear-download-progress` IPC handlers in `public/electron.js` and implemented in `electronBridge.ts`, filling in a `showDownloadNotification`/`hideDownloadNotification` bridge seam that was previously a no-op on Electron

### Fixed
- **iOS: infinite "Loading…" after switching offline → online** — the library views (`ArtistList`, `AllAlbumsGrid`, `AllSongsGrid`) could spin forever after toggling back to online mode on iOS. Root cause was a chain: (1) `OfflineModeContext` only ever updated `isOnline` from `navigator.onLine` and the `window` `online`/`offline` events, and the `@capacitor/network` listener it registers updated **only `isCellular`, never `isOnline`** — WKWebView is unreliable about all three, so after launching with no connection `isOnline` stayed a stale `false`; (2) `toggleOfflineMode()` never re-checked connectivity, so going online left `offlineModeEnabled=false` while `isOnline` was still `false`, forcing views down the cache-only path or straight into a network call; (3) **no axios timeout was configured anywhere in the app**, so the first (frequently hung) WKWebView XHR after the transition never settled and the component's `loading` state was never cleared — the existing `ERR_NETWORK` interceptor can't catch a socket that simply hangs. Fixes: `axios.defaults.timeout = 15000` in `src/index.tsx` (+ the connectivity-error interceptor now also treats `ECONNABORTED`); the native `Network` plugin now drives `isOnline` from `status.connected` in both `getStatus()` and `networkStatusChange` (`OfflineModeContext.tsx`); and `toggleOfflineMode()` calls `checkConnectivity()` on the offline→online transition. Android was likely unaffected (its WebView fires `online`/`offline` reliably and recovers its network stack immediately) but gets the same hardening. Needs an iOS device test to confirm.
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
