import { Capacitor } from '@capacitor/core';
import { capacitorBridge } from './capacitorBridge';
import { electronBridge } from './electronBridge';
import { fallbackBridge } from './fallbackBridge';

export interface SystemStats {
  cpuPercent: number;
  cores: number;
  appMemBytes: number;      // working-set size of all app processes (Electron: sum of workingSetSize in KB→bytes)
  totalRamBytes?: number;   // total installed physical RAM (os.totalmem)
  freeRamBytes?: number;    // currently free physical RAM (os.freemem)
  /** Per-Electron-process CPU breakdown (app-only). pct may exceed 100 on multi-core machines. */
  processBreakdown?: Array<{ label: string; pct: number }>;
}

export interface PlatformBridge {
  readonly isElectron: boolean;
  readonly isCapacitor: boolean;
  /** true when file-system cache operations are supported (Electron + Android) */
  readonly isCacheAvailable: boolean;

  // Color config
  readColorConfig(username: string): Promise<string>;
  writeColorConfig(username: string, config: string): Promise<boolean>;

  // Offline cache — file I/O
  getCacheDir(): Promise<string>;
  readCacheIndex(): Promise<string | null>;
  writeCacheIndex(indexData: string): Promise<boolean>;
  readUserCacheIndex(userId: string): Promise<string | null>;
  writeUserCacheIndex(userId: string, indexData: string): Promise<boolean>;
  readUserMetadata(userId: string): Promise<string | null>;
  writeUserMetadata(userId: string, metadataData: string): Promise<boolean>;
  readAudioRegistry(): Promise<string | null>;
  writeAudioRegistry(registryData: string): Promise<boolean>;
  saveAudioFile(buffer: number[], hash: string, extension: string): Promise<{ success: boolean; path: string }>;
  saveCoverArtFile(buffer: number[], hash: string, extension: string): Promise<{ success: boolean; path: string }>;
  deleteAudioDir(hash: string): Promise<boolean>;
  getAudioFilePath(hash: string, filename: string): Promise<string | null>;
  readCachedImage(relativePath: string): Promise<string | null>;
  deleteCachedFile(relativePath: string): Promise<boolean>;
  clearCacheDir(): Promise<boolean>;
  getCacheStats(): Promise<{ totalSize: number; fileCount: number }>;
  findSiblingArt(audioHash: string): Promise<string | null>;
  extractEmbeddedArt(audioHash: string): Promise<string | null>;
  migrateFileToHashStorage(
    oldPath: string,
    hash: string,
    filename: string,
  ): Promise<{ success: boolean; newPath?: string; error?: string }>;

  // Secure credential storage
  safeStorageAvailable(): Promise<boolean>;
  encryptCredential(plaintext: string): Promise<string | null>;
  decryptCredential(encrypted: string): Promise<string | null>;

  // Logging
  writeLog(params: { message: string; level: string }): Promise<void>;
  getLogPath(): Promise<string>;
  getLoggingEnabled(): Promise<boolean>;
  setLoggingEnabled(enabled: boolean): Promise<boolean>;
  openLogFolder(): Promise<boolean>;

  // Android foreground service + native MediaSession — no-ops on Electron/web
  startMediaService(title?: string, artist?: string, album?: string, artworkUrl?: string | null): Promise<void>;
  stopMediaService(): Promise<void>;
  updateMediaMetadata(title: string, artist: string, album: string, artworkUrl: string | null): Promise<void>;
  updateMediaPlaybackState(isPlaying: boolean, positionMs: number, durationMs: number): Promise<void>;
  updateMediaNotificationState(liked: boolean, repeatMode: number): Promise<void>;
  preloadNextArtwork(artworkUrl: string): Promise<void>;
  onMediaControl(callback: (action: string, positionMs?: number) => void): () => void;

  // Multi-window — Electron only; no-ops on Android
  toggleMiniPlayer(): Promise<boolean>;
  isMiniPlayer(): Promise<boolean>;
  requestPlayerState(): Promise<any>;
  sendPlayerState(state: any): Promise<void>;
  onPlayerStateChanged(callback: (state: any) => void): () => void;
  sendPlayerControl(action: string, data?: any): Promise<void>;
  onPlayerControlAction(callback: (action: string, data?: any) => void): () => void;
  onCacheRebuildTrigger(callback: () => void): () => void;

  // System performance stats — returns null on platforms where unavailable
  getSystemStats(): Promise<SystemStats | null>;

  // Process priority / core affinity per mode
  setPowerSaverPriority(enabled: boolean): Promise<void>;
  setPerformancePriority(): Promise<void>;

  // Download progress notification (Android OS notification; no-op on Electron/web)
  showDownloadNotification(opts: { title: string; text: string; progress: number; ongoing: boolean; indeterminate?: boolean }): Promise<void>;
  hideDownloadNotification(): Promise<void>;

  // Tell the main process whether downloads are active (Electron: prevents silent window close)
  setDownloadActive(active: boolean): Promise<void>;
}

let _bridge: PlatformBridge | null = null;

export function getBridge(): PlatformBridge {
  if (_bridge) return _bridge;

  if (Capacitor.isNativePlatform()) {
    _bridge = capacitorBridge;
  } else if (typeof window !== 'undefined' && (window as any).electron) {
    _bridge = electronBridge;
  } else {
    _bridge = fallbackBridge;
  }

  return _bridge!;
}
