const { app, BrowserWindow, ipcMain, protocol, Menu, shell, dialog, safeStorage, session } = require('electron');
const path = require('path');
const url = require('url');
const fs = require('fs'); // Use sync fs, not promises
const isDev = require('electron-is-dev');

// Get version from package.json
const { version } = require('../package.json');

let mainWindow = null;
let miniPlayerWindow = null;
let lastPlayerState = null; // Store latest player state for mini player sync

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
    writeLog(`Xylonic v${version} starting on ${new Date().toISOString()}`);
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
        title: `Xylonic v${version}`,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: false,
        },
        autoHideMenuBar: true,
        icon: path.join(__dirname, 'icon.png'),
    });

    // Better path handling for production
    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
    } else {
        // Construct absolute file:// URL for production
        const indexPath = path.join(__dirname, '..', 'build', 'index.html');
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
            mainWindow.setTitle(`Xylonic v${version} | ↓ ${kbps} kbps`);
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
            mainWindow.setTitle(`Xylonic v${version}`);
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

    // Add keyboard shortcut for DevTools (Alt+F12) - works in both dev and production
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.alt && input.key === 'F12') {
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
        title: `Xylonic Mini Player v${version}`,
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
        icon: path.join(__dirname, 'icon.png'),
    });

    // Load with mini player flag
    if (isDev) {
        miniPlayerWindow.loadURL('http://localhost:3000?mini=true');
    } else {
        // Construct absolute file:// URL with query parameter
        const indexPath = path.join(__dirname, '..', 'build', 'index.html');
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

// Register file protocol before app is ready
app.whenReady().then(() => {
    // Ensure both main settings file and color_settings exist when app is ready
    ensureSettingsDir();
    ensureSettingsFile();
    
    // Check logging preference and initialize if enabled
    checkLoggingPreference();
    initializeLogFile();
    
    protocol.registerFileProtocol('file', (request, callback) => {
        const pathname = decodeURIComponent(request.url.replace('file:///', ''));
        callback(pathname);
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

ipcMain.handle('player-state-update', (event, state) => {
  // Store the latest state
  console.log('[Electron] player-state-update received:', state?.currentSong?.title || 'no song');
  lastPlayerState = state;
  // Forward state updates from main window to mini player
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    console.log('[Electron] Forwarding state to mini player');
    miniPlayerWindow.webContents.send('player-state-changed', state);
  }
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