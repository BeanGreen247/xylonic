# Xylonic — Work List (session bootstrap)

Consolidated, always-current task list across every workstream. Detail + Definition
of Done live in [`docs/ROADMAP.md`](ROADMAP.md); latest session context in
[`docs/session_summary.md`](session_summary.md) (tail only). This file is the
"where are we / what's next" index — keep its checkboxes in sync as work lands.

Status: `✅` done · `🟡` partial · `⬜` open · `🔒` blocked (needs a device or
WS-TEST coverage first) · `🎨` design-gated (needs its own `docs/design/00N`).

Last updated: 2026-09-08.

---

## Installed skills — use all of them

A new session must invoke the **always-on** skills at the start (via the Skill
tool) and reach for the rest whenever the task matches. "Use all of them" =
every skill below has a home in the work that remains; the mapping is explicit so
nothing gets skipped.

### Always on (invoke every session, no exceptions)
| Skill | Role |
|---|---|
| `token-economy` | scoped reads, batched tool calls, one-sentence replies, low reasoning depth |
| `silent-executor` | work quietly, no narration, `FINISHED`-style terse close |
| `no-unsolicited-opinions` | execute the instruction as given; don't re-litigate decided choices |
| `python-engineer` | read before writing/reviewing non-trivial Python (the `scripts/*.js` are JS, but any Python tooling, and its systems-engineering guidance, applies) |

### Xylonic layer skills (pick by which files the task touches)
| Skill | Owns |
|---|---|
| `xylonic-frontend` | `src/**`, `public/index.html`, styling, shared logic — **most WS-UX / WS-PERF / WS-ARCH renderer work** |
| `xylonic-electron` | `public/electron.js`, `preload.js`, `mpris.js`, `electron-builder.*` — WS-SEC `xylonic://` + CSP, IPC, packaging |
| `xylonic-mobile` | `android/**`, `ios/**`, `capacitor.config.ts`, Capacitor plugins — WS-TV, Android download pool, iOS download bug, Keychain/Keystore backend |

### Craft / workflow skills (use where relevant)
| Skill | Where it applies next |
|---|---|
| `design-craft` | **every** WS-UX visual task — UI-02…14, offline landing, contrast/AA pass, high-contrast variant. Research first, lock a direction, write the `docs/design/00N` ledger before coding. |
| `planning-and-task-breakdown` | before starting `react-router`, the `PlayerContext` engine/queue split, WS-TV — turn each into ordered sub-tasks |
| `incremental-implementation` | any multi-file change — one reviewable commit per step, build+test between |
| `module-extraction-verification` | the remaining `PlayerContext` / `downloadManagerService` splits — prove behaviour-preserving before trusting them |
| `test-driven-development` | **WS-TEST** — `PlayerContext` queue tests, `downloadManagerService` event tests, MSW mock server; and any bug fix |
| `code-review-and-quality` | before pushing each workstream increment; self-review the diff |
| `code-simplification` | `SettingsView` remaining split, provider-tree collapse, lint `no-unused-vars` burndown |
| `debugging-and-error-recovery` | the iOS download bug, any failing build/test, the false "N songs not downloaded" banner |
| `performance-optimization` | **WS-PERF** — queue-persistence→IDs, `fa-solid` subset, `QueueTab` windowing, dep bumps, Lighthouse |
| `security-and-hardening` | **WS-SEC** — plaintext-at-rest removal, `webSecurity:true`, CSP tighten, `npm audit` triage, logger redaction |
| `observability-and-instrumentation` | WS-QUAL "structured `logger` fields + per-batch correlation id" |
| `api-and-interface-design` | `react-router` route contract, the `getUiMode()` bridge method, `PlayerProvider` public API when splitting |
| `ci-cd-and-automation` | make `lint`/`format:check` required CI gates, TV emulator smoke, Lighthouse in CI, `npm audit` gate |
| `git-workflow-and-versioning` | commits (single-line conventional, zero AI attribution), `npm run version:date` when cutting a build, CHANGELOG |
| `documentation-and-adrs` | ADRs for routing + TV-mode + any new subsystem; keep `docs/architecture/*` + `docs/design/*` current |
| `browser` | Playwright visual QA of every WS-UX change (light + dark, 390/900/1440); the iOS CDP debug workflow |
| `websearch` | `design-craft` reference research (local tools only — never a paid API); dep-bump changelog review |
| `skill-safety-review` | only if adding/updating a skill |

---

## Execution order in effect (owner-revised 2026-09-07)

```
WS-QUAL core ✅ → WS-TEST harness ✅ → WS-ARCH → WS-PERF → WS-UX leftovers
  → WS-FEAT/DOCS → WS-QUAL remainder (near-last) → WS-SEC leftovers → WS-TV
  → WS-TEST full coverage (very last)
```

Consequence: the WS-ARCH god-object splits run **before** their WS-TEST coverage
— "tests before refactors" is consciously suspended; each split is gated on
`npm run build` + the existing 127 tests + `electron:serve`, with device-only
behaviours verified with the owner afterwards.

Validation commands (the only ones a session runs): `npm run build`, `npm test`,
`npm run lint`, `npm run size`, `npm run electron:serve` (bg, scan for "error
occurred in the main process"). Never trigger packaging / ADB / Gradle / Xcode /
`cap sync` / emulators. Commits: single-line conventional, **zero** AI/attribution.

---

## ▶ WS-ARCH — Architecture

- ✅ `electron.js` split — 2232 → 533 lines, 9 `public/ipc/*` modules
- ✅ `LayoutModeContext` + consumed by WS-UX
- ✅ 7 ADRs in `docs/decisions/`
- ✅ Provider-tree memoization — all 8 contexts `useMemo` + `useCallback`
- ✅ `ARCHITECTURE.md` physical split — 14 `docs/architecture/NN-*.md` + index; old path is a redirect stub
- 🟡 `SettingsView` split — 1226 → **745** (`LicensesDialog`, `TechStackDialog`, `PerformanceCacheSection`, `AboutSection`, `AdvancedSection`). Remaining: Appearance/Playback/Account/Offline&Cache/Remote/Streaming/Downloads/Library/Danger + switch-server modal — state-coupled, want a props shape or tab UI
- 🟡 `PlayerContext` split — 1555 → **1026** (`playerQueue`, `playerPersistence`, `utils/dataUrl`, `useMediaSession`, `useSleepTimer`, `usePlaybackPrefs`, `useNeighborSongs`)
- 🔒 `PlayerContext` → `usePlaybackEngine` + `useQueue` core — mutually entangled via `playNext`/`playSong`/`playPrevious` + the ref web; worst race/dup-event history; no test net; gapless/MPRIS device-only
- 🔒 `downloadManagerService` → `downloadQueue` + `downloadTransport` — `this.queue` mutated at ~40 sites (restructure, not extraction); batch-hijack landmine; native pools device-only
- 🔒 `react-router` — new runtime dep + rewrites Android `backbutton` + section history; on-device pass required
- 🟡 *(Should)* collapse `RemoteModeProvider` / `ImageCacheProvider` into leaner hooks

## ▶ WS-PERF — Performance

- ✅ `getAllSongs` parallel batches
- ✅ Prod log stripping (modern bundle)
- ✅ Search-index compression — `CompressionStream` deflate in `searchCacheService` (was already shipped)
- 🟡 FontAwesome subset — `fa-brands` (110 kB) + `fa-regular` (19 kB) webfonts + 22 kB CSS dropped; `github`/`lastfm` inline SVG (`components/common/BrandGlyph`). Remaining: true `fa-solid-900` subset (115 kB, ~98/1400 glyphs) — build-time subsetter + full glyph list incl. dynamic `fa-${…}`; also fixes the MECHEN DAP high-codepoint non-render
- ✅ Perf budget CI gate — `npm run size` / `scripts/check-bundle-size.js` in `ci.yml`
- ✅ `docs/PERF_LEDGER.md` — before/after per optimisation + bundle snapshot
- 🟡 `SettingsView` + lists — `content-visibility` on `.settings-section`; high-cost list items already memoized/virtualized. Remaining: `QueueTab` renders the full queue un-windowed (25k rows on "play all")
- 🔒 Queue persistence → `{ids, idx}` + IDB song store — entangled with the synchronous `PlayerContext` boot (`loadQueue()` is a `useState` initializer)
- 🔒 *(Should)* Dep bumps — Electron 27→LTS, TS 4.9→5.x, Capacitor 8→9 (device pass each; the TS bump also unblocks the blocking `typecheck` CI gate)
- 🔒 *(Should)* Legacy-bundle log strip (`@babel/core` plugin; packaged-build test)
- 🔒 *(Should)* Android multi-threaded download pool (native; `DownloadService.java` is single-threaded)
- ⬜ *(Should)* Lighthouse run on the web build

## ▶ WS-UX — Design system / UX

- ✅ Three responsive layouts (`data-layout`, docked queue panel, container-query grids) — `docs/design/0001`
- ✅ `100vh` → `100dvh`
- ✅ Accessibility pass — global `:focus-visible`, `aria-label` on icon buttons, `aria-live` on download/queue status
- ✅ Design-craft research pass — `docs/design/0001`
- 🟡 Light theme — token flip + system/light/dark toggle; **colour audit done** (~250 `rgba(255,255,255,…)` + ~15 `rgba(0,0,0,…)` literals → 6 flip tokens `--border*`/`--hover-overlay`/`--active-overlay`/`--scrim` across 30 files). Left: `LoginForm` (accent gradient — white is correct), dev HUD, data-URI arrow fills, high-alpha scrollbar thumbs
- 🟡 Token discipline — repeated state blocks → `.library-state*`; inline `style={{}}` 115 → 79. Remaining: eslint rule (attempted — per-property `no-restricted-syntax` too noisy, +127 warnings; needs a custom rule that detects a *fully*-static object)
- 🟡 Empty/loading/error states — `Skeleton.tsx` in 6 list/grid views. Remaining: offline "here's what's available" landing (= UI-09); RightPanel/Discover skeletons
- 🟡 Persistent queue panel — docks at `expanded`. Remaining: "playing from &lt;context&gt;" header (touches `PlayerContext` queue state)
- 🟡 Motion pass — global `@media (prefers-reduced-motion: reduce)` block (all anim/transition → 0.01 ms). Remaining: "one deliberate now-playing transition" = UI-13
- ⬜ Contrast check both themes vs WCAG AA; ship a high-contrast variant for the cheap DAP
- 🔒 On-device compact check (iPhone 15 Pro Max) — verify the phone layout is untouched
- 🟡 **Surface modernization** — `docs/design/0002`, 14 tasks:
  - ✅ **UI-04** tabular figures (`tabular-nums` on every running-number display)
  - 🟡 **UI-01** — `--elevation-modal` flip token replacing 28 heavy modal shadows. Remaining: re-tune `--elevation-1..4` + converge card/button radius on `--radius-md/lg`
  - 🟡 **UI-03** — `--font-size-*` / `--tracking-*` / `--leading-*` tokens + `text-wrap: balance` on headings. Remaining: migrate component `font-size` literals onto the ramp
  - 🟡 **UI-05** — wider focus-ring offset (3px). Remaining: true two-tone ring (pseudo-element)
  - ⬜ **UI-02** card hover-lift + fade-in play FAB *(next Tier 1 — JSX + interaction, `design-craft` + `browser` QA)*
  - 🎨 **UI-06** richer now-playing bar · **UI-07** ambient colour from art (`--art-tint`) · **UI-08** library filter/sort chips · **UI-09** offline landing + skeletons · **UI-10** list density toggle
  - 🎨 **UI-11** Discover hero shelf · **UI-12** now-playing overlay redesign · **UI-13** motion system (`--ease-*`/`--dur-*` tokens) · **UI-14** icon weight/size consistency (with the FA subset)

## ▶ WS-FEAT / WS-DOCS

- ✅ `CLAUDE.md` populated · 7 ADRs · `docs/design/` started · `version:date` tooling (`26.09.07`) · `ARCHITECTURE.md` split
- ⬜ Prune / date-stamp `CACHE_V21_*.md`, `IMAGE_CACHE_*.md`, `QUALITY_VERIFICATION.md` → `docs/history/`
- ⬜ Trim `README.md` to quick-start + feature list + platform matrix (add the Android TV row); write `CONTRIBUTING.md` (commands, credential-service rule, build-only rule, PR checklist)
- ⬜ Deep-linking / "resume where I was" (falls out of `react-router`)
- ⬜ Playlist editing parity (reorder, multi-select add/remove across views)
- ⬜ Gapless/crossfade polish + ReplayGain (`music-metadata` already parses tags)
- ⬜ Smart offline — "keep my most-played N GB offline automatically"
- ⬜ Cast / DLNA output (beyond LAN Remote Mode)
- ⬜ Last.fm love-sync both directions; ListenBrainz as a second scrobbler
- ⬜ Sleep-timer "end of track / album" modes; alarm
- ⬜ Lyrics (`getLyrics` / LRCLIB) with a TV-friendly full-screen view

## ▶ WS-QUAL — near-last

- ✅ ESLint + typescript-eslint + Prettier config; `no-console` sweep (221 → `logger`); dead cache files removed; `CLAUDE.md` populated; error-handling starters (`MainApp`, `App` bootstrap)
- ⬜ Make `lint` + `format:check` **required** CI checks
- ⬜ `any` < 30 — type the Subsonic response surface in `src/types/subsonic.ts` (`response.data['subsonic-response']`) — 135 of the 231 warnings
- 🟡 Lint warning burndown (231): ~37 `no-empty`, ~43 `no-unused-vars`, ~29 `exhaustive-deps` (~17 are dead disable directives); then flip each rule warn → error
- ⬜ One-time `prettier --write` + commit
- ⬜ *(Should)* structured `logger` fields (`{event, …}`) + a correlation id per download batch; husky + lint-staged pre-commit

## ▶ WS-SEC — leftovers (deferred by owner)

- ✅ `credentialsService` single path · `crypto.getRandomValues` salt · `setWindowOpenHandler` default-deny · partial CSP (Electron prod) · removed credential `console.log`
- ⬜ **Rotate `xylonic-release.jks`** — new key, `git rm`, `git filter-repo` history purge, key + passwords to CI secrets, `build-android.sh` reads from env *(owner's job)*
- ⬜ Delete every `localStorage.getItem('password')` — plaintext-at-rest removal (still written as the sync hydration source; gated on WS-TEST hydrate-before-first-read coverage)
- ⬜ Kill `webSecurity: false` — register `xylonic://` protocol for cached audio/art, inject Subsonic auth via `onBeforeSendHeaders`, re-enable `webSecurity: true` on both `BrowserWindow`s (needs a 4-target desktop device pass)
- ⬜ Full CSP — drop `'unsafe-inline'` once `xylonic://` exists; `<meta http-equiv="Content-Security-Policy">` in `index.html` for Capacitor
- ⬜ Capacitor `Preferences`-group Keychain/Keystore credential backend; one-time plaintext → secure-backend migration on launch
- ⬜ *(Should)* scope `usesCleartextTraffic` / `network_security_config` to user hosts only; `npm audit --audit-level=high` CI gate (24 vulns / 3 critical at last check); `logger` redaction (never log `password` / `t` / `s` / full stream URLs)

## ▶ WS-TV — Android TV (deferred by owner)

- ⬜ **Native/manifest**: `<uses-feature leanback required=false>` + `touchscreen required=false`; add `LEANBACK_LAUNCHER` category (keep `LAUNCHER`); `android:banner` + `tv_banner` drawable (320×180 xhdpi + 1280×720 for Play); verify FGS types TV-OK; add `getUiMode(): 'normal'|'television'|…` to `PlatformBridge` (reads `Configuration.uiMode`) feeding `LayoutModeContext`; `build-android.sh --tv-check` greps merged manifest; optional TV-emulator CI smoke
- ⬜ **Frontend**: spatial-nav focus engine (`@bbc/tv-lrud-spatial` / `norigin-spatial-navigation` / small custom); D-pad key handling (arrows / Enter / BACK→router / media keys); `scrollIntoView` on focus + keep the focused item mounted in `react-window`; `tv` layout mode in `LayoutModeContext` — horizontal shelves, large type, 5–8 % overscan, no hover/right-click, full-screen ambient now-playing as idle; phone→TV credential pairing over Remote Mode (UDP 7766); leanback-friendly `MediaSessionCompat` metadata/queue for Assistant
- ⬜ *(Should)* Play Store "Android TV" quality checklist; screensaver/burn-in mitigation on the idle screen; Android TV recommendations channel

## ▶ WS-TEST — full coverage (very last)

- ✅ Vitest + RTL + jsdom; `.github/workflows/ci.yml` (lint + test + build; typecheck non-blocking); **127 tests**
- ⬜ `PlayerContext` queue tests — Fisher-Yates (each song once per cycle), repeat one/all, next/prev at boundaries, shuffle toggle rebuild → **unblocks the `useQueue` split**
- ⬜ `downloadManagerService` — queue dedup, idempotent `songDownloaded`/`songFailed`, `reconcileOrphans`, batch-hijack path → **unblocks the transport split**
- ⬜ `subsonicApi` — auth param shape, `checkOfflineMode` blocking, `getAllSongs` pagination termination, `search3` empty-query
- ⬜ `searchCacheService` / `searchWorker` — filter correctness + main-thread fallback
- ⬜ Contract tests for `src/platform/` bridges (fake bridge vs each real bridge)
- ⬜ Mock Subsonic server (MSW handlers or a tiny Express fixture) — no test hits a live server
- ⬜ Flip `tsc --noEmit` to a blocking CI check (after the TS 5.x bump)
- ⬜ *(Should)* Playwright smoke in CI (boot → login vs mock → play → offline → cached playback); coverage floor 40 → 60 % on `src/services/**` + `src/context/**`

---

## Open device-test items (carry-over, need the owner's hardware)

- iOS downloads still fail on the latest build (batch fix + `CAPBridgedPlugin` migration shipped; bug is in the download flow — trace `xyDebugTrace` over CDP)
- iOS offline→online infinite "Loading…" fix — confirm the stuck spinner is gone
- iOS auto-offline on cellular — test on real cellular data
- Android single-threaded downloads (see WS-PERF)
- Re-download library to populate `artistCoverArtId` for pre-Jul-3 cached songs
- The false "N songs not downloaded" banner — `getAllSongs` compares counts, not IDs
