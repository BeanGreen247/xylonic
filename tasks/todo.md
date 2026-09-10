# TODO — Perf + Tests + Visual-language phase

Full detail + acceptance criteria in `tasks/plan.md`.

## Phase 1 — cleanup
- [x] T1  ADR 0008 → Rejected; dropped react-router from ROADMAP WS-ARCH Must

## Phase 2 — Subsonic typing + cache
- [x] T2  Envelope types — already modelled (`SubsonicEnvelope`/`SubsonicResponseBody`);
          `subsonicApi.ts` was already fully generic. Real remaining work was at
          consumers: extended `Song` interfaces with technical-metadata fields.
- [x] T3  Removed `(song as any).x` casts in `SongList` / `AllSongsGrid` (−20 warnings).
          NOTE: ~3 duplicate local `Song` interfaces still exist — consolidation is
          a follow-up task (call it T3b).
- [~] T4  60 s TTL `Map` cache on `getArtists` / `getAlbumList2` (all types incl.
          recently-added) / `getStarred2`; star/unstar purge; `clearApiCache()` export.
          Build + lint green. **Timing not yet traced** — provisional per PERF_LEDGER.
- [ ] Checkpoint: build clean ✓ · **repeat-nav timing trace pending** · no stale-star ✓
- [ ] T3b (new) consolidate duplicate `Song` interfaces onto one canonical type
- [ ] T4b (new) wire `clearApiCache()` into logout / server-switch

## Phase 3 — tiered perf modes
- [x] T5  merged `performanceModeService` + `powerSaverService` → one
          `perfModeService` (`'gaming'|'balanced'|'eco'` + legacy-key migration).
          Old services deleted; 6 consumers updated (index, App, useNeighborSongs,
          imageCacheService, Header, RenderTimerHUD).
- [x] T6  per-tier profiles: FPS {15/60/10}, PREFETCH_AHEAD {0/4/0},
          IMAGE_CACHE_TUNING, YIELDS_CPU {true/false/true}; gaming reuses
          `body.performance-mode` + new `body.gaming-mode` (opaque surfaces,
          no ambient blur). Owner intent for gaming: **minimise system load for a
          foreground game** (not a boost).
- [x] T7  3-way selector in `AdvancedSection` (replaces the two toggles).
- [~] Checkpoint: `vite build` + lint (174) green. **Per-tier CPU/GPU/RAM trace
          still pending** — provisional per PERF_LEDGER.
- [ ] T7b (cross-layer, xylonic-electron) `setPerformancePriority` bridge method
          is now unused by app code — remove from bridge contract + `electron.js`.

## Phase 4 — lint + style
- [x] T8  27 deliberate empty catches annotated (not logged — all are
          plugin/IPC/storage best-effort guards; a warn would be noise on web).
          `no-empty` flipped to **error** in eslint.config.mjs. no-empty 27→0.
- [~] T9  partial — dropped 3 unused `catch (_)` bindings + 2 verified dead
          locals (`MiniPlayer.formatTime`, `QueueTab.currentIndex`).
          no-unused-vars 35→30. **Remaining 30 not done**: mostly pagination
          dead code (`handleNextPage`/`handlePreviousPage` in AlbumList/ArtistList
          — removal cascades into `currentPage`/`totalPages` state, unverifiable
          without running the app) + unused context destructures + a few "incomplete
          wiring" flags. Needs a careful per-site pass, ideally after WS-TEST.
- [ ] T10 **blocked on a decision** — `npm run format` reformats **167 files**
          (whole `src/`, incl. the 3k-line `index.css`). One-time, permanent,
          rewrites every `git blame` line, conflicts with Phase 7 stylesheet work.
          CI `format:check` step can't be added until this lands. Awaiting owner OK
          on timing (recommend: right before Phase 7, or right after).
- [ ] T11 static `style={{}}` → classes — deferred, bundle with Phase 7 (needs
          both-theme browser QA anyway).
- [ ] T-any (was folded into T9) 91 `no-explicit-any` — own scoped pass, mostly
          `remoteDiscoveryService` (30), bridges, `global.d.ts`, `settingsManager`.
- [ ] Checkpoint: lint clean at error level for no-console + no-empty; build clean ✓

## Phase 5 — README
- [ ] T12 trim 726 → ~120 lines (owner reviews outline)

## Phase 6 — WS-TEST (pulled forward)
- [ ] T13 Vitest harness + npm test wired
- [ ] T14 PlayerContext queue logic tests
- [ ] T15 downloadManagerService dedup/idempotency tests
- [ ] T16 subsonicApi + MSW
- [ ] T17 src/platform/ bridge contract tests
- [ ] Checkpoint: coverage floor on services/** + context/**, CI runs tests

## Phase 7 — new visual language — CANCELLED (owner 2026-09-10)
Replaced by cache + perf hardening:
- [x] T18 `persistentCache` — IDB-backed two-tier SWR cache (+ 9 unit tests)
- [x] T19 `metadataCache` → facade over it; boot hydration in index.tsx (200ms cap)
- [x] T20 ArtistList/AlbumList/AllAlbumsGrid/SongList metadata reads → `metadataCache.swr()`
          with `onRevalidated` repaint (SongList album = stale-until-next-visit by
          design). swr gained an `onRevalidated` opt + a 10th unit test. lint 142→140.
- [~] T21 assessed — little safe/evidence-backed work left:
        · `search` — already served from the local `searchCacheService` index;
          the network `search()` is a rare fallback and stale results are
          undesirable → **not cached** (deliberate).
        · artist-detail — no separate view; `getArtist` reads in AlbumList +
          SongList already went through T20.
        · blob compression — `persistentCache` stores structured-clone objects,
          not strings; per-entry sizes are small and IDB size isn't a reported
          problem → **deferred, no evidence to act on** (performance-optimization
          skill: don't optimise without a measurement).
- [ ] T22 queue persistence → {ids, idx} + IDB song store (kills the multi-MB
        `JSON.stringify(Song[])` on every next/prev/shuffle). **Blocked on test
        coverage** — needs `computePrevIndex` extracted from `PlayerContext` into
        `playerQueue.ts` (which already has `buildShuffleQueue` + `computeNextIndex`
        + 10 tests) + queue-persistence tests, before the sync-boot path is touched.
- [ ] Checkpoint: cold-start / warm-reload timing traced + logged in PERF_LEDGER
