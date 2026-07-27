# Xylonic — Features & Roadmap

← [Back to README](README.md)

---

## Features

### Core Playback
- **Stream Music** - Connect to any Subsonic-compatible server
- **Full Playback Controls** - Play, pause, next, previous with seek
- **Auto-play** - Songs automatically continue to next track
- **Progress Bar** - Visual progress with time display and click-to-seek
- **Volume Control** - Adjustable volume slider with mute

### Theming & Customization
- **12 Total Themes** - 8 preset themes + 4 custom theme slots
- **Preset Themes:** Cyan Wave (default), Purple Dream, Forest Green, Crimson Fire, Ocean Blue, Sunset Orange, Bubblegum Pink, Tropical Teal
- **Custom Theme Editor** - Create your own themes with color picker
- **Live Theme Preview** - See changes in real-time
- **Persistent Storage** - Themes saved locally per user

### Shuffle & Repeat
- **True Random Shuffle** - Fisher-Yates pre-shuffled index; every song plays exactly once per cycle before any repeats
- **Shuffle All** - Shuffle your entire library from Artists page
- **Shuffle Album** - Shuffle individual albums from Album page
- **Repeat Modes** - Off, Repeat All, Repeat One
- **Repeat Persistence** - Repeat preference saved to user-scoped localStorage (`repeat_pref_<username>`); restored on app start; cleared on logout
- **Queue Wrap-Around** - At the end of the queue, playback always continues from the first song regardless of repeat setting

### Keyboard Shortcuts
- **Space** - Play/Pause (only when song loaded)
- **Shift + →** - Next Track
- **Shift + ←** - Previous Track
- **→** - Seek Forward 5s
- **←** - Seek Backward 5s
- **Shift + ↑** - Volume Up 10%
- **Shift + ↓** - Volume Down 10%
- **S** - Toggle Shuffle
- **R** - Toggle Repeat
- **M** - Mute/Unmute
- **Ctrl+M** - Toggle Mini Player Mode
- **Ctrl+K** - Focus search bar
- **Q** - Toggle Queue panel
- **H** - Toggle History panel
- **P** - Toggle Playlists panel
- **Ctrl+Shift+Delete** - Wipe all caches (image, search index; preserves offline songs)

### Library Browser
- **Search** - Real-time search across artists, albums, and songs
- **Library View Toggle** - Switch between Artists, All Albums (grid), and All Songs views
- **Artist → Album → Song Hierarchy** - Intuitive navigation
- **All Albums Grid** - Browse every album across all artists in a paginated grid
- **All Songs Grid** - Browse every song in your library with pagination
- **Beautiful Album Art** - High-quality cover art throughout
- **Internet Artwork Fallback** - Fetches album art from iTunes API when server art is unavailable
- **Live Stats** - Real-time count of artists, albums, and songs
- **Back Navigation** - Easy navigation up the hierarchy
- **Pagination** - 50 artists/albums per page for large libraries
- **Add to Queue** - Queue any song from the library with one click
- **Add to Playlist** - Add any song to a saved playlist directly from the song row
- **Animated Equalizer** - Animated bars on the currently playing song row
- **Right-Click Context Menu** - Play Now, Play Next, Add to Queue, Add to Playlist, Download
- **Play Next** - Insert a song to play immediately after the current track
- **Liked Songs View** - Dedicated paginated view of all starred/liked songs with full context menu support

### Queue, History & Playlists
- **Right Panel** - Slide-in side panel with three tabs: Queue, Recently Played, and Playlists
- **Queue Management** - View full playback queue; drag-to-reorder, remove songs, or clear all
- **Queue & Position Persistence** - Playback queue AND current song position survive app restarts (saved to localStorage per user); music does not auto-play on restore
- **In-panel Search** - Filter songs inside Queue, History, and Playlists panels in real-time
- **Recently Played History** - Auto-tracks last 50 songs with time-ago display; play, add to queue, add to playlist, or clear
- **Playlist Management** - Create, rename, delete playlists; drag-to-reorder songs within a playlist
- **Save Queue as Playlist** - One-click saves the current queue into a named playlist

### Playback Speed Control
- **Variable Speed** - 7 speed options: 0.5×, 0.75×, 1× (normal), 1.25×, 1.5×, 1.75×, 2×
- **Per-Session** - Speed selector available in playback controls and Now Playing overlay
- **Real-Time** - Change speed at any time without interrupting playback

### Sleep Timer
- **Auto-Stop** - Set playback to stop after 15, 30, 45, or 60 minutes
- **Live Countdown** - Remaining time shown in the hamburger menu badge
- **Cancel Anytime** - Cancel the timer without interrupting playback

### Discover / Home
- **Home Section** - Dedicated Home tab with curated album carousels
- **Recently Added** - Albums most recently added to the server
- **Recently Played** - Albums you have listened to recently
- **Most Played** - Your most-played albums
- **Random Mix** - A random selection of albums from your library, refreshable on demand
- **Play All** - One-click to play the entire Random Mix section as a shuffled playlist
- **Horizontal Scrolling** - Arrow-button scroll rows; skeleton loaders while fetching
- **Offline Aware** - Gracefully shows an offline notice when Discover is unavailable

### Now Playing Overlay
- **Fullscreen Now Playing** - Click the player bar to open a fullscreen Now Playing view
- **Ambient Art Background** - Album art is blurred, darkened, and saturated to create an immersive full-bleed background behind the overlay; dark scrim gradient ensures text legibility
- **Three-Card Art Carousel** - Previous, current, and next album art displayed side-by-side; swipe left/right to skip tracks with spring-back animation below the gesture threshold and directional arrow hints
- **Swipe Down to Close** - Drag handle at top; swipe-down closes with spring animation; direction lock prevents horizontal carousel swipes from triggering close
- **Mouse Drag to Close** - Click and drag downward on the desktop Now Playing screen to dismiss
- **Audio Stats** - Format, Bitrate, Sample Rate, Bit Depth, and File Size always visible; data from song object with Subsonic `getSong` API fallback
- **Quality Selector** - Change streaming quality from within the overlay with a toast confirmation
- **Speed Selector** - Change playback speed from within the overlay
- **All Controls** - Shuffle, previous, play/pause, next, repeat (with "1" badge in repeat-one mode), and like — all in one screen; playlist icon button in the info row
- **Dynamic Art Sizing** - Album art grows to fill available screen height at all breakpoints using `min()/max()` CSS expressions; on a 412 px phone the art is 396 px wide (+19% over the previous layout)
- **Remote Mode** - All controls route through `RemoteModeContext`; pending state shown with a pulsing glow animation

### Navigation & Layout
- **Sidebar Navigation** - Persistent left-side nav with Home, Library, Downloads, and Settings sections
- **Home** - Discover view with curated carousels
- **Library** - Full artist/album/song browser with view toggle
- **Downloads** - Inline Download Manager panel
- **Settings** - Dedicated settings panel (theme, offline, performance, cache, debug)
- **Mobile Bottom Navigation** - Bottom tab bar for Home, Library, Search, Queue, Playlists, and Remote on Android

### User Experience
- **Material You Design** - Modern, clean interface
- **Responsive Layout** - Works on all window sizes
- **No Menu Bar** - Clean, distraction-free interface
- **Mini Player Mode** - Compact always-on-top window for playback control (desktop)
- **Help Dialog** - Quick reference for keyboard shortcuts
- **Theme Selector Dialog** - Beautiful grid layout for choosing themes
- **Faster Animations** - All UI transitions tightened for a snappier feel
- **Portable** - Runs without installation on Windows and Linux
- **MPRIS2 Integration** - Native Linux D-Bus media-key and taskbar controls
- **Missing Songs Banner** - Detects when server songs are not yet in the download cache and offers a one-click bulk download
- **New Content Detection** - On launch, compares server library counts with the local search index and prompts a cache refresh when new artists or songs are found
- **Switch Server** - Quickly switch between saved server connections from the hamburger menu or Settings without logging out

### Performance & Power
- **Performance Mode** - Allocates all CPU cores to Xylonic for maximum throughput on capable hardware
- **Power Saver Mode** - Restricts core affinity to half the available cores to reduce battery drain
- **Normal Mode** - Default balanced mode uses ¾ of available cores
- **Virtual Scrolling** - Song lists with more than 60 songs use react-window v2 windowing; only ~15 DOM nodes rendered at a time regardless of album size
- **Web Worker Search** - Real-time search filter runs entirely off the main thread; zero UI jank even on 25K+ song libraries; main-thread fallback if the worker fails
- **Fisher-Yates Shuffle Queue** - Pre-shuffled index array ensures every song plays exactly once per cycle before any repeats
- **Gapless Preload Safety-Net** - Begins buffering the next song 15 seconds before the current one ends
- **IPC Position Throttle** - Electron mini-player state sync split: metadata fires instantly; position updates capped at 2 fps (IPC calls drop from ~3,600/min to ~120/min)
- **In-Memory Metadata Cache** - Navigation returns cached API results instantly (30-minute TTL)
- **True LRU Image Cache** - Album art memory cache promotes entries on every read and write; real LRU eviction
- **Mode-Aware Image Cache Sizing** - `imageCacheService.syncWithAppMode()` adjusts concurrent fetches (4/2/1) and memory cache size (400/200/100 entries) based on active power mode; applied on startup and on mode change
- **Mode-Aware Cover Art Lookahead** - `PlayerContext` prefetches cover art 4 songs ahead (normal), 2 (performance mode), or 0 (power-saver); native notification artwork preload skipped entirely in power-saver mode
- **Performance Mode CSS Hardening** - Text-shadows and sub-pixel font antialiasing disabled in performance mode for cheaper glyph rasterisation
- **Power-Saver Image Rendering** - `image-rendering: pixelated` applied to all images in power-saver mode, eliminating GPU bilinear interpolation on scaled art

### Offline Mode & Downloads
- **Permanent Cache** - Download songs to AppData for offline playback
- **Quality Selection** - Choose download quality: Original, 320kbps, 256kbps, 128kbps, or 64kbps
- **Download Manager** - Manage download queue with pause/resume/retry; shows disk space available (Electron)
- **Download Notification** - OS-level notification while downloading: song name, X/Y count, live speed (MB/s), ETA; auto-dismisses on completion
- **Background Downloads (Android)** - Native Java `HttpURLConnection` inside a `dataSync` foreground service — completely bypasses WebView JS throttling; continues when screen is off, app is backgrounded, or swiped from recents
- **Battery Optimization (Android)** - Automatically requests OS "Unrestricted" battery exemption on first launch
- **Orphan Recovery (Android)** - `reconcileOrphans()` on startup re-registers audio files written during WebView OOM crash
- **Offline Mode Memory** - Remembers offline mode state across restarts; does not re-prompt "Mobile Data Detected" if already in offline mode
- **Offline-First Playback** - Cached songs play instantly, fall back to streaming if not cached
- **Album Downloads** - Download entire albums with one click
- **Cache Management** - View cached albums, delete individual albums or clear all cache
- **Cache Integrity Verification** - "Verify Cache" button with real filesystem checks; auto-runs after download queue drains
- **Clear All App Data** - Danger Zone in Settings wipes all Xylonic data; on Android also clears native storage and WebView caches
- **Connectivity Detection** - Automatic internet check on launch with offline mode prompt; 6-second grace period before showing "no internet" so brief signal drops don't interrupt usage
- **Bandwidth Control** - Toggle offline mode while online to conserve bandwidth
- **Storage Efficient** - Cover art aliasing system prevents duplicate downloads

### Streaming Quality Control
- **Bitrate Selection** - Original, 320, 256, 192, 128, or 64 kbps
- **Per-User Settings** - Streaming quality preference saved for each user
- **Real-Time Switching** - Change quality anytime from playback controls
- **Persistent Settings** - Your quality preference is remembered across sessions

### Remote Control (LAN — Desktop & Android)
- **LAN Discovery** - Xylonic devices on the same Wi-Fi / LAN discover each other automatically via multicast UDP port 7766
- **Cross-Device Control** - Control playback on any Xylonic device from any other — desktop ↔ phone, phone ↔ desktop
- **Two Roles** - "Be Controlled" lets other devices drive playback here; "Control Others" lets this device act as a controller
- **Pair & Unpair** - Simple pair/unpair flow from the Remote picker
- **Live State Sync** - Now Playing state (song, position, play/pause) mirrored to the controlling device in real time
- **Desktop Header Button** - Remote button in the Electron header shows device count and connected status
- **Firewall Setup** - Built-in dialog with ready-to-paste commands for Linux (ufw/firewalld/nftables/iptables) and Windows (netsh/PowerShell)
- **WiFi / LAN Required** - Remote mode requires a local network connection; availability indicator shown in the UI

### Last.fm Scrobbling
- **Scrobble Tracks** - Automatically scrobble plays to your Last.fm account
- **API Key Setup** - Configure your own Last.fm API key and secret in settings
- **Per-User Config** - Each Subsonic user has independent Last.fm credentials
- **Toggle On/Off** - Enable or disable scrobbling from the hamburger menu

### Security & Privacy
- **Encrypted Credential Storage** - Passwords encrypted at rest using OS-native keychains when available
- **HTTPS Enforcement** - All external server connections require HTTPS
- **Offline Mode** - Enter offline mode with stored encrypted credentials without network connection
- **Per-User Storage** - Each user's settings, themes, and cache are isolated

---

## Roadmap

### Completed
- [x] Shuffle functionality (All + Album)
- [x] Keyboard shortcuts with Help dialog
- [x] Theme customization (12 themes total)
- [x] Custom theme editor with color picker
- [x] Theme persistence (localStorage + cfg files)
- [x] Search functionality across library
- [x] Favorites/starred songs
- [x] Mini player mode (always-on-top compact view, desktop)
- [x] Offline Mode — download songs for offline playback with permanent cache
- [x] Quality Control — select download bitrate (Original, 320, 256, 128, 64 kbps)
- [x] Download Manager — manage album downloads with queue, pause/resume, and retry
- [x] Connection History — previous connections saved as dropdown for quick login
- [x] Multi-User Offline Mode — each user has separate offline cache
- [x] Quality Control — select streaming bitrate (Original, 320, 256, 192, 128, 64 kbps)
- [x] Cover art aliasing — storage-efficient deduplication for album art
- [x] Encrypted credential storage (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- [x] HTTPS enforcement
- [x] Loading spinner on play button while buffering
- [x] Recently played history — auto-tracked, re-playable, clearable
- [x] Queue management — view, drag-to-reorder, remove songs, clear queue
- [x] Playlists management — create, rename, delete, reorder songs, save locally per user
- [x] Queue & position persistence — queue AND current song restored across restarts (no auto-play)
- [x] Right Panel — slide-in side panel with Queue, Recently Played, and Playlists tabs
- [x] In-panel search/filter
- [x] Save queue as playlist
- [x] Now Playing fullscreen overlay
- [x] Swipe to skip — swipe left/right on album art in Now Playing overlay
- [x] Swipe down to close — Now Playing overlay dismisses on downward swipe (mobile + Android tablet)
- [x] Mouse drag down to close — desktop Now Playing panel dismisses on drag-down
- [x] Mobile bottom navigation — bottom tab bar for Android
- [x] Playback speed control — 0.5× to 2× in 7 steps
- [x] Library view toggle — Artists, All Albums grid, All Songs grid
- [x] Last.fm scrobbling — automatic scrobbling via user-supplied API key
- [x] Internet artwork fallback — album art from iTunes API when server art unavailable
- [x] Android support — Capacitor bridge for native Android builds
- [x] Sleep timer — auto-stop after 15/30/45/60 minutes with live countdown
- [x] Discover / Home view — curated carousels (Recently Added, Recently Played, Most Played, Random Mix)
- [x] Sidebar navigation — persistent Home / Library / Downloads / Settings panel
- [x] Remote Control — LAN device discovery (UDP 7766) and HTTP command server (7767); desktop and Android; account-scoped pairing
- [x] Settings panel — dedicated settings view
- [x] Performance Mode / Power Saver Mode — CPU core affinity control
- [x] MPRIS2 integration — native Linux D-Bus media controls and taskbar integration
- [x] Missing songs banner — detects un-cached songs and offers bulk download
- [x] New content detection — compares server library vs. local index on launch
- [x] Switch Server — quick server switch without full logout
- [x] Right-click context menu on song rows
- [x] Play Next — insert any song immediately after the current track
- [x] Liked Songs View — dedicated paginated view with full context menu support
- [x] Download notification — OS-level notification with live speed and ETA
- [x] Background downloads (Android) — native Java foreground service
- [x] Battery optimization dialog (Android) — requests "Unrestricted" background permission
- [x] Orphan recovery (`reconcileOrphans()`) — recovers audio files after WebView OOM crash
- [x] Clear All App Data (Android)
- [x] Offline artist cover art — `ar-xxx` IDs stored in download metadata
- [x] Disk space indicator in Download Manager (Electron desktop)
- [x] Cache integrity verification — "Verify Cache" button with real filesystem checks; auto-runs after downloads
- [x] Virtual scrolling in SongList — react-window v2 hybrid
- [x] Web Worker for search — zero UI jank on 25K+ libraries
- [x] Fisher-Yates shuffle queue
- [x] Gapless preload safety-net — buffering triggered 15 s before current song ends
- [x] Electron IPC position throttle — metadata fires immediately; position gated at 2 fps
- [x] True LRU image memory cache
- [x] IDB batch writes during cache preload
- [x] In-memory metadata TTL cache (30-min TTL)
- [x] Offline mode memory — no re-prompt when already in offline mode on cellular
- [x] Connectivity grace period — 6 s debounce on browser offline event + 3 s retry in connectivity check before showing offline prompt
- [x] Queue wrap-around — end of queue always continues from song 0, regardless of repeat setting
- [x] Tap album art to play/pause — works in both Now Playing components (mobile overlay + desktop/tablet panel)
- [x] Swipe-down direction lock (DesktopNowPlaying) — horizontal gestures in the queue list no longer accidentally trigger close
- [x] NowPlayingOverlay redesign — ambient blurred art background, three-card art carousel, audio stats row (format/bitrate/sample-rate/bit-depth/file-size), circular playlist icon button in info row, remote-mode pulsing pending state, dynamic `min()/max()` art sizing at all breakpoints
- [x] Repeat mode persistence — repeat preference saved to user-scoped localStorage; restored on app start; cleared on logout
- [x] Mode-aware image cache sizing — `imageCacheService.syncWithAppMode()` adjusts concurrent fetches and memory cache size per power mode; applied at init and on `appModeChanged` event
- [x] Mode-aware cover art lookahead — 4/2/0 songs ahead (normal/performance/power-saver); native artwork preload skipped in power-saver
- [x] Performance + power-saver CSS hardening — text-shadow/font-smoothing disabled in performance mode; pixelated image rendering in power-saver mode

### Planned

#### Player
- [ ] iOS support — native Capacitor app for iPhone/iPad (see [IOS_SETUP.md](IOS_SETUP.md))
- [ ] Crossfade between tracks
- [ ] Equalizer with presets
- [ ] Replay Gain / volume normalisation

#### Queue & Library
- [ ] Drag songs from the main library directly into a playlist
- [ ] Export / import playlists (M3U or JSON)

#### Discovery
- [ ] "More by this artist" shortcut on the now-playing bar
- [ ] ListenBrainz scrobbling
- [ ] Lyrics display (if available from server)

#### Visual
- [ ] Visualiser / waveform on the now-playing bar
