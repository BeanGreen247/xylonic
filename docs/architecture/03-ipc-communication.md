# IPC Communication Patterns

> **Structure note (2026-09):** `public/electron.js` was split from one 2232-line
> file into `public/electron.js` (wiring, 533 lines) + nine
> `public/ipc/<domain>.js` modules (`remote`, `logging`, `settings`,
> `credentials`, `system`, `misc`, `downloadNotification`, `cache`,
> `playerWindow`), each exporting `register<Domain>Ipc(deps)` with shared state
> injected as getters/callbacks. The *handler names and payloads* below are
> unchanged; the *file layout* is not. See
> [ADR 0006](docs/decisions/0006-electron-main-split-into-ipc-modules.md).

### Pattern 1: Fire-and-Forget (One-Way)

Used when the sender doesn't need a response.

```mermaid
sequenceDiagram
    participant Renderer as Renderer Process
    participant Main as Main Process
    
    Renderer->>Main: send('event', data)
    Note over Main: Process event<br/>(no response needed)
```

**Example: Send player state to mini player**

```typescript
// PlayerContext.tsx (Main Window)
const sendPlayerState = (state: PlayerState) => {
  if (window.electron?.send) {
    window.electron.send('send-player-state', state);
  }
};

// electron.js (Main Process)
ipcMain.on('send-player-state', (event, state) => {
  lastPlayerState = state; // Cache for new windows
  
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.webContents.send('player-state-changed', state);
  }
});
```

### Pattern 2: Request-Response (Two-Way)

Used when the sender needs data back from the receiver.

```mermaid
sequenceDiagram
    participant Renderer as Renderer Process
    participant Main as Main Process
    
    Renderer->>+Main: invoke('get-data')
    Note over Main: Process request<br/>and prepare response
    Main-->>-Renderer: Returns data (Promise resolves)
```

**Example: Encrypt credentials**

```typescript
// secureCredentialService.ts (Renderer)
export const storeCredentials = async (
  serverUrl: string,
  username: string,
  password: string
) => {
  try {
    // Request encryption from main process
    const encrypted = await window.electron.invoke('encrypt-credential', {
      serverUrl,
      username,
      password
    });
    
    // Store encrypted result
    localStorage.setItem('credentials_encrypted', JSON.stringify(encrypted));
  } catch (error) {
    console.error('Encryption failed:', error);
  }
};

// electron.js (Main Process)
ipcMain.handle('encrypt-credential', async (event, data) => {
  try {
    // Use OS-native keychain (Windows DPAPI, macOS Keychain)
    const encrypted = await keytar.setPassword(
      'xylonic',
      `${data.serverUrl}::${data.username}`,
      data.password
    );
    return { success: true, encrypted };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

### Pattern 3: Event Broadcasting (One-to-Many)

Used to notify multiple windows of state changes.

```mermaid
sequenceDiagram
    participant RendererA as Renderer A<br/>(Main Window)
    participant Main as Main Process
    participant RendererB as Renderer B<br/>(Mini Player)
    participant RendererC as Renderer C<br/>(Future Window)
    
    RendererA->>Main: send('broadcast', data)
    Note over Main: Forward to all<br/>renderer windows
    Main->>RendererB: Forward event
    Main->>RendererC: Forward event
```

### Mini Player Synchronization Flow

**Opening Mini Player:**

```mermaid
sequenceDiagram
    participant User
    participant MainApp as MainApp.tsx
    participant Main as electron.js<br/>(Main Process)
    participant MiniPlayer as MiniPlayer.tsx<br/>(New Renderer)
    
    User->>MainApp: Press Ctrl+M or Click
    MainApp->>Main: send('toggle-mini-player')
    
    alt Mini player exists
        Main->>Main: Destroy mini player
        Main->>MainApp: Show main window
    else Mini player doesn't exist
        Main->>Main: Create BrowserWindow<br/>(width: 400, height: 120,<br/>alwaysOnTop: true, frame: false)
        Main->>MainApp: Hide main window
        Main->>MiniPlayer: Load localhost:3000?mini=true
        
        MiniPlayer->>MiniPlayer: useEffect() on mount<br/>Check URL param
        MiniPlayer->>Main: invoke('request-player-state')
        Main-->>MiniPlayer: Return lastPlayerState (cached)
        MiniPlayer->>MiniPlayer: Update local state<br/>Render UI with current song
    end
```

**Real-Time State Synchronization:**

```mermaid
sequenceDiagram
    participant Player as PlayerContext.tsx<br/>(Main Window)
    participant Main as electron.js<br/>(Main Process)
    participant Mini as MiniPlayer.tsx
    
    Note over Player: Song plays/pauses/changes
    Player->>Main: send('send-player-state', newState)
    Note over Main: Cache: lastPlayerState = newState
    Main->>Mini: send('player-state-changed', newState)
    Note over Mini: Listener receives event<br/>Update local state<br/>Re-render UI
    
    Note over Player,Mini: Result: Both windows synchronized
```

**User Controls from Mini Player:**

```mermaid
sequenceDiagram
    participant User
    participant Mini as MiniPlayer.tsx
    participant Main as electron.js<br/>(Main Process)
    participant Player as PlayerContext.tsx<br/>(Main Window)
    
    User->>Mini: Click Play/Pause
    Mini->>Main: send('send-player-control',<br/>{action: 'togglePlayPause'})
    Main->>Player: forward('player-control-action',<br/>{action: 'togglePlayPause'})
    Note over Player: Execute togglePlayPause()<br/>Audio element state changes
    Player->>Main: send('send-player-state', newState)
    Main->>Mini: send('player-state-changed', newState)
    Note over Mini: UI updates with new state
    
    Note over User,Mini: Result: Control executed,<br/>state synced back
```

---
