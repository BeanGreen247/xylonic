# Design 0001 — Three responsive layouts (WS-UX)

Status: locked · 2026-09-07 · owner: WS-UX

Grounds the roadmap item "Three real responsive layouts driven by
`LayoutModeContext` + container queries". This is a **layout-structure** pass, not
a visual redesign — the dark theme, the 261-var theming engine, `--primary`
accent, spacing/radius/elevation tokens and every component's visual treatment
are unchanged. Only the *arrangement* of nav / content / queue changes per
form factor.

---

## Research

Live inspection was run against **Navidrome's public demo**
(`demo.navidrome.org`, the reference Subsonic web client) at 390 / 900 / 1440 px
via the `browser` skill. Search engines (DDG) bot-blocked `curl`, so the other
references below are grounded in their published, widely-documented desktop
designs rather than fresh capture — each is used only for a well-known,
structural trait, not for visual taste.

| # | Reference | Inspected | Structural traits taken |
|---|-----------|-----------|--------------------------|
| 1 | **Navidrome** (Subsonic web client) | live, 3 widths | Binary drawer: MUI `Drawer-modal` overlay < ~600 px, permanent **240 px labelled sidebar** ≥ 600 px; full-width bottom player bar at every width; queue is a player-bar popover, **no docked panel**. |
| 2 | **YouTube Music** desktop | documented | The only reference with **both** an icon rail (≈72 px, labels on expand) **and** a persistent right-hand queue/now-playing column on wide screens — exactly the roadmap's three-tier ask. Rail → mini-bar + full-screen player on narrow. |
| 3 | **Spotify** desktop/web | documented | Right "Now Playing" panel is a **user toggle, docked** (~280–420 px), not forced open; below a threshold it auto-hides and the left library collapses to an icon rail. "Panel is optional" rule. |
| 4 | **Apple Music** web | documented | ~260 px labelled sidebar, no intermediate rail state — just hides under a hamburger when narrow. Confirms label-list sidebar is fine at desktop; argues against over-engineering the narrow case. |

### Synthesis

**Primary foundation: YouTube Music's rail + docked-queue-column** — it is the
only one whose structure maps 1:1 onto compact / medium / expanded.

Borrowed, bounded:
- from **Spotify** — the right panel is a *toggle that docks*, never force-open;
  the app is usable with it closed at every width.
- from **Navidrome** — at the widest tier the left nav is a **labelled 240 px
  sidebar**, not a permanent skinny rail (YTM keeps the rail even when wide;
  Xylonic already has a good labelled `AppNav`, so we keep labels at `expanded`
  and use the rail only for the `medium` squeeze).

Rejected:
- Averaging to "one collapsible sidebar for all widths" (Navidrome/Apple) — it
  throws away the medium-tier ergonomics the roadmap explicitly wants.
- A permanent skinny rail at desktop (pure YTM) — wastes the horizontal room
  Xylonic's `AppNav` already fills well with labels + user/server info.
- Force-opening the queue panel at `expanded` — violates Spotify's "optional"
  rule and would shove content on every desktop launch.

---

## The three layouts

Driven by `useLayoutMode().mode` (already computed from viewport `matchMedia` at
767 / 1199 px + coarse-pointer). App writes it to `data-layout` on `.app`;
structural CSS keys off `.app[data-layout="…"]`. `forceMode` still overrides
(tests, and WS-TV's `tv`).

### compact — phone, `≤ 767 px`
- **Nav:** `MobileBottomNav` (5 items). `AppNav` sidebar `display:none`.
- **Content:** single pane, full width.
- **Queue/history/playlists:** `RightPanel` as the current **full-height overlay
  drawer** + backdrop, slid in from the right, toggled from the header.
- Unchanged from today — this pass only formalises it under `data-layout`.

### medium — tablet / small desktop window, `768–1199 px`
- **Nav:** `AppNav` forced to a **64 px icon rail** — icons only, no collapse
  toggle, no user/server block, no Help/Logout labels (all still reachable:
  `title`/`aria-label` already present; Logout stays as an icon button). Bottom
  nav hidden.
- **Content:** fills the space left of the rail.
- **Queue panel:** stays an **overlay** drawer (same as compact), toggled from
  the header — horizontal room is too tight to dock without crushing content.

### expanded — desktop, `≥ 1200 px`
- **Nav:** full **200 px labelled `AppNav`** (today's sidebar, keeps its
  user-driven collapse-to-52 px toggle and user/server rows).
- **Content:** centre column.
- **Queue panel:** `RightPanel` **docks** — a flex child of `.app-body`, no
  backdrop, no `position:fixed`; when open it *reserves* `clamp(300px, 26vw,
  380px)` and the content column shrinks rather than being overlaid. Closed by
  default; toggled from the header (Spotify rule). Esc / close button still work.

### tv — reserved
`data-layout="tv"` selector exists but is populated by WS-TV, not here.

---

## Container queries

The roadmap asks for "container queries (not just `max-width: 767`)". Applied
where it actually earns its keep: **the card grids** (`.artists-grid`,
`.albums-grid`, and the skeleton grid) reflow off the *content column's* width,
not the viewport's — so docking the queue panel or the rail immediately re-flows
the cards without a viewport media query.

- `.main-content { container: main-col / inline-size; }`
- grids: `@container main-col (width < 640px) { … repeat(auto-fill, minmax(150px,1fr)) }`
  stepping up through `minmax(180px)` → `minmax(200px)` at wider container widths,
  replacing the fixed `minmax(180px,1fr)` + the `min-width:1366px !important`
  override.

Nav/panel structure stays context-driven (`data-layout`) — deterministic,
`forceMode`-testable, and not something a container query can express (the nav is
outside the content container).

---

## Decision ledger

| Decision | Source | Source rule / role preserved | Why |
|---|---|---|---|
| 3 tiers compact/medium/expanded, not 2 | YouTube Music structure | rail is the *medium* squeeze only | Roadmap DoD names all three; matches `LayoutModeContext` enum already shipped |
| Labelled 200 px sidebar at `expanded` (not a permanent rail) | Navidrome 240 px sidebar; Apple Music | label-list nav = desktop default | `AppNav` already fills it well with labels + user/server; rail at desktop wastes room |
| 64 px **icon rail** at `medium` | YouTube Music rail | icon rail = intermediate density | Reclaims ~136 px for content on tablets / half-screen windows without losing nav |
| Queue panel **docks** at `expanded`, **overlays** below | YouTube Music right column; Spotify docked panel | panel is docked chrome, not a modal | The one real ergonomic gap vs reference apps (roadmap "Should"); only fits ≥1200 |
| Queue panel **closed by default**, toggle to open, at every width | Spotify "Now Playing" toggle | panel is optional, never force-open | Don't shove content on desktop launch; keep one mental model across tiers |
| `data-layout` attr drives nav/panel; container queries drive card grids | craft (separation of concerns) | container queries = content reflow only | Nav lives outside the content container; attr is `forceMode`-testable and TV-ready |
| No visual-token changes | Xylonic `CLAUDE.md` + existing theme engine | every colour/space/radius token keeps its role | This is a layout pass; a visual redesign is out of scope |
| Bottom nav only at `compact` | current app; Navidrome modal-drawer threshold | bottom nav = phone affordance | Coarse-pointer phones; rail replaces it from 768 up |

---

## Implementation plan (incremental, build + test + screenshot each)

1. **`data-layout` + medium rail** — App consumes `useLayoutMode`, sets
   `data-layout` on `.app`; new `.app[data-layout="medium"] .app-nav` rail rules;
   `AppNav` hides toggle/user block at `medium`. Bottom nav / sidebar visibility
   moves from `@media` to `data-layout` (keep `@media` as the SSR-less fallback).
2. **Docked queue panel at `expanded`** — move `<RightPanel/>` into `.app-body`;
   `RightPanel` reads `useLayoutMode`; docked class when `isExpanded`
   (`position:static`, width reserved only when `.open`, no backdrop).
3. **Container-query card grids** — `.main-content` becomes a container; grids +
   skeleton grid switch to `@container`; drop the `min-width:1366px !important`
   grid override.
4. **QA pass** — Playwright at 390 / 900 / 1440, both themes, panel open/closed;
   compare against this spec; fix drift.

Verify on device later (iPhone 15 Pro Max) that `compact` is untouched.
