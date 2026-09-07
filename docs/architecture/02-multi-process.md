# Multi-Process Architecture

Electron applications run in **two separate processes** that communicate via IPC:

### Main Process (Node.js)

**File:** `public/electron.js`

The main process is a Node.js environment that runs BEFORE any windows are created. It has full access to Node.js APIs and the operating system.

**Responsibilities:**

```javascript
// Main Process Lifecycle
app.whenReady()
  ├─► Create BrowserWindows (main, mini player)
  ├─► Set up IPC handlers (encrypt, decrypt, file I/O)
  ├─► Configure CSP (Content Security Policy)
  └─► Manage app lifecycle (quit, activate)
```

**Key Operations:**

| Operation | Description | Why Main Process? |
|-----------|-------------|-------------------|
| **Window Management** | Create, destroy, show/hide windows | Requires Node.js `BrowserWindow` API |
| **File System I/O** | Read/write cache files, config files | Security: Renderer has limited FS access |
| **OS Keychain Access** | Encrypt/decrypt credentials | Requires native modules (Windows DPAPI, macOS Security Framework) |
| **IPC Event Routing** | Forward events between windows | Only main process can communicate with all renderers |

### Renderer Process (Chromium)

**Files:** `src/` directory (React app)

Each BrowserWindow runs in its own sandboxed renderer process - a Chromium browser environment with limited system access.

**Responsibilities:**

```javascript
// Renderer Process Components
React Application
  ├─► Context Providers (state management)
  ├─► UI Components (visual rendering)
  ├─► Event Handlers (user interactions)
  └─► IPC Communication (via preload bridge)
```

**Security Model:**

| Feature | Enabled | Reason |
|---------|---------|--------|
| **Node Integration** | ❌ Disabled | Prevents direct Node.js API access from web code |
| **Context Isolation** | ✅ Enabled | Isolates renderer code from preload scripts |
| **Sandbox** | ✅ Enabled | Limits system resource access |
| **CSP** | ✅ Strict | Restricts loading external scripts/resources |

**IPC Bridge (Preload Script):**

```javascript
// public/preload.js - Secure IPC bridge
contextBridge.exposeInMainWorld('electron', {
  // Renderer → Main
  send: (channel, data) => ipcRenderer.send(channel, data),
  
  // Main → Renderer (event listener)
  on: (channel, callback) => ipcRenderer.on(channel, callback),
  
  // Request-response pattern
  invoke: (channel, data) => ipcRenderer.invoke(channel, data)
});
```

---
