# 0006 — `electron.js` is wiring only; domains live in `public/ipc/*`

- Status: Accepted
- Date: 2026-09-07

## Context

`public/electron.js` had grown to 2232 lines: app lifecycle, two window
factories, protocol/CSP, and ~69 `ipcMain.handle` handlers for cache
filesystem, logging, settings, credentials, remote discovery, system stats,
mini-player, MPRIS art — all in one file sharing module-level mutable state
(`mainWindow`, `miniPlayerWindow`, `lastPlayerState`, `cacheBasePath`,
`loggingEnabled`, …). Untestable, hard to navigate, and every feature touched
the same file.

## Decision

Each cohesive IPC domain moves to `public/ipc/<domain>.js` exporting a
`register<Domain>Ipc(deps)` function. `electron.js` requires them and calls each
`register*` once; it keeps only window creation, app lifecycle, protocol + CSP,
and the shared path helpers.

Shared state crosses the boundary as **injected getters/callbacks**, never free
variables: `getMainWindow: () => mainWindow`, `getLastPlayerState`,
`onDownloadActiveChange: (v) => { _activeDownloads = v; _updatePowerSave(); }`,
`getCacheBasePath`, etc. Modules require Node builtins themselves; Electron
objects (`dialog`, `shell`, `safeStorage`, `Tray`, `nativeImage`) are injected
too so each module is loadable and functionally testable in plain Node.

Modules: `remote`, `logging`, `settings`, `credentials`, `system`, `misc`,
`downloadNotification`, `cache` (~31 handlers), `playerWindow`.
`electron-builder.json` `files` includes `public/ipc/**/*.js`.

## Consequences

- `electron.js` 2232 → **533 lines**.
- Each module has a standalone plain-node functional test; `npm run electron:serve`
  is the integration check (a missed `lastPlayerState` free variable in the
  first slice was caught exactly this way — the fix was to inject it).
- `pathToFileUrl` lives in `cache.js` and is re-exported for the MPRIS code in
  `playerWindow.js`.
- A packaged build now depends on `public/ipc/**` being bundled — the
  `electron-builder.json` change is load-bearing.
