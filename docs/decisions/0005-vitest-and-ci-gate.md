# 0005 — Vitest + a CI gate

- Status: Accepted
- Date: 2026-09-06

## Context

`npm test` was `echo "No test runner configured"`. The bug history is dominated
by races and duplicate-event correctness bugs — exactly what regression tests
catch — and the WS-ARCH god-object splits can't be trusted without behaviour
pinned first.

## Decision

- **Vitest 3 + jsdom + React Testing Library**, config in `vitest.config.ts`
  (separate from `vite.config.mts` so `@vitejs/plugin-legacy` doesn't run under
  the test transform). Scripts: `test`, `test:watch`, `test:coverage`,
  `typecheck` (`tsc --noEmit`).
- Test the pure/decision layers directly; mock the platform-touching deps
  (`vi.mock('../utils/logger')` etc.) so service tests don't drag in
  `@capacitor/*`. God-object tests use `vi.resetModules()` + dynamic import per
  test and a minimal in-memory fake bridge.
- **`.github/workflows/ci.yml`** runs `lint` + `test` + `build` on push/PR to
  `main` as real gates. `typecheck` runs **non-blocking** — there are ~59
  pre-existing errors, mostly TS 4.9 not understanding `moduleResolution:
  "bundler"`; it becomes a gate after the WS-PERF TypeScript 5.x bump.

## Consequences

- Every WS-ARCH extraction ships with tests for the piece it pulls out; the
  extraction is only trusted when `npm test` is green.
- Coverage is low in aggregate (targeted unit tests of a few large modules) — no
  coverage threshold gate until the god-objects are split into unit-testable
  pieces.
- A full-flow integration test of `downloadBatchNative` was attempted and
  dropped (fake-timer + nested-await deadlock); its idempotency guard is a
  one-liner, better covered once `downloadTransport` is extracted.
