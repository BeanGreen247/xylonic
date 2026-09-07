# Architecture — index

The full narrative still lives in **[`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)**
(2600+ lines). A physical per-subsystem split of that file is a pending WS-DOCS
task; until then, use this index to jump into it, and the ADRs below for the
"why" behind structural decisions.

## Sections in `ARCHITECTURE.md`

| Section | What it covers | Freshness |
|---|---|---|
| Overview / High-Level | product shape, one shared core → Electron + Capacitor | current |
| Multi-Process Architecture | Electron main/renderer, Android app process vs WebView | current |
| IPC Communication Patterns | the `ipcMain.handle` surface | **stale** — `electron.js` was split into `public/ipc/*` modules, see [ADR 0006](../decisions/0006-electron-main-split-into-ipc-modules.md) |
| Offline Cache System | v2 content-addressed cache | see also [ADR 0002](../decisions/0002-offline-cache-v2-hash-storage.md) |
| Authentication & Security | login flow, `webSecurity`, CSP | credential path superseded by [ADR 0004](../decisions/0004-single-credential-service.md); WS-SEC still open |
| Music Playback Pipeline | audio element, queue, gapless, MPRIS | `PlayerContext` being split (`playerQueue`, `playerPersistence`, `useMediaSession`) |
| Theme Management | `colorConfigManager`, custom themes | current |
| State Management | the provider tree | now also `LayoutModeContext` — [ADR 0007](../decisions/0007-layout-mode-context.md) |
| Design Patterns & Best Practices | conventions | current |
| Performance Optimizations | virtual scroll, search worker, LRU art | WS-PERF adds more |
| Build Process & Cache Management | Vite, electron-builder, CI | CI added — [ADR 0005](../decisions/0005-vitest-and-ci-gate.md) |
| Security Considerations | threat notes | WS-SEC |
| Remote Control Architecture | LAN discovery UDP 7766 + command server 7767 | current; code now `public/ipc/remote.js` |
| Android Native Layer | foreground service, wakelock, plugins | current |

## Decision records

See [`../decisions/`](../decisions/README.md). Read these before changing the
platform bridge, the offline cache layout, the download recovery flow, the
credential path, the Electron main structure, or layout branching.

## Module-level contracts

Per-module responsibilities and gotchas: [`../module_notes.md`](../module_notes.md).
