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
  getDiskSpace: (targetPath) => ipcRenderer.invoke('get-disk-space', targetPath),
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
  // Multi-user cache operations (v2.1)
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
  findSiblingArt: (audioHash) => ipcRenderer.invoke('find-sibling-art', audioHash),
  extractEmbeddedArt: (audioHash) => ipcRenderer.invoke('extract-embedded-art', audioHash),
  // Secure credential storage
  safeStorageAvailable: () => ipcRenderer.invoke('safe-storage-available'),
  encryptCredential: (plaintext) => ipcRenderer.invoke('safe-storage-encrypt', plaintext),
  decryptCredential: (encrypted) => ipcRenderer.invoke('safe-storage-decrypt', encrypted),
  // Cover art resolution for navigator.mediaSession (browser process needs file:// not blob://)
  getCachedCoverArtUrl: (coverArtId) => ipcRenderer.invoke('get-cached-cover-art-url', coverArtId),
  findSiblingArtUrl: (audioHash) => ipcRenderer.invoke('find-sibling-art-url', audioHash),
  saveArtToTemp: (buffer, mimeType) => ipcRenderer.invoke('save-art-to-temp', { buffer, mimeType }),
  // System stats (CPU, RAM)
  getSystemStats: () => ipcRenderer.invoke('get-system-stats'),
  // Process priority / core affinity per mode
  setPowerSaverPriority: (enabled) => ipcRenderer.invoke(enabled ? 'set-power-saver-priority' : 'restore-process-priority'),
  setPerformancePriority: () => ipcRenderer.invoke('set-performance-priority'),
  // Remote discovery
  remoteGetDevices: () => ipcRenderer.invoke('remote-get-devices'),
  remoteGetDeviceId: () => ipcRenderer.invoke('remote-get-device-id'),
  remoteGetDeviceName: () => ipcRenderer.invoke('remote-get-device-name'),
  remoteGetControlEnabled: () => ipcRenderer.invoke('remote-get-control-enabled'),
  remoteSetControlEnabled: (enabled) => ipcRenderer.invoke('remote-set-control-enabled', enabled),
  remoteSetControllerTarget: (id) => ipcRenderer.invoke('remote-set-controller-target', id),
  remoteSetAccountId: (id) => ipcRenderer.invoke('remote-set-account-id', id),
  onRemoteDeviceFound: (callback) => {
    ipcRenderer.on('remote-device-found', (_event, device) => callback(device));
    return () => ipcRenderer.removeAllListeners('remote-device-found');
  },
  onRemoteDeviceLost: (callback) => {
    ipcRenderer.on('remote-device-lost', (_event, info) => callback(info));
    return () => ipcRenderer.removeAllListeners('remote-device-lost');
  },
  onRemoteDevicePairingChanged: (callback) => {
    ipcRenderer.on('remote-device-pairing-changed', (_event, info) => callback(info));
    return () => ipcRenderer.removeAllListeners('remote-device-pairing-changed');
  },
  onRemoteCommand: (callback) => {
    ipcRenderer.on('remote-command', (_event, cmd) => callback(cmd));
    return () => ipcRenderer.removeAllListeners('remote-command');
  },
  onRemotePairingEstablished: (callback) => {
    ipcRenderer.on('remote-pairing-established', (_event, info) => callback(info));
    return () => ipcRenderer.removeAllListeners('remote-pairing-established');
  },
  onRemotePairingCleared: (callback) => {
    ipcRenderer.on('remote-pairing-cleared', (_event, info) => callback(info));
    return () => ipcRenderer.removeAllListeners('remote-pairing-cleared');
  },
  remoteSendCommand: (opts) => ipcRenderer.invoke('remote-send-command', opts),
  onRemotePlayerStateUpdate: (callback) => {
    ipcRenderer.on('remote-player-state-update', (_event, state) => callback(state));
    return () => ipcRenderer.removeAllListeners('remote-player-state-update');
  },
  getOsPlatform: () => ipcRenderer.invoke('get-os-platform'),
  detectLinuxFirewall: () => ipcRenderer.invoke('detect-linux-firewall'),
  setDownloadActive: (active) => ipcRenderer.invoke('set-download-active', active),
  setDownloadProgress: (opts) => ipcRenderer.invoke('set-download-progress', opts),
  clearDownloadProgress: () => ipcRenderer.invoke('clear-download-progress'),
  // Logging
  writeLog: ({ message, level }) => ipcRenderer.invoke('write-log', { message, level }),
  getLogPath: () => ipcRenderer.invoke('get-log-path'),
  getLoggingEnabled: () => ipcRenderer.invoke('get-logging-enabled'),
  setLoggingEnabled: (enabled) => ipcRenderer.invoke('set-logging-enabled', enabled),
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
});
