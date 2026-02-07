const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const isDev = require('electron-is-dev');

let mainWindow;

function createWindow() {
    // Remove the default menu
    Menu.setApplicationMenu(null);

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'Xylonic',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false,
        },
    });

    // Better path handling for production
    const startUrl = isDev
        ? 'http://localhost:3000'
        : `file://${path.join(__dirname, '../build/index.html')}`;

    mainWindow.loadURL(startUrl);

    if (isDev) {
        // Open DevTools in development
        mainWindow.webContents.openDevTools();
    }

    mainWindow.on('closed', () => (mainWindow = null));
}

// Register file protocol before app is ready
app.whenReady().then(() => {
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