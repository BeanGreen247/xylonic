# Xylonic System Architecture

> **Moved (2026-09-07).** The monolithic architecture doc was split per-subsystem
> under **[`docs/architecture/`](docs/architecture/README.md)** (WS-ARCH / WS-DOCS).

Start at **[`docs/architecture/README.md`](docs/architecture/README.md)** — it
indexes the 14 subsystem docs:

| # | Doc | Covers |
|---|-----|--------|
| 1 | [Overview](docs/architecture/01-overview.md) | product shape, shared core → Electron + Capacitor, tech stack |
| 2 | [Multi-process](docs/architecture/02-multi-process.md) | Electron main/renderer, Android app process vs WebView |
| 3 | [IPC communication](docs/architecture/03-ipc-communication.md) | the `ipcMain.handle` surface (`public/ipc/*`) |
| 4 | [Offline cache](docs/architecture/04-offline-cache.md) | v2 content-addressed cache, orphan reconciliation |
| 5 | [Authentication & security](docs/architecture/05-authentication-security.md) | login flow, `webSecurity`, CSP |
| 6 | [Playback pipeline](docs/architecture/06-playback-pipeline.md) | audio element, queue, gapless, MPRIS |
| 7 | [Theme management](docs/architecture/07-theme-management.md) | `colorConfigManager`, custom themes, light/dark |
| 8 | [State management](docs/architecture/08-state-management.md) | the provider tree, `LayoutModeContext` |
| 9 | [Design patterns](docs/architecture/09-design-patterns.md) | conventions and best practices |
| 10 | [Performance](docs/architecture/10-performance.md) | virtual scroll, search worker, LRU art |
| 11 | [Build process](docs/architecture/11-build-process.md) | Vite, electron-builder, CI, `version:date` |
| 12 | [Security considerations](docs/architecture/12-security-considerations.md) | threat notes (WS-SEC) |
| 13 | [Remote control](docs/architecture/13-remote-control.md) | LAN discovery UDP 7766 + command server 7767 |
| 14 | [Android native layer](docs/architecture/14-android-native.md) | foreground service, wakelock, Capacitor plugins |

Decision records: [`docs/decisions/`](docs/decisions/README.md).
Per-module contracts: [`docs/module_notes.md`](docs/module_notes.md).
