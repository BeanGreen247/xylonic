# 0001 — Platform access via a single bridge

- Status: Accepted
- Date: (pre-2026-09; recorded retroactively 2026-09-07)

## Context

Xylonic ships one React/Vite/TypeScript core (`src/**`) to three runtimes:
Electron (renderer), Capacitor Android WebView, and a plain-web fallback. Each
exposes filesystem, secure storage, OS media integration and system stats
differently — or not at all. Scattering `if (isElectron) … else if (Capacitor) …`
through components makes every platform quirk a cross-cutting concern and makes
Android TV / new targets a shotgun edit.

## Decision

All platform-specific capability goes through **`src/platform/bridge.ts`**: a
`PlatformBridge` interface plus `getBridge()`, which returns exactly one of
`electronBridge`, `capacitorBridge` or `fallbackBridge` based on the runtime.
Components and services call `getBridge().<method>()`; they never branch on
platform themselves. `fallbackBridge` returns benign "unavailable" values
(nulls, `false`, no-op event subscriptions) so web builds degrade cleanly.

Contract tests (`src/platform/*Bridge.test.ts`) pin each bridge to the interface.

## Consequences

- New platform ⇒ add one bridge file; no component churn.
- A capability that's missing on a platform is a `fallbackBridge`-style no-op,
  not a crash.
- The interface is a chokepoint: adding a method touches all three bridges. That
  friction is intentional — it keeps the surface small.
- Layout/form-factor branching is a *separate* seam — see
  [0007](0007-layout-mode-context.md).
