# 0008 — Navigation moves to `react-router` (memory history)

- Status: Rejected (2026-09-10, owner)
- Date: 2026-09-08

## Decision (2026-09-10)

Not doing this. The hand-rolled navigation in `App.tsx` works and has been
stable on all platforms; the migration's main risks — Android hardware-back
handling and overlay-dismissal ordering — outweigh the deep-linking and
scroll-restoration upside at this stage. `react-router-dom@7` stays installed
(removal is a separate trivial task) in case this is revisited. The rest of
this document is kept for that possibility.

## Context

`src/App.tsx` hand-rolls the app's entire navigation model in ~340 lines of
interlocking `useState`:

- `navigation: { view: 'artists' | 'albums' | 'songs', artistId?, artistName?,
  albumId?, albumName?, sourceView?, sourceSection? }` — the library drill-down,
  where `sourceView` / `sourceSection` are breadcrumb hints so "back" knows how
  far to unwind and which label to show (a 5-way `backLabel` ternary).
- `topView: 'artists' | 'allAlbums' | 'allSongs' | 'likedSongs'` — which library
  tab is active.
- `appSection: 'home' | 'library' | 'settings' | 'downloads'`.
- `sectionHistory: AppSection[]` — a manual return stack for settings/downloads.
- `backHandlerRef.current` — reassigned **every render** so the Android
  `backbutton` event always has a fresh closure. It dismisses ~7 overlay states
  in priority order, then unwinds section/drill-down, then calls
  `NavBridge.minimizeApp()`.

There is no deep-linking, no real history, no scroll restoration, and
`MainApp.tsx` is dead. The custom back-stack is the source of several past
"stuck view" / unexpected-minimise bugs.

`react-router-dom@7` is installed (2026-09-08).

## Decision

Adopt **`createMemoryRouter` + `<RouterProvider>`** (not `BrowserRouter` — there
is no URL bar in Electron or the Capacitor WebView, and memory history behaves
identically on every target).

Route table:

| Path | Renders | Notes |
|---|---|---|
| `/` | `DiscoverView` (home) | |
| `/library` | library shell + `topView` tabs (`ArtistList` / `AllAlbumsGrid` / `AllSongsGrid` / `LikedSongsView`) | `topView` stays local state or `?tab=`; it's a view toggle, not history |
| `/library/artist/:artistId` | `AlbumList` | `artistName` + `sourceView` via route `state` |
| `/library/album/:albumId` | `SongList` | `albumName` / `artistName` / `sourceView` / `sourceSection` via route `state`; drives `backLabel` |
| `/settings` | `SettingsView` | |
| `/downloads` | `DownloadManagerWindow inline` | |

- `sourceView` / `sourceSection` move from `navigation` fields to
  `useLocation().state` on the drill-down routes. `backLabel` is derived from
  that state, unchanged logic.
- `sectionHistory` is deleted — `navigate(-1)` replaces it.
- The Android `backbutton` handler keeps its overlay-dismissal prefix verbatim
  (those overlays are not routes), then: if `router.state.location.key !== 'default'`
  → `navigate(-1)`, else `NavBridge.minimizeApp()`.
- Search results overlay `isSearching` stays as-is (a `SearchProvider` flag, not
  a route); clearing search still resets to `/library`.
- Logout → `navigate('/library')`; the `?mini=true` `MiniPlayer` short-circuit
  stays **above** the router and all providers.
- Scroll restoration: `<ScrollRestoration>` (or the `react-window` list refs)
  once routes exist.

## Consequences

- ~250–350 lines of `App.tsx` rewritten; ~20 `setNavigation` / `setAppSection`
  call sites become `navigate(...)`. `App.tsx` shrinks and the nav model becomes
  declarative + inspectable.
- Deep-linking / "resume where I was" (WS-FEAT) falls out for free.
- **Must be verified on device** — the Android hardware-back path and the
  overlay-dismissal-before-history ordering are the risk. Not landing on `main`
  without an Electron + Android + iOS click-through of every route transition.
- Do it as a dedicated task, not bundled with other work. This ADR is the plan;
  flip to Accepted when the migration lands.
