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
- [x] T9  done (2026-09-14) — remaining 29 `no-unused-vars` cleared, 0 left.
          Dead code removed: pagination `handlePreviousPage`/`handleNextPage` in
          AlbumList/ArtistList (superseded by `handlePageClick`, no cascade —
          `currentPage`/`totalPages` still used elsewhere); `isFirstTimeUser`
          (App.tsx, dead since the Jul 31 direct-check refactor); `handleDeveloperClick`
          (Header.tsx, never wired to a button); dead `isSwiping` state in
          NowPlayingOverlay (swipeDx already drove the visuals); `applyVolume`
          helper in PlayerContext (every real call site already inlines
          `audio.volume = …` — left those alone, PlayerContext is the known
          landmine file); `searchIndexComplete` in CachePreloadDialog (dup of
          `currentPhase === 'complete'`). **Real bug fixed**: `ShuffleAllButton`
          built a Fisher-Yates `shuffleArray` helper but never called it —
          "Shuffle All" was playing the raw unshuffled list; now
          `playPlaylist(shuffleArray(songs), 0)`. **Feature wired, not deleted**:
          `AllAlbumsGrid`/`AllSongsGrid` took `onArtistClick`/`onAlbumClick` props
          from both callers (MainApp.tsx, App.tsx) but never used them — artist
          name in the album grid and artist+album names in the all-songs list are
          now clickable through to the artist/album view (added `artistId` to
          `AllSongsGrid`'s `Song` type + `searchSongsPaginated`'s return type,
          which already carried it from the Subsonic response but the type cast
          dropped it). New `.album-artist-link` reuse + `.all-songs-artist-link`/
          `.all-songs-album-link` in index.css (button-reset, `text-secondary`/
          `text-muted`, underline on hover — matches the existing SongList/
          DiscoverView pattern). `MainApp.tsx`'s `handleLogout`/`logout` destructure
          removed as dead (see flag below — the whole file is unreachable).
          `npm run lint` 139→109 warnings, `npm run build` clean, 137/137 tests green.
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
- [x] T13 Vitest harness + npm test wired — done (this list was stale; verified
          2026-09-14, `npm test` runs 17 files / 137 tests green)
- [x] T14 PlayerContext queue logic tests — `playerQueue.test.ts` (10),
          `playerPersistence.test.ts` (8)
- [x] T15 downloadManagerService dedup/idempotency tests —
          `downloadManagerService.test.ts` (5), `downloadReconciler.test.ts` (11),
          `downloadManagerHelpers.test.ts` (10)
- [x] T16 subsonicApi tests exist (`subsonicApi.test.ts`, 9 tests) — confirmed
          **not MSW**, uses `vi.mock('axios', ...)` module mocking instead
          (works, exercises response-shape/error-envelope logic; doesn't
          exercise real HTTP semantics like MSW would). Leaving as-is — good
          enough coverage for now, MSW migration is a nice-to-have not a gap.
- [x] T17 src/platform/ bridge contract tests — `capacitorBridge`/`electronBridge`/
          `fallbackBridge` .test.ts (6/7/7)
- [x] CI runs tests — confirmed `.github/workflows/ci.yml` has an `Unit tests`
          step (`npm test`) as a required gate alongside lint/build/bundle-size.
- [ ] Checkpoint: coverage floor on services/** + context/** not yet measured/set
          (no `--coverage` step in CI; ad-hoc file count above isn't a real floor)

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
- [x] T22 done (2026-09-14) — queue persistence off the `localStorage`
        stringify hot path. Went with a single-blob-per-user IDB store
        (`src/services/playerQueueStore.ts`) rather than literal per-song
        `{ids, idx}` reconstruction: same effect (no more
        `JSON.stringify(Song[])` on every next/prev/shuffle — IDB structured
        clone, async write, and now skipped entirely when the playlist
        identity hasn't changed) with much less surface area — no async
        hydration effect needed in `PlayerContext`, since `playerQueueStore.init()`
        is raced into `index.tsx`'s existing pre-render `persistentCache`
        gate, so `loadQueue()` stays synchronous at the same call sites.
        Unblocked the stated prerequisite first: `computePrevIndex` extracted
        into `playerQueue.ts` (+5 tests, 15 total), replacing the two
        duplicated inline copies in `PlayerContext.tsx`. 11 new tests total
        across `playerQueue`/`playerQueueStore`/`playerPersistence`, all
        green (148/148). Build clean, lint unchanged. Ran the app twice via
        `electron:serve` — clean boot, no errors — but **not verified
        end-to-end on a real login** (no credentials in this sandbox): queue
        a playlist → force-quit → relaunch → confirm restore is still owed
        as a manual on-device check.
- [ ] Checkpoint: cold-start / warm-reload timing traced + logged in PERF_LEDGER
        (T22's fix removes the stringify but the trace itself is still owed —
        see the ranked list in docs/session_summary.md, item #4)
