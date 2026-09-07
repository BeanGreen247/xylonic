# 0004 — One credential service

- Status: Accepted
- Date: 2026-09-06

## Context

`serverUrl` / `username` / `password` were read from `localStorage` in ~30
places as a copy-pasted triple, with the password in plaintext. There was a
half-finished `secureCredentialService` (Electron `safeStorage`) that only some
call sites used. This blocked the WS-SEC goal of no-plaintext-at-rest and made
the credential shape impossible to evolve.

## Decision

`src/services/credentialsService.ts` is the **single authoritative accessor**:

- `getCached()` — synchronous `{ serverUrl, username, password }` from a
  module-level cache hydrated from `localStorage` at import. Drop-in for the old
  triple; preserves call-site timing.
- `get()` — async; prefers the encrypted backend for the password, refreshes
  the cache. `hydrate()` runs once from `AuthContext` at boot.
- `set()` / `clear()` — keep the encrypted store, the sync cache and legacy
  `localStorage` in step.
- `useCredentials()` hook for React consumers.

Rule: **no new `localStorage.getItem('password')`.** If you touch a call site,
route it through `credentialsService.getCached()`.

## Consequences

- Every app-code credential read now goes through one place (migrated
  2026-09-06); the encrypted backend is the source of truth where available.
- Plaintext `localStorage` is *still written* as the synchronous hydration
  source — removing it needs a guaranteed secure-hydrate-before-first-read and
  is gated on WS-TEST + the `webSecurity:true` / `xylonic://` desktop pass.
- Capacitor still falls through to the cache like web until a
  Keychain/Keystore-backed `Preferences` group lands (WS-SEC).
