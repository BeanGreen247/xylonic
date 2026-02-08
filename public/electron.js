const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs'); // Use sync fs, not promises
const isDev = require('electron-is-dev');

// Get version from package.json
const { version } = require('../package.json');

let mainWindow = null;

// Settings file path - now .cfg instead of .json
const getSettingsFilePath = () => path.join(app.getPath('userData'), 'settings.cfg');

// Settings directory path (for color configs)
const getSettingsDir = () => path.join(app.getPath('userData'), 'color_settings');

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
    const startUrl = isDev
        ? 'http://localhost:3000'
        : 'file://' + path.join(__dirname, '../build/index.html');

    mainWindow.loadURL(startUrl);

    // Keep the title even after page loads
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
    });

    // Clean up on window close
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Register file protocol before app is ready
app.whenReady().then(() => {
    // Ensure both main settings file and color_settings exist when app is ready
    ensureSettingsDir();
    ensureSettingsFile();
    
    protocol.registerFileProtocol('file', (request, callback) => {
        const pathname = decodeURIComponent(request.url.replace('file:///', ''));
        callback(pathname);
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

        console.log(`✅ Saved: ${fullPath}`);
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