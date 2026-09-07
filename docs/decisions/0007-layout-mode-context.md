# 0007 — `LayoutModeContext` is the one seam for form-factor branching

- Status: Accepted
- Date: 2026-09-07

## Context

Layout decisions were scattered: `window.innerWidth <= 767` in JS, `<= 680` in
other files, `isMobile = !isElectron` in one component, plus a dozen
`@media (max-width: 767px)` blocks. Android TV (10-foot, D-pad) is on the
roadmap and would add another axis. There was no single place to ask "what shape
is this?".

## Decision

`src/context/LayoutModeContext.tsx` exposes
`LayoutMode = 'compact' | 'medium' | 'expanded' | 'tv'`:

- `compact` < 768, `medium` 768–1199, `expanded` ≥ 1200 (from viewport
  `matchMedia`; the 767 breakpoint matches the existing CSS).
- `isCoarsePointer` from `(hover: none) and (pointer: coarse)`.
- `tv` is **not** derived from the viewport heuristic — it arrives via the
  native `getUiMode()` bridge signal in WS-TV. A `forceMode` prop covers TV and
  tests.

`LayoutModeProvider` wraps the whole app; components read `useLayoutMode()`
instead of measuring the window or checking the platform.

## Consequences

- Nothing consumes it yet — WS-UX replaces the ad-hoc width checks with it and
  builds the three responsive layouts on top; WS-TV plugs in `getUiMode()`.
- Still viewport-based; WS-UX upgrades the `medium`/`expanded` split to
  container queries so a narrow desktop window gets the tablet layout.
- Adds one provider to an already-deep tree — accepted; it has no dependencies
  and its `value` is memoised.
