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
- [ ] T8  no-empty catches → logger.warn
- [ ] T9  no-unused-vars + dead deps disables
- [ ] T10 prettier --write, flip rules to error, CI lint+format gate
- [ ] T11 static style={{}} → classes
- [ ] Checkpoint: lint clean at error level, build clean

## Phase 5 — README
- [ ] T12 trim 726 → ~120 lines (owner reviews outline)

## Phase 6 — WS-TEST (pulled forward)
- [ ] T13 Vitest harness + npm test wired
- [ ] T14 PlayerContext queue logic tests
- [ ] T15 downloadManagerService dedup/idempotency tests
- [ ] T16 subsonicApi + MSW
- [ ] T17 src/platform/ bridge contract tests
- [ ] Checkpoint: coverage floor on services/** + context/**, CI runs tests

## Phase 7 — new visual language
- [ ] T18 design-craft research → docs/design/0009-visual-language.md
- [ ] T19 UI-06 now-playing bar → docs/design/0010
- [ ] T20 UI-07 --art-tint (perf-aware) → docs/design/0011
- [ ] T21 UI-12 overlay redesign → docs/design/0012
- [ ] T22 UI-10 density toggle → docs/design/0013
- [ ] Checkpoint: browser QA both themes, Electron + WebView, owner sign-off
