# Xylonic - Subsonic Music Player

A modern, beautiful Electron-based music player for Subsonic-compatible servers with offline download capabilities.

Version: 26.2.7-dev

License: MIT

## Features

- **Stream Music** - Connect to your Subsonic server and stream your entire library
- **Offline Downloads** - Download songs for offline playback with quality selection
- **Beautiful UI** - Modern blue-themed interface with album art display
- **Playback Controls** - Full control with play, pause, next, previous
- **Shuffle & Repeat** - Multiple playback modes (shuffle, repeat all, repeat one)
- **Quality Selector** - Choose streaming quality (Original, 320, 256, 192, 128 kbps)
- **Progress Bar** - Visual progress with seek functionality
- **Volume Control** - Adjust volume with mute option
- **Browse Library** - Navigate by Artists, Albums, and Songs
- **Album Art** - Beautiful cover art display throughout the app
- **Responsive Design** - Optimized desktop layout

## Quick Start

### Prerequisites

- Node.js 16+ and npm
- A Subsonic-compatible server (Subsonic, Airsonic, Navidrome, etc.)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/xylonic.git
cd xylonic

# Install dependencies
npm install

# Start development server
npm start
```

### Build for Production

```bash
# Build web version
npm run build

# Build Electron app for Windows
npm run electron:build:win

# Build Electron app for Linux
npm run electron:build:linux
```

## Usage

1. **Launch Application** - Start Xylonic
2. **Connect to Server** - Enter your Subsonic server URL, username, and password
3. **Test Connection** - Use the connection test to verify credentials
4. **Browse Library** - Navigate through artists and albums
5. **Play Music** - Click any song to start playback
6. **Download Songs** - Use download buttons to save songs for offline playback
7. **Shuffle All** - Use the shuffle button to play your entire library randomly

## Configuration

### Server Compatibility

Xylonic is compatible with:
- Subsonic
- Airsonic / Airsonic-Advanced
- Navidrome
- Gonic
- Ampache (with Subsonic API enabled)

### Quality Settings

Available streaming qualities:
- **Original** - Server's original file quality
- **320 kbps** - High quality
- **256 kbps** - Very good quality
- **192 kbps** - Good quality
- **128 kbps** - Standard quality

### Storage

Downloaded songs are stored locally using IndexedDB with the following structure:
- Song metadata (title, artist, album)
- Audio blob data
- Quality level
- Download timestamp

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety and better developer experience
- **Electron** - Cross-platform desktop application
- **Subsonic API** - Music streaming protocol
- **IndexedDB** - Local storage for downloads
- **CSS Variables** - Theming system
- **Context API** - State management

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

None currently. All core features are working as expected.

## Roadmap

Potential future enhancements:
- Playlists management
- Search functionality
- Lyrics display
- Equalizer
- Scrobbling support
- Themes customization
- Keyboard shortcuts

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

**Version 26.2.7-dev** - A stable, working version with clean blue theme and all core features implemented.

Built with care for music lovers who want a modern, beautiful way to enjoy their Subsonic library.