# Design 0002 — UI modernization task set (WS-UX)

Status: proposed · 2026-09-07 · owner: WS-UX

A backlog to bring Xylonic's surface up to current streaming-app standards
**without a re-skin**. Hard constraints (from `CLAUDE.md` + `docs/design/0001`):

- Dark theme stays the baseline; the 261-var theming engine + user accent stay
  the source of truth — new surfaces read tokens, never hardcode.
- Runs in an Electron renderer **and** older Android/iOS WebViews at 25k-song
  scale — no heavy per-frame work, everything degrades under
  `prefers-reduced-motion` and `body.performance-mode`.
- Minimal-diff, token-first, no architecture rewrites. This is polish on top of
  the three-tier layout, not a replacement for it.

---

## Research

Builds on `docs/design/0001` (Navidrome inspected live; YouTube Music / Spotify /
Apple Music structural traits). For *surface* modernization the load-bearing
references are:

| Reference | Trait borrowed for this backlog |
|---|---|
| **Spotify 2023+** | Bottom "Now Playing bar" carries an art thumb + inline scrubber + expand affordance; card hover = subtle lift + a round play FAB that fades in on the art; very restrained elevation. |
| **Plexamp** | Album-art-derived **ambient colour** behind the now-playing view and (subtly) card/section backgrounds — the one signature "move". |
| **Apple Music** | Tight heading tracking, real type scale, tabular figures for durations/counts; large-art "hero" shelf on the landing page. |
| **YouTube Music** | Chip-based filters above lists; "continue listening" shelf. |

**Direction lock** — *warm up the greys, make album art the hero, add one
ambient-colour move, and make the now-playing bar do more.* Reject: a decorative
display serif, editorial cream canvas, left accent stripes, emoji icons,
indigo/violet — none fit a music player and all read as AI-slop defaults.

### Decision ledger (direction)

| Decision | Source | Role preserved | Why |
|---|---|---|---|
| Softer elevation + hover-lift, not hard drop-shadows | Spotify/Apple restraint | `--elevation-*` tokens keep their scale, values re-tuned | Current `--elevation-2/3` on cards reads heavy, especially in light mode |
| Album art gets a fade-in round **play FAB** on hover | Spotify card | new component, art-overlay role only | Biggest "feels dated" gap on the card grid |
| Art-derived **ambient colour** behind now-playing + subtle on section headers | Plexamp | decorative background role only, never an interactive surface | One memorable move; `NowPlayingOverlay` already blurs art so the plumbing is half there |
| Now-playing bar: art thumb + inline scrubber + expand | Spotify bar | player-bar chrome | Xylonic's bar is a flat icon row; scrubber is separate |
| Type scale + tabular figures | Apple Music | new `--font-size-*` / `--tracking-*` tokens; `font-variant-numeric` | Durations/counts currently jitter; headings have no rhythm |
| Filter **chips** above library lists | YouTube Music | reuse existing pill styling | `LibraryViewToggle` is a good base; extend to sort/filter |

Nothing here changes an existing token's meaning — it adds tokens and re-tunes
shadow values.

---

## Task tiers

Sizes: **S** ≈ half-day · **M** ≈ 1–2 days · **L** ≈ 3+ days / needs its own design pass.

### Tier 1 — high impact, low risk (do first, interleave with WS-UX Must)

- [~] **UI-01 · Elevation + radius re-tune** (S) — done 2026-09-07: new
      theme-flipping `--elevation-modal` token (dark `0 20px 60px /.55`, light
      `0 16px 48px /.18`) replaces 28 heavy `0 …px rgba(0,0,0,0.4–0.8)` modal
      drop-shadows across 18 files. **Remaining:** re-tune `--elevation-1..4`
      themselves + converge card/button radius on `--radius-md/lg`.
- [ ] **UI-02 · Card hover-lift + play FAB** (M) — `translateY(-2px)` + elevation
      step on `.album-card` / `.artist-card` hover; a round primary-accent play
      button that fades/scales in over the art (keyboard-focusable, hidden from
      AT when the card itself is the control). Gated by `prefers-reduced-motion`
      and `isCoarsePointer` (always-visible on touch). Reference: Spotify card.
- [ ] **UI-03 · Type scale tokens** (S) — add `--font-size-xs…2xl`,
      `--tracking-tight`, `--leading-*`; apply to headings / section titles /
      card text; `text-wrap: balance` on headings. Reference: Apple Music.
- [x] **UI-04 · Tabular figures** (2026-09-07) — `font-variant-numeric:
      tabular-nums` + `font-feature-settings: "tnum"` on `.progress-time`,
      `.song-duration`, track-number, `.panel-song-time`, `.progress-stats`,
      `.library-stats`, `.download-progress-text`, `.stat-value`,
      `.mini-player-time`. One grouped rule in `index.css`.
- [ ] **UI-05 · Focus-ring polish** (S) — the WS-a11y `:focus-visible` ring is
      functional but blunt; give it `border-radius` inheritance and a 2-layer
      ring (accent + 1px contrast) so it reads on both light art and dark chrome.

### Tier 2 — medium effort, needs a little design judgement

- [ ] **UI-06 · Now-playing bar richer** (M) — add a small rounded art thumbnail
      (click → open `NowPlayingOverlay`), fold the scrubber inline into the bar
      on `medium`/`expanded`, keep the compact bar as-is. Reference: Spotify bar.
      Touches `PlaybackControls` + its CSS only.
- [ ] **UI-07 · Ambient colour from art** (M) — extract a dominant/average colour
      from the current track's art (small offscreen `<canvas>`, cached per
      art id, main-thread-cheap) → CSS var `--art-tint`; use it as a very low-
      alpha wash behind `NowPlayingOverlay` and optionally the docked queue
      header. Decorative only. Reference: Plexamp. Respects performance-mode
      (falls back to `--surface`).
- [ ] **UI-08 · Library filter chips** (M) — a chip row above artist/album/song
      lists for sort (name / recently added / most played) and quick filters
      (downloaded-only, favourites). Reuse `LibraryViewToggle`'s pill styling.
      Reference: YTM. Pairs with the WS-PERF `{ids,idx}` list work.
- [ ] **UI-09 · Empty / offline states** (M) — the WS-UX "offline landing" item,
      designed properly: illustration-free, art-collage of what *is* cached +
      one clear action. Also skeletons for RightPanel tabs + Discover.
- [ ] **UI-10 · List row density toggle** (S–M) — comfortable / compact in
      Settings → Appearance; drives a `data-density` attr + row padding tokens.
      Cheap DAP users want compact; desktop users want comfortable.

### Tier 3 — bigger bets (own design pass each)

- [ ] **UI-11 · Landing "hero" shelf** (L) — a large-art featured row at the top
      of Discover (recently added #1, or a "for you" pick), above the current
      carousels. Reference: Apple Music. Needs a Discover layout pass.
- [ ] **UI-12 · Now-playing overlay redesign** (L) — full-screen player: big art,
      ambient background (UI-07), inline lyrics slot (feeds WS-FEAT lyrics),
      up-next peek. Currently functional but plain.
- [ ] **UI-13 · Motion system** (L) — the WS-UX motion pass as a system: a
      `--ease-*` / `--dur-*` token set, section cross-fades, list-item stagger
      on first paint, now-playing art crossfade; one document of what animates
      and why. All `prefers-reduced-motion` gated.
- [ ] **UI-14 · Icon weight/size consistency** (M) — pairs with the WS-PERF FA
      subset: one size scale for nav / player / row-action icons, consistent
      optical weight, kill the `≥ \f100` glyphs that don't render on the MECHEN
      DAP (`feedback_fa7_icon_range`).

---

## Sequencing

Tier 1 (UI-01→05) is ~2–3 days total and can land alongside the remaining WS-UX
Must items — it's mostly token work. Tier 2 slots between WS-PERF tasks (UI-08
with the list refactor, UI-07 is standalone). Tier 3 items each want their own
`docs/design/000N` before implementation.

Validate every visual task with a Playwright before/after at 390 / 900 / 1440,
light + dark, per the `design-craft` quality gate.
