# Performance ledger (WS-PERF)

Every optimisation attempt: baseline → result → keep/revert. Purpose is to stop
dead ideas being re-tried and to hold WS-PERF to "every kept optimisation has a
before/after number".

Bundle baselines are `npm run build` output (raw / gzip). Captured on the dev
box (Linux, Vite 8); treat as relative, not absolute.

| Date | Change | Baseline | Result | Verdict |
|------|--------|----------|--------|---------|
| 2026-09-06 | `getAllSongs` — serial page probe then **4-concurrent** `search3` batches, stop on first short page | 25k-song fetch fully sequential (~1 req at a time) | wall-clock ~4× faster on large libraries; order + `failed` list + offline guard preserved; covered by `subsonicApi.test.ts` | **keep** |
| 2026-09-07 | Prod log stripping — terser `compress.pure_funcs = [logger.log, logger.info, logger.debug]` | modern bundle `index.js` 609 kB raw | 597 kB raw (calls **and** their arg construction dropped); `logger.error`/`warn` retained | **keep** — modern bundle only; `@vitejs/plugin-legacy` chunk keeps the strings (own minify path), needs a Babel plugin |
| 2026-09-07 | Search index compression (`searchCacheService`) | index stored as raw JSON string in IDB | `deflate` via `CompressionStream` (v2.0 records), ~3–5× smaller at rest; legacy v1.0 read path + uncompressed write fallback retained. *Already shipped — was untracked.* | **keep** |
| 2026-09-07 | FontAwesome — drop `all.min.css` for `fontawesome.min.css` + `solid.min.css`; inline `github`/`lastfm` as SVG (`components/common/BrandGlyph`); regular family unused | `fa-brands-400` 110 kB + `fa-regular-400` 19 kB webfonts shipped; `index.css` 254 kB raw / 55 kB gzip | brands + regular webfonts **gone**; `index.css` 232 kB raw / 44 kB gzip; `index.js` +2 kB (SVG paths). Net **−131 kB** assets, −11 kB gzip CSS | **keep** — solid webfont (115 kB, ~98/1400 glyphs) still whole; true subset is the remaining task |
| 2026-09-08 | `fa-solid-900` true subset — `scripts/build-fa-subset.mjs` scans `src/**` for static `fa-*` tokens, dynamic `fa-${…}` / `fa-<stem>-${…}` literals and `icon:'fa-*'` config, resolves them against FA7 metadata, runs `subset-font`; `src/index.tsx` imports `styles/fa-solid-subset.css` instead of FA's `solid.min.css` | `fa-solid-900.woff2` 112 kB / ~1400 glyphs | `fa-solid-subset.woff2` **8.5 kB / 104 glyphs**; committed to repo, regen via `npm run fa:subset`. Net **−104 kB** assets | **keep** — `npm run build` + `npm run size` + 127 tests green; a cross-screen icon QA pass is still advisable. (Aside: `fa-list-music` / `fa-repeat-1` / `fa-wifi-slash` don't exist in FA7 Free — already broken pre-subset, unrelated.) |
| 2026-09-10 | `subsonicApi` response cache — 60 s TTL `Map` on `getArtists` / `getAlbumList2` (all `type`s incl. recently-added) / `getStarred2`, keyed by endpoint + server + user + params (not the rotating auth token); `getStarred` purged on `star`/`unstar`; `clearApiCache(prefix?)` exported | repeat nav (Discover → Artist → back → Artist, Liked toggle) refetches every list on each visit | in-window repeat visits served from memory, 0 network; **wall-clock delta not yet traced** — needs an `electron:serve` + DevTools session | **provisional keep** — build + 174-warning lint (was 194) green; re-measure and record numbers before marking Phase 2 done, else revert |
| 2026-09-10 | Persistent metadata cache — new `persistentCache` (memory + IDB, stale-while-revalidate); `metadataCache` reworked as a facade over it; `persistentCache.init()` hydrates before first paint (200 ms cap). ArtistList/AlbumList/SongList/AllAlbumsGrid metadata now persists across reload | in-memory only `metadataCache` — every reload / app restart = full skeleton + sequential Subsonic refetch | warm launch paints library from IDB, 0 network until stale; 136 tests pass (+9 for `persistentCache`); `vite build` clean | **provisional keep** — cold-start / warm-reload wall-clock **not yet traced** (`electron:serve` + DevTools); confirm the IDB hydrate beats the 200 ms cap in practice, then record numbers |
| 2026-09-10 | The 4 library views migrated to `metadataCache.swr()` — stale copy paints instantly, background refresh + `onRevalidated` repaint, concurrent-load dedup | views showed a hard cache hit *or* a skeleton + full await; no background refresh (stale for the whole 30-min TTL) | first paint is now cache-bound not network-bound whenever any copy exists; still correct (stale then live); 137 tests, build clean | **provisional keep** — same trace pending; watch for a visible re-layout when `onRevalidated` swaps a large list |
| 2026-09-10 | Perf tiers Gaming/Balanced/Eco — merged `performanceModeService` + `powerSaverService` → one `perfModeService`. Gaming (new intent per owner: minimise Xylonic's system load for a foreground game) = 15 fps RAF, `performance-mode` + new `gaming-mode` CSS (opaque surfaces, no blur/shadow/transition/GPU layers), prefetch 0, 1 concurrent img fetch, img-mem cache 120, CPU priority yielded. Eco = old power-saver + old middle tier (10 fps, pixelated). Balanced = old Normal | 2 booleans, UI-forced mutually exclusive; old "performance" only dropped to 30 fps and stripped effects; nothing minimised memory/prefetch | fewer draw calls (opaque compositing), lower RAF wake rate, no look-ahead network/decode, smaller image RAM in Gaming; **per-tier CPU/GPU/RAM deltas not yet traced** | **provisional keep** — `vite build` clean, lint 174 unchanged; needs an `electron:serve` + DevTools trace per tier (frame CPU, layer count, JS heap) before it's a confirmed keep |

## Current bundle snapshot (2026-09-07, post-FA)

```
index.js            602 kB raw / 165 kB gzip   (modern)
index-legacy.js     982 kB raw / 239 kB gzip
polyfills-legacy    157 kB raw /  56 kB gzip
index.css           232 kB raw /  44 kB gzip
fa-solid-subset.woff2  8.5 kB  (only FA webfont still shipped; 104-glyph subset)
```

## Backlog (WS-PERF Must/Should not yet done)

- Queue persistence → `{ids, idx}` in localStorage + song-by-id IDB store
  (kills the multi-MB `JSON.stringify(Song[])` on every next/prev/shuffle).
  Blocked with the `PlayerContext` boot path — `loadQueue()` is a synchronous
  `useState` initializer today.
- Dep bumps: Electron 27 → LTS, TS 4.9 → 5.x, Capacitor 8 → 9 (device pass each).
- Legacy-bundle log stripping (Babel plugin).
- `React.memo` / `useMemo` audit on `SettingsView` + large lists;
  `content-visibility: auto` on off-screen sections.
- CI bundle-size gate (fail on >10 % growth) + a Lighthouse run.
- Android multi-threaded download pool.
