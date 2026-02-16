const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  getColorConfigPath: (username) => ipcRenderer.invoke('get-color-config-path', username),
  readColorConfig: (username) => ipcRenderer.invoke('read-color-config', username),
  writeColorConfig: (username, config) => ipcRenderer.invoke('write-color-config', username, config),
  toggleMiniPlayer: () => ipcRenderer.invoke('toggle-mini-player'),
  isMiniPlayer: () => ipcRenderer.invoke('is-mini-player'),
  // Player state synchronization
  requestPlayerState: () => ipcRenderer.invoke('request-player-state'),
  sendPlayerState: (state) => ipcRenderer.invoke('player-state-update', state),
  onPlayerStateChanged: (callback) => {
    ipcRenderer.on('player-state-changed', (event, state) => callback(state));
    return () => ipcRenderer.removeAllListeners('player-state-changed');
  },
  sendPlayerControl: (action, data) => ipcRenderer.invoke('player-control', action, data),
  onPlayerControlAction: (callback) => {
    ipcRenderer.on('player-control-action', (event, action, data) => callback(action, data));
    return () => ipcRenderer.removeAllListeners('player-control-action');
  },
  // Cache rebuild trigger
  onCacheRebuildTrigger: (callback) => {
    ipcRenderer.on('trigger-cache-rebuild', () => callback());
    return () => ipcRenderer.removeAllListeners('trigger-cache-rebuild');
  },
  // Offline cache operations
  getCacheDir: () => ipcRenderer.invoke('get-cache-dir'),
  getCacheLocation: () => ipcRenderer.invoke('get-cache-location'),
  setCacheLocation: (newPath) => ipcRenderer.invoke('set-cache-location', newPath),
  pickCacheLocation: () => ipcRenderer.invoke('pick-cache-location'),
  readCacheIndex: () => ipcRenderer.invoke('read-cache-index'),
  writeCacheIndex: (indexData) => ipcRenderer.invoke('write-cache-index', indexData),
  getCachedFilePath: (relativePath) => ipcRenderer.invoke('get-cached-file-path', relativePath),
  readCachedImage: (relativePath) => ipcRenderer.invoke('read-cached-image', relativePath),
  deleteCachedFile: (relativePath) => ipcRenderer.invoke('delete-cached-file', relativePath),
  clearCacheDir: () => ipcRenderer.invoke('clear-cache-dir'),
  downloadSongToCache: (buffer, relativePath) => ipcRenderer.invoke('download-song-to-cache', { buffer, relativePath }),
  getCacheStats: () => ipcRenderer.invoke('get-cache-stats'),
  // Multi-user cache operations (v2.0)
  getUserCacheDir: (userId) => ipcRenderer.invoke('get-user-cache-dir', userId),
  getAudioDir: () => ipcRenderer.invoke('get-audio-dir'),
  readUserCacheIndex: (userId) => ipcRenderer.invoke('read-user-cache-index', userId),
  writeUserCacheIndex: (userId, indexData) => ipcRenderer.invoke('write-user-cache-index', userId, indexData),
  readUserMetadata: (userId) => ipcRenderer.invoke('read-user-metadata', userId),
  writeUserMetadata: (userId, metadataData) => ipcRenderer.invoke('write-user-metadata', userId, metadataData),
  readAudioRegistry: () => ipcRenderer.invoke('read-audio-registry'),
  writeAudioRegistry: (registryData) => ipcRenderer.invoke('write-audio-registry', registryData),
  saveAudioFile: (buffer, hash, extension) => ipcRenderer.invoke('save-audio-file', { buffer, hash, extension }),
  saveCoverArtFile: (buffer, hash, extension) => ipcRenderer.invoke('save-cover-art-file', { buffer, hash, extension }),
  deleteAudioDir: (hash) => ipcRenderer.invoke('delete-audio-dir', hash),
  getAudioFilePath: (hash, filename) => ipcRenderer.invoke('get-audio-file-path', hash, filename),
  migrateFileToHashStorage: (oldPath, hash, filename) => ipcRenderer.invoke('migrate-file-to-hash-storage', { oldPath, hash, filename }),
  // Secure credential storage
  safeStorageAvailable: () => ipcRenderer.invoke('safe-storage-available'),
  encryptCredential: (plaintext) => ipcRenderer.invoke('safe-storage-encrypt', plaintext),
  decryptCredential: (encrypted) => ipcRenderer.invoke('safe-storage-decrypt', encrypted),
  // Logging
  writeLog: ({ message, level }) => ipcRenderer.invoke('write-log', { message, level }),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  getLoggingEnabled: () => ipcRenderer.invoke('get-logging-enabled'),
  setLoggingEnabled: (enabled) => ipcRenderer.invoke('set-logging-enabled', enabled),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
});
