import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import type { PlatformBridge } from './bridge';

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

function toBase64(buffer: number[]): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function ensureDir(path: string): Promise<void> {
  try {
    await Filesystem.mkdir({ path, directory: DATA, recursive: true });
  } catch {
    // already exists — ignore
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory: DATA });
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string | null> {
  try {
    const r = await Filesystem.readFile({ path, directory: DATA, encoding: Encoding.UTF8 });
    return r.data as string;
  } catch {
    return null;
  }
}

async function writeText(path: string, data: string): Promise<boolean> {
  try {
    await Filesystem.writeFile({ path, directory: DATA, data, encoding: Encoding.UTF8, recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function calcDirSize(path: string): Promise<{ totalSize: number; fileCount: number }> {
  let totalSize = 0;
  let fileCount = 0;
  try {
    const { files } = await Filesystem.readdir({ path, directory: DATA });
    for (const f of files) {
      const sub = `${path}/${f.name}`;
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
    const { uri } = await Filesystem.getUri({ path: CACHE_BASE, directory: DATA });
    return uri;
  },

  // ── Legacy v1 index ───────────────────────────────────────────────────────
  readCacheIndex: () => readText(`${CACHE_BASE}/cache_index.json`),
  writeCacheIndex: (d) => writeText(`${CACHE_BASE}/cache_index.json`, d),

  // ── Per-user index ────────────────────────────────────────────────────────
  readUserCacheIndex: (uid) => readText(`${CACHE_BASE}/users/${uid}/cache_index.json`),
  writeUserCacheIndex: (uid, d) => writeText(`${CACHE_BASE}/users/${uid}/cache_index.json`, d),

  // ── Per-user metadata ─────────────────────────────────────────────────────
  readUserMetadata: (uid) => readText(`${CACHE_BASE}/users/${uid}/metadata.json`),
  writeUserMetadata: (uid, d) => writeText(`${CACHE_BASE}/users/${uid}/metadata.json`, d),

  // ── Shared audio registry ─────────────────────────────────────────────────
  readAudioRegistry: () => readText(`${CACHE_BASE}/registry.json`),
  writeAudioRegistry: (d) => writeText(`${CACHE_BASE}/registry.json`, d),

  // ── Audio file storage ────────────────────────────────────────────────────
  async saveAudioFile(buffer, hash, extension) {
    const dir = `${CACHE_BASE}/audio/${hash}`;
    await ensureDir(dir);
    await Filesystem.writeFile({
      path: `${dir}/audio${extension}`,
      directory: DATA,
      data: toBase64(buffer),
    });
    return { success: true, path: `audio/${hash}/audio${extension}` };
  },

  async saveCoverArtFile(buffer, hash, extension) {
    const dir = `${CACHE_BASE}/audio/${hash}`;
    await ensureDir(dir);
    await Filesystem.writeFile({
      path: `${dir}/cover${extension}`,
      directory: DATA,
      data: toBase64(buffer),
    });
    return { success: true, path: `audio/${hash}/cover${extension}` };
  },

  async deleteAudioDir(hash) {
    try {
      await Filesystem.rmdir({ path: `${CACHE_BASE}/audio/${hash}`, directory: DATA, recursive: true });
      return true;
    } catch { return false; }
  },

  async getAudioFilePath(hash, filename) {
    const path = `${CACHE_BASE}/audio/${hash}/${filename}`;
    if (!await pathExists(path)) return null;
    const { uri } = await Filesystem.getUri({ path, directory: DATA });
    // convertFileSrc makes the file:// URI usable from inside the WebView
    return Capacitor.convertFileSrc(uri);
  },

  // ── Image reading ─────────────────────────────────────────────────────────
  async readCachedImage(relativePath) {
    try {
      const r = await Filesystem.readFile({ path: `${CACHE_BASE}/${relativePath}`, directory: DATA });
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
      await Filesystem.deleteFile({ path: `${CACHE_BASE}/${relativePath}`, directory: DATA });
      return true;
    } catch { return false; }
  },

  async clearCacheDir() {
    try {
      const { files } = await Filesystem.readdir({ path: CACHE_BASE, directory: DATA });
      for (const f of files) {
        const p = `${CACHE_BASE}/${f.name}`;
        if (f.type === 'directory') {
          await Filesystem.rmdir({ path: p, directory: DATA, recursive: true });
        } else {
          await Filesystem.deleteFile({ path: p, directory: DATA });
        }
      }
      return true;
    } catch { return false; }
  },

  getCacheStats: () => calcDirSize(CACHE_BASE),

  // ── Art lookup ────────────────────────────────────────────────────────────
  async findSiblingArt(audioHash) {
    const candidates = [
      'cover.webp', 'album.webp', 'folder.webp',
      'cover.jpg', 'album.jpg', 'folder.jpg',
      'cover.jpeg', 'album.jpeg', 'folder.jpeg',
      'cover.png', 'album.png', 'folder.png',
    ];
    for (const name of candidates) {
      const path = `${CACHE_BASE}/audio/${audioHash}/${name}`;
      try {
        const r = await Filesystem.readFile({ path, directory: DATA });
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
      const r = await Filesystem.readFile({ path: `${CACHE_BASE}/${oldPath}`, directory: DATA });
      const newDir = `${CACHE_BASE}/audio/${hash}`;
      await ensureDir(newDir);
      await Filesystem.writeFile({ path: `${newDir}/${filename}`, directory: DATA, data: r.data as string });
      await Filesystem.deleteFile({ path: `${CACHE_BASE}/${oldPath}`, directory: DATA });
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
    if (level === 'ERROR') console.error('[Xylonic]', message);
    else if (level === 'WARN') console.warn('[Xylonic]', message);
    else console.log('[Xylonic]', message);
  },
  async getLogPath() { return ''; },
  async getLoggingEnabled() { return false; },
  async setLoggingEnabled(_en) { return false; },
  async openLogFolder() { return false; },

  // ── Android foreground service + native MediaSession ─────────────────────
  async startMediaService(title?: string, artist?: string, album?: string, artworkUrl?: string | null) {
    try { await MediaControl.startService({ title: title ?? '', artist: artist ?? '', album: album ?? '', artworkUrl: artworkUrl ?? '' }); } catch {}
  },
  async stopMediaService()  { try { await MediaControl.stopService();  } catch {} },
  async updateMediaMetadata(title, artist, album, artworkUrl) {
    try { await MediaControl.updateMetadata({ title, artist, album, artworkUrl: artworkUrl ?? '' }); } catch {}
  },
  async updateMediaPlaybackState(isPlaying, positionMs, durationMs) {
    try { await MediaControl.updatePlaybackState({ isPlaying, positionMs, durationMs }); } catch {}
  },
  async updateMediaNotificationState(liked, repeatMode) {
    try { await MediaControl.updateShuffleRepeatLike({ liked, repeatMode }); } catch {}
  },
  async preloadNextArtwork(artworkUrl) {
    try { await MediaControl.preloadNextArtwork({ artworkUrl }); } catch {}
  },
  onMediaControl(callback) {
    let handle: { remove(): void } | null = null;
    MediaControl.addListener('mediaControl', (data) => {
      callback(data.action, data.positionMs);
    }).then(h => { handle = h; }).catch(() => {});
    return () => { handle?.remove(); };
  },

  async showDownloadNotification(opts) {
    try { await DownloadNotification.showProgress(opts); } catch {}
  },
  async hideDownloadNotification() {
    try { await DownloadNotification.hide(); } catch {}
  },
  async setDownloadActive(_active) {},

  async getSystemStats() { return null; },
  async setPowerSaverPriority(_enabled: boolean) {},
  async setPerformancePriority() {},

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
