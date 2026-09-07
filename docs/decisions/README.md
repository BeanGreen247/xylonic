# Architecture Decision Records

Short, dated records of structural decisions and *why* — the context that isn't
recoverable from the diff. Format is MADR-lite: Context → Decision → Consequences.

Add a new one as `NNNN-kebab-title.md` (next free number). Never rewrite an
accepted ADR; supersede it with a new one and link back.

| # | Title | Status |
|---|---|---|
| [0001](0001-platform-bridge.md) | Platform access via a single bridge, never inline `if (isElectron)` | Accepted |
| [0002](0002-offline-cache-v2-hash-storage.md) | Offline cache v2: content-addressed audio, shared registry, per-user index | Accepted |
| [0003](0003-download-orphan-reconciliation.md) | Native downloads: completion log + pending-batch map + startup reconcile | Accepted |
| [0004](0004-single-credential-service.md) | One `credentialsService`; no new `localStorage.getItem('password')` | Accepted |
| [0005](0005-vitest-and-ci-gate.md) | Vitest for unit tests; CI gates on lint + test + build | Accepted |
| [0006](0006-electron-main-split-into-ipc-modules.md) | `electron.js` is wiring only; domains live in `public/ipc/*` | Accepted |
| [0007](0007-layout-mode-context.md) | `LayoutModeContext` is the one seam for form-factor branching | Accepted |
