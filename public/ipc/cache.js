// Offline cache filesystem: cache-location config, the shared audio/cover-art
// registry, per-user cache index + metadata, file save/read/delete, disk space,
// embedded-art extraction. ~31 IPC handlers. Extracted from public/electron.js
// (WS-ARCH). electron.js keeps the cache-path helpers (they touch settings.cfg)
// and injects them; pathToFileUrl lives here and is re-exported for the MPRIS
// code still in electron.js.
const path = require('path');
const fs = require('fs');
const os = require('os');

// Convert an absolute filesystem path to a file:// URL (cross-platform).
function pathToFileUrl(absPath) {
  const norm = absPath.replace(/\\/g, '/');
  return 'file://' + (norm.startsWith('/') ? '' : '/') + norm;
}

function registerCacheIpc({ ipcMain, dialog, getMainWindow, getCacheBasePath, saveCacheBasePath }) {
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
  const result = await dialog.showOpenDialog(getMainWindow(), {
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
}

module.exports = { registerCacheIpc, pathToFileUrl };
