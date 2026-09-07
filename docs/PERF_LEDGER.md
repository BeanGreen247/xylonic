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

## Current bundle snapshot (2026-09-07, post-FA)

```
index.js            602 kB raw / 165 kB gzip   (modern)
index-legacy.js     982 kB raw / 239 kB gzip
polyfills-legacy    157 kB raw /  56 kB gzip
index.css           232 kB raw /  44 kB gzip
fa-solid-900.woff2  115 kB     (only FA webfont still shipped)
```

## Backlog (WS-PERF Must/Should not yet done)

- Queue persistence → `{ids, idx}` in localStorage + song-by-id IDB store
  (kills the multi-MB `JSON.stringify(Song[])` on every next/prev/shuffle).
  Blocked with the `PlayerContext` boot path — `loadQueue()` is a synchronous
  `useState` initializer today.
- `fa-solid-900` true subset (build-time subsetter + full glyph list incl.
  dynamic `fa-${…}` outcomes).
- Dep bumps: Electron 27 → LTS, TS 4.9 → 5.x, Capacitor 8 → 9 (device pass each).
- Legacy-bundle log stripping (Babel plugin).
- `React.memo` / `useMemo` audit on `SettingsView` + large lists;
  `content-visibility: auto` on off-screen sections.
- CI bundle-size gate (fail on >10 % growth) + a Lighthouse run.
- Android multi-threaded download pool.
