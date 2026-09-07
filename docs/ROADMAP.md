# Xylonic Roadmap — "Everything to 9+"

Planning document for lifting every quality axis to **9–10/10**, plus adding
**Android TV** support. Derived from the 2026-09 codebase analysis.

- Companion to `docs/todos.md` (tactical, session-scoped) — this file is the
  strategic plan. When a task here starts, mirror it into `docs/todos.md`.
- Update `docs/session_summary.md` + `CHANGELOG.md` as workstreams land.
- Scores are self-assessed against the axis "Definition of Done" below each
  workstream. An axis is not "9" until every **must** box is checked.

---

## Scorecard

| Axis | Now | Target | Gating workstream |
|---|---|---|---|
| Product ambition / feature depth | 9.0 | 9.5 | WS-TV + WS-FEAT |
| Architecture | 7.5 | 9.5 | WS-ARCH |
| Code quality / maintainability | 5.5 | 9.0 | WS-QUAL |
| Testing / QA | 1.5 | 9.0 | WS-TEST |
| Security | 3.5 | 9.5 | WS-SEC |
| Performance engineering | 7.0 | 9.5 | WS-PERF |
| Design system / UX | 6.0 | 9.0 | WS-UX + WS-TV |
| Internal docs | 8.0 | 9.5 | WS-DOCS |

**Weighted overall target: 9.3 / 10.**

---

## Guiding principles

1. **Tests before refactors.** No god-object gets split until its behaviour is
   pinned by tests. `WS-TEST` unblocks `WS-ARCH`.
2. **One authoritative credential path.** Every `localStorage.getItem('password')`
   is a bug until `WS-SEC` removes it.
3. **Shared layer stays platform-agnostic.** TV, iOS, desktop differences go
   through `src/platform/` + a layout-mode context, never inline `if (isTV)`
   scattered in components.
4. **Build-only validation locally** (`npm run build`); the user runs
   packaging/device installs.
5. **Every workstream ends with:** CHANGELOG entry, docs updated, CI green.

---

## Phase order (dependency-aware)

```
Phase 0  WS-SEC (secrets)  ──┐
Phase 1  WS-TEST ───────────┼──► Phase 2  WS-ARCH ──► Phase 4  WS-PERF
Phase 1  WS-QUAL (lint/CI) ─┘                     └──► Phase 3  WS-UX ──► Phase 5  WS-TV
Phase 6  WS-FEAT + WS-DOCS (rolling, low-risk, fill gaps)
```

Phase 0 is do-first (key rotation can't wait). Phases 1a (lint/CI) and 1b
(test harness) run in parallel. TV work depends on the responsive refactor.

---

## WS-SEC — Security → 9.5

**Now 3.5.** Plaintext creds, keystore in git, `webSecurity:false`, no CSP.

### Must
- [ ] **Rotate `xylonic-release.jks`.** Generate a new signing key, `git rm` the
      old one, purge from history (`git filter-repo`), move key + passwords to
      CI secrets (GitHub Actions `secrets.ANDROID_KEYSTORE_B64` etc.). Treat the
      old key as compromised. Update `build-android.sh` to read from env.
- [ ] **Single credential service.** New `src/services/credentialsService.ts`:
      `get()/set()/clear()` returning `{serverUrl,user,pass}`. Backends:
      Electron `safeStorage` (existing bridge), Capacitor `Preferences` backed by
      Android Keystore / iOS Keychain (via `@capacitor/preferences` `group`),
      web = in-memory session only (no persistence).
- [ ] **Delete every `localStorage.getItem('password')`** (30+ sites across
      `MainApp.tsx`, `App.tsx`, `downloadManagerService.ts`, `SongList.tsx`,
      `AlbumList.tsx`, `AllAlbumsGrid/SongsGrid.tsx`, `DiscoverView.tsx`,
      `LikedSongsView.tsx`, `CachePreloadDialog.tsx`, `likedSongsService.ts`,
      `secureCredentialService.ts`). Replace with one `useCredentials()` hook /
      `credentialsService.get()`. Removes the copy-pasted `serverUrl/user/pass`
      triple as a side effect.
- [ ] **One-time migration** on launch: if legacy plaintext keys exist, import
      into the secure backend, then `removeItem`.
- [ ] **CSP.** Electron `session.onHeadersReceived` injects a strict
      `Content-Security-Policy` (`default-src 'self'`; `img-src 'self' data:
      https: xylonic:`; `media-src 'self' blob: https: xylonic:`;
      `connect-src 'self' https: http:` for arbitrary Subsonic hosts;
      no `unsafe-eval`). Add `<meta http-equiv="Content-Security-Policy">` to
      `index.html` for the Capacitor build.
- [ ] **Kill `webSecurity: false`.** Register a custom `xylonic://` protocol
      (`protocol.handle`) for cached audio/art files; inject Subsonic auth via
      `onBeforeSendHeaders` instead of relying on disabled CORS. Re-enable
      `webSecurity: true` on both `BrowserWindow`s.
- [ ] **`setWindowOpenHandler` default-deny** — only `shell.openExternal` for
      `http/https`, `return { action: 'deny' }` for everything else.
- [ ] **Crypto salt** — replace `Math.random().toString(36)` in
      `subsonicApi.generateAuthParams` with `crypto.getRandomValues` hex, ≥16 chars.

### Should
- [ ] `usesCleartextTraffic` — scope `network_security_config` to
      user-configured hosts only, not global; document HTTP-server risk in UI.
- [ ] Dependency audit gate in CI (`npm audit --audit-level=high`), triaged by
      reachability (see `security-and-hardening` skill).
- [ ] `SendFeedback`-style redaction pass on `logger` — never log the `password`
      / `t` / `s` query params (currently full stream URLs are logged).

### Definition of Done
No secret in the repo or history; no plaintext credential at rest on any
platform; `webSecurity: true`; CSP present and enforced on desktop + mobile;
`npm audit` clean of reachable high/critical; security checklist in
`security-and-hardening` passes.

---

## WS-TEST — Testing / QA → 9.0

**Now 1.5.** `"test": "echo \"No test runner configured\""`. Zero tests.

### Must
- [ ] **Add Vitest + React Testing Library + jsdom.** Real `npm test`,
      `npm run test:watch`, `npm run test:coverage`. Wire into `.github/workflows`.
- [ ] **Core race/correctness coverage** (each maps to a real CHANGELOG bug):
  - [ ] `offlineCacheService` — add/remove/verify, `totalSize` accounting
        (no double-count on re-register), debounced save flush, orphan
        `registerNativeDownload`.
  - [ ] `downloadManagerService` — queue dedup, idempotent
        `songDownloaded`/`songFailed`, `reconcileOrphans`, batch-hijack path.
  - [ ] `PlayerContext` queue logic — Fisher-Yates (every song once per cycle),
        repeat one/all, next/prev at boundaries, shuffle toggle rebuild.
  - [ ] `subsonicApi` — auth param shape, `checkOfflineMode` blocking,
        `getAllSongs` pagination termination, `search3` empty-query.
  - [ ] `searchCacheService` / `searchWorker` — filter correctness + main-thread
        fallback.
- [ ] **Contract tests for `src/platform/` bridges** — a fake bridge implementing
      `PlatformBridge`, asserting each real bridge honours the interface
      (return shapes, error modes).
- [ ] **Mock Subsonic server** (`vitest` MSW handlers or a tiny Express fixture)
      — no test hits a live server.
- [ ] **CI matrix** builds all targets on PR (already partially present) +
      runs `test` + `tsc --noEmit` + lint as required checks.

### Should
- [ ] **Playwright smoke test** per platform web build: boot, login against mock,
      play a track, go offline, verify cached playback. Run headless in CI.
- [ ] Coverage floor in CI (start at 40 % lines on `src/services/**` +
      `src/context/**`, ratchet up; don't gate on UI components yet).
- [ ] `test-connection.sh` / `build-*.sh` — add a `--dry-run` self-check target.

### Definition of Done
`npm test` runs a real suite; every bug class in the CHANGELOG history
(races, dup events, size accounting, orphan recovery) has a regression test;
CI blocks merge on test + typecheck + lint; services/context coverage ≥ 60 %.

---

## WS-QUAL — Code quality → 9.0

**Now 5.5.** 134 `any`, 41 `eslint-disable`, 221 raw `console.*`, no lint config,
pervasive `catch {}`.

### Must
- [ ] **ESLint + `typescript-eslint` + Prettier** config committed. Rules:
      `no-console` (force `logger`), `no-empty` (ban silent `catch {}`),
      `@typescript-eslint/no-explicit-any` (warn → error over time),
      `react-hooks/exhaustive-deps` (audit the 41 disables — keep only justified).
- [ ] **`npm run lint` + `npm run format:check` in CI** as required checks.
- [ ] **Replace all 221 `console.*`** with `logger.*` (categorised). Vite
      `define` strips `logger.debug`/`log` in production builds so hot-path
      string formatting cost disappears on Android WebView.
- [ ] **Error-handling sweep** — every `catch {}` / "silently ignore" becomes
      `logger.error('[area]', e)` at minimum; user-facing failures get a retry
      affordance (ties to WS-UX empty/error states). Start with `MainApp.tsx`
      (3 blocks), `handleDownloadMissing`, `App.tsx` bootstrap.
- [ ] **Kill dead code** — `src/services/offlineCacheService.v1.backup.ts.txt`
      and `.v2.ts` out of `src/` (git history / `docs/` note). One live
      implementation only.
- [ ] **`any` reduction** — target < 30 project-wide. Type the Subsonic response
      surface properly in `src/types/subsonic.ts` (biggest `any` source is
      `response.data['subsonic-response']` handling).
- [ ] **Fill `CLAUDE.md`** — currently empty; it should state the doc-maintenance
      contract (todos/session_summary/module_notes/ARCHITECTURE/CHANGELOG),
      build-only-validation rule, and the credential-service rule.

### Should
- [ ] Shared `useServerCreds()` hook returned from WS-SEC replaces the triple
      everywhere (already listed there; verify no stragglers).
- [ ] `logger` gains structured fields (`{event, ...}`) per
      `observability-and-instrumentation`; add a correlation id per download batch.
- [ ] Pre-commit hook (husky + lint-staged) — lint + format + `tsc` on staged files.

### Definition of Done
Lint + format + typecheck are required CI gates and pass clean; `any` < 30;
no `console.*` in `src/`; no empty catch blocks; no dead cache files;
`CLAUDE.md` populated.

---

## WS-ARCH — Architecture → 9.5

**Now 7.5.** Good bridge spine; god-objects, no router, manual view state machine.

### Must (each preceded by its WS-TEST coverage)
- [ ] **Split `PlayerContext` (1555 lines)** into:
      `usePlaybackEngine` (audio element, src swap, preload/gapless),
      `useQueue` (queue/shuffle/repeat/persistence),
      `useMediaSession` (OS media integration + MPRIS/MediaSession bridge calls),
      `usePlayerPersistence` (localStorage/IDB, queue-as-IDs — see WS-PERF).
      `PlayerProvider` composes them; public `usePlayer()` API unchanged.
- [ ] **Split `downloadManagerService` (2064 lines)** into `downloadQueue`
      (model + dedup), `downloadTransport` (native Android/iOS/Electron/web pools),
      `downloadReconciler` (orphans, batch hijack, completion log).
- [x] **Split `electron.js`** (2026-09-07) — 2232 → **533 lines of wiring**.
      `public/ipc/*.js`: `remote.js`, `logging.js`, `settings.js`, `credentials.js`,
      `system.js`, `misc.js`, `downloadNotification.js`, `cache.js` (~31 handlers),
      `playerWindow.js` (mini-player + player-state + MPRIS art). Each module has
      a plain-node functional test; `electron:serve` verified clean per step.
- [ ] **Split `SettingsView` (1226 lines)** into one component per section,
      each memoised, lazy-mounted per tab.
- [ ] **Add routing** — `react-router` with memory history on native. Replaces
      the `topView/drillView/selectedArtist/selectedAlbum` machine in `MainApp`.
      Enables deep-linking, desktop back-stack (subsumes the custom Android
      back-stack), and scroll-position restore on reload.
- [ ] **`LayoutModeContext`** — `'compact' | 'medium' | 'expanded' | 'tv'`,
      derived from container size + input capability + native `uiMode`
      (TV signal from the bridge). The one place platform/layout branching lives.

### Should
- [ ] Provider tree (8 deep) — verify every `value` is `useMemo`'d; collapse
      `RemoteModeProvider`/`ImageCacheProvider` into leaner hooks if they don't
      need to be context.
- [ ] `ARCHITECTURE.md` (95 KB) — split into `docs/architecture/*.md` by
      subsystem; keep a short index. Regenerate the module map.
- [ ] ADRs (`docs/decisions/NNNN-*.md`) for: the bridge pattern, offline cache
      v2 hash storage, download reconciliation, routing adoption, TV layout mode.

### Definition of Done
No file in `src/` over ~600 lines except generated types; `electron.js` is
wiring only; routing in place with working back navigation on all platforms;
all layout/platform branching flows through `LayoutModeContext` + `src/platform/`;
ADRs exist for every major decision.

---

## WS-PERF — Performance → 9.5

**Now 7.0.** Strong already (virtual scroll, search worker, LRU art, IPC throttle).

### Must
- [ ] **Queue persistence** — stop `JSON.stringify(entireSong[])` on every
      next/prev/shuffle. Persist `{ids:[], idx}` + a song-by-id store in IDB;
      debounce writes (500 ms); validate + repair on load. Fixes multi-MB
      main-thread stalls and partial-write corruption on 25k "play all".
- [x] **`getAllSongs` parallelism** (2026-09-06) — probe page 0 serially, then
      fetch the rest in batches of 4 concurrent `search3` requests, stop on first
      short page. (Subsonic `search3` returns no reliable total, so probe-then-
      batch rather than reading a total up front.) Order + `failed` + offline
      guard preserved; covered by `subsonicApi.test.ts`.
- [ ] **Production log stripping** — Vite `define` drops `logger.debug/log`;
      confirm no `console.*` survives (WS-QUAL).
- [ ] **FontAwesome subset** — stop importing all of `@fortawesome/fontawesome-free`.
      Build a subset (~60 glyphs used) or inline SVGs. Cuts bundle + fixes the
      MECHEN H1-Pro `+` non-render (see `feedback_fa7_icon_range`).
- [ ] **Search index compression** — `CompressionStream('deflate')` on the IDB
      search index (3–5× smaller); read path handles legacy uncompressed records.

### Should
- [ ] **Dependency bumps** (each isolated, tested, changelog-reviewed):
      Electron 27 → current LTS, TypeScript 4.9 → 5.x, Capacitor 8 → 9,
      Vite already 8. Each removes a class of platform bugs.
- [ ] `SettingsView` + large lists — `React.memo` audit, `useMemo` for derived
      lists, `content-visibility: auto` on off-screen sections.
- [ ] Android downloads — multi-threaded pool matching the Electron/iOS cap
      (see `docs/todos.md`); notification/wakelock state reworked for N active
      transfers.
- [ ] Perf budget in CI — bundle size check (`bundlesize`), fail on >10 % growth;
      a Lighthouse run on the web build.
- [ ] Keep a `docs/PERF_LEDGER.md` — every optimisation attempt, baseline →
      result → keep/revert, so dead ideas aren't re-tried.

### Definition of Done
No synchronous multi-MB serialization on the playback path; big-library
metadata fetch is parallel; production bundle carries no debug logging and a
subset icon font; search index compressed; a perf budget gate in CI; every
kept optimisation has a before/after number in the ledger.

---

## WS-UX — Design system / UX → 9.0

**Now 6.0.** Coherent dark theme + 261-var theming engine; one breakpoint,
`100vh`, whole-FA, no real light theme, a11y gaps.

### Must
- [ ] **Three real responsive layouts** driven by `LayoutModeContext` +
      container queries (not just `max-width: 767`):
  - **compact** (phone): bottom nav, single pane, current mobile UI.
  - **medium** (tablet / small desktop window): rail nav + content, optional
    right panel.
  - **expanded** (desktop): sidebar + content + persistent right-hand
    queue/now-playing panel.
  - (**tv** — see WS-TV.)
- [ ] **`100vh` → `100dvh`** on `.app` and every full-height element; keep the
      existing safe-area/`viewport-fit` handling.
- [ ] **Real light theme** — `:root` light baseline + `prefers-color-scheme`
      dark as the default pair the theming engine (`colorConfigManager`,
      `CustomThemeEditor`) layers onto. Fix hardcoded
      `<meta name="theme-color" content="#000000">` (theme-aware).
- [ ] **Token discipline** — replace inline `style={{ marginBottom: '24px' }}`
      (MainApp and others) and magic pixels with the existing `--spacing-*` /
      `--radius-*` scale. Lint rule to discourage new inline style objects.
- [ ] **Accessibility pass** — `aria-label` on every icon-only button (not just
      `title`); global `:focus-visible` ring; audit `user-select: none` (keep for
      chrome, allow for track/album titles); `role`/`aria-live` already good on
      banners — extend to download/queue status.
- [ ] **Empty / loading / error states** — skeletons for lists, an explicit
      offline "here's what's available" state, retry buttons where WS-QUAL
      removed silent catches.

### Should
- [ ] Persistent right-hand **queue panel** on expanded layout with drag-reorder
      and "playing from <context>" — the main ergonomic gap vs. reference apps.
- [ ] Design-craft research pass (per `design-craft` skill) before the expanded
      layout: 3–4 real reference players, a locked direction, a decision ledger
      in `docs/design/`.
- [ ] Motion pass — `prefers-reduced-motion` honoured everywhere; one deliberate
      now-playing transition rather than scattered effects.
- [ ] Contrast check both themes against WCAG AA; ship a high-contrast variant
      for the cheap-DAP hardware.

### Definition of Done
Three container-query layouts verified on phone / tablet / desktop / small
window; light + dark both first-class and theme-engine-compatible; no `100vh`;
every interactive control keyboard-reachable with a visible focus state and an
accessible name; no silent blank states.

---

## WS-TV — Android TV support → (feeds Product 9.5 + UX 9.0)

**Feasibility: YES, medium effort.** Capacitor apps run on Android TV (it has a
WebView). No Apple TV (explicitly out of scope). The work is ~70 % frontend
(spatial navigation + 10-foot layout) and ~30 % native manifest/leanback glue.
Same APK can serve phone + tablet + TV.

### Native / manifest (small)
- [ ] `android/app/src/main/AndroidManifest.xml`:
  - [ ] `<uses-feature android:name="android.software.leanback" android:required="false" />`
  - [ ] `<uses-feature android:name="android.hardware.touchscreen" android:required="false" />`
  - [ ] Add `<category android:name="android.intent.category.LEANBACK_LAUNCHER" />`
        to `MainActivity`'s intent-filter (keep the existing `LAUNCHER`).
  - [ ] `android:banner="@drawable/tv_banner"` on `<application>` (320×180 xhdpi).
- [ ] `tv_banner` asset (+ `drawable-xhdpi`); Play Store TV listing needs a
      1280×720 banner too.
- [ ] Verify `MusicService` / `DownloadService` foreground-service types are TV-OK
      (they are — `mediaPlayback`).
- [ ] Expose a TV signal on `PlatformBridge`:
      `getUiMode(): Promise<'normal'|'television'|'car'|'desk'|'watch'>` reading
      `Configuration.uiMode & UI_MODE_TYPE_MASK` in `MainActivity` /
      a tiny plugin. `LayoutModeContext` uses it (fallback heuristic:
      `matchMedia('(hover: none) and (pointer: coarse)') === false` + large
      screen + no touch).
- [ ] `build-android.sh` — no change needed (single APK); add a
      `--tv-check` that greps the merged manifest for the leanback category.
- [ ] CI — add an Android TV emulator smoke boot (optional; `avdmanager`
      `system-images;android-34;android-tv;x86_64`).

### Frontend — spatial navigation (the real work)
- [ ] **Focus engine** — adopt a lightweight roving-tabindex / spatial-nav lib
      (`@bbc/tv-lrud-spatial`, `norigin-spatial-navigation`) or a small custom
      one. Every focusable gets a visible focus ring (reuse the WS-UX
      `:focus-visible` token, bumped for 10-foot legibility).
- [ ] **D-pad key handling** — arrow keys move focus, Enter/`DPAD_CENTER` =
      activate, `BACK` = router back (wire to WS-ARCH routing), Media keys =
      play/pause/next/prev (already partly handled via MediaSession).
- [ ] **`scrollIntoView` on focus** for long lists; virtualised lists
      (`react-window`) must keep the focused item mounted.
- [ ] **`tv` layout mode** in `LayoutModeContext`:
  - Horizontal shelves (rows) for Artists / Albums / Recently Played /
    Liked — TV UX is browse-by-row, not drill-down menus.
  - Large type scale, generous spacing, **5–8 % overscan margin** on the
    root container.
  - No hover-only affordances; no tiny targets; no right-click menus —
    context actions move to a focus-then-Enter detail panel.
  - Now-Playing = full-screen ambient art (reuse `NowPlayingOverlay`,
    TV-scaled) as the default idle screen.
- [ ] **Login on TV** — server URL / user / pass via the Android IME
      (D-pad keyboard). Prefer: pair-from-phone flow using the existing
      **Remote Mode** LAN discovery (`remoteDiscoveryService`, UDP 7766) — TV
      advertises, phone pushes credentials. Big UX win, reuses existing code.
- [ ] **Leanback-friendly media session** — ensure `MediaSessionCompat`
      metadata + queue is populated so the Android TV system UI / Google
      Assistant ("play X on Xylonic") works.
- [ ] Disable pinch-zoom / text-select CSS already handles this; verify no
      `touch-action` rule breaks D-pad scroll.

### Should
- [ ] Play Store "Android TV" quality checklist pass (banner, no touch
      requirement, D-pad-only completable, back always works, no crashes on
      leanback launch).
- [ ] Screensaver / burn-in mitigation on the idle now-playing screen (slow
      art drift, dim after N minutes).
- [ ] Recommendations channel (Android TV home row) — optional, later.

### Definition of Done
App launches from the Android TV leanback launcher with a banner; the entire
app (login → browse → play → offline) is completable with a D-pad only; focus
is always visible and never trapped; `BACK` always works; phone-to-TV credential
pairing works via Remote Mode; single APK still installs and behaves correctly
on phone + tablet.

---

## WS-FEAT — Feature gaps → Product 9.5

Low-risk, fills competitive gaps. Pick opportunistically between big workstreams.

- [ ] Deep-linking / "resume where I was" (falls out of WS-ARCH routing).
- [ ] Persistent expanded-layout queue panel (WS-UX).
- [ ] Playlist editing parity (reorder, multi-select add/remove) across views.
- [ ] Gapless/crossfade polish + ReplayGain (`music-metadata` already parses tags).
- [ ] Smart offline: "keep my most-played N GB offline automatically" (uses
      `recentlyPlayedService` + `networkStatsService`).
- [ ] Cast / DLNA output (beyond the existing LAN Remote Mode).
- [ ] Last.fm love sync both directions; ListenBrainz as a second scrobbler.
- [ ] Sleep-timer "end of track/album" modes; alarm.
- [ ] Lyrics (Subsonic `getLyrics` / LRCLIB) with a TV-friendly full-screen view.

---

## WS-DOCS — Internal docs → 9.5

**Now 8.0.** Huge but sprawling; `CLAUDE.md` empty; some stale.

- [ ] Populate `CLAUDE.md` (WS-QUAL).
- [ ] Split `ARCHITECTURE.md` into `docs/architecture/*.md` + index (WS-ARCH).
- [ ] ADR set in `docs/decisions/` (WS-ARCH).
- [ ] Prune / date-stamp `CACHE_V21_*.md`, `IMAGE_CACHE_*.md`,
      `QUALITY_VERIFICATION.md` — mark historical, move under `docs/history/`.
- [ ] `README.md` — trim to quick-start + feature list + platform matrix;
      link out to the split architecture docs. Add the Android TV row.
- [ ] `CONTRIBUTING.md` — test/lint/build commands, the credential-service rule,
      build-only-validation rule, PR checklist.
- [ ] Keep `docs/PERF_LEDGER.md` (WS-PERF) and `docs/design/` (WS-UX) current.

### Definition of Done
`CLAUDE.md` real; architecture docs modular with an index; ADRs for every major
decision; no undated historical doc in the repo root; README + CONTRIBUTING
current including TV.

---

## Release gates (Definition of Done, project-wide)

Before any release tag, all of:
- [ ] `npm run build` clean; `tsc --noEmit` clean; `npm run lint` clean.
- [ ] `npm test` green; services/context coverage ≥ 60 %.
- [ ] No secret in repo/history; `webSecurity: true`; CSP enforced.
- [ ] `npm audit` — no reachable high/critical.
- [ ] CHANGELOG entry (curated, impact-first) + version bump matching change
      type (CalVer date + sequence).
- [ ] `docs/session_summary.md` + `docs/todos.md` updated.
- [ ] Manual device pass recorded for anything native (Android phone, Android TV,
      iOS, one desktop) — state platform + result, don't claim untested.

---

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Keystore rotation breaks existing installs' update path | High | New key = new signing identity; document that sideloaded users must reinstall once. Play Store uses Play App Signing if enrolled. |
| `webSecurity: true` breaks Subsonic art / cached file loading | High | Land `xylonic://` protocol + header injection first, behind a flag; verify on all 4 desktop targets before flipping. |
| God-object splits regress playback/download races | High | WS-TEST gates every split; no refactor without its coverage first. |
| Capacitor 9 / Electron LTS bump breaks native plugins | Med | One bump per PR, changelog reviewed, full device pass; revert-clean. |
| Spatial nav lib doesn't handle virtualised lists well | Med | Prototype focus + `react-window` early in WS-TV; custom LRUD fallback if needed. |
| TV Play Store rejection (touch requirement / D-pad gaps) | Med | Run the TV quality checklist before submission; D-pad-only test is a WS-TV DoD item. |
| Scope creep from WS-FEAT starving core workstreams | Med | WS-FEAT is explicitly opportunistic/low-priority; core phases come first. |
