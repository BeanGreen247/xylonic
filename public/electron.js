const { app, BrowserWindow, ipcMain, protocol, Menu, shell, dialog, safeStorage, session, nativeImage, net, powerSaveBlocker } = require('electron');
const { execFile } = require('child_process');
const https = require('https');
const http = require('http');
const path = require('path');
const url = require('url');
const os = require('os');
const fs = require('fs'); // Use sync fs, not promises
const isDev = require('electron-is-dev');

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

// Logging setup - write to userData directory (disabled by default)
let loggingEnabled = false; // Disabled by default
const getLogFilePath = () => path.join(app.getPath('userData'), 'app.log');
const maxLogSize = 5 * 1024 * 1024; // 5MB max log file size

// Save original console methods BEFORE overriding
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

// Check logging preference from settings file
function checkLoggingPreference() {
  try {
    const settingsFile = getSettingsFilePath();
    if (fs.existsSync(settingsFile)) {
      const content = fs.readFileSync(settingsFile, 'utf8');
      const match = content.match(/^logging_enabled=(true|false)$/m);
      if (match) {
        loggingEnabled = match[1] === 'true';
        originalConsoleLog('Logging', loggingEnabled ? 'enabled' : 'disabled');
        return;
      }
    }
  } catch (error) {
    // Silently fail, keep logging disabled
  }
  loggingEnabled = false; // Default to disabled
}

// Initialize log file
function initializeLogFile() {
  if (!loggingEnabled) return;
  
  try {
    const logFile = getLogFilePath();
    const logDir = path.dirname(logFile);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Rotate log file if it's too large
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size > maxLogSize) {
        const backupFile = logFile.replace('.log', '.old.log');
        if (fs.existsSync(backupFile)) {
          fs.unlinkSync(backupFile); // Delete old backup
        }
        fs.renameSync(logFile, backupFile);
        originalConsoleLog('Rotated log file to:', backupFile);
      }
    }
    
    // Write startup message
    writeLog('='.repeat(80));
    writeLog(`Xylonic v${version}${_buildSuffix} starting on ${new Date().toISOString()}`);
    writeLog(`Mode: ${isDev ? 'DEVELOPMENT' : 'PRODUCTION'}`);
    writeLog(`Log file: ${logFile}`);
    writeLog(`User data: ${app.getPath('userData')}`);
    writeLog('='.repeat(80));
  } catch (error) {
    originalConsoleError('Failed to initialize log file:', error);
  }
}

// Write to log file
function writeLog(message, level = 'INFO') {
  if (!loggingEnabled) return;
  
  try {
    const logFile = getLogFilePath();
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}\n`;
    
    // Append to log file
    fs.appendFileSync(logFile, logLine, 'utf8');
    
    // Also output to console using ORIGINAL methods (not overridden ones)
    if (level === 'ERROR') {
      originalConsoleError(logLine.trim());
    } else if (level === 'WARN') {
      originalConsoleWarn(logLine.trim());
    } else {
      originalConsoleLog(logLine.trim());
    }
  } catch (error) {
    originalConsoleError('Failed to write to log file:', error);
  }
}

// Override console methods to write to file (only if logging enabled)
console.log = (...args) => {
  if (!loggingEnabled) return;
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  writeLog(message, 'INFO');
};

console.error = (...args) => {
  if (!loggingEnabled) return;
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  writeLog(message, 'ERROR');
};

console.warn = (...args) => {
  if (!loggingEnabled) return;
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  writeLog(message, 'WARN');
};

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

// Color config file path - per user in color_settings folder
const getColorConfigPath = (username) => {
  if (!username) return null;
  return path.join(getSettingsDir(), `colors_${username}.cfg`);
};

// Ensure settings file exists - ONLY CREATE IF MISSING, NEVER MODIFY EXISTING
function ensureSettingsFile() {
  try {
    const settingsFile = getSettingsFilePath();
    const settingsDir = path.dirname(settingsFile);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
      console.log('Created settings directory:', settingsDir);
    }
    
    // ONLY create file if it doesn't exist - NEVER touch existing files
    if (!fs.existsSync(settingsFile)) {
      // Create empty CFG file with header comment
      const emptyCfg = '# Xylonic Settings File\n# Generated automatically - edit with care\n\n';
      fs.writeFileSync(settingsFile, emptyCfg, 'utf8');
      console.log('Created new settings file:', settingsFile);
    } else {
      console.log('Settings file already exists (not modifying):', settingsFile);
    }
  } catch (error) {
    console.error('Failed to ensure settings file:', error);
  }
}

// Ensure color_settings directory exists
function ensureSettingsDir() {
  try {
    const settingsDir = getSettingsDir();
    if (!fs.existsSync(settingsDir)) {
      fs.mkdirSync(settingsDir, { recursive: true });
      console.log('Created color_settings directory:', settingsDir);
    } else {
      console.log('color_settings directory exists:', settingsDir);
    }
  } catch (error) {
    console.error('Failed to create color_settings directory:', error);
  }
}

// Ensure color config exists for user
function ensureColorConfig(username) {
  if (!username) return;
  
  try {
    ensureSettingsDir(); // Make sure parent directory exists
    
    const colorFile = getColorConfigPath(username);
    if (!colorFile) return;
    
    // Only create if missing
    if (!fs.existsSync(colorFile)) {
      const emptyCfg = `# Xylonic Color Config for ${username}\n# Generated automatically - edit with care\n\n`;
      fs.writeFileSync(colorFile, emptyCfg, 'utf8');
      console.log(`Created color config: color_settings/colors_${username}.cfg`);
    }
  } catch (error) {
    console.error(`Failed to ensure color config for ${username}:`, error);
  }
}

// Initialize color_settings directory on app start
ensureSettingsDir();

// Initialize settings file on app start
ensureSettingsFile();

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
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
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


// ── Remote Discovery ─────────────────────────────────────────────────────────
const dgram   = require('dgram');
const crypto  = require('crypto');
const REMOTE_BROADCAST_PORT = 7766;
const REMOTE_CMD_PORT       = 7767;
const REMOTE_MULTICAST_ADDR = '239.255.85.89';

let _remoteDeviceId        = null;
let _remoteBroadcastSock   = null;
let _remoteBroadcastTimer  = null;
let _remoteListenerSock    = null;
let _remoteCommandServer   = null;
let _remotePairedController = null; // device ID of the controller that has locked this device
let _remoteControllingId   = null;  // device ID this device is currently controlling (as controller)
let _remoteControlEnabled  = true;  // synced from renderer localStorage on startup
let _remoteAccountId       = '';    // md5(username:serverUrl) — empty string means not set
const _remoteDevices       = new Map(); // id -> { id, name, host, cmdPort, platform, pairedWith, lastSeen }

function _getRemoteDeviceId() {
    if (_remoteDeviceId) return _remoteDeviceId;
    const idFile = path.join(app.getPath('userData'), 'device_id.txt');
    try {
        if (fs.existsSync(idFile)) {
            _remoteDeviceId = fs.readFileSync(idFile, 'utf8').trim();
        } else {
            _remoteDeviceId = (crypto.randomUUID ? crypto.randomUUID() :
                crypto.randomBytes(16).toString('hex'));
            fs.writeFileSync(idFile, _remoteDeviceId, 'utf8');
        }
    } catch { _remoteDeviceId = 'electron-' + Date.now(); }
    return _remoteDeviceId;
}

function _getRemoteDeviceName() {
    const osType = process.platform === 'win32' ? 'Windows'
                 : process.platform === 'linux'  ? 'Linux'
                 : process.platform === 'darwin' ? 'macOS'
                 : process.platform;
    return os.hostname() + ',' + osType;
}

function _getLocalIp() {
    const ifaces = os.networkInterfaces();
    // Skip virtual/tunnel interface name prefixes — these are never reachable from LAN peers.
    const VIRTUAL_PREFIXES = ['docker', 'veth', 'br-', 'vmnet', 'virbr', 'tun', 'tap', 'vpn', 'wsl', 'lo'];
    const isVirtual = (name) => VIRTUAL_PREFIXES.some(p => name.toLowerCase().startsWith(p));
    // Private LAN ranges that a phone on the same WiFi router can actually reach.
    const isLanIp = (addr) =>
        /^192\.168\./.test(addr) ||
        /^10\./.test(addr) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(addr);

    // First pass: prefer a LAN IP on a non-virtual interface.
    for (const name of Object.keys(ifaces)) {
        if (isVirtual(name)) continue;
        for (const iface of (ifaces[name] || [])) {
            if (iface.family === 'IPv4' && !iface.internal && isLanIp(iface.address))
                return iface.address;
        }
    }
    // Second pass: any non-virtual, non-loopback IPv4.
    for (const name of Object.keys(ifaces)) {
        if (isVirtual(name)) continue;
        for (const iface of (ifaces[name] || [])) {
            if (iface.family === 'IPv4' && !iface.internal) return iface.address;
        }
    }
    // Last resort.
    return '127.0.0.1';
}

/** Compute directed broadcast addresses for all active IPv4 interfaces. */
function _getBroadcastAddresses() {
    const results = new Set(['255.255.255.255']);
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of (ifaces[name] || [])) {
            if (iface.family !== 'IPv4' || iface.internal) continue;
            try {
                const ip      = iface.address.split('.').map(Number);
                const mask    = iface.netmask.split('.').map(Number);
                const bcast   = ip.map((b, i) => (b & mask[i]) | (~mask[i] & 0xff));
                results.add(bcast.join('.'));
            } catch {}
        }
    }
    return Array.from(results);
}

function _stopRemoteBroadcast() {
    if (_remoteBroadcastTimer) { clearInterval(_remoteBroadcastTimer); _remoteBroadcastTimer = null; }
    if (_remoteBroadcastSock) { try { _remoteBroadcastSock.close(); } catch {} _remoteBroadcastSock = null; }
}

function _startRemoteBroadcast() {
    if (_remoteBroadcastSock) return;
    if (!_remoteControlEnabled) return;
    try {
        _remoteBroadcastSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        _remoteBroadcastSock.bind(0, () => {
            try { _remoteBroadcastSock.setBroadcast(true); } catch {}
            const send = () => {
                const ps = lastPlayerState;
                const now = Date.now();
                const packet = {
                    type:       'XYLONIC_PRESENCE',
                    id:         _getRemoteDeviceId(),
                    name:       _getRemoteDeviceName(),
                    host:       _getLocalIp(),
                    cmdPort:    REMOTE_CMD_PORT,
                    platform:   'electron',
                    pairedWith:    _remotePairedController || null,
                    controllingId: _remoteControllingId   || null,
                    accountId:     _remoteAccountId       || null,
                    ts:            now,
                };
                if (ps) {
                    packet.playerState = {
                        isPlaying:   !!(ps.isPlaying && !ps.isLoading),
                        currentTime: ps.currentTime || 0,
                        duration:    ps.duration    || 0,
                        song: ps.currentSong ? {
                            id:       ps.currentSong.id,
                            title:    ps.currentSong.title,
                            artist:   ps.currentSong.artist,
                            album:    ps.currentSong.album    || '',
                            coverArt: ps.currentSong.coverArt || '',
                            duration: ps.currentSong.duration || 0,
                        } : null,
                    };
                }
                const payload = Buffer.from(JSON.stringify(packet), 'utf8');
                for (const addr of _getBroadcastAddresses()) {
                    try { _remoteBroadcastSock.send(payload, REMOTE_BROADCAST_PORT, addr); } catch {}
                }
                // Also send to our dedicated multicast group for Android 12+ discovery
                try { _remoteBroadcastSock.send(payload, REMOTE_BROADCAST_PORT, REMOTE_MULTICAST_ADDR); } catch {}
            };
            send();
            _remoteBroadcastTimer = setInterval(send, 1000);
        });
        _remoteBroadcastSock.on('error', () => {});
    } catch {}
}

function _startRemoteListener() {
    if (_remoteListenerSock) return;
    try {
        _remoteListenerSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        _remoteListenerSock.on('message', (buf) => {
            try {
                const pkt = JSON.parse(buf.toString('utf8'));
                if (pkt.type !== 'XYLONIC_PRESENCE') return;
                const { id, name, host, cmdPort, platform, pairedWith, controllingId, accountId } = pkt;
                if (id === _getRemoteDeviceId()) return;

                const isNew    = !_remoteDevices.has(id);
                const prev     = _remoteDevices.get(id);
                const nowPaired      = pairedWith    || null;
                const nowControlling = controllingId || null;
                const nowAccountId   = accountId     || null;
                const nowEntry = { id, name, host, cmdPort, platform, pairedWith: nowPaired, controllingId: nowControlling, accountId: nowAccountId, lastSeen: Date.now() };
                _remoteDevices.set(id, nowEntry);

                if (isNew && mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('remote-device-found', { id, name, host, cmdPort, platform, pairedWith: nowPaired, controllingId: nowControlling, accountId: nowAccountId });
                } else if (!isNew && prev && mainWindow && !mainWindow.isDestroyed()) {
                    const pairedChanged      = prev.pairedWith    !== nowPaired;
                    const controllingChanged = prev.controllingId !== nowControlling;
                    if (pairedChanged || controllingChanged) {
                        mainWindow.webContents.send('remote-device-pairing-changed', { id, pairedWith: nowPaired, controllingId: nowControlling, accountId: nowAccountId });
                    }
                }

                // Forward live player state to the renderer when this packet is from
                // the device this Electron instance is currently controlling.
                if (_remoteControllingId && id === _remoteControllingId &&
                    mainWindow && !mainWindow.isDestroyed()) {
                    const ps = pkt.playerState || {};
                    mainWindow.webContents.send('remote-player-state-update', {
                        id,
                        isPlaying:   ps.isPlaying   || false,
                        currentTime: ps.currentTime || 0,
                        duration:    ps.duration    || (ps.song && ps.song.duration) || 0,
                        stateTs:     pkt.ts         || Date.now(),
                        song:        ps.song        || null,
                    });
                }
            } catch {}
        });
        _remoteListenerSock.on('error', () => {});
        _remoteListenerSock.bind(REMOTE_BROADCAST_PORT, () => {
            try { _remoteListenerSock.setBroadcast(true); } catch {}
            // Join multicast on every active non-loopback IPv4 interface so we
            // receive packets from Android, which sends to the multicast group only
            // (255.255.255.255 broadcast is restricted on modern Android).
            // A single addMembership() with no interface binds to the default route
            // interface only and silently misses WiFi packets when another interface
            // (Ethernet, VPN) is the default.
            const ifaces = os.networkInterfaces();
            for (const name of Object.keys(ifaces)) {
                for (const iface of (ifaces[name] || [])) {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        try { _remoteListenerSock.addMembership(REMOTE_MULTICAST_ADDR, iface.address); } catch {}
                    }
                }
            }
        });

        // Stale device cleanup — also auto-unpairts if the paired controller disappears
        setInterval(() => {
            const now = Date.now();
            for (const [id, dev] of _remoteDevices.entries()) {
                if (now - dev.lastSeen > 15000) {
                    _remoteDevices.delete(id);
                    if (id === _remotePairedController) {
                        _remotePairedController = null;
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('remote-pairing-cleared', {});
                        }
                    }
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('remote-device-lost', { id });
                    }
                }
            }
        }, 5000);
    } catch {}
}

function _startRemoteCommandServer() {
    if (_remoteCommandServer) return;
    try {
        _remoteCommandServer = http.createServer((req, res) => {
            if (req.method !== 'POST' || req.url !== '/cmd') {
                res.writeHead(404); res.end(); return;
            }
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
                const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
                try {
                    const { action, data, controllerId } = JSON.parse(body);

                    if (action === 'pair') {
                        if (!_remoteControlEnabled) {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"remote_control_disabled"}'); return;
                        }
                        if (!controllerId) {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"missing_id"}'); return;
                        }
                        // Reject if both sides have a non-empty accountId that differs
                        const controllerAccountId = (data || {}).controllerAccountId || '';
                        if (_remoteAccountId && controllerAccountId && _remoteAccountId !== controllerAccountId) {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"account_mismatch"}'); return;
                        }
                        // Reject only if currently paired with a DIFFERENT controller that is
                        // still visible on the network. If the old controller has gone offline
                        // (dropped from _remoteDevices by the stale-cleanup timer), allow the
                        // new device to take over — this prevents phantom locks after switching
                        // between controller devices.
                        if (_remotePairedController &&
                            _remotePairedController !== controllerId &&
                            _remoteDevices.has(_remotePairedController)) {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"already_paired"}'); return;
                        }
                        _remotePairedController = controllerId;
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('remote-pairing-established', { controllerId, controllerName: (data || {}).controllerName || '' });
                        }
                        res.writeHead(200, headers);
                        res.end('{"ok":true}'); return;
                    }

                    if (action === 'disconnect') {
                        if (controllerId && controllerId === _remotePairedController) {
                            _remotePairedController = null;
                            if (mainWindow && !mainWindow.isDestroyed()) {
                                mainWindow.webContents.send('remote-pairing-cleared', {});
                            }
                            res.writeHead(200, headers);
                            res.end('{"ok":true}');
                        } else {
                            res.writeHead(200, headers);
                            res.end('{"ok":false,"reason":"not_paired"}');
                        }
                        return;
                    }

                    // All other commands — require matching controller
                    if (_remotePairedController && _remotePairedController !== controllerId) {
                        res.writeHead(200, headers);
                        res.end('{"ok":false,"reason":"not_paired"}'); return;
                    }

                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('remote-command', { action, data: data || {} });
                    }
                    res.writeHead(200, headers);
                    res.end('{"ok":true}');
                } catch {
                    res.writeHead(400, headers);
                    res.end('{"ok":false,"reason":"parse_error"}');
                }
            });
        });
        _remoteCommandServer.listen(REMOTE_CMD_PORT, '0.0.0.0');
        _remoteCommandServer.on('error', () => {});
    } catch {}
}

ipcMain.handle('remote-get-devices', () => Array.from(_remoteDevices.values()));
ipcMain.handle('remote-get-device-id', () => _getRemoteDeviceId());
ipcMain.handle('remote-get-device-name', () => _getRemoteDeviceName());
ipcMain.handle('remote-get-control-enabled', () => _remoteControlEnabled);
ipcMain.handle('remote-set-control-enabled', (event, enabled) => {
    _remoteControlEnabled = !!enabled;
    if (_remoteControlEnabled) {
        _startRemoteBroadcast();
    } else {
        _stopRemoteBroadcast();
        // Drop any active pairing so the next controller can connect after re-enabling
        if (_remotePairedController) {
            _remotePairedController = null;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('remote-pairing-cleared', {});
            }
        }
    }
});
ipcMain.handle('remote-set-account-id', (_event, id) => { _remoteAccountId = id || ''; });
ipcMain.handle('remote-set-controller-target', (event, id) => {
    _remoteControllingId = id || null;
});
// Outgoing HTTP command — Electron can now act as a controller as well as a target.
ipcMain.handle('remote-send-command', (_event, { host, port, action, data, controllerId }) => {
    return new Promise((resolve) => {
        // Android's handleCommand calls getJSONObject("data") — it expects an object,
        // not a string. The renderer passes data as JSON.stringify(obj), so parse it
        // back to an object here before encoding the request body.
        let dataObj;
        try { dataObj = typeof data === 'string' ? JSON.parse(data) : (data || {}); } catch { dataObj = {}; }
        const body = JSON.stringify({ action, data: dataObj, controllerId });
        const req = http.request(
            { hostname: host, port, path: '/cmd', method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
            (res) => {
                let raw = '';
                res.on('data', chunk => { raw += chunk; });
                res.on('end', () => {
                    try { resolve(JSON.parse(raw)); }
                    catch { resolve({ ok: false, reason: 'parse_error' }); }
                });
            },
        );
        req.on('error', () => resolve({ ok: false, reason: 'network_error' }));
        req.setTimeout(5000, () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
        req.write(body);
        req.end();
    });
});

// OS platform (for firewall setup UI)
ipcMain.handle('get-os-platform', () => process.platform);

// Background download keep-alive
ipcMain.handle('set-download-active', (_event, active) => {
    _activeDownloads = !!active;
    _updatePowerSave();
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
    ensureSettingsDir();
    ensureSettingsFile();
    
    // Check logging preference and initialize if enabled
    checkLoggingPreference();
    initializeLogFile();
    
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
    _startRemoteBroadcast();
    _startRemoteListener();
    _startRemoteCommandServer();

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

// Handle logging from renderer process
ipcMain.handle('write-log', async (event, { message, level }) => {
    writeLog(message, level || 'INFO');
});

// Get log file path for renderer
ipcMain.handle('get-log-path', () => {
    return getLogFilePath();
});

// Get logging enabled status
ipcMain.handle('get-logging-enabled', () => {
    return loggingEnabled;
});

// Set logging enabled status
ipcMain.handle('set-logging-enabled', (event, enabled) => {
    loggingEnabled = enabled;
    
    // Save to settings file
    try {
        const settingsFile = getSettingsFilePath();
        let content = '';
        
        if (fs.existsSync(settingsFile)) {
            content = fs.readFileSync(settingsFile, 'utf8');
        } else {
            content = '# Xylonic Settings File\n# Generated automatically - edit with care\n\n';
        }
        
        // Update or add logging_enabled
        if (content.includes('logging_enabled=')) {
            content = content.replace(/^logging_enabled=(true|false)$/m, `logging_enabled=${enabled}`);
        } else {
            content += `\nlogging_enabled=${enabled}\n`;
        }
        
        fs.writeFileSync(settingsFile, content, 'utf8');
        
        // Initialize or close logging
        if (enabled) {
            initializeLogFile();
        }
        
        return true;
    } catch (error) {
        originalConsoleError('Failed to save logging preference:', error);
        return false;
    }
});

// Open log folder in file manager
ipcMain.handle('open-log-folder', async () => {
    try {
        const logPath = getLogFilePath();
        shell.showItemInFolder(logPath);
        return true;
    } catch (error) {
        originalConsoleError('Failed to open log folder:', error);
        return false;
    }
});

// IPC Handlers for settings
ipcMain.handle('get-settings-path', () => {
  return getSettingsFilePath();
});

ipcMain.handle('read-settings', () => {
  try {
    const settingsFile = getSettingsFilePath();
    if (fs.existsSync(settingsFile)) {
      const data = fs.readFileSync(settingsFile, 'utf8');
      console.log('Read settings file, length:', data.length);
      return data; // Return raw CFG string, not parsed JSON
    }
    return ''; // Return empty string instead of {}
  } catch (error) {
    console.error('Failed to read settings:', error);
    return '';
  }
});

ipcMain.handle('write-settings', (event, settingsContent) => {
  try {
    const settingsFile = getSettingsFilePath();
    fs.writeFileSync(settingsFile, settingsContent, 'utf8');
    console.log('Wrote settings file');
    return true;
  } catch (error) {
    console.error('Failed to write settings:', error);
    return false;
  }
});

// IPC Handlers for color configs
ipcMain.handle('get-color-config-path', (event, username) => {
  return getColorConfigPath(username);
});

ipcMain.handle('read-color-config', (event, username) => {
  try {
    const colorFile = getColorConfigPath(username);
    if (!colorFile) return '';
    
    ensureColorConfig(username); // Create if missing
    
    if (fs.existsSync(colorFile)) {
      const data = fs.readFileSync(colorFile, 'utf8');
      console.log(`Read color config for ${username}, length:`, data.length);
      return data;
    }
    return '';
  } catch (error) {
    console.error(`Failed to read color config for ${username}:`, error);
    return '';
  }
});

ipcMain.handle('write-color-config', (event, username, configContent) => {
  try {
    const colorFile = getColorConfigPath(username);
    if (!colorFile) return false;
    
    fs.writeFileSync(colorFile, configContent, 'utf8');
    console.log(`Wrote color config for ${username}`);
    return true;
  } catch (error) {
    console.error(`Failed to write color config for ${username}:`, error);
    return false;
  }
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