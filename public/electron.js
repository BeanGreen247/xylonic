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
const { registerCredentialsIpc } = require('./ipc/credentials');
const { registerSystemIpc } = require('./ipc/system');
const { registerMiscIpc } = require('./ipc/misc');
const { registerDownloadNotificationIpc } = require('./ipc/downloadNotification');
const { registerCacheIpc, pathToFileUrl } = require('./ipc/cache');
const { registerPlayerWindowIpc } = require('./ipc/playerWindow');

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

// Small one-off IPC (extracted to ./ipc/misc.js)
registerMiscIpc({ ipcMain, app });

// Download progress surface — dock/taskbar bar, tray, dock badge (./ipc/downloadNotification.js)
registerDownloadNotificationIpc({
  ipcMain, app, Tray, nativeImage,
  getMainWindow: () => mainWindow,
  onDownloadActiveChange: (v) => { _activeDownloads = v; _updatePowerSave(); },
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

// Secure credential storage (extracted to ./ipc/credentials.js)
registerCredentialsIpc({ ipcMain, safeStorage });

// Mini-player + player-state + MPRIS-art IPC (extracted to ./ipc/playerWindow.js)
registerPlayerWindowIpc({
  ipcMain, mpris, pathToFileUrl,
  getMainWindow: () => mainWindow,
  getMiniPlayerWindow: () => miniPlayerWindow,
  createMiniPlayer,
  getLastPlayerState: () => lastPlayerState,
  setLastPlayerState: (s) => { lastPlayerState = s; },
  onPlayerStateChange: _updatePowerSave,
  getCacheBasePath,
});


// Offline cache filesystem IPC (extracted to ./ipc/cache.js)
registerCacheIpc({
  ipcMain, dialog,
  getMainWindow: () => mainWindow,
  getCacheBasePath, saveCacheBasePath,
});

// Priority / affinity / system stats (extracted to ./ipc/system.js)
registerSystemIpc({ ipcMain, app, execFile });


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