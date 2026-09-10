# Implementation Plan: Perf + Tests + Visual-language phase (2026-09-10)

Supersedes the "solo-doable next" list in `~/xylonic-next-session-2026-09-08-v2.md`
for ordering. Owner direction (2026-09-10):

- **Drop** the `react-router` migration — current hand-rolled nav in `App.tsx`
  stays. ADR 0008 → Rejected.
- Optimize for **performance & efficiency**; turn the single binary
  `performanceModeService` toggle into **tiered modes** (Balanced / Eco / Gaming).
- **Subsonic response typing** doubles as a perf task — add response caching.
- **README**: trim to essentials only.
- Lint burndown (#4) and static inline-style cleanup (#5) proceed as previously scoped.
- **Pull WS-TEST forward** — owner now wants robust unit coverage *before* the
  remaining polish, overriding the ROADMAP "tests very last" note.
- **Visual restyle** = *new visual language* (not just polish, not a full recolor):
  YT-Music-style dark futuristic direction. Targets WS-UX UI-06 (now-playing bar),
  UI-07 (`--art-tint`), UI-10 (density), UI-12 (overlay redesign). Cyan accent and
  the elevation system stay for now.

## Architecture decisions

- Navigation stays as-is (ADR 0008 Rejected). No `createMemoryRouter`.
- Perf tiers: one enum `'balanced' | 'eco' | 'gaming'` persisted at
  `xylonic_performance_mode`; migrate the old `'true'/'false'` string on read
  (`'true'` → `'eco'`, else `'balanced'`). Keep the `appModeChanged` event and the
  `.performance-mode` body class (add `.perf-eco` / `.perf-gaming`) so existing CSS
  hooks keep working.
- Perf work is measurement-gated: baseline via `npm run electron:serve` + browser
  DevTools trace, `npm run size`, and the RenderTimer HUD. Log every attempt
  (kept and reverted) in `docs/PERF_LEDGER.md`.
- Tests: Vitest (ROADMAP WS-TEST harness item). Small/unit-first per the pyramid;
  MSW for `subsonicApi`. No behavior changes bundled into test PRs.
- Restyle: `design-craft` research pass first → `docs/design/000N` ledger per
  UI-0N item → implement → browser QA in **both** themes and at Electron +
  Android-WebView widths.

## Task list

### Phase 1 — Zero-risk cleanup
- [ ] **T1** ADR 0008 → Rejected; note nav stays hand-rolled. Remove the
      `react-router` checkbox from ROADMAP WS-ARCH "Must" (leave a one-line
      "Rejected — see ADR 0008"). `react-router-dom` stays installed for now
      (removal is its own trivial task). — XS, docs only.

### Phase 2 — Subsonic typing + response cache  (WS-QUAL + WS-PERF)
- [ ] **T2** Model the 1.16.1 response envelope in `src/types/subsonic.ts`
      (`artist`, `album`, `albumList2`, `searchResult3`, `starred2`, `directory`,
      `artistInfo`, `error`, `status`, …). — M.
- [ ] **T3** `axios.get(url)` → `axios.get<Envelope>(url)` at the ~30 call sites in
      `subsonicApi.ts` + direct consumers. tsc-gated. — M.
- [ ] **T4** Add a small TTL cache (module-level `Map`, ~60 s, keyed by
      endpoint+params) for idempotent reads: `getArtists`, `getAlbumList2`,
      `getArtistInfo2`, `search3`, `getStarred2`. Invalidate `getStarred2` on
      star/unstar. Bypass when offline mode owns the data. — S/M.
- [ ] **Checkpoint:** `npm run build` clean; repeat-navigation timing (Discover →
      Artist → back → Artist) improved vs baseline in the PERF_LEDGER; no stale-star
      regression.

### Phase 3 — Tiered performance modes  (WS-PERF)
- [ ] **T5** `performanceModeService` → tri-state enum + old-value migration; keep
      `isPerformanceModeEnabled()` as a compat shim (`mode !== 'balanced'`). — S.
- [ ] **T6** Per-tier profiles: RAF throttle fps (Balanced 60 / Eco 30 / Gaming 60),
      neighbor-prefetch depth (`useNeighborSongs`), off-screen art decode
      (`imageCacheService`), and CSS (`.perf-eco` disables `backdrop-filter`,
      heavy `box-shadow`, non-essential transitions). — M.
- [ ] **T7** Settings UI: replace the on/off switch in `AdvancedSection.tsx` with a
      3-way segmented control; copy explains each tier. — S.
- [ ] **Checkpoint:** each tier measured (fps HUD + trace) and logged; Eco shows a
      real main-thread / paint reduction or T6's CSS half is reverted.

### Phase 4 — Lint + style cleanup  (WS-QUAL + WS-UX)
- [ ] **T8** `no-empty`: ~22 silent `catch {}` → `logger.warn` (skip the
      deliberately-silent platform-bridge ones, comment why). — M.
- [ ] **T9** `no-unused-vars` (~43) + remaining dead `exhaustive-deps` disables;
      several flag incomplete wiring — fix or file. — M.
- [ ] **T10** One-time `prettier --write`, separate commit. Flip cleaned rules
      warn → error. Wire `lint` + `format:check` into `.github/workflows/ci.yml`. — S.
- [ ] **T11** ~79 static `style={{}}` → classes (exact-value moves only). Browser
      pass both themes. — M.
- [ ] **Checkpoint:** `npm run lint` clean at error level; `npm run build` clean.

### Phase 5 — README trim  (WS-DOCS)
- [ ] **T12** 726 → ~120 lines: logo/tagline, highlights, platform matrix
      (+ Android TV row), quick-start, links to `docs/architecture/`. Delete the
      stale inline stack dump. Owner reviews the kept outline before it lands. — S.

### Phase 6 — WS-TEST (pulled forward)
- [ ] **T13** Vitest harness: config, `src/test/` setup, first smoke test, `npm test`
      wired, `tsc --noEmit` still advisory. — S.
- [ ] **T14** `PlayerContext` queue logic: Fisher-Yates shuffle, repeat one/all,
      next/prev boundaries, shuffle rebuild. State-based assertions. — M.
- [ ] **T15** `downloadManagerService`: dedup, idempotent `songDownloaded` /
      `songFailed`, `reconcileOrphans`, batch-hijack. — M.
- [ ] **T16** `subsonicApi` with MSW mock Subsonic server (happy path + `error`
      envelope + the T4 cache). — M.
- [ ] **T17** `src/platform/` bridge contract tests (capacitor / electron / fallback
      shape parity). — S/M.
- [ ] **Checkpoint:** coverage reported; floor set on `services/**` + `context/**`
      (start 40 %, target 60 %). CI runs `npm test`.

### Phase 7 — New visual language  (WS-UX, needs design-craft research each)
- [ ] **T18** Research pass: 3–5 real futuristic music players (YT Music, Spotify,
      Apple Music, Plexamp, Roon) → one locked direction + decision ledger in
      `docs/design/0009-visual-language.md`. — S (research).
- [ ] **T19** UI-06 now-playing bar redesign → `docs/design/0010`. — M.
- [ ] **T20** UI-07 `--art-tint` derived from cover art (guarded, perf-mode aware —
      off in Eco). `docs/design/0011`. — M.
- [ ] **T21** UI-12 overlay/now-playing-full redesign → `docs/design/0012`. — M/L.
- [ ] **T22** UI-10 density toggle (comfortable / compact), ties into perf tiers'
      touch vs desktop row heights. `docs/design/0013`. — M.
- [ ] **Checkpoint:** browser QA each in light + dark, Electron + WebView widths;
      screenshots in the design ledger; owner sign-off before merge.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Perf-mode enum migration breaks saved prefs | Med | Read-time migration + compat shim; test T14-style |
| T4 cache serves stale liked/star state | Med | Explicit invalidation on star/unstar; short TTL; offline bypass |
| Restyle regresses WebView (older engine, 25k-song lists) | High | design-craft QA at WebView width; no `backdrop-filter` in Eco; `content-visibility` kept |
| Pulling WS-TEST forward slows visible progress | Low | Phases 2–5 ship user-visible wins first; tests are Phase 6 |
| God-object edits (PlayerContext / downloadManager) in T14–T15 tests surface real races | Med | Tests are read-only w.r.t. prod code; any fix is its own Prove-It commit |

## Open questions
- T4: is 60 s TTL acceptable for `getAlbumList2` "recently added", or should that
  one be excluded? (default: include, 60 s)
- T12: anything in the current README that must stay verbatim?
