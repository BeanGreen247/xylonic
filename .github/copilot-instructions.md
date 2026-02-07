# Subsonic Music Player - AI Coding Instructions

## Project Overview
Electron + React + TypeScript music streaming app connecting to Subsonic API servers. Spotify-like UI with authentication, artist/album/song library browsing, and full playback controls.

## Architecture

### Electron Setup
- Main process: `public/electron.js` - Creates BrowserWindow, handles CSP, dev/prod modes
- Renderer: React app at `http://localhost:3000` (dev) or `build/index.html` (prod)
- Run dev: `npm run dev` or `npm run electron:serve`
- Build: `npm run electron:build`

### Authentication Flow
1. User enters `serverUrl`, `username`, `password` in `LoginForm.tsx`
2. **IMPORTANT**: Test connection with `testConnection()` before login - validates credentials
3. On successful test → User clicks Login → `AuthContext.login()` stores credentials in localStorage
4. `AuthContext` manages global auth state, provides `isAuthenticated`, `logout()`
5. `App.tsx` conditionally renders `LoginForm` or main player interface

### Navigation Structure
- **Artists** (`ArtistList.tsx`) → **Albums** → **Songs** hierarchy
- Back button navigates up the hierarchy
- Clicking song plays it and sets track list for next/previous navigation
- All fetching uses stored credentials from localStorage via `getFromStorage()`

### Core Components
- **Auth**: `LoginForm.tsx` (server URL + credentials + test), `ConnectionTest.tsx`
- **Player**: `PlaybackControls.tsx` (bottom section), `ProgressBar.tsx`, `VolumeControl.tsx`
- **Library**: `ArtistList.tsx` (main navigation), `SongList.tsx`, `SongItem.tsx`
- **Layout**: `Header.tsx` (shows user/server, logout), `Sidebar.tsx`

### Data Flow
```
LoginForm → testConnection() → AuthContext.login() → localStorage
                                        ↓
                               useSongList/ArtistList
                                        ↓
                                  subsonicApi.ts
                                        ↓
                                    SongItem
                                        ↓
                        usePlayer → PlaybackControls
```

## Subsonic API Integration

### Authentication Pattern (Token-Based)
```typescript
const salt = Math.random().toString(36).substring(7);
const token = md5(password + salt);
// URL params: ?u={username}&t={token}&s={salt}&v=1.16.1&c=SubsonicMusicApp&f=json
```

**CRITICAL**: Every API call must generate a NEW salt and token. Salt changes each request for security.

### Key Endpoints
- `ping.view` - Connection test & auth validation
- `getArtists.view` - Fetch all artists (returns nested index structure)
- `getArtist.view?id={artistId}` - Get artist's albums
- `getAlbum.view?id={albumId}` - Get album's songs
- `stream.view?id={songId}` - Audio stream URL (via `getStreamUrl()`)
- `getCoverArt.view?id={coverArtId}` - Album/artist artwork

### Response Structure
```typescript
{
  "subsonic-response": {
    "status": "ok" | "failed",
    "version": "1.16.1",
    "artists": { "index": [...] }, // getArtists
    "artist": { "album": [...] },  // getArtist
    "album": { "song": [...] }     // getAlbum
  }
}
```

### Server URL Format
User must provide: `http://192.168.1.100:4040` or `https://music.example.com`
- Always include protocol (http/https)
- Include port if non-standard
- NO trailing slash

## Critical Conventions

### Player Controls Layout
```
┌─────────────────────────────────────────────────────┐
│ [Song Info]    [⏮ ⏸/▶ ⏭]    [🔂 🔁 🔀]           │
│                [Progress Bar]                        │
└─────────────────────────────────────────────────────┘
```
- **Repeat Once** (🔂) and **Repeat All** (🔁) are SEPARATE independent buttons
- Active state: `.active` CSS class, color: `#1db954`
- Repeat states: `'none'` | `'one'` | `'all'`
- Shuffle toggles independently

### State Management
- **Context API**: `AuthContext` (auth state), `PlayerContext` (wraps `usePlayer` hook)
- **Custom hooks**: `useAuth`, `usePlayer`, `useSongList` - contain business logic
- **localStorage**: Credentials stored as plain text (keys: `auth`, `serverUrl`, `username`, `password`)
- Clear all storage on logout: `localStorage.clear()`

### Audio Playback
- `usePlayer` hook manages HTMLAudioElement via useRef
- When playing song from list: call `setTrackListAndPlay(songs, index)` to enable next/prev
- Single song play: call `play(song)` directly
- Stream URLs constructed per-request with fresh auth tokens

### TypeScript Patterns
- All Subsonic API responses typed in `types/subsonic.ts`
- Player state in `types/player.ts`
- Shared Song interface in `types/index.ts`
- Export hooks both ways: `export const useAuth = ...; export default useAuth;`
- Error handling: `(error as Error).message`

## Common Issues & Fixes

### Connection Failures
1. **Check server URL format**: Must include `http://` or `https://`, correct port
2. **CORS**: Subsonic server must allow origin `http://localhost:3000` (dev) or use `--disable-web-security` in Electron
3. **Token regeneration**: Each API call needs NEW salt/token pair - don't reuse
4. **Response validation**: Always check `response.data['subsonic-response']?.status === 'ok'`

### Authentication Issues
- `testConnection()` MUST succeed before calling `login()`
- Don't call `authenticateUser()` in `AuthContext.login()` - test already validated
- Credentials must be stored in exact format: `serverUrl`, `username`, `password` (no 'auth' token)

### Playback Issues
- Stream URLs expire - generate fresh URL on each play
- HTMLAudioElement must load before play: `audio.load()` then `audio.play()`
- Handle play() promise rejection (browser autoplay policy)
- Set track list for next/prev to work: `setTrackListAndPlay()`

## Development Workflow

### Start Development
```bash
npm run dev              # Starts React dev server + Electron
npm start               # React only (browser mode)
npm run electron:dev    # With debugging on port 5858
```

### Build & Package
```bash
npm run build                 # Create production React build
npm run electron:build        # Package Electron app (all platforms)
npm run electron:build:win    # Windows only
```

### Project Structure
```
src/
  components/          # UI organized by feature
    Auth/             # Login, connection test
    Player/           # Playback controls, progress, volume
    Library/          # Artists, albums, songs lists
    Layout/           # Header, sidebar
  hooks/              # Business logic (useAuth, usePlayer, useSongList)
  services/           # External APIs (subsonicApi, audioPlayer)
  context/            # Global state providers
  types/              # TypeScript interfaces
  utils/              # Helpers (md5, localStorage)
  styles/             # Global CSS
```

### Key Files
- `public/electron.js` - Electron main process, CSP configuration
- `src/App.tsx` - Root component, auth check, layout
- `src/hooks/usePlayer.ts` - Audio playback state machine (550+ lines)
- `src/services/subsonicApi.ts` - All API calls with token auth
- `src/components/Library/ArtistList.tsx` - Main navigation UI

## Security Notes
- **NOT PRODUCTION READY**: Passwords stored in localStorage as plain text
- Token-based auth prevents password in URLs (vs basic auth)
- Generate unique salt per request
- CSP configured in `electron.js` for media/image loading
- Clear all credentials on logout

## First-Time User Flow
1. App loads → `AuthContext` checks localStorage for `auth` key
2. No auth → Render `LoginForm` with server URL, username, password inputs
3. User fills form → Clicks "Test Connection"
4. `testConnection()` validates → Success message shows
5. User clicks "Login" → `AuthContext.login()` saves to localStorage
6. `isAuthenticated` becomes true → App shows `Header` + `ArtistList` + `PlaybackControls`