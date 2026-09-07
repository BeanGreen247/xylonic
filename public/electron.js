const { app, BrowserWindow, ipcMain, protocol, Menu, Tray, shell, dialog, safeStorage, session, nativeImage, net, powerSaveBlocker } = require('electron');
const { execFile } = require('child_process');
const https = require('https');
const http = require('http');
const path = require('path');
const url = require('url');
const os = require('os');
const fs = require('fs'); // Use sync fs, not promises
const isDev = require('electron-is-dev');
const { registerRemoteIpc } = require('./ipc/remote');
const { registerLoggingIpc } = require('./ipc/logging');
const { registerSettingsIpc } = require('./ipc/settings');

let mpris = null;
if (process.platform === 'linux') {
    try { mpris = require('./mpris'); } catch (e) { console.warn('[MPRIS] module unavailable:', e.message); }
}

// Native MPRIS2 is implemented in mpris.js (Linux only) — do NOT also enable
// Chromium's HardwareMediaKeyHandling/MediaSessionService bridge, which would
// register a second MPRIS service and show a duplicate entry in KDE's widget.

// Set Windows Application User Model ID so the SMTC (system volume flyout)
// correctly identifies this app in both dev and portable/installed modes.
if (process.platform === 'win32') {
    app.setAppUserModelId('beangreen247.xylonic.musicplayer');
}

// Get version from package.json
const { version } = require('../package.json');

// Read build-info.json — written by scripts/write-build-info.js before each build.
// In production the file lands in dist/ (Vite copies public/ → dist/).
// In dev it lives alongside this file in public/.
let _buildInfo = null;
try {
    const candidates = [
        path.join(__dirname, '..', 'dist', 'build-info.json'),
        path.join(__dirname, 'build-info.json'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) { _buildInfo = JSON.parse(fs.readFileSync(p, 'utf8')); break; }
    }
} catch {}
const _isDebugBuild = _buildInfo ? _buildInfo.buildType === 'debug' : isDev;
const _buildSuffix  = (_isDebugBuild && _buildInfo?.buildNumber)
    ? ` [Build #${_buildInfo.buildNumber}]`
    : '';

let mainWindow = null;
let miniPlayerWindow = null;
let lastPlayerState = null;
let _activeDownloads = false;
let _powerSaveId     = null; // powerSaveBlocker ID, null = not active

// Keep the system awake while music is playing or a download is in progress.
function _updatePowerSave() {
    const needsBlock = _activeDownloads ||
        !!(lastPlayerState && lastPlayerState.isPlaying && !lastPlayerState.isLoading);
    if (needsBlock && _powerSaveId === null) {
        _powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!needsBlock && _powerSaveId !== null) {
        if (powerSaveBlocker.isStarted(_powerSaveId)) powerSaveBlocker.stop(_powerSaveId);
        _powerSaveId = null;
    }
}
// Bounded LRU cache: coverArtId -> file:// URL. Capped at 10 entries so memory
// stays flat regardless of library size. A miss costs one stat call (fast), not
// a network fetch, because temp files persist on disk with deterministic names.
const _mprisArtMemCache = new Map();
const MPRIS_ART_CACHE_MAX = 10;
// coverArtId -> Promise; deduplicates concurrent in-flight fetches for the same art
const _mprisArtPending = new Map();

// Resolve the app icon regardless of dev/prod layout
function getIconPath(preferIco = false) {
  const isWin = process.platform === 'win32';
  const ext = (preferIco || isWin) ? 'ico' : 'png';
  const fallbackExt = ext === 'ico' ? 'png' : 'ico';

  // In dev: electron.js lives in public/, icon lives in assets/ (one level up)
  const devPath = path.join(__dirname, '..', 'assets', `icon.${ext}`);
  if (fs.existsSync(devPath)) return devPath;
  const devFallback = path.join(__dirname, '..', 'assets', `icon.${fallbackExt}`);
  if (fs.existsSync(devFallback)) return devFallback;

  // In production (electron-builder extraResources): icon next to resources
  const resPath = path.join(process.resourcesPath || '', `icon.${ext}`);
  if (fs.existsSync(resPath)) return resPath;
  const resFallback = path.join(process.resourcesPath || '', `icon.${fallbackExt}`);
  if (fs.existsSync(resFallback)) return resFallback;

  // Last resort: next to electron.js
  return path.join(__dirname, `icon.${ext}`);
}

// Logging (extracted to ./ipc/logging.js — also overrides console.* here)
const _logging = registerLoggingIpc({
  ipcMain, app, shell, version, buildSuffix: _buildSuffix, isDev,
});

// Cache location configuration
let cacheBasePath = null; // Will be loaded from settings

// Settings file path - now .cfg instead of .json
const getSettingsFilePath = () => path.join(app.getPath('userData'), 'settings.cfg');

// Settings directory path (for color configs)
const getSettingsDir = () => path.join(app.getPath('userData'), 'color_settings');

// Get cache location from settings or use default
const getCacheBasePath = () => {
  if (cacheBasePath) return cacheBasePath;
  
  // Try to load from settings file
  try {
    const settingsFile = getSettingsFilePath();
    if (fs.existsSync(settingsFile)) {
      const content = fs.readFileSync(settingsFile, 'utf8');
      const match = content.match(/^cache_location=(.+)$/m);
      if (match && match[1]) {
        cacheBasePath = match[1].trim();
        console.log('Loaded cache location from settings:', cacheBasePath);
        return cacheBasePath;
      }
    }
  } catch (error) {
    console.error('Failed to load cache location:', error);
  }
  
  // Default to AppData/permanent_cache
  cacheBasePath = path.join(app.getPath('userData'), 'permanent_cache');
  console.log('Using default cache location:', cacheBasePath);
  return cacheBasePath;
};

// Save cache location to settings
const saveCacheBasePath = (newPath) => {
  try {
    const settingsFile = getSettingsFilePath();
    let content = '';
    
    // Read existing content
    if (fs.existsSync(settingsFile)) {
      content = fs.readFileSync(settingsFile, 'utf8');
    } else {
      content = '# Xylonic Settings File\n# Generated automatically - edit with care\n\n';
    }
    
    // Update or add cache_location
    if (content.includes('cache_location=')) {
      content = content.replace(/^cache_location=.+$/m, `cache_location=${newPath}`);
    } else {
      content += `\ncache_location=${newPath}\n`;
    }
    
    fs.writeFileSync(settingsFile, content, 'utf8');
    cacheBasePath = newPath;
    console.log('Saved cache location:', newPath);
    return true;
  } catch (error) {
    console.error('Failed to save cache location:', error);
    return false;
  }
};

// Settings + color-config (extracted to ./ipc/settings.js)
const _settings = registerSettingsIpc({ ipcMain, getSettingsFilePath, getSettingsDir });

// Initialize settings + color_settings on app start
_settings.ensureSettingsDir();
_settings.ensureSettingsFile();

function createWindow() {
    // Remove the default menu
    Menu.setApplicationMenu(null);

    // DON'T redeclare mainWindow - use the outer variable
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        // Set dynamic title with version
        title: `Xylonic v${version}${_buildSuffix}`,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: false,
        },
        autoHideMenuBar: true,
        icon: getIconPath(),
    });

    // Better path handling for production
    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
    } else {
        // Construct absolute file:// URL for production
        const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
        mainWindow.loadURL(`file://${indexPath.replace(/\\/g, '/')}`);
    }

    // Force external links to open in system browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      // Default-deny: only hand real web URLs to the system browser, block
      // everything else (no in-app popups, no file://, no custom schemes).
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });

    // Network monitoring for bitrate display in title
    let lastBytes = 0;
    let lastTime = Date.now();
    let currentDownloadSpeed = 0;

    mainWindow.webContents.session.webRequest.onCompleted((details) => {
      if (details.url.includes('stream.view')) {
        const bytes = details.responseHeaders?.['content-length']?.[0] || 0;
        const duration = details.timestamp - details.requestTime;
        
        if (duration > 0 && bytes) {
          const bytesNum = parseInt(bytes);
          const durationSec = duration / 1000;
          const kbps = Math.round((bytesNum * 8) / durationSec / 1000);
          currentDownloadSpeed = kbps;
          
          // Update title with current speed
          if (mainWindow && kbps > 0) {
            mainWindow.setTitle(`Xylonic v${version}${_buildSuffix} | ↓ ${kbps} kbps`);
          }
        }
      }
    });

    // Reset title when no streaming activity
    let titleResetTimer;
    mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      if (details.url.includes('stream.view')) {
        clearTimeout(titleResetTimer);
        titleResetTimer = setTimeout(() => {
          if (mainWindow) {
            mainWindow.setTitle(`Xylonic v${version}${_buildSuffix}`);
          }
        }, 5000); // Reset after 5 seconds of no activity
      }
      callback({});
    });

    // Keep the title even after page loads (but allow our updates)
    mainWindow.on('page-title-updated', (event) => {
        event.preventDefault();
    });

    // Open DevTools in development automatically
    if (isDev) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (_isDebugBuild && input.alt && input.key === 'F12') {
            if (mainWindow.webContents.isDevToolsOpened()) {
                mainWindow.webContents.closeDevTools();
            } else {
                mainWindow.webContents.openDevTools();
            }
        }
        
        // Cache rebuild shortcut (Ctrl+Shift+R)
        if (input.control && input.shift && input.key.toLowerCase() === 'r') {
            event.preventDefault();
            mainWindow.webContents.send('trigger-cache-rebuild');
            console.log('Cache rebuild triggered via keyboard shortcut (Ctrl+Shift+R)');
        }
    });

    // Intercept window close when downloads are active
    mainWindow.on('close', (event) => {
        if (_activeDownloads && process.platform !== 'darwin') {
            event.preventDefault();
            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'question',
                buttons: ['Keep Downloading', 'Cancel & Quit'],
                defaultId: 0,
                cancelId: 1,
                title: 'Downloads in Progress',
                message: 'Music is still downloading.',
                detail: 'Minimize the window to keep downloads running, or cancel them and quit.'
            });
            if (choice === 1) {
                _activeDownloads = false;
                mainWindow.destroy();
            } else {
                mainWindow.minimize();
            }
        }
    });

    // Clean up on window close
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createMiniPlayer() {
    // Don't create if already exists
    if (miniPlayerWindow) {
        miniPlayerWindow.focus();
        return;
    }

    miniPlayerWindow = new BrowserWindow({
        width: 350,
        height: 100,
        title: `Xylonic Mini Player v${version}${_buildSuffix}`,
        resizable: false,
        alwaysOnTop: true,
        frame: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: false,
        },
        autoHideMenuBar: true,
        icon: getIconPath(),
    });

    miniPlayerWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // Load with mini player flag
    if (isDev) {
        miniPlayerWindow.loadURL('http://localhost:3000?mini=true');
    } else {
        // Construct absolute file:// URL with query parameter
        const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
        miniPlayerWindow.loadURL(`file://${indexPath.replace(/\\\\/g, '/')}?mini=true`);
    }

    // Clean up on window close
    miniPlayerWindow.on('closed', () => {
        miniPlayerWindow = null;
        // Show main window when mini player closes
        if (mainWindow) {
            mainWindow.show();
        }
    });
}


// ── Remote Discovery (extracted to ./ipc/remote.js) ──────────────────────────
const _remoteIpc = registerRemoteIpc({
  ipcMain,
  app,
  getMainWindow: () => mainWindow,
  getLastPlayerState: () => lastPlayerState,
});

// OS platform (for firewall setup UI)
ipcMain.handle('get-os-platform', () => process.platform);

// Background download keep-alive
ipcMain.handle('set-download-active', (_event, active) => {
    _activeDownloads = !!active;
    _updatePowerSave();
});

// Dock/taskbar progress bar + tray tooltip for background downloads.
let downloadTray = null;
ipcMain.handle('set-download-progress', (_event, { progress = 0, indeterminate = false, title = '', text = '' } = {}) => {
    if (!mainWindow) return;
    try {
        mainWindow.setProgressBar(
            indeterminate ? 2 : Math.min(Math.max(progress, 0), 100) / 100,
            { mode: indeterminate ? 'indeterminate' : 'normal' }
        );
    } catch { /* setProgressBar unsupported on this platform build */ }

    if (!downloadTray) {
        try {
            downloadTray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon-tray.png')));
        } catch { downloadTray = null; }
    }
    if (downloadTray) {
        const pct = indeterminate ? '…' : `${Math.round(progress)}%`;
        downloadTray.setToolTip(`${title || 'Downloading'}${text ? `: ${text}` : ''} (${pct})`);
    }

    if (process.platform === 'darwin' && app.dock) {
        app.dock.setBadge(indeterminate ? '…' : `${Math.round(progress)}%`);
    }
});

ipcMain.handle('clear-download-progress', () => {
    if (mainWindow) {
        try { mainWindow.setProgressBar(-1); } catch { /* ignore */ }
    }
    if (downloadTray) {
        downloadTray.destroy();
        downloadTray = null;
    }
    if (process.platform === 'darwin' && app.dock) {
        app.dock.setBadge('');
    }
});

// Detect which Linux firewall tools are present (for the firewall setup dialog)
ipcMain.handle('detect-linux-firewall', async () => {
    if (process.platform !== 'linux') return [];
    const { execSync } = require('child_process');
    const found = [];
    const probe = (cmd) => { try { execSync(cmd, { timeout: 2000, stdio: 'ignore' }); return true; } catch { return false; } };
    if (probe('which ufw'))          found.push('ufw');
    if (probe('which firewall-cmd')) found.push('firewalld');
    if (probe('which nft'))          found.push('nftables');
    if (probe('which iptables'))     found.push('iptables');
    return found;
});

// Register file protocol before app is ready
app.whenReady().then(() => {
    // Ensure both main settings file and color_settings exist when app is ready
    _settings.ensureSettingsDir();
    _settings.ensureSettingsFile();
    
    // Check logging preference and initialize if enabled
    _logging.initLogging();
    
    // Normalize file:// paths through fileURLToPath so absolute paths on Linux
    // stay absolute (avoids the old replace('file:///','') stripping the leading '/').
    // bypassCustomProtocolHandlers: true prevents circular recursion and lets
    // Chromium's native file handler serve the request (handles Range, MIME, etc).
    protocol.handle('file', (request) => {
        try {
            const filePath = url.fileURLToPath(request.url);
            return net.fetch(url.pathToFileURL(filePath).toString(), { bypassCustomProtocolHandlers: true });
        } catch {
            return new Response(null, { status: 404 });
        }
    });

    // Content-Security-Policy (WS-SEC, partial). Production only for now: the
    // strict form (no 'unsafe-inline' on script-src, a xylonic:// scheme for
    // cached media, and webSecurity:true) is gated on the custom-protocol work
    // and a 4-target desktop pass — see docs/ROADMAP.md WS-SEC. Dev is skipped
    // so the Vite dev server (inline scripts / eval) keeps working.
    if (!isDev) {
        const csp = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https: http:",
            "media-src 'self' blob: data: https: http:",
            "connect-src 'self' https: http:",
            "font-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'",
            "frame-ancestors 'none'",
        ].join('; ');
        session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Content-Security-Policy': [csp],
                },
            });
        });
    }

    // HTTPS enforcement - allow most sources, only warn about public HTTP
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const url = details.url;
        
        // Allow all HTTPS
        if (url.startsWith('https://')) {
            callback({});
            return;
        }
        
        // Allow all localhost/127.0.0.1
        if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
            callback({});
            return;
        }
        
        // Allow file:// protocol
        if (url.startsWith('file://')) {
            callback({});
            return;
        }
        
        // Allow private IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
        const privateIPPatterns = [
            /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}/,
            /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
            /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}/,
            /^http:\/\/[^\/]+\.local/
        ];
        
        if (privateIPPatterns.some(pattern => pattern.test(url))) {
            callback({});
            return;
        }
        
        // Allow devtools:// protocol
        if (url.startsWith('devtools://')) {
            callback({});
            return;
        }
        
        // Allow chrome-extension:// protocol
        if (url.startsWith('chrome-extension://')) {
            callback({});
            return;
        }
        
        // For everything else HTTP, just log a warning but allow it
        // This ensures the app works while still providing security awareness
        if (url.startsWith('http://')) {
            console.warn('[Security] Allowing HTTP request (consider using HTTPS):', url);
        }
        
        callback({});
    });

    createWindow();
    _remoteIpc.startRemoteDiscovery();

    if (process.platform === 'linux') {
        const appIcon = nativeImage.createFromPath(getIconPath());
        if (!appIcon.isEmpty()) app.setIcon(appIcon);

        // Init native MPRIS2 service; control events are forwarded to the renderer
        if (mpris) {
            mpris.initMpris(mainWindow, (action, data) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('player-control-action', action, data);
                }
            });
        }
    }
});

// Handle song saving
ipcMain.handle('save-song', async (event, { buffer, filePath, artist, album, title }) => {
    try {
        const musicDir = app.getPath('music');
        const downloadDir = path.join(musicDir, 'SubsonicDownloads');
        
        const fullPath = path.join(downloadDir, filePath);
        const dir = path.dirname(fullPath);

        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(fullPath, buffer);

        console.log(`Saved: ${fullPath}`);
        return { success: true, path: fullPath };
    } catch (error) {
        console.error('Failed to save song:', error);
        throw error;
    }
});

// Get download directory
ipcMain.handle('get-download-dir', async () => {
    const musicDir = app.getPath('music');
    return path.join(musicDir, 'SubsonicDownloads');
});


// Secure credential storage handlers (safeStorage)
ipcMain.handle('safe-storage-available', () => {
  return safeStorage.isEncryptionAvailable();
});

ipcMain.handle('safe-storage-encrypt', (event, plaintext) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('Encryption not available - storing credentials in memory only');
      return null;
    }
    const buffer = safeStorage.encryptString(plaintext);
    return buffer.toString('base64');
  } catch (error) {
    console.error('Failed to encrypt credential:', error);
    return null;
  }
});

ipcMain.handle('safe-storage-decrypt', (event, encrypted) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('Encryption not available - cannot decrypt');
      return null;
    }
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  } catch (error) {
    console.error('Failed to decrypt credential:', error);
    return null;
  }
});

// Mini player handlers
ipcMain.handle('toggle-mini-player', () => {
  try {
    if (miniPlayerWindow) {
      // Mini player exists - close it and show main
      miniPlayerWindow.close();
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
      return false; // Mini player closed
    } else {
      // Create mini player and hide main
      createMiniPlayer();
      if (mainWindow) {
        mainWindow.hide();
      }
      return true; // Mini player opened
    }
  } catch (error) {
    console.error('Failed to toggle mini player:', error);
    return false;
  }
});

ipcMain.handle('is-mini-player', (event) => {
  return event.sender === miniPlayerWindow?.webContents;
});

// Player state synchronization
ipcMain.handle('request-player-state', () => {
  // Return the last known player state
  console.log('[Electron] request-player-state called, returning:', lastPlayerState);
  return lastPlayerState;
});

// Return the deterministic temp path for a given coverArtId.
// Using a fixed name per ID means the file is written once and reused across sessions.
function mprisArtTempPath(coverArtId) {
  const safe = coverArtId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `xylonic_mpris_${safe}.jpg`);
}

function mprisArtCacheGet(coverArtId) {
  if (!_mprisArtMemCache.has(coverArtId)) return undefined;
  // Move to end = most recently used
  const u = _mprisArtMemCache.get(coverArtId);
  _mprisArtMemCache.delete(coverArtId);
  _mprisArtMemCache.set(coverArtId, u);
  return u;
}

function mprisArtCacheSet(coverArtId, url) {
  _mprisArtMemCache.delete(coverArtId); // remove before re-insert to update order
  if (_mprisArtMemCache.size >= MPRIS_ART_CACHE_MAX) {
    _mprisArtMemCache.delete(_mprisArtMemCache.keys().next().value); // evict oldest
  }
  _mprisArtMemCache.set(coverArtId, url);
}

// Resolve cover art to a file:// URL for MPRIS, with a layered cache to minimise I/O:
//   1. LRU memory Map   — zero I/O, O(1)
//   2. Offline registry — one stat call
//   3. Existing temp file (prior session) — one stat call, zero writes
//   4. Network fetch + single write — only on first-ever play of this cover art
// Concurrent calls for the same coverArtId share one Promise so only one fetch
// and one write ever happen at a time.
function resolveMprisArt(coverArtId, httpUrl) {
  const hit = mprisArtCacheGet(coverArtId);
  if (hit !== undefined) return Promise.resolve(hit);

  if (_mprisArtPending.has(coverArtId)) return _mprisArtPending.get(coverArtId);

  const promise = (async () => {
    // Offline cache registry
    try {
      const cacheDir = getCacheBasePath();
      const registryFile = path.join(cacheDir, 'registry.json');
      if (fs.existsSync(registryFile)) {
        const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
        const hash = registry.coverArtIdMap?.[coverArtId];
        const entry = hash && registry.coverArtFiles?.[hash];
        if (entry?.filePath) {
          const full = path.join(cacheDir, entry.filePath);
          if (fs.existsSync(full)) {
            const u = pathToFileUrl(full);
            mprisArtCacheSet(coverArtId, u);
            return u;
          }
        }
      }
    } catch { /* registry unreadable — continue */ }

    // Existing temp file (written in a previous session)
    const tmpPath = mprisArtTempPath(coverArtId);
    if (fs.existsSync(tmpPath)) {
      const u = pathToFileUrl(tmpPath);
      mprisArtCacheSet(coverArtId, u);
      return u;
    }

    // Network fetch — one write per unique cover art, ever
    if (!httpUrl) return null;
    return new Promise((resolve) => {
      try {
        const parsed = new URL(httpUrl);
        const transport = parsed.protocol === 'https:' ? https : http;
        const req = transport.get(httpUrl, { timeout: 8000 }, (res) => {
          if (res.statusCode !== 200) { res.resume(); return resolve(null); }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            try {
              fs.writeFileSync(tmpPath, Buffer.concat(chunks));
              const u = pathToFileUrl(tmpPath);
              mprisArtCacheSet(coverArtId, u);
              console.log('[MPRIS] Art written:', tmpPath);
              resolve(u);
            } catch (e) { console.warn('[MPRIS] Art write failed:', e.message); resolve(null); }
          });
          res.on('error', (e) => { console.warn('[MPRIS] Art response error:', e.message); resolve(null); });
        });
        req.on('error', (e) => { console.warn('[MPRIS] Art request error:', e.message); resolve(null); });
        req.on('timeout', () => { req.destroy(); resolve(null); });
      } catch (e) { console.warn('[MPRIS] Art fetch error:', e.message); resolve(null); }
    });
  })().finally(() => _mprisArtPending.delete(coverArtId));

  _mprisArtPending.set(coverArtId, promise);
  return promise;
}

ipcMain.handle('player-state-update', async (event, state) => {
  lastPlayerState = state;
  _updatePowerSave();
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.webContents.send('player-state-changed', state);
  }
  if (!mpris) return;

  const coverArtId = state.currentSong?.coverArt;
  if (!coverArtId) { mpris.updateMprisState({ ...state, coverArtUrl: null }); return; }

  // Hot path: LRU memory cache hit — zero I/O, synchronous
  const cached = mprisArtCacheGet(coverArtId);
  if (cached !== undefined) {
    mpris.updateMprisState({ ...state, coverArtUrl: cached });
    return;
  }

  // Push text metadata immediately; art will follow once resolved
  mpris.updateMprisState({ ...state, coverArtUrl: null });

  resolveMprisArt(coverArtId, state.coverArtUrl).then((fileUrl) => {
    if (fileUrl && mpris && lastPlayerState?.currentSong?.coverArt === coverArtId) {
      mpris.updateMprisState({ ...lastPlayerState, coverArtUrl: fileUrl });
    }
  });
});

ipcMain.handle('player-control', (event, action, data) => {
  // Forward control actions from mini player to main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('player-control-action', action, data);
  }
});

// ===== Offline Cache IPC Handlers =====

// Get cache directory path
ipcMain.handle('get-cache-dir', () => {
  const cacheDir = getCacheBasePath();
  // Ensure directory exists
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
    console.log('Created permanent_cache directory:', cacheDir);
  }
  return cacheDir;
});

// Get current cache location
ipcMain.handle('get-cache-location', () => {
  return getCacheBasePath();
});

// Set cache location
ipcMain.handle('set-cache-location', async (event, newPath) => {
  try {
    // Validate path exists or can be created
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }
    
    // Check if writable
    const testFile = path.join(newPath, '.write_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    
    // Save to settings
    return saveCacheBasePath(newPath);
  } catch (error) {
    console.error('Failed to set cache location:', error);
    return false;
  }
});

// Open directory picker for cache location
ipcMain.handle('pick-cache-location', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Cache Location',
    message: 'Choose where to store downloaded music',
    buttonLabel: 'Select Folder'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Get disk space for the volume that hosts the given path
ipcMain.handle('get-disk-space', (event, targetPath) => {
  return new Promise((resolve) => {
    if (typeof fs.statfs !== 'function') { resolve(null); return; }
    // Walk up to find an existing ancestor if the path doesn't exist yet
    let p = targetPath || getCacheBasePath();
    while (p && !fs.existsSync(p)) {
      const parent = path.dirname(p);
      if (parent === p) { resolve(null); return; }
      p = parent;
    }
    fs.statfs(p, (err, stats) => {
      if (err) { resolve(null); return; }
      resolve({
        available: stats.bavail * stats.bsize,
        total:     stats.blocks * stats.bsize,
      });
    });
  });
});

// Read cache index
ipcMain.handle('read-cache-index', () => {
  try {
    const cacheDir = getCacheBasePath();
    const indexFile = path.join(cacheDir, 'cache_index.json');
    
    if (fs.existsSync(indexFile)) {
      const data = fs.readFileSync(indexFile, 'utf8');
      console.log('Read cache index, length:', data.length);
      return data;
    }
    return null;
  } catch (error) {
    console.error('Failed to read cache index:', error);
    return null;
  }
});

// Write cache index
ipcMain.handle('write-cache-index', (event, indexData) => {
  try {
    const cacheDir = getCacheBasePath();
    const indexFile = path.join(cacheDir, 'cache_index.json');
    
    // Ensure directory exists
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    
    fs.writeFileSync(indexFile, indexData, 'utf8');
    console.log('Wrote cache index');
    return true;
  } catch (error) {
    console.error('Failed to write cache index:', error);
    return false;
  }
});

// Get full path to cached file
ipcMain.handle('get-cached-file-path', (event, relativePath) => {
  const cacheDir = getCacheBasePath();
  const fullPath = path.join(cacheDir, relativePath);
  const fileExists = fs.existsSync(fullPath);
  
  console.log('[IPC] get-cached-file-path:', {
    relativePath,
    fullPath,
    fileExists,
    cacheDir
  });
  
  if (!fileExists) {
    console.warn('[IPC] WARNING: File does not exist:', fullPath);
  }
  
  return fullPath;
});

// Read cached image as base64 data URL
ipcMain.handle('read-cached-image', (event, relativePath) => {
  try {
    const cacheDir = getCacheBasePath();
    const fullPath = path.join(cacheDir, relativePath);
    
    if (!fs.existsSync(fullPath)) {
      console.warn('[IPC] WARNING: Cached image does not exist:', fullPath);
      return null;
    }
    
    // Read file as binary buffer
    const buffer = fs.readFileSync(fullPath);
    
    // Determine MIME type from extension
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const mimeType = mimeTypes[ext] || 'image/jpeg';
    
    // Convert to base64 data URL
    const base64 = buffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;
    
    console.log('[IPC] Read cached image as data URL:', relativePath, '|', buffer.length, 'bytes');
    return dataUrl;
  } catch (error) {
    console.error('[IPC] ERROR: Failed to read cached image:', error);
    return null;
  }
});

// Delete cached file
ipcMain.handle('delete-cached-file', (event, relativePath) => {
  try {
    const cacheDir = getCacheBasePath();
    const fullPath = path.join(cacheDir, relativePath);
    
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      console.log('Deleted cached file:', relativePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to delete cached file:', error);
    return false;
  }
});

// Clear entire cache directory
ipcMain.handle('clear-cache-dir', () => {
  try {
    const cacheDir = getCacheBasePath();
    
    if (fs.existsSync(cacheDir)) {
      // Delete all files except cache_index.json (we'll clear it separately)
      const files = fs.readdirSync(cacheDir);
      files.forEach(file => {
        if (file !== 'cache_index.json') {
          const filePath = path.join(cacheDir, file);
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
        }
      });
      console.log('Cleared cache directory');
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to clear cache directory:', error);
    return false;
  }
});

// Download song to cache
ipcMain.handle('download-song-to-cache', async (event, { buffer, relativePath }) => {
  try {
    const cacheDir = getCacheBasePath();
    const fullPath = path.join(cacheDir, relativePath);
    const dir = path.dirname(fullPath);
    
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write file
    fs.writeFileSync(fullPath, Buffer.from(buffer));
    console.log('Downloaded song to cache:', relativePath);
    return { success: true, path: fullPath };
  } catch (error) {
    console.error('Failed to download song to cache:', error);
    throw error;
  }
});

// Get cache stats (for debugging/info display)
ipcMain.handle('get-cache-stats', () => {
  try {
    const cacheDir = getCacheBasePath();
    
    if (!fs.existsSync(cacheDir)) {
      return { totalSize: 0, fileCount: 0 };
    }
    
    let totalSize = 0;
    let fileCount = 0;
    
    const countFilesRecursive = (dir) => {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
          countFilesRecursive(filePath);
        } else {
          totalSize += stats.size;
          fileCount++;
        }
      });
    };
    
    countFilesRecursive(cacheDir);
    
    return { totalSize, fileCount };
  } catch (error) {
    console.error('Failed to get cache stats:', error);
    return { totalSize: 0, fileCount: 0 };
  }
});

// ===== Multi-User Cache IPC Handlers (v2.0) =====

// Get user-specific cache directory
ipcMain.handle('get-user-cache-dir', (event, userId) => {
  const baseDir = getCacheBasePath();
  const userDir = path.join(baseDir, 'users', userId);
  
  // Ensure directory exists
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
    console.log('Created user cache directory:', userDir);
  }
  return userDir;
});

// Get shared audio directory
ipcMain.handle('get-audio-dir', () => {
  const baseDir = getCacheBasePath();
  const audioDir = path.join(baseDir, 'audio');
  
  // Ensure directory exists
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
    console.log('Created audio directory:', audioDir);
  }
  return audioDir;
});

// Read user's cache index
ipcMain.handle('read-user-cache-index', (event, userId) => {
  try {
    const baseDir = getCacheBasePath();
    const indexFile = path.join(baseDir, 'users', userId, 'cache_index.json');
    
    if (fs.existsSync(indexFile)) {
      const data = fs.readFileSync(indexFile, 'utf8');
      console.log('Read user cache index for', userId, '- length:', data.length);
      return data;
    }
    return null;
  } catch (error) {
    console.error('Failed to read user cache index:', error);
    return null;
  }
});

// Write user's cache index
ipcMain.handle('write-user-cache-index', (event, userId, indexData) => {
  try {
    const baseDir = getCacheBasePath();
    const userDir = path.join(baseDir, 'users', userId);
    const indexFile = path.join(userDir, 'cache_index.json');
    
    // Ensure directory exists
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    
    fs.writeFileSync(indexFile, indexData, 'utf8');
    console.log('Wrote user cache index for', userId);
    return true;
  } catch (error) {
    console.error('Failed to write user cache index:', error);
    return false;
  }
});

// Read user metadata
ipcMain.handle('read-user-metadata', (event, userId) => {
  try {
    const baseDir = getCacheBasePath();
    const metadataFile = path.join(baseDir, 'users', userId, 'metadata.json');
    
    if (fs.existsSync(metadataFile)) {
      const data = fs.readFileSync(metadataFile, 'utf8');
      console.log('Read user metadata for', userId);
      return data;
    }
    return null;
  } catch (error) {
    console.error('Failed to read user metadata:', error);
    return null;
  }
});

// Write user metadata
ipcMain.handle('write-user-metadata', (event, userId, metadataData) => {
  try {
    const baseDir = getCacheBasePath();
    const userDir = path.join(baseDir, 'users', userId);
    const metadataFile = path.join(userDir, 'metadata.json');
    
    // Ensure directory exists
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }
    
    fs.writeFileSync(metadataFile, metadataData, 'utf8');
    console.log('Wrote user metadata for', userId);
    return true;
  } catch (error) {
    console.error('Failed to write user metadata:', error);
    return false;
  }
});

// Read audio file registry
ipcMain.handle('read-audio-registry', () => {
  try {
    const baseDir = getCacheBasePath();
    const registryFile = path.join(baseDir, 'registry.json');
    
    if (fs.existsSync(registryFile)) {
      const data = fs.readFileSync(registryFile, 'utf8');
      console.log('Read audio registry, length:', data.length);
      return data;
    }
    return null;
  } catch (error) {
    console.error('Failed to read audio registry:', error);
    return null;
  }
});

// Write audio file registry
ipcMain.handle('write-audio-registry', (event, registryData) => {
  try {
    const baseDir = getCacheBasePath();
    const registryFile = path.join(baseDir, 'registry.json');
    
    // Ensure base directory exists
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }
    
    fs.writeFileSync(registryFile, registryData, 'utf8');
    console.log('Wrote audio registry to:', registryFile);
    return true;
  } catch (error) {
    console.error('Failed to write audio registry:', error);
    return false;
  }
});

// Save audio file to hash-based path
ipcMain.handle('save-audio-file', async (event, { buffer, hash, extension }) => {
  try {
    const baseDir = getCacheBasePath();
    const audioDir = path.join(baseDir, 'audio', hash);
    const filePath = path.join(audioDir, `audio${extension}`);
    
    // Ensure directory exists
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    
    // Write file
    fs.writeFileSync(filePath, Buffer.from(buffer));
    console.log('Saved audio file:', hash, extension);
    return { success: true, path: `audio/${hash}/audio${extension}` };
  } catch (error) {
    console.error('Failed to save audio file:', error);
    throw error;
  }
});

// Save cover art to hash-based path
ipcMain.handle('save-cover-art-file', async (event, { buffer, hash, extension }) => {
  try {
    const baseDir = getCacheBasePath();
    const audioDir = path.join(baseDir, 'audio', hash);
    const filePath = path.join(audioDir, `cover${extension}`);
    
    // Ensure directory exists
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }
    
    // Write file
    fs.writeFileSync(filePath, Buffer.from(buffer));
    console.log('Saved cover art:', hash, extension);
    return { success: true, path: `audio/${hash}/cover${extension}` };
  } catch (error) {
    console.error('Failed to save cover art:', error);
    throw error;
  }
});

// Delete audio file directory (when refCount reaches 0)
ipcMain.handle('delete-audio-dir', (event, hash) => {
  try {
    const baseDir = getCacheBasePath();
    const audioDir = path.join(baseDir, 'audio', hash);
    
    if (fs.existsSync(audioDir)) {
      fs.rmSync(audioDir, { recursive: true, force: true });
      console.log('Deleted audio directory:', hash);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to delete audio directory:', error);
    return false;
  }
});

// Get audio file path (for hash-based lookup)
ipcMain.handle('get-audio-file-path', (event, hash, filename) => {
  const baseDir = getCacheBasePath();
  const filePath = path.join(baseDir, 'audio', hash, filename);
  const fileExists = fs.existsSync(filePath);
  
  console.log('[IPC] get-audio-file-path:', hash, filename, '- exists:', fileExists);
  
  if (fileExists) {
    return filePath;
  }
  return null;
});

// Extract embedded cover art from a cached audio file using music-metadata
ipcMain.handle('extract-embedded-art', async (event, audioHash) => {
  try {
    const mm = require('music-metadata');
    const baseDir = getCacheBasePath();
    const audioDir = path.join(baseDir, 'audio', audioHash);

    if (!fs.existsSync(audioDir)) return null;

    const files = fs.readdirSync(audioDir);
    const audioFile = files.find(f => /^audio\.(mp3|flac|ogg|opus|m4a|aac|wav|wma)$/i.test(f));
    if (!audioFile) return null;

    const audioPath = path.join(audioDir, audioFile);
    const metadata = await mm.parseFile(audioPath, { duration: false, skipCovers: false });

    const picture = metadata.common.picture?.[0];
    if (!picture) return null;

    const base64 = Buffer.from(picture.data).toString('base64');
    const mime = picture.format || 'image/jpeg';
    console.log('[IPC] Extracted embedded art from:', audioHash, '|', picture.data.length, 'bytes');
    return `data:${mime};base64,${base64}`;
  } catch (error) {
    console.error('[IPC] Failed to extract embedded art:', error);
    return null;
  }
});

// Find sibling art files (album.jpg, cover.jpg, folder.jpg) in an audio hash directory
ipcMain.handle('find-sibling-art', (event, audioHash) => {
  try {
    const baseDir = getCacheBasePath();
    const audioDir = path.join(baseDir, 'audio', audioHash);

    if (!fs.existsSync(audioDir)) return null;

    const candidates = ['album.jpg', 'album.jpeg', 'cover.jpg', 'cover.jpeg', 'folder.jpg', 'folder.jpeg', 'front.jpg', 'front.jpeg'];
    for (const name of candidates) {
      const filePath = path.join(audioDir, name);
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        const ext = path.extname(name).toLowerCase();
        const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
        console.log('[IPC] Found sibling art:', name, 'for hash:', audioHash);
        return `data:${mime};base64,${buffer.toString('base64')}`;
      }
    }
    return null;
  } catch (error) {
    console.error('[IPC] Failed to find sibling art:', error);
    return null;
  }
});

// Convert an absolute filesystem path to a file:// URL (cross-platform)
function pathToFileUrl(absPath) {
  const norm = absPath.replace(/\\/g, '/');
  return 'file://' + (norm.startsWith('/') ? '' : '/') + norm;
}

// Return a file:// URL for a cached cover art image given its Subsonic coverArtId.
// Reads the shared registry to resolve coverArtId → hash → file path.
ipcMain.handle('get-cached-cover-art-url', (event, coverArtId) => {
  try {
    const cacheDir = getCacheBasePath();
    const registryFile = path.join(cacheDir, 'registry.json');
    if (!fs.existsSync(registryFile)) return null;

    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    const coverArtHash = registry.coverArtIdMap?.[coverArtId];
    if (!coverArtHash) return null;

    const coverArtEntry = registry.coverArtFiles?.[coverArtHash];
    if (!coverArtEntry?.filePath) return null;

    // filePath is stored relative to cacheDir, e.g. "audio/{hash}/cover.jpg"
    const fullPath = path.join(cacheDir, coverArtEntry.filePath);
    if (!fs.existsSync(fullPath)) return null;

    return pathToFileUrl(fullPath);
  } catch (err) {
    console.error('[IPC] get-cached-cover-art-url failed:', err);
    return null;
  }
});

// Return a file:// URL for the first sibling image found next to a cached audio file.
// This is faster than find-sibling-art because it avoids reading the file into memory.
ipcMain.handle('find-sibling-art-url', (event, audioHash) => {
  try {
    const cacheDir = getCacheBasePath();
    const audioDir = path.join(cacheDir, 'audio', audioHash);
    if (!fs.existsSync(audioDir)) return null;

    const candidates = ['cover.jpg', 'cover.jpeg', 'cover.png', 'album.jpg', 'album.jpeg', 'folder.jpg', 'front.jpg'];
    for (const name of candidates) {
      const filePath = path.join(audioDir, name);
      if (fs.existsSync(filePath)) return pathToFileUrl(filePath);
    }
    return null;
  } catch (err) {
    console.error('[IPC] find-sibling-art-url failed:', err);
    return null;
  }
});

// Migration utility: Copy file from old path to new hash-based path
ipcMain.handle('migrate-file-to-hash-storage', async (event, { oldPath, hash, filename }) => {
  try {
    const baseDir = getCacheBasePath();
    const oldFilePath = path.join(baseDir, oldPath);
    const newAudioDir = path.join(baseDir, 'audio', hash);
    const newFilePath = path.join(newAudioDir, filename);
    
    // Check if old file exists
    if (!fs.existsSync(oldFilePath)) {
      console.warn('Old file not found for migration:', oldFilePath);
      return { success: false, error: 'File not found' };
    }
    
    // Create new directory
    if (!fs.existsSync(newAudioDir)) {
      fs.mkdirSync(newAudioDir, { recursive: true });
    }
    
    // Copy file to new location
    fs.copyFileSync(oldFilePath, newFilePath);
    console.log('Migrated file:', oldPath, '→', `audio/${hash}/${filename}`);
    
    return { success: true, newPath: `audio/${hash}/${filename}` };
  } catch (error) {
    console.error('Failed to migrate file:', error);
    return { success: false, error: error.message };
  }
});

// Save cover art bytes to a temp file and return its file:// URL.
// navigator.mediaSession artwork must point to a file:// or http:// URL because
// Chromium's MPRIS/SMTC artwork downloader runs in the browser process and
// cannot reach renderer-local blob: URLs via SimpleURLLoader.
ipcMain.handle('save-art-to-temp', (event, { buffer, mimeType }) => {
    try {
        const ext = (mimeType || '').includes('png') ? 'png' : 'jpg';
        const tmpFile = path.join(os.tmpdir(), `xylonic_cover_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpFile, Buffer.from(buffer));
        return pathToFileUrl(tmpFile);
    } catch (err) {
        console.error('[IPC] save-art-to-temp failed:', err);
        return null;
    }
});

// ── Power Saver: lower/restore scheduling priority of every app process ────────
// On Unix, a process can increase its own nice value (lower priority) freely,
// but restoring a lower nice value requires the process to have been the one
// that raised it, or to have CAP_SYS_NICE. We set main + renderer PIDs and
// swallow errors gracefully — on Windows this is fully reversible.
// Helper: collect all app process PIDs (main + renderers + GPU etc.)
function _allAppPids() {
    const pids = new Set([process.pid]);
    try { app.getAppMetrics().forEach(m => { if (m.pid) pids.add(m.pid); }); } catch {}
    return [...pids];
}

ipcMain.handle('set-power-saver-priority', () => {
    const pids = _allAppPids();
    const totalCores   = os.cpus().length;
    const allowedCores = Math.max(1, Math.floor(totalCores / 2));

    // Lower scheduling priority
    const target = os.constants.priority.PRIORITY_BELOW_NORMAL;
    pids.forEach(pid => { try { os.setPriority(pid, target); } catch {} });

    // Limit CPU affinity to the first half of logical cores
    if (process.platform === 'linux') {
        // taskset is part of util-linux, available on virtually all Linux distros
        pids.forEach(pid => {
            execFile('taskset', ['-cp', `0-${allowedCores - 1}`, String(pid)], () => {});
        });
    } else if (process.platform === 'win32') {
        // Affinity mask: bit N = core N allowed; use Math.pow to handle >30 cores
        const mask = Math.round(Math.pow(2, allowedCores)) - 1;
        pids.forEach(pid => {
            execFile('powershell', [
                '-Command',
                `try { (Get-Process -Id ${pid}).ProcessorAffinity = ${mask} } catch {}`,
            ], () => {});
        });
    }
    // macOS: no user-space affinity API; priority reduction above is the best we can do
});

// Normal mode: all cores + normal priority (let OS schedule naturally)
ipcMain.handle('restore-process-priority', () => {
    const pids = _allAppPids();
    const totalCores = os.cpus().length;

    const normal = os.constants.priority.PRIORITY_NORMAL;
    pids.forEach(pid => { try { os.setPriority(pid, normal); } catch {} });

    if (process.platform === 'linux') {
        pids.forEach(pid => {
            execFile('taskset', ['-cp', `0-${totalCores - 1}`, String(pid)], () => {});
        });
    } else if (process.platform === 'win32') {
        const fullMask = Math.round(Math.pow(2, totalCores)) - 1;
        pids.forEach(pid => {
            execFile('powershell', [
                '-Command',
                `try { (Get-Process -Id ${pid}).ProcessorAffinity = ${fullMask} } catch {}`,
            ], () => {});
        });
    }
});

// Performance mode: all cores + normal priority
ipcMain.handle('set-performance-priority', () => {
    const pids = _allAppPids();
    const totalCores = os.cpus().length;

    const normal = os.constants.priority.PRIORITY_NORMAL;
    pids.forEach(pid => { try { os.setPriority(pid, normal); } catch {} });

    if (process.platform === 'linux') {
        pids.forEach(pid => {
            execFile('taskset', ['-cp', `0-${totalCores - 1}`, String(pid)], () => {});
        });
    } else if (process.platform === 'win32') {
        const fullMask = Math.round(Math.pow(2, totalCores)) - 1;
        pids.forEach(pid => {
            execFile('powershell', [
                '-Command',
                `try { (Get-Process -Id ${pid}).ProcessorAffinity = ${fullMask} } catch {}`,
            ], () => {});
        });
    }
});

// Short display labels for Electron process types.
const _PROC_LABEL = {
    'Browser':  'MAIN',
    'Tab':      'RNDR',
    'Renderer': 'RNDR',
    'GPU':      'GPU',
    'Utility':  'UTIL',
    'Crashpad': 'CRSH',
};

ipcMain.handle('get-system-stats', () => {
    try {
        const metrics = app.getAppMetrics();

        // Total app CPU: sum all Electron sub-processes (percentCPUUsage can
        // exceed 100 on multi-core machines — cap the displayed sum at 100).
        const totalCpu = metrics.reduce((sum, m) => sum + (m.cpu?.percentCPUUsage ?? 0), 0);

        // Per-process-type CPU breakdown — app-specific, not system-wide.
        // Multiple processes of the same type (e.g. two RNDR windows) are merged.
        const byType = {};
        for (const m of metrics) {
            const label = _PROC_LABEL[m.type] ?? m.type.slice(0, 4).toUpperCase();
            byType[label] = (byType[label] ?? 0) + (m.cpu?.percentCPUUsage ?? 0);
        }
        const processBreakdown = Object.entries(byType)
            .map(([label, pct]) => ({ label, pct: Math.round(pct) }))
            .filter(e => e.pct > 0)
            .sort((a, b) => b.pct - a.pct);

        // Sum working-set KB across every Electron process (renderer + GPU + etc.)
        const appMemKb = metrics.reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0);

        return {
            cpuPercent:      Math.min(100, Math.round(totalCpu)),
            cores:           os.cpus().length,
            appMemBytes:     appMemKb * 1024,
            totalRamBytes:   os.totalmem(),
            freeRamBytes:    os.freemem(),
            processBreakdown,
        };
    } catch {
        return null;
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});