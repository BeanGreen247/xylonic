# Xylonic

<p align="center">
  <img src="assets/icon.png" alt="Xylonic Logo" width="96"/>
</p>

A modern, beautiful music player for Subsonic-compatible servers with a Spotify-like UI, extensive customization, and native mobile support. Available on Windows, Linux, macOS (Electron), Android (Capacitor), and iOS (Capacitor — sideloaded via CI).

**Version:** 26.7.31  
**Author:** BeanGreen247  
**License:** MIT

## Features

For the complete feature list and roadmap see **[FEATURES.md](FEATURES.md)**.

**Highlights:**
- Stream from any Subsonic-compatible server (Navidrome, Airsonic, Gonic…)
- Offline download cache · queue & position restored across restarts · background downloads
- LAN remote control — control any Xylonic device from any other
- Now Playing: ambient blurred art, three-card carousel, audio stats, dynamic art sizing; repeat persists across restarts
- 12 themes + custom editor · Last.fm scrobbling · sleep timer
- Virtual scrolling · web-worker search · MPRIS2 (Linux) · mode-aware image cache
- iOS support via GitHub Actions CI — unsigned IPA built on every push, installed via Sideloadly; see [IOS_SETUP.md](IOS_SETUP.md)

## Screenshots

Screenshots are available on the [GitHub Releases page](https://github.com/BeanGreen247/xylonic/releases).

## System Architecture

> **For Developers:** Detailed technical documentation is available in [ARCHITECTURE.md](ARCHITECTURE.md)

Xylonic is built on **Electron 27** with **React 18.2.0** and **TypeScript 4.9.5**, featuring:

- **Multi-window architecture** - Main window + mini player with synchronized state
- **Context-based state management** - Auth, Player, Theme, Offline, Search contexts
- **IPC communication** - Bidirectional events between main and renderer processes
- **Offline-first caching** - Reference-counted v2.1 cache with deduplication
- **Secure credential storage** - OS-native keychains (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- **Service layer pattern** - Business logic isolated from UI components
- **Platform bridge** - Unified API across Electron and Capacitor (Android) runtimes

### Quick Architecture Overview

```
Main Process (electron.js)           Renderer Process (React)
├─ Window Management                 ├─ Context Providers
├─ IPC Handlers                      ├─ UI Components  
├─ OS Keychain                       ├─ Service Layer
└─ File System I/O                   └─ Subsonic API Client
          │                                    │
          └────── IPC Events ──────────────────┘
```

### Key Features

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Authentication** | Token-based (MD5 salted) | Secure Subsonic API access |
| **Offline Cache** | Reference-counted files | Multi-user, deduplicated storage |
| **Cover Art** | Aliasing + iTunes fallback | One image per album; internet fallback |
| **Themes** | CSS custom properties | 8 presets + 4 custom slots |
| **Mini Player** | Separate BrowserWindow | Always-on-top compact view |
| **Platform Bridge** | Electron + Capacitor | Single codebase for desktop and Android |
| **Last.fm** | Official API v2 | Scrobbling with user-supplied API key |
| **Remote Control** | UDP 7766 + TCP 7767 | LAN device discovery and cross-device command server |

### Architecture Documentation

For comprehensive technical details, see [ARCHITECTURE.md](ARCHITECTURE.md):
- Multi-process architecture and IPC patterns (with interactive diagrams)
- Offline cache system with reference counting (v2.1)
- Remote control LAN discovery and command architecture
- Authentication flows (online and offline)
- Music playback pipeline and state machine
- Theme management with dual storage
- Design patterns and best practices
- Performance optimizations and security

> **💡 Tip:** ARCHITECTURE.md uses interactive Mermaid diagrams that render beautifully on GitHub. Click to zoom and explore the system design visually.

## Quick Start

### Prerequisites

- **For Users:** Nothing! Just download and run
- **For Developers:** Node.js 20+ and npm
- **Server:** A Subsonic-compatible server (Navidrome, Airsonic, Gonic, etc.)

### Download & Run (End Users)

#### Windows
1. Download `Xylonic-26.7.6-portable.exe` (portable) or `Xylonic-26.7.6-x64.exe` (installer) from [Releases](https://github.com/BeanGreen247/xylonic/releases)
2. Double-click to run (no installation needed for portable!)
3. Enter your Subsonic server details and enjoy

#### Linux
1. Download `Xylonic-26.7.6-x64.tar.gz` (or `.deb` / `.AppImage`) from [Releases](https://github.com/BeanGreen247/xylonic/releases)
2. Extract the archive:
   ```bash
   tar -xzf Xylonic-26.7.6-x64.tar.gz
   ```
3. Navigate to the folder:
   ```bash
   cd Xylonic-26.7.6-x64
   ```
4. Make the binary executable:
   ```bash
   chmod +x xylonic
   ```
5. Run the app:
   ```bash
   ./xylonic
   ```

**Optional:** Create a desktop shortcut or add to your PATH for easier access.

### Development Setup

```bash
# Clone the repository
git clone https://github.com/BeanGreen247/xylonic.git
cd xylonic

# Install dependencies
npm install

# Start development server
npm run electron:serve
```

## Building from Source

**Important:** Always run `npm run build` first to create the production React build before running any `electron:build` commands.

**Pre-Build Cleanup:** All build commands automatically clean before building:
- **Project directories:** `build/` and `dist/` folders (old build artifacts)
- **AppData directory:** Developer's AppData folder (except `color_settings` and `permanent_cache`)

This ensures a clean build with no stale artifacts. This ONLY happens on your development machine during build - it does NOT affect users.

### Build for Windows (on Windows)
```bash
# Create production build and package (includes automatic pre-build cleanup)
npm run electron:build:win-portable

# Or manually clean first, then build:
npm run prebuild:clean
npm run build
npm run electron:build:win-portable
```
Output: `dist/Xylonic-26.7.6-portable.exe` (portable) and `dist/Xylonic-26.7.6-x64.exe` (installer)

The build process will:
1. Clean project directories (build/, dist/)
2. Clean your local AppData/xylonic directory (preserves color_settings and permanent_cache)
3. Build the React production bundle
4. Package the Electron app

### Build for Linux (on Linux or WSL2)
```bash
# Create production build and package (includes automatic pre-build cleanup)
npm run electron:build:linux-tar

# Or manually clean first, then build:
npm run prebuild:clean
npm run build
npm run electron:build:linux-tar
```
Output: `dist/Xylonic-26.7.6-x64.tar.gz` (also `.deb` and `.AppImage` on native Linux)

### Build Both (Windows + Linux tar.gz)
```bash
# Package for both platforms (includes pre-build cleanup)
npm run electron:build:all-portable
```

### Build for Android

Requires Android Studio and the Android SDK installed.

```bash
# Sync the React build into the Capacitor Android project
npm run android:sync

# Open in Android Studio to build/run
npm run android:open

# Or build APK/AAB directly
npm run android:build:debug     # debug APK
npm run android:build:release   # signed release APK + AAB
npm run android:build:both      # both
```

### Build for iOS

iOS builds run automatically on every push to `main` via GitHub Actions (macOS runner). A signed local Xcode setup is not required.

See **[IOS_SETUP.md](IOS_SETUP.md)** for the full install process — CI produces an unsigned IPA that you sign and install using **Sideloadly on Windows**.

```bash
# Download latest IPA from CI (requires gh CLI)
bash scripts/download-ios-ipa.sh

npm run ios:sync           # sync React build into Xcode project
npm run ios:open           # open in Xcode (requires macOS)
```

### Build for macOS

macOS builds (`.dmg` + `.zip`, Intel + Apple Silicon) also run via GitHub Actions. Trigger manually at **Actions → Desktop Build → Run workflow → macos**.

Local build (requires macOS):
```bash
npm run electron:build:mac
```

### Manual Pre-Build Cleanup

If you want to clean your build directories without building:
```bash
npm run prebuild:clean
```

This removes:
- **Project directories:** `build/` and `dist/` (old build artifacts)
- **AppData directory:** Everything from `%APPDATA%\xylonic` except:
  - `color_settings/` - Your custom theme configurations
  - `permanent_cache/` - Your offline music cache

**Note:** AppImage builds require native Linux environment. WSL2 can only build tar.gz archives.

## Clean Build from Scratch

If you encounter build issues or want to ensure a fresh build with no old artifacts:

```bash
# 1. Clean everything (node_modules, build artifacts, caches)
Remove-Item -Recurse -Force node_modules, build, dist -ErrorAction SilentlyContinue

# 2. Install dependencies with legacy peer deps flag
npm install --legacy-peer-deps

# 3. Build production React app
npm run build

# 4. Test the app in development mode
npm run electron:serve

# 5. If everything works, package for distribution
npm run electron:build:win-portable    # Windows
npm run electron:build:linux-tar       # Linux
npm run electron:build:all-portable    # Both platforms
```

### Troubleshooting Build Issues

**Problem:** Blank screen after starting the app  
**Solution:** Delete `build/` folder and run `npm run build` again

**Problem:** Module not found errors  
**Solution:** Delete `node_modules/` and run `npm install --legacy-peer-deps`

**Problem:** Old cached code still running  
**Solution:** Full clean rebuild (see steps above)

**Problem:** Electron won't start  
**Solution:** Check logs in `C:\Users\{YourUsername}\AppData\Roaming\xylonic\app.log`

### Application Logs

Xylonic includes an **optional debug logging feature** for troubleshooting and issue reports:

**Logging Status:** Disabled by default (for privacy and performance)

**To Enable Logging:**
1. Click the hamburger menu (☰) in the top-right corner
2. Click "Debug Logging" to toggle it on
3. The menu will show "Enabled" badge when active
4. Click "Open Log Folder" to view logs in File Explorer

**Log Location:** `C:\Users\{YourUsername}\AppData\Roaming\xylonic\app.log`  
**Log Rotation:** Automatically rotates when file exceeds 5MB (old logs saved as `app.old.log`)  
**Log Contents (when enabled):**
- Application startup and shutdown events
- Authentication attempts and errors
- Cache operations and downloads
- Player state changes and errors
- Network connection issues
- Build and version information

**When to Enable:**
- Experiencing bugs or crashes
- Preparing a bug report/issue
- Troubleshooting connection problems
- Debugging offline mode issues

**Privacy Note:** Logs may contain server URLs and usernames (but NOT passwords). Disable logging when not needed for troubleshooting.

**To view logs:**
- Windows: Use "Open Log Folder" button in menu, or navigate to `%APPDATA%\xylonic`
- Linux: Navigate to `~/.config/xylonic`
- Or check console output when running in development mode with logging enabled

**Note:** AppImage builds require native Linux environment. WSL2 can only build tar.gz archives.

## Usage Guide

### First-Time Setup

1. **Launch Xylonic**
2. **Enter Server Details:**
   - Server URL: `http://your-server:4533` (include `http://` or `https://`)
   - Username: Your Subsonic username
   - Password: Your Subsonic password
3. **Test Connection** - Verify credentials before logging in
4. **Click Login** - Your credentials are saved locally

### Theming

**Access Theme Selector:**
- Click the **Theme** button in the top-right header
- Browse 8 preset themes in a beautiful grid layout
- Select any theme to apply instantly

**Create Custom Themes:**
1. Click **Edit Custom Themes** button in theme selector
2. Choose one of 4 custom theme slots (Custom 1-4)
3. Enter a theme name
4. Pick a color with the color picker or enter hex code
5. Click **Preview** to see changes live
6. Click **Save & Apply** to make it permanent

**Theme Storage:**
- Preset + custom themes are stored locally per OS user and per Subsonic username
- Each user has their own file: `color_settings/colors_{username}.cfg` (Electron userData folder)
- Defaults are created only for a new user; existing files are never overwritten on logout or app restart
- The last selected theme is applied automatically after login

### Keyboard Shortcuts

Press **Help** button in header or refer to shortcuts above. All shortcuts respect song state (won't crash if no song loaded).

| Shortcut | Action |
|----------|--------|
| **Space** | Play / Pause |
| **Shift + →** | Next track |
| **Shift + ←** | Previous track |
| **→** | Seek +5 s |
| **←** | Seek −5 s |
| **Shift + ↑** | Volume +10% |
| **Shift + ↓** | Volume −10% |
| **M** | Mute / Unmute |
| **S** | Toggle Shuffle |
| **R** | Toggle Repeat |
| **Q** | Toggle Queue panel |
| **H** | Toggle History panel |
| **P** | Toggle Playlists panel |
| **Ctrl+K** | Focus search bar |
| **Ctrl+M** | Toggle Mini Player |
| **Ctrl+Shift+Delete** | Wipe all caches (image + search; offline songs preserved) |

### Mini Player Mode

Access a compact always-on-top player window:

**Activate Mini Player:**
- Click the **Mini** button in the header
- Press **Ctrl+M** keyboard shortcut

**Mini Player Features:**
- Album artwork display
- Song title and artist information
- Play, pause, next, previous controls
- Progress bar with time display
- Always stays on top of other windows
- Main window automatically hides

**Return to Main Window:**
- Click the expand icon (↗) in mini player
- Press **Ctrl+M** again
- Close the mini player window

The mini player shares the same playback state with the main window, so you can switch between them without interrupting your music.

### Offline Mode & Downloads

**Downloading Albums for Offline Playback:**

1. **Navigate to an Album** - Click through Artists → Albums → Album View
2. **Click Download Button** - Next to "Play Album" and "Shuffle" buttons
3. **Select Quality** - Choose from:
   - **Original (Raw)** - Highest quality, no transcoding, larger files
   - **320 kbps** - Excellent quality, recommended for most users
   - **256 kbps** - High quality, good balance
   - **128 kbps** - Good quality, smaller files
   - **64 kbps** - Lower quality, smallest files
4. **Confirm Download** - Click "Download X Songs" button
5. **Monitor Progress** - Download Manager opens automatically, or click "Downloads" in header

**Managing Downloads:**

Access the Download Manager from the **Downloads** button in the header:

- **Overall Progress** - See total download progress bar and statistics
- **Pause/Resume** - Pause the entire download queue or resume downloads
- **Retry Failed** - Automatically retry any failed downloads
- **Clear Completed** - Remove completed downloads from queue view
- **Clear Queue** - Cancel all pending downloads

**Offline Mode:**

Toggle offline mode using the **Online/Offline** button in the header:

- **Offline-First** - Cached songs play instantly, streaming used as fallback
- **Bandwidth Saving** - Enable offline mode while online to avoid streaming
- **Connectivity Check** - App detects internet status and prompts for offline mode
- **Online/Offline Indicator** - Green (online) or red (offline) status in header

**Cache Management:**

Multiple ways to manage your cache:

**Download Manager Cache View:**
1. Click **Manage Cache** in Download Manager to view cached albums
2. See total songs, albums, and storage size
3. **Delete Individual Albums** - Click trash icon next to album
4. **Verify Cache** - Click "Verify Cache" to check every cached song against the filesystem; orphaned entries are removed automatically; live progress counter shown while running; also triggers automatically after every download batch completes
5. **Clear Downloaded Songs** - Remove all offline songs from cache

**Hamburger Menu (☰) - Clear All Caches:**
1. Click hamburger menu in top-right corner
2. Select **"Clear All Caches"** button
3. Clears **both** image cache (IndexedDB) and offline songs (permanent_cache)
4. Forces complete rebuild of cache on next startup
5. Use when switching servers or troubleshooting cache issues

**Settings - Clear All App Data (Android):**
1. Open Settings → scroll to Danger Zone
2. Click **"Clear All App Data"** and confirm
3. Clears everything: download queue, audio cache, image cache, search index, localStorage
4. On Android, also deletes native `permanent_cache`, WebView HTTP/cookie caches, and SharedPreferences
5. Use when migrating to a new server or performing a full reset

**Storage Location:**
- **Windows:** `%APPDATA%\Xylonic\permanent_cache\`
- **Linux:** `~/.config/Xylonic/permanent_cache/`

Cached songs are organized by Artist/Album/Song for easy management.

### Navigation

- **Artists View** - Browse all artists in your library (50 per page)
- **Click Artist** - View all albums by that artist (50 per page)
- **Click Album** - View all songs in that album
- **Click Song** - Start playback
- **Back Buttons** - Navigate back up the hierarchy
- **Page Controls** - Use Previous/Next or click page numbers to navigate

### Playback Controls

| Control | Function |
|---------|----------|
| **Previous** | Go to previous song (or restart if >3s) |
| **Play/Pause** | Toggle playback |
| **Next** | Skip to next song |
| **Shuffle** | Randomize playback order |
| **Shuffle All** | Shuffle entire library (on Artists page) |
| **Shuffle Album** | Shuffle current album (on Album page) |
| **Repeat All** | Loop entire playlist |
| **Repeat One** | Loop current song |

### Features

- **Auto-continue** - Songs automatically play next track
- **True shuffle** - Random first song selection for authentic shuffle experience
- **Progress bar** - Click to seek to any position
- **Volume control** - Adjust or mute with slider
- **Real-time stats** - See your library size in header
- **GitHub link** - Easy access to project repository

## Configuration

### Compatible Servers

Xylonic works with any Subsonic API-compatible server:
- **Navidrome** (Recommended)
- **Airsonic / Airsonic-Advanced**
- **Gonic**
- **Subsonic**
- **Ampache** (with Subsonic API)

### Server URL Format

Always include the protocol and port:
```
YES: http://192.168.1.100:4533
YES: https://music.example.com
YES: http://localhost:4040
NO: 192.168.1.100:4533 (missing protocol)
NO: http://music.example.com/ (trailing slash)
```

### Data Storage

- **Credentials:** Dual storage approach for security and compatibility:
  - Plaintext in localStorage (for backwards compatibility and fallback)
  - Encrypted in OS-native secure storage when available (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- **Settings:** `settings.cfg` in the Electron userData folder
- **Themes:** `color_settings/colors_{username}.cfg` per Subsonic username (no cross-user leakage)
- **Offline Cache:** `permanent_cache/` folder in the Electron userData directory
  - Organized by Artist/Album/Song structure
  - Includes `cache_index.json` for tracking cached songs, metadata, and cover art aliases
  - Cover art aliasing: Multiple songs in same album reference single image file for storage efficiency
- **Electron userData Locations:**
  - **Windows:** `%APPDATA%\Xylonic\`
  - **Linux:** `~/.config/Xylonic/`

## Technology Stack

- **Frontend:** React 18.2.0 + TypeScript 4.9.5
- **Desktop:** Electron 27
- **Mobile:** Capacitor 8 (Android + iOS)
- **Build Tool:** react-scripts 5.0.1
- **HTTP Client:** Axios 1.6.0
- **Icons:** FontAwesome 7
- **Styling:** Pure CSS with Material You variables + CSS custom properties for theming
- **State Management:** React Context API (Auth, Player, Theme, Offline, Search, UI)
- **Authentication:** Token-based (MD5 salted, secure credential storage)
- **API:** Subsonic REST API v1.16.1
- **Scrobbling:** Last.fm API v2 (optional, user-configured)
- **Storage:** localStorage + OS-native secure credential storage (Windows Credential Manager, macOS Keychain, Linux Secret Service)
- **Development Tools:**
  - Process Management: concurrently 8.x
  - Environment Variables: cross-env 10.x
  - Build Packaging: electron-builder 24.x
  - Type Definitions: @types/react 18.2.0, @types/react-dom 18.2.0, @types/node 20.0.0
  - Utilities: wait-on 7.x, electron-is-dev 2.x

## Development

### Running in Development

```bash
npm run electron:serve
```

The app will open at `http://localhost:3000`

**Development Mode Behavior:**
- **Session persistence:** Credentials persist across dev server restarts (same as production)
- **Debug logging:** Console logs are enabled in the renderer process
- **DevTools:** Opens automatically; Alt+F12 to toggle

### Building

```bash
# Production web build (disables all debug logging)
npm run build

# Production Electron build (no auto-logout, no console logs)
npm run electron:build
```

## Development vs Production Behavior

| Feature                | Development                                      | Production                        |
|------------------------|--------------------------------------------------|-----------------------------------|
| Session persistence    | Credentials persist across restarts              | Same                              |
| Console logging        | Enabled                                          | Enabled                           |
| Theme persistence      | Per-user `color_settings/colors_{username}.cfg`  | Same                              |
| DevTools               | Opens automatically; Alt+F12 toggle              | Closed by default; Alt+F12 toggle |

Dev start:
```bash
npm run electron:serve
```

Production build:
```bash
npm run build
npm run electron:build
```

**Production vs Development:**

| Feature | Development | Production |
|---------|-------------|------------|
| Console Logs | Enabled | Enabled |
| Session persistence | Persists | Persists |
| DevTools | Auto-open | Alt+F12 only |
| Debug info | Verbose | Normal |

### Testing Production Builds

**To verify console logs are disabled in production:**

#### Windows:
```bash
# 1. Build the production version
npm run build
npm run electron:build

# 2. Run the built executable
.\dist\win-unpacked\Xylonic.exe

# 3. Open DevTools (Ctrl+Shift+I or F12)
# 4. Check Console tab - should be empty (no debug logs)
# 5. Test shuffle, playback, navigation - no logs should appear
```

#### Linux:
```bash
# 1. Build the production version
npm run build
npm run electron:build

# 2. Extract and run the built app
cd dist
tar -xzf xylonic-*.tar.gz
cd xylonic-*/
./xylonic

# 3. Open DevTools (Ctrl+Shift+I or F12)
# 4. Check Console tab - should be empty (no debug logs)
# 5. Test shuffle, playback, navigation - no logs should appear
```

**Alternative: Check without DevTools**
```bash
# Windows - Run from command line to see if logs appear in terminal
dist\win-unpacked\Xylonic.exe --no-sandbox

# Linux - Run from terminal
./dist/xylonic-*/xylonic

# If production build is correct: No console output during normal operation
# Only critical errors (if any) would appear
```

## Git Workflow

### Restoring to Stable Version

If you need to restore the working v1.0.0:

```bash
# View all tags
git tag

# Reset to a tagged release (destructive - loses uncommitted changes)
git reset --hard v26.6.20

# Or create a recovery branch (safe)
git checkout -b recovery-branch v26.6.20

# Or temporarily view the tag
git checkout v26.6.20
```

### Creating Feature Branches

```bash
# Create and switch to feature branch
git checkout -b feature/my-new-feature

# Make changes and commit
git add .
git commit -m "Add: description of changes"

# Return to main and merge
git checkout main
git merge feature/my-new-feature
```

## Known Issues

None currently! All features working as expected.

**Recent Fixes:**
- Discover "Recently Played" now loads correctly (Subsonic API type corrected from `recentlyPlayed` to `recent`)
- Download Manager cache location now shows the real path on Android instead of "Error loading location"
- Animated equalizer bars in song rows are now properly centered on the album art thumbnail
- Text selection and blue tap-highlight suppressed globally across all UI elements
- Android downloads no longer stall when backgrounded — actual HTTP transfer moved from JS `fetch()` to a native Java `HttpURLConnection` thread inside the foreground service
- Battery optimization dialog now reliably appears on first Android launch (launched directly from `MainActivity.onCreate` with a 3 s delay, avoiding the null-activity pitfall in Capacitor plugins)
- Android download wakelock no longer expires after ~30 min — watchdog refreshes the lock every 2 s regardless of WebView activity
- WebView OOM crash during large batch registrations fixed — `registerNativeDownload` calls are now serial (one in-flight at a time) preventing V8 heap exhaustion on 1000+ song downloads
- Offline artist cover art now displays correctly — the `ar-xxx` Subsonic cover art ID is stored in cache metadata for newly downloaded songs; artist photos load from the preloaded image cache in offline mode
- Songs downloaded by the foreground service during a renderer OOM crash are automatically recovered on next launch via `reconcileOrphans()` — no songs are silently lost to Android memory pressure
- "Download Manager shows Done: 0 after app restart" fixed — the running `DownloadService` now redirects its broadcast target to the new JS session instead of queuing a duplicate batch

## Roadmap

See **[FEATURES.md → Roadmap](FEATURES.md#roadmap)** for the full list of completed and planned features.

## Contributing

Contributions are not welcome! Please leave this project up to me, thx.

## License

MIT License - See LICENSE file for details.

## Support

For issues, questions, or feature requests:
- Open an issue on GitHub
- Check the Subsonic API documentation
- Review existing issues for solutions

## Acknowledgments

- Subsonic API for the music streaming protocol
- React team for the amazing framework
- Electron for cross-platform desktop support
- Material You design system for color inspiration
- All contributors and testers

---

**Built with love for music lovers who want a modern, beautiful, and customizable way to stream their Subsonic library.**

**v26.7.28** - Full CI pipeline: Android APK, iOS unsigned IPA (device build, Sideloadly), Windows portable, Linux AppImage/deb/tar.gz, macOS dmg/zip (Intel + Apple Silicon); `scripts/download-ios-ipa.sh`; IOS_SETUP.md rewritten
