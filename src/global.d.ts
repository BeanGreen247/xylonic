// Global type declarations for Electron APIs exposed via preload

interface PlayerState {
  currentSong: any | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'all' | 'one';
  muted: boolean;
}

interface Window {
  electron?: {
    getColorConfigPath: (username: string) => Promise<string | null>;
    readColorConfig: (username: string) => Promise<string>;
    writeColorConfig: (username: string, config: string) => Promise<boolean>;
    toggleMiniPlayer: () => Promise<boolean>;
    isMiniPlayer: () => Promise<boolean>;
    requestPlayerState: () => Promise<PlayerState | null>;
    sendPlayerState: (state: PlayerState) => Promise<void>;
    onPlayerStateChanged: (callback: (state: PlayerState) => void) => () => void;
    sendPlayerControl: (action: string, data?: any) => Promise<void>;
    onPlayerControlAction: (callback: (action: string, data?: any) => void) => () => void;
    // Offline cache operations
    getCacheDir: () => Promise<string>;
    getCacheLocation: () => Promise<string>;
    getDiskSpace: (targetPath?: string) => Promise<{ available: number; total: number } | null>;
    setCacheLocation: (newPath: string) => Promise<boolean>;
    pickCacheLocation: () => Promise<string | null>;
    readCacheIndex: () => Promise<string>;
    writeCacheIndex: (indexData: string) => Promise<boolean>;
    getCachedFilePath: (relativePath: string) => Promise<string>;
    readCachedImage: (relativePath: string) => Promise<string | null>;
    deleteCachedFile: (relativePath: string) => Promise<boolean>;
    clearCacheDir: () => Promise<boolean>;
    downloadSongToCache: (buffer: number[], relativePath: string) => Promise<{ success: boolean; path: string }>;
    getCacheStats: () => Promise<{ totalSize: number; fileCount: number }>;
    // Multi-user cache operations (v2.0)
    getUserCacheDir: (userId: string) => Promise<string>;
    getAudioDir: () => Promise<string>;
    readUserCacheIndex: (userId: string) => Promise<string | null>;
    writeUserCacheIndex: (userId: string, indexData: string) => Promise<boolean>;
    readUserMetadata: (userId: string) => Promise<string | null>;
    writeUserMetadata: (userId: string, metadataData: string) => Promise<boolean>;
    readAudioRegistry: () => Promise<string | null>;
    writeAudioRegistry: (registryData: string) => Promise<boolean>;
    saveAudioFile: (buffer: number[], hash: string, extension: string) => Promise<{ success: boolean; path: string }>;
    saveCoverArtFile: (buffer: number[], hash: string, extension: string) => Promise<{ success: boolean; path: string }>;
    deleteAudioDir: (hash: string) => Promise<boolean>;
    getAudioFilePath: (hash: string, filename: string) => Promise<string | null>;
    migrateFileToHashStorage: (oldPath: string, hash: string, filename: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
    findSiblingArt: (audioHash: string) => Promise<string | null>;
    extractEmbeddedArt: (audioHash: string) => Promise<string | null>;
    // Secure credential storage
    safeStorageAvailable: () => Promise<boolean>;
    encryptCredential: (plaintext: string) => Promise<string | null>;
    decryptCredential: (encrypted: string) => Promise<string | null>;
    // Cover art resolution for navigator.mediaSession (needs file:// not blob://)
    getCachedCoverArtUrl: (coverArtId: string) => Promise<string | null>;
    findSiblingArtUrl: (audioHash: string) => Promise<string | null>;
    saveArtToTemp: (buffer: number[], mimeType: string) => Promise<string | null>;
    // Logging
    writeLog: (params: { message: string; level: string }) => Promise<void>;
    getLogPath: () => Promise<string>;
    getLoggingEnabled: () => Promise<boolean>;
    setLoggingEnabled: (enabled: boolean) => Promise<boolean>;
    openLogFolder: () => Promise<boolean>;
    // Remote discovery
    remoteGetDeviceId: () => Promise<string>;
    remoteGetDeviceName: () => Promise<string>;
    remoteGetDevices: () => Promise<any[]>;
    remoteSetControlEnabled: (enabled: boolean) => Promise<void>;
    remoteSetControllerTarget: (id: string | null) => Promise<void>;
    remoteSendCommand: (opts: { host: string; port: number; action: string; data: string; controllerId: string }) => Promise<{ ok: boolean; reason?: string }>;
    onRemoteDeviceFound: (callback: (device: any) => void) => () => void;
    onRemoteDeviceLost: (callback: (info: { id: string }) => void) => () => void;
    onRemoteDevicePairingChanged: (callback: (info: { id: string; pairedWith?: string | null; controllingId?: string | null }) => void) => () => void;
    onRemoteCommand: (callback: (cmd: { action: string; data: any }) => void) => () => void;
    onRemotePairingEstablished: (callback: (info: { controllerId: string; controllerName: string }) => void) => () => void;
    onRemotePairingCleared: (callback: (info: {}) => void) => () => void;
    onRemotePlayerStateUpdate: (callback: (state: any) => void) => () => void;
    onCacheRebuildTrigger: (callback: () => void) => () => void;
  };
  require?: any;
}
