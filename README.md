# Xylonic - Subsonic Music Player

A modern, beautiful Electron-based music player for Subsonic-compatible servers with a Spotify-like cyan-themed UI.

**Version:** 26.2.7-dev  
**Author:** BeanGreen247  
**License:** MIT

## Features

- **Stream Music** - Connect to any Subsonic-compatible server
- **Beautiful UI** - Modern cyan/light blue Material You-inspired theme
- **Full Playback Controls** - Play, pause, next, previous with seek
- **Shuffle & Repeat** - Multiple modes (shuffle, repeat all, repeat one)
- **Progress Bar** - Visual progress with time display
- **Volume Control** - Adjustable volume slider
- **Library Browser** - Navigate Artists → Albums → Songs hierarchy
- **Album Art** - Beautiful cover art throughout the app
- **Responsive Design** - Works on all window sizes
- **Auto-play** - Songs automatically continue to next track
- **Live Stats** - Real-time count of artists, albums, and songs
- **No Menu Bar** - Clean, distraction-free interface
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
1. Download `Xylonic-26.2.7-dev-portable.exe` from [Releases](https://github.com/BeanGreen247/xylonic/releases)
2. Double-click to run (no installation needed!)
3. Enter your Subsonic server details and enjoy

#### Linux
1. Download `xylonic-26.2.7-dev.tar.gz` from [Releases](https://github.com/BeanGreen247/xylonic/releases)
2. Extract the archive:
   ```bash
   tar -xzf xylonic-26.2.7-dev.tar.gz
   ```
3. Navigate to the folder:
   ```bash
   cd xylonic-26.2.7-dev
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
Output: `dist/Xylonic-26.2.7-dev-portable.exe`

### Build for Linux (on Linux or WSL2)
```bash
npm run electron:build:linux-tar
```
Output: `dist/xylonic-26.2.7-dev.tar.gz`

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
| **🔁** Repeat All | Loop entire playlist |
| **🔂** Repeat One | Loop current song |

### Features

- **Auto-continue** - Songs automatically play next track
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

- **Credentials:** Stored in browser localStorage (plain text - not production-ready)
- **Settings:** Stored locally with the app
- **Music:** Streamed from server (no local storage)

## Technology Stack

- **Frontend:** React 18 + TypeScript
- **Desktop:** Electron 27
- **Styling:** Pure CSS with Material You variables
- **State:** React Context API
- **Auth:** Token-based (MD5 salted)
- **API:** Subsonic REST API v1.16.1

## Project Structure

```
src/
├── components/          # React components
│   ├── Auth/           # Login and authentication
│   ├── Layout/         # Header and layout components
│   ├── Library/        # Artist, album, song lists
│   ├── Player/         # Playback controls
│   └── common/         # Shared components
├── context/            # React Context providers
├── services/           # API and storage services
├── styles/             # Global CSS
├── types/              # TypeScript definitions
└── utils/              # Helper functions
```

## Development

### Running in Development

```bash
npm run electron:serve
```

The app will open at `http://localhost:3000`

### Building

```bash
# Production web build
npm run build

# Electron build
npm run electron-build
```

## Git Workflow

### Restoring to Stable Version

If you need to restore the working v1.0.0:

```bash
# View all tags
git tag

# Reset to v26.2.7-dev (destructive - loses uncommitted changes)
git reset --hard v26.2.7-dev

# Or create a recovery branch (safe)
git checkout -b recovery-branch v26.2.7-dev

# Or temporarily view v26.2.7-dev
git checkout v26.2.7-dev
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

## Roadmap

Potential future features:
- [ ] **Quality Control** - Select streaming bitrate (320, 256, 192, 128 kbps)
- [ ] **Offline Mode** - Download songs for offline playback
- [ ] Search functionality
- [ ] Playlists management
- [ ] Queue management
- [ ] Lyrics display
- [ ] Keyboard shortcuts
- [ ] Theme customization
- [ ] Scrobbling support
- [ ] Equalizer
- [ ] Mini player mode

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
- All contributors and testers

---

**Built with ❤️ for music lovers who want a modern, beautiful way to stream their Subsonic library.**

**v26.2.7-dev** - Stable release with cyan theme, auto-play, and portable builds for Windows & Linux