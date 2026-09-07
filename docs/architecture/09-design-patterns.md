# Design Patterns & Best Practices

### 1. Service Layer Pattern

Business logic is extracted into **service modules** separate from UI components.

```
Components (UI)  →  Services (Logic)  →  External APIs
     │                    │                    │
   React              Pure TS              Subsonic
   useState           Functions            Server
   useEffect          No state
```

**Example: Authentication**

```typescript
// ❌ BAD: Logic mixed with UI
const LoginForm = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  const handleLogin = async () => {
    // Direct API call in component (bad!)
    const response = await fetch(serverUrl + '/rest/ping.view?...');
    if (response.ok) {
      localStorage.setItem('auth', JSON.stringify({username, password}));
      setIsAuthenticated(true);
    }
  };
  
  return <form onSubmit={handleLogin}>...</form>;
};

// ✅ GOOD: Logic in service layer
// src/services/authService.ts
export const authenticateUser = async (
  serverUrl: string,
  username: string,
  password: string
): Promise<boolean> => {
  const response = await subsonicApi.ping(serverUrl, username, password);
  return response.status === 'ok';
};

// Component only handles UI
const LoginForm = () => {
  const { login } = useAuth(); // Context handles state
  
  const handleLogin = async () => {
    const success = await authenticateUser(serverUrl, username, password);
    if (success) login({ serverUrl, username, password });
  };
  
  return <form onSubmit={handleLogin}>...</form>;
};
```

### 2. Custom Hooks Pattern

Reusable stateful logic extracted into custom hooks.

```typescript
// src/hooks/usePlayer.ts
export const usePlayer = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  
  const play = async (song: Song) => {
    // Complex playback logic here
    const audioUrl = await resolveAudioSource(song);
    if (audioRef.current) {
      audioRef.current.src = audioUrl;
      await audioRef.current.play();
      setIsPlaying(true);
    }
  };
  
  const pause = () => {
    audioRef.current?.pause();
    setIsPlaying(false);
  };
  
  return { currentSong, isPlaying, play, pause, audioRef };
};

// Components consume the hook
const PlaybackControls = () => {
  const { currentSong, isPlaying, play, pause } = usePlayer();
  
  return (
    <div>
      <button onClick={() => isPlaying ? pause() : play(currentSong)}>
        {isPlaying ? 'Pause' : 'Play'}
      </button>
    </div>
  );
};
```

### 3. Defensive Programming

Extensive null checks and error handling prevent crashes.

```typescript
// ✅ GOOD: Null-safe cache operations
export const getSongFromCache = async (songId: string): Promise<Blob | null> => {
  try {
    // Check if cache directory exists
    if (!cacheIndex) {
      await initializeCache();
    }
    
    // Check if song exists in cache
    const cachedSong = cacheIndex?.songs?.[songId];
    if (!cachedSong) {
      return null; // Not an error, just cache miss
    }
    
    // Check if file actually exists on disk
    const audioPath = cachedSong.audioPath;
    if (!audioPath || !(await fileExists(audioPath))) {
      console.warn(`Cache inconsistency: ${songId} indexed but file missing`);
      return null;
    }
    
    // Read file
    const blob = await readAudioFile(audioPath);
    return blob;
    
  } catch (error) {
    // Log error but don't throw (graceful degradation)
    console.error('Cache read error:', error);
    return null;
  }
};

// Usage: Always handle null case
const audioUrl = await getSongFromCache(song.id);
if (audioUrl) {
  // Use cached version
  playFromCache(audioUrl);
} else {
  // Fall back to streaming
  streamFromServer(song.id);
}
```

### 4. Event-Driven Architecture

Loose coupling between components via DOM events.

```typescript
// Advantages:
// - No direct imports between contexts
// - Easy to add new listeners
// - Prevents circular dependencies

// Emitter
const triggerEvent = (eventName: string, detail?: any) => {
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
};

// Listener
useEffect(() => {
  const handler = (event: CustomEvent) => {
    console.log('Event received:', event.detail);
  };
  
  window.addEventListener('custom-event', handler);
  return () => window.removeEventListener('custom-event', handler);
}, []);
```

### 5. Separation of Main and Renderer

Main process handles system operations, renderer handles UI.

| Operation | Process | Reason |
|-----------|---------|--------|
| Create windows | Main | Requires `BrowserWindow` API |
| File I/O | Main | Security: Renderer has limited FS access |
| OS keychain | Main | Requires native modules |
| UI rendering | Renderer | React runs in browser environment |
| User input | Renderer | DOM events in browser |
| State management | Renderer | React Context API |

### 6. Progressive Enhancement

Features degrade gracefully when unavailable.

```typescript
// Example: Secure credential storage with fallback
export const storeCredentials = async (password: string) => {
  try {
    // Try OS keychain first (best security)
    if (window.electron?.invoke) {
      const result = await window.electron.invoke('encrypt-credential', password);
      if (result.success) {
        return; // Success, exit early
      }
    }
  } catch (error) {
    console.warn('OS keychain unavailable, using fallback');
  }
  
  // Fallback: localStorage (less secure but functional)
  localStorage.setItem('credentials_plaintext', password);
};
```

### 7. User+Server Specific Keys Pattern

For multi-user environments, localStorage keys are namespaced with user and server identifiers to prevent conflicts.

```typescript
// ✅ GOOD: Namespaced keys for multi-user isolation
const getCacheKey = (key: string): string => {
  const user = username || 'unknown';
  const server = serverUrl || 'unknown';
  
  // Hash the server URL to keep key manageable
  const serverHash = Math.abs(
    server.split('').reduce((acc, char) => 
      ((acc << 5) - acc) + char.charCodeAt(0), 0
    )
  );
  
  return `${key}_${user}_${serverHash}`;
};

// Usage examples:
localStorage.setItem(getCacheKey('cachePreloaded'), 'true');
localStorage.setItem(getCacheKey('cachePreloadTimestamp'), Date.now().toString());

// Results in keys like:
// - "cachePreloaded_john_123456789"
// - "cachePreloadTimestamp_john_123456789"
// - "cachePreloaded_jane_987654321" (different user, no conflict)
```

**Benefits:**

- **No Cross-User Interference**: User A's logout doesn't affect User B's cache state
- **Multi-Server Support**: Same user can have different cache states for different servers
- **Shared Machines**: Multiple users on same computer maintain independent preferences
- **Predictable Behavior**: Each user/server combination has consistent, isolated state

**Anti-Pattern to Avoid:**

```typescript
// ❌ BAD: Global keys (causes conflicts)
localStorage.setItem('cachePreloaded', 'true');
// Problem: User B's login would see User A's cache flag

// ❌ BAD: Clearing all cache keys on logout
const logout = () => {
  localStorage.removeItem('cachePreloaded'); // Clears ALL users' flags!
  // Problem: User B loses their cache state when User A logs out
};
```

---
