# Xylonic - Subsonic Music Player

A modern, beautiful Electron-based music player for Subsonic-compatible servers with a Spotify-like UI and extensive customization options.

**Version:** 26.2.8-dev  
**Author:** BeanGreen247  
**License:** MIT

## Features

### Core Playback
- **Stream Music** - Connect to any Subsonic-compatible server
- **Full Playback Controls** - Play, pause, next, previous with seek
- **Auto-play** - Songs automatically continue to next track
- **Progress Bar** - Visual progress with time display and click-to-seek
- **Volume Control** - Adjustable volume slider with mute

### Theming & Customization
- **12 Total Themes** - 8 preset themes + 4 custom theme slots
- **Preset Themes:**
  - Cyan Wave (default)
  - Purple Dream
  - Forest Green
  - Crimson Fire
  - Ocean Blue
  - Sunset Orange
  - Bubblegum Pink
  - Tropical Teal
- **Custom Theme Editor** - Create your own themes with color picker
- **Live Theme Preview** - See changes in real-time
- **Persistent Storage** - Themes saved locally per user

### Shuffle & Repeat
- **True Random Shuffle** - Starts from random song for authentic shuffle experience
- **Shuffle All** - Shuffle your entire library from Artists page
- **Shuffle Album** - Shuffle individual albums from Album page
- **Repeat Modes** - Off, Repeat All, Repeat One (independent buttons)

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

### Library Browser
- **Artist → Album → Song Hierarchy** - Intuitive navigation
- **Beautiful Album Art** - High-quality cover art throughout
- **Live Stats** - Real-time count of artists, albums, and songs
- **Back Navigation** - Easy navigation up the hierarchy

### User Experience
- **Material You Design** - Modern, clean interface
- **Responsive Layout** - Works on all window sizes
- **No Menu Bar** - Clean, distraction-free interface
- **Help Dialog** - Quick reference for keyboard shortcuts
- **Theme Selector Dialog** - Beautiful grid layout for choosing themes
- **Portable** - Runs without installation on Windows and Linux

## Screenshots

*Coming soon*

## Quick Start

### Prerequisites

- **For Users:** Nothing! Just download and run
- **For Developers:** Node.js 16+ and npm
- **Server:** A Subsonic-compatible server (Navidrome, Airsonic, Gonic, etc.)

### Download & Run (End Users)

#### Windows
1. Download `Xylonic-26.2.8-dev-portable.exe` from [Releases](https://github.com/BeanGreen247/xylonic/releases)
2. Double-click to run (no installation needed!)
3. Enter your Subsonic server details and enjoy

#### Linux
1. Download `xylonic-26.2.8-dev.tar.gz` from [Releases](https://github.com/BeanGreen247/xylonic/releases)
2. Extract the archive:
   ```bash
   tar -xzf xylonic-26.2.8-dev.tar.gz
   ```
3. Navigate to the folder:
   ```bash
   cd xylonic-26.2.8-dev
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

### Build for Windows (on Windows)
```bash
npm run electron:build:win-portable
```
Output: `dist/Xylonic-26.2.8-dev-portable.exe`

### Build for Linux (on Linux or WSL2)
```bash
npm run electron:build:linux-tar
```
Output: `dist/xylonic-26.2.8-dev.tar.gz`

### Build Both (Windows + Linux tar.gz)
```bash
npm run electron:build:all-portable
```

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

### Navigation

- **Artists View** - Browse all artists in your library
- **Click Artist** - View all albums by that artist
- **Click Album** - View all songs in that album
- **Click Song** - Start playback
- **Back Buttons** - Navigate back up the hierarchy

### Playback Controls

| Control | Function |
|---------|----------|
| **⏮** Previous | Go to previous song (or restart if >3s) |
| **⏸/▶** Play/Pause | Toggle playback |
| **⏭** Next | Skip to next song |
| **🔀** Shuffle | Randomize playback order |
| **🔀 Shuffle All** | Shuffle entire library (on Artists page) |
| **🔀 Shuffle Album** | Shuffle current album (on Album page) |
| **🔁** Repeat All | Loop entire playlist |
| **🔂** Repeat One | Loop current song |

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
- ✅ **Navidrome** (Recommended)
- ✅ **Airsonic / Airsonic-Advanced**
- ✅ **Gonic**
- ✅ **Subsonic**
- ✅ **Ampache** (with Subsonic API)

### Server URL Format

Always include the protocol and port:
```
✅ http://192.168.1.100:4533
✅ https://music.example.com
✅ http://localhost:4040
❌ 192.168.1.100:4533 (missing protocol)
❌ http://music.example.com/ (trailing slash)
```

### Data Storage

- **Credentials:** localStorage (plain text; not production-ready)
- **Settings:** `settings.cfg` in the Electron userData folder
- **Themes:** `color_settings/colors_{username}.cfg` per Subsonic username (no cross-user leakage)
- **Music:** streamed; no local cache unless added separately

## Technology Stack

- **Frontend:** React 18 + TypeScript
- **Desktop:** Electron 27
- **Styling:** Pure CSS with Material You variables + CSS custom properties for theming
- **State:** React Context API (Auth, Player, Theme)
- **Auth:** Token-based (MD5 salted)
- **API:** Subsonic REST API v1.16.1
- **Storage:** localStorage (browser/Electron native)

## Project Structure

```
src/
├── components/          # React components
│   ├── Auth/           # Login and authentication
│   ├── Layout/         # Header and layout components
│   ├── Library/        # Artist, album, song lists
│   ├── Player/         # Playback controls
│   └── common/         # Shared (Theme selector, Keyboard help, Custom theme editor)
├── context/            # React Context providers (Auth, Player, Theme)
├── hooks/              # Custom hooks (useKeyboardShortcuts, usePlayer, etc.)
├── services/           # API and storage services
├── styles/             # Global CSS
├── types/              # TypeScript definitions (Song, Theme, PlayerState)
└── utils/              # Helper functions (logger, md5)
```

## Development

### Running in Development

```bash
npm run electron:serve
```

The app will open at `http://localhost:3000`

**Development Mode Behavior:**
- **Auto-logout:** All sessions are automatically cleared when starting in dev mode
- **Debug logging:** All console logs are enabled (disabled in production builds)
- **Fresh state:** You'll need to log in each time you start the dev server

This ensures you're always testing with a clean slate and helps catch authentication issues early.

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
| Auto-logout on start   | Yes; first dev load clears localStorage once per session (logger) | No auto-clear                     |
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
| Console Logs | ✅ Enabled | ❌ Disabled |
| Auto-logout on start | ✅ Yes | ❌ No |
| Session persistence | ❌ Cleared | ✅ Persists |
| Debug info | ✅ Verbose | ❌ Silent |

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

# Reset to v26.2.8-dev (destructive - loses uncommitted changes)
git reset --hard v26.2.8-dev

# Or create a recovery branch (safe)
git checkout -b recovery-branch v26.2.8-dev

# Or temporarily view v26.2.8-dev
git checkout v26.2.8-dev
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
- ✅ Keyboard shortcuts now check if song is loaded before executing
- ✅ Theme preferences persist across sessions in production
- ✅ Shuffle starts from random song for true shuffle experience
- ✅ Development mode auto-logout is intentional for clean testing

## Roadmap

### Completed
- [x] Shuffle functionality (All + Album)
- [x] Keyboard shortcuts with Help dialog
- [x] Theme customization (12 themes total)
- [x] Custom theme editor with color picker
- [x] Theme persistence (localStorage)
- [x] Theme persistence (cfg files)

### Potential Future Features
- [ ] **Quality Control** - Select streaming bitrate (320, 256, 192, 128 kbps)
- [ ] **Offline Mode** - Download songs for offline playback
- [ ] Search functionality across library
- [ ] Playlists management (create, edit, save locally)
- [ ] Queue management (view, reorder, clear)
- [ ] Lyrics display (if available from server)
- [ ] Scrobbling support (Last.fm, ListenBrainz)
- [ ] Equalizer with presets
- [ ] Mini player mode (always-on-top compact view)
- [ ] Recently played history
- [ ] Favorites/starred songs

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add: amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

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

**Built with ❤️ for music lovers who want a modern, beautiful, and customizable way to stream their Subsonic library.**

**v26.2.8-dev** - Feature-rich release with theming, keyboard shortcuts, and smart shuffle