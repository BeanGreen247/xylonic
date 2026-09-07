# Architecture

Per-subsystem reference, split out of the former monolithic `ARCHITECTURE.md`
(2026-09-07, WS-ARCH / WS-DOCS). Read the ADRs in [`../decisions/`](../decisions/README.md)
for the *why* behind structural decisions; per-module contracts live in
[`../module_notes.md`](../module_notes.md).

| # | Doc | Covers |
|---|-----|--------|
| 1 | [01-overview.md](01-overview.md) | product shape, one shared core → Electron + Capacitor, tech stack |
| 2 | [02-multi-process.md](02-multi-process.md) | Electron main/renderer, Android app process vs WebView |
| 3 | [03-ipc-communication.md](03-ipc-communication.md) | the `ipcMain.handle` surface — now `public/ipc/*` modules ([ADR 0006](../decisions/0006-electron-main-split-into-ipc-modules.md)) |
| 4 | [04-offline-cache.md](04-offline-cache.md) | v2 content-addressed cache ([ADR 0002](../decisions/0002-offline-cache-v2-hash-storage.md), [ADR 0003](../decisions/0003-download-orphan-reconciliation.md)) |
| 5 | [05-authentication-security.md](05-authentication-security.md) | login flow, `webSecurity`, CSP — credential path per [ADR 0004](../decisions/0004-single-credential-service.md); WS-SEC still open |
| 6 | [06-playback-pipeline.md](06-playback-pipeline.md) | audio element, queue, gapless, MPRIS — `PlayerContext` split into `playerQueue` / `playerPersistence` / `useMediaSession` |
| 7 | [07-theme-management.md](07-theme-management.md) | `colorConfigManager`, custom themes, light/dark mode |
| 8 | [08-state-management.md](08-state-management.md) | the provider tree, incl. [`LayoutModeContext`](../decisions/0007-layout-mode-context.md) |
| 9 | [09-design-patterns.md](09-design-patterns.md) | conventions and best practices |
| 10 | [10-performance.md](10-performance.md) | virtual scroll, search worker, LRU art, IPC throttle — WS-PERF adds more |
| 11 | [11-build-process.md](11-build-process.md) | Vite, electron-builder, CI ([ADR 0005](../decisions/0005-vitest-and-ci-gate.md)), `version:date` |
| 12 | [12-security-considerations.md](12-security-considerations.md) | threat notes — WS-SEC |
| 13 | [13-remote-control.md](13-remote-control.md) | LAN discovery UDP 7766 + command server 7767 (`public/ipc/remote.js`) |
| 14 | [14-android-native.md](14-android-native.md) | foreground service, wakelock, Capacitor plugins |
