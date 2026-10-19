import { Capacitor, registerPlugin } from '@capacitor/core';
import { probeKnownHosts } from '../services/serverDiscoveryProbe';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import type { PlatformBridge } from './bridge';
import { logger } from '../utils/logger';
import { bytesToBase64 } from '../utils/dataUrl';
import { getCacheRoot } from '../services/cacheStorageService';

interface DownloadNotificationPlugin {
  showProgress(opts: { title: string; text: string; progress: number; ongoing: boolean; indeterminate?: boolean }): Promise<void>;
  hide(): Promise<void>;
}
const DownloadNotification = registerPlugin<DownloadNotificationPlugin>('DownloadNotification');

interface MediaControlPlugin {
  startService(opts: { title: string; artist: string; album: string; artworkUrl: string }): Promise<void>;
  stopService(): Promise<void>;
  updateMetadata(opts: { title: string; artist: string; album: string; artworkUrl: string }): Promise<void>;
  updatePlaybackState(opts: { isPlaying: boolean; positionMs: number; durationMs: number }): Promise<void>;
  updateShuffleRepeatLike(opts: { liked: boolean; repeatMode: number }): Promise<void>;
  addListener(event: 'mediaControl', handler: (data: { action: string; positionMs?: number }) => void): Promise<{ remove(): void }>;
}
const MediaControl = registerPlugin<MediaControlPlugin>('MediaControl');

const DATA = Directory.Data;
const CACHE_BASE = 'permanent_cache';

// Where the permanent cache lives. '' = the default (Directory.Data/permanent_cache); otherwise
// the absolute directory of the user's chosen volume (see cacheStorageService / CacheStoragePlugin).
// Resolved once, natively, before any cache file is touched.
let _customRoot = '';
const rootReady: Promise<void> = getCacheRoot().then(path => { _customRoot = path; }).catch(() => {});

// Absolute file:// URI of the cache root, captured on the first getCacheDir()
// call so cached-audio URLs can be built synchronously (no native round-trip),
// which keeps audio.play() inside the tap's user-activation window on iOS.
let _cacheRootUri = '';

/** Filesystem arguments for a path relative to the cache root ('' = the root itself). */
function loc(rel: string): { path: string; directory?: Directory } {
  const tail = rel ? `/${rel}` : '';
  return _customRoot
    ? { path: `file://${_customRoot}${tail}` }
    : { path: `${CACHE_BASE}${tail}`, directory: DATA };
}

function toBase64(buffer: number[]): string {
  return bytesToBase64(new Uint8Array(buffer));
}

async function ensureDir(rel: string): Promise<void> {
  await rootReady;
  try {
    await Filesystem.mkdir({ ...loc(rel), recursive: true });
  } catch {
    // already exists — ignore
  }
}

async function pathExists(rel: string): Promise<boolean> {
  await rootReady;
  try {
    await Filesystem.stat(loc(rel));
    return true;
  } catch {
    return false;
  }
}

async function readText(rel: string): Promise<string | null> {
  await rootReady;
  try {
    const r = await Filesystem.readFile({ ...loc(rel), encoding: Encoding.UTF8 });
    return r.data as string;
  } catch {
    return null;
  }
}

async function writeText(rel: string, data: string): Promise<boolean> {
  await rootReady;
  try {
    await Filesystem.writeFile({ ...loc(rel), data, encoding: Encoding.UTF8, recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function calcDirSize(rel: string): Promise<{ totalSize: number; fileCount: number }> {
  await rootReady;
  let totalSize = 0;
  let fileCount = 0;
  try {
    const { files } = await Filesystem.readdir(loc(rel));
    for (const f of files) {
      const sub = rel ? `${rel}/${f.name}` : f.name;
      if (f.type === 'directory') {
        const s = await calcDirSize(sub);
        totalSize += s.totalSize;
        fileCount += s.fileCount;
      } else {
        totalSize += (f as any).size ?? 0;
        fileCount++;
      }
    }
  } catch { /* ignore */ }
  return { totalSize, fileCount };
}

export const capacitorBridge: PlatformBridge = {
  isElectron: false,
  isCapacitor: true,
  isCacheAvailable: true,

  // ── Color config ─────────────────────────────────────────────────────────
  async readColorConfig(username) {
    const { value } = await Preferences.get({ key: `colors_${username}` });
    return value ?? '';
  },
  async writeColorConfig(username, config) {
    await Preferences.set({ key: `colors_${username}`, value: config });
    return true;
  },

  // ── Cache root ────────────────────────────────────────────────────────────
  async getCacheDir() {
    await rootReady;
    if (_customRoot) {
      _cacheRootUri = `file://${_customRoot}`;
    } else {
      const { uri } = await Filesystem.getUri({ path: CACHE_BASE, directory: DATA });
      _cacheRootUri = uri;
    }
    return _cacheRootUri;
  },

  getCachedAudioUrlSync(hash, filename) {
    if (!_cacheRootUri) return null;
    const base = _cacheRootUri.replace(/\/$/, '');
    return Capacitor.convertFileSrc(`${base}/audio/${hash}/${filename}`);
  },

  // ── Legacy v1 index ───────────────────────────────────────────────────────
  readCacheIndex: () => readText('cache_index.json'),
  writeCacheIndex: (d) => writeText('cache_index.json', d),

  // ── Per-user index ────────────────────────────────────────────────────────
  readUserCacheIndex: (uid) => readText(`users/${uid}/cache_index.json`),
  writeUserCacheIndex: (uid, d) => writeText(`users/${uid}/cache_index.json`, d),

  // ── Per-user metadata ─────────────────────────────────────────────────────
  readUserMetadata: (uid) => readText(`users/${uid}/metadata.json`),
  writeUserMetadata: (uid, d) => writeText(`users/${uid}/metadata.json`, d),

  // ── Shared audio registry ─────────────────────────────────────────────────
  readAudioRegistry: () => readText('registry.json'),
  writeAudioRegistry: (d) => writeText('registry.json', d),

  // ── Audio file storage ────────────────────────────────────────────────────
  async saveAudioFile(buffer, hash, extension) {
    const dir = `audio/${hash}`;
    await ensureDir(dir);
    await Filesystem.writeFile({
      ...loc(`${dir}/audio${extension}`),
      data: toBase64(buffer),
    });
    return { success: true, path: `audio/${hash}/audio${extension}` };
  },

  async saveCoverArtFile(buffer, hash, extension) {
    const dir = `audio/${hash}`;
    await ensureDir(dir);
    await Filesystem.writeFile({
      ...loc(`${dir}/cover${extension}`),
      data: toBase64(buffer),
    });
    return { success: true, path: `audio/${hash}/cover${extension}` };
  },

  async deleteAudioDir(hash) {
    try {
      await rootReady;
      await Filesystem.rmdir({ ...loc(`audio/${hash}`), recursive: true });
      return true;
    } catch { return false; }
  },

  async getAudioFilePath(hash, filename) {
    const rel = `audio/${hash}/${filename}`;
    if (!await pathExists(rel)) return null;
    const uri = _customRoot ? `file://${_customRoot}/${rel}` : (await Filesystem.getUri(loc(rel))).uri;
    // convertFileSrc makes the file:// URI usable from inside the WebView
    return Capacitor.convertFileSrc(uri);
  },

  // ── Image reading ─────────────────────────────────────────────────────────
  async readCachedImage(relativePath) {
    try {
      await rootReady;
      const r = await Filesystem.readFile(loc(relativePath));
      const base64 = r.data as string;
      const ext = relativePath.split('.').pop()?.toLowerCase();
      const mime =
        ext === 'png'  ? 'image/png'  :
        ext === 'gif'  ? 'image/gif'  :
        ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return `data:${mime};base64,${base64}`;
    } catch { return null; }
  },

  // ── Cache management ──────────────────────────────────────────────────────
  async deleteCachedFile(relativePath) {
    try {
      await rootReady;
      await Filesystem.deleteFile(loc(relativePath));
      return true;
    } catch { return false; }
  },

  async clearCacheDir() {
    try {
      await rootReady;
      const { files } = await Filesystem.readdir(loc(''));
      for (const f of files) {
        if (f.type === 'directory') {
          await Filesystem.rmdir({ ...loc(f.name), recursive: true });
        } else {
          await Filesystem.deleteFile(loc(f.name));
        }
      }
      return true;
    } catch { return false; }
  },

  getCacheStats: () => calcDirSize(''),

  // ── Art lookup ────────────────────────────────────────────────────────────
  async findSiblingArt(audioHash) {
    const candidates = [
      'cover.webp', 'album.webp', 'folder.webp',
      'cover.jpg', 'album.jpg', 'folder.jpg',
      'cover.jpeg', 'album.jpeg', 'folder.jpeg',
      'cover.png', 'album.png', 'folder.png',
    ];
    for (const name of candidates) {
      try {
        await rootReady;
        const r = await Filesystem.readFile(loc(`audio/${audioHash}/${name}`));
        const ext = name.split('.').pop()?.toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        return `data:${mime};base64,${r.data}`;
      } catch { /* try next */ }
    }
    return null;
  },

  // music-metadata is Node.js only — not available in WebView
  async extractEmbeddedArt(_audioHash) { return null; },

  async migrateFileToHashStorage(oldPath, hash, filename) {
    try {
      await rootReady;
      const r = await Filesystem.readFile(loc(oldPath));
      const newDir = `audio/${hash}`;
      await ensureDir(newDir);
      await Filesystem.writeFile({ ...loc(`${newDir}/${filename}`), data: r.data as string });
      await Filesystem.deleteFile(loc(oldPath));
      return { success: true, newPath: `audio/${hash}/${filename}` };
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) };
    }
  },

  // ── Secure storage ────────────────────────────────────────────────────────
  // Returning false means the app falls back to its plaintext localStorage path.
  // Install @capacitor-community/secure-storage for real encryption.
  async safeStorageAvailable() { return false; },
  async encryptCredential(_p) { return null; },
  async decryptCredential(_e) { return null; },

  // ── Logging ───────────────────────────────────────────────────────────────
  async writeLog({ message, level }) {
    if (level === 'ERROR') logger.error('[Xylonic]', message);
    else if (level === 'WARN') logger.warn('[Xylonic]', message);
    else logger.log('[Xylonic]', message);
  },
  async getLogPath() { return ''; },
  async getLoggingEnabled() { return false; },
  async setLoggingEnabled(_en) { return false; },
  async openLogFolder() { return false; },

  // ── Android foreground service + native MediaSession ─────────────────────
  async startMediaService(title?: string, artist?: string, album?: string, artworkUrl?: string | null) {
    try { await MediaControl.startService({ title: title ?? '', artist: artist ?? '', album: album ?? '', artworkUrl: artworkUrl ?? '' }); } catch { /* native plugin absent off Android */ }
  },
  async stopMediaService()  { try { await MediaControl.stopService();  } catch { /* native plugin absent off Android */ } },
  async updateMediaMetadata(title, artist, album, artworkUrl) {
    try { await MediaControl.updateMetadata({ title, artist, album, artworkUrl: artworkUrl ?? '' }); } catch { /* native plugin absent off Android */ }
  },
  async updateMediaPlaybackState(isPlaying, positionMs, durationMs) {
    try { await MediaControl.updatePlaybackState({ isPlaying, positionMs, durationMs }); } catch { /* native plugin absent off Android */ }
  },
  async updateMediaNotificationState(liked, repeatMode) {
    try { await MediaControl.updateShuffleRepeatLike({ liked, repeatMode }); } catch { /* native plugin absent off Android */ }
  },
  async preloadNextArtwork(artworkUrl) {
    try { await MediaControl.preloadNextArtwork({ artworkUrl }); } catch { /* native plugin absent off Android */ }
  },
  onMediaControl(callback) {
    let handle: { remove(): void } | null = null;
    MediaControl.addListener('mediaControl', (data) => {
      callback(data.action, data.positionMs);
    }).then(h => { handle = h; }).catch(() => {});
    return () => { handle?.remove(); };
  },

  async showDownloadNotification(opts) {
    try { await DownloadNotification.showProgress(opts); } catch { /* native plugin absent off Android */ }
  },
  async hideDownloadNotification() {
    try { await DownloadNotification.hide(); } catch { /* native plugin absent off Android */ }
  },
  async setDownloadActive(_active) {},

  discoverServers: (onFound, onDone) => probeKnownHosts(onFound, onDone),

  async getSystemStats() { return null; },
  async setPowerSaverPriority(_enabled: boolean) {},
  async setPerformancePriority() {},
  async setGamingMode(_enabled: boolean) {},
  async trimMemory() {},

  // ── Multi-window (no-op on Android) ──────────────────────────────────────
  async toggleMiniPlayer() { return false; },
  async isMiniPlayer() { return false; },
  async requestPlayerState() { return null; },
  async sendPlayerState(_s) {},
  onPlayerStateChanged(_cb) { return () => {}; },
  async sendPlayerControl(_a, _d?) {},
  onPlayerControlAction(_cb) { return () => {}; },
  onCacheRebuildTrigger(_cb) { return () => {}; },
};
