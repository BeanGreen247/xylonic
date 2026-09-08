# Contributing to Xylonic

Xylonic is one shared React/Vite/TypeScript core (`src/**`) shipped to
Windows / Linux / macOS via Electron and Android / iOS via Capacitor.
Server-side target: Subsonic API 1.16.1 (Navidrome, Airsonic, Gonic).

## Getting started

```bash
npm install
npm start                # Vite dev server (browser)
npm run electron:serve   # Vite + Electron shell
```

Native builds (`npm run android:build:*`, `build-ios.sh`, `electron:build:*`)
are maintainer-run — see `ANDROID_SETUP.md` / `IOS_SETUP.md`.

## Checks before a PR

| Command | Must be |
|---|---|
| `npm run build` | clean TypeScript + Vite compile |
| `npm test` | green (Vitest — unit tests for services/context/utils) |
| `npm run lint` | 0 errors (warnings are being burned down; don't add new ones) |
| `npm run size` | all chunks within the ceilings in `scripts/check-bundle-size.js` |

CI (`.github/workflows/ci.yml`) runs lint + test + build on every push;
`tsc --noEmit` runs non-blocking for now.

## House rules

- **Minimal diffs.** Match the existing style, tokens, naming and architecture.
  If the architecture looks wrong, open an issue / say so — don't silently
  rewrite it.
- **Platform-agnostic core.** `src/**` runs in both Electron's renderer and the
  Android/iOS WebView. Platform access goes through `src/platform/`
  (`bridge.ts` + `capacitorBridge` / `electronBridge` / `fallbackBridge`), never
  an inline `if (isElectron)` in a component.
- **Credentials.** Read `{serverUrl, username, password}` via
  `credentialsService.getCached()`. Do **not** add new
  `localStorage.getItem('password')` call sites; migrate one if you touch it.
- **Logging.** Use `utils/logger`, never `console.*`. Categorised prefixes
  (`[Download]`, `[Cache]`, …). Never log the `password` / `t` / `s` auth params
  or full stream URLs.
- **Styling.** Dark-theme baseline in `src/styles/index.css`
  (`--primary-color: #00bcd4`). Use the existing `--spacing-*` / `--radius-*` /
  `--elevation-*` / `--font-size-*` tokens; avoid new inline `style={{}}`.
- **Types.** `strict: true`. Don't add `any` — extend `src/types/subsonic.ts`
  for API response shapes.
- **Icons.** FontAwesome solid only, shipped as a build-time subset
  (`npm run fa:subset` after adding a new `fa-*` reference). Glyphs with Unicode
  ≥ `\f100` don't render on some cheap Android DAPs — prefer icons ≤ `\f0ff`.

## Commits

Single-line [Conventional Commits](https://www.conventionalcommits.org):
`type(scope): summary`. No body, no trailers.

## Docs to keep current with a change

- `CHANGELOG.md` — impact-first, grouped Added/Fixed/Changed; bump the CalVer
  `YY.MM.NN` version to match (`npm run version:date`).
- `docs/architecture/*.md` — for structural changes (new subsystem / moved
  boundary); add an ADR under `docs/decisions/` for a decision worth recording.
- `docs/module_notes.md` — when a module's contract or responsibility changes.
- `docs/PERF_LEDGER.md` — before/after numbers for any perf change.

## Big files (split in progress — treat as god-objects for now)

`context/PlayerContext.tsx`, `services/downloadManagerService.ts`,
`public/electron.js`. Be conservative around `PlayerContext` queue logic and
`downloadManagerService` (orphan reconciliation, batch hijack) — the bug history
is dominated by races and duplicate-event correctness bugs.
