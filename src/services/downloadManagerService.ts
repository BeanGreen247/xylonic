/**
 * Download Manager Service
 * Manages sequential song downloads to permanent cache
 */

import {
  DownloadQuality,
  DownloadQueueItem,
  DownloadStatus,
  DownloadProgress,
  AlbumDownloadRequest,
  DownloadEvent,
  DownloadEventType,
  DownloadableSong
} from '../types/offline';
import { Song } from '../types';
import { getStreamUrl } from './subsonicApi';
import { offlineCacheService } from './offlineCacheService';
import { logger } from '../utils/logger';
import { getBridge } from '../platform/bridge';
import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';
import md5 from 'md5';

interface NativeDownloaderPlugin {
  startDownload(opts: {
    url: string;
    hash: string;
    songId: string;
    title: string;
  }): Promise<{ extension: string; bytesReceived: number }>;

  /** Download all items natively without JS round-trips between songs. */
  startBatch(opts: {
    items: Array<{ url: string; hash: string; songId: string; title: string }>;
  }): Promise<{ done: boolean }>;

  addListener(
    event: 'downloadProgress',
    handler: (data: {
      songId: string;
      progress: number;
      bytesReceived: number;
      totalBytes: number;
      speedBps: number;
    }) => void
  ): Promise<PluginListenerHandle>;

  /** Fired after each song in a batch finishes downloading on the native thread. */
  addListener(
    event: 'songDownloaded',
    handler: (data: { songId: string; extension: string; bytesReceived: number }) => void
  ): Promise<PluginListenerHandle>;

  /** Fired when a song in a batch fails on the native thread. */
  addListener(
    event: 'songFailed',
    handler: (data: { songId: string; error: string }) => void
  ): Promise<PluginListenerHandle>;

  /** Signal the native thread to stop after the currently-downloading song. */
  cancelBatch(): Promise<void>;

  /** Wipe WebView cache, cookies, WebStorage, and SharedPreferences at the OS level. */
  clearAllNativeData(): Promise<void>;

  /** Send the app to the background (used by Android back-button handler at root). */
  minimizeApp(): Promise<void>;

  /** Read the native completion log written by DownloadService after each successful download. */
  readCompletionLog(): Promise<{
    entries: Array<{ hash: string; songId: string; extension: string; bytesReceived: number }>;
  }>;

  /** Delete the completion log after reconcileOrphans() has processed it. */
  clearCompletionLog(): Promise<void>;
}

// Android-only native downloader; iOS uses the background URLSession plugin below
const NativeDownloader: NativeDownloaderPlugin | null = Capacitor.getPlatform() === 'android'
  ? registerPlugin<NativeDownloaderPlugin>('NativeDownloader')
  : null;

interface BackgroundDownloadPlugin {
  startDownload(opts: {
    url: string;
    songId: string;
    audioHash: string;
    headers?: Record<string, string>;
  }): Promise<void>;
  cancelDownload(opts: { songId: string }): Promise<void>;
  readCompletionLog(): Promise<{
    entries: Array<{ songId: string; audioHash: string; extension: string; fileSize: number }>;
  }>;
  clearCompletionLog(): Promise<void>;
  addListener(
    event: 'backgroundDownloadCompleted',
    handler: (data: { songId: string; audioHash: string; extension: string; fileSize: number }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'backgroundDownloadFailed',
    handler: (data: { songId: string; error: string }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'downloadProgress',
    handler: (data: { songId: string; bytesWritten: number; totalBytes: number }) => void
  ): Promise<PluginListenerHandle>;
  probeConnection(opts: { url: string }): Promise<{ ok: boolean }>;
}

const BackgroundDownload: BackgroundDownloadPlugin | null = Capacitor.getPlatform() === 'ios'
  ? registerPlugin<BackgroundDownloadPlugin>('BackgroundDownload')
  : null;

interface BackgroundKeepAlivePlugin {
  arm(): Promise<void>;
  disarm(): Promise<void>;
}
const BackgroundKeepAlive: BackgroundKeepAlivePlugin | null = Capacitor.getPlatform() === 'ios'
  ? registerPlugin<BackgroundKeepAlivePlugin>('BackgroundKeepAlive')
  : null;

type DownloadEventListener = (event: DownloadEvent) => void;

class DownloadManagerService {
  private static readonly QUEUE_KEY        = 'xylonic_pending_downloads';
  private static readonly BATCH_PENDING_KEY = 'xylonic_batch_pending';

  private queue: DownloadQueueItem[] = [];
  private currentDownload: DownloadQueueItem | null = null;
  private isPaused: boolean = false;
  private isDownloading: boolean = false;
  private listeners: DownloadEventListener[] = [];
  private maxRetries: number = 8;

  // Whether startBatch is available on the native side. Set false on first failure
  // so we fall back to single-song mode without looping.
  private useBatchMode: boolean = true;

  // Set by clearQueue() while a download is active. The current song is allowed
  // to finish (avoiding file corruption) then the queue is wiped.
  private pendingClear: boolean = false;

  // Track which albums and artists have had cover art downloaded in this session
  private downloadedAlbumCovers: Set<string> = new Set();
  private downloadedArtistCovers: Set<string> = new Set();

  // Track the primary cover art ID for each album (first one downloaded)
  private albumCoverArtMap: Map<string, string> = new Map();

  // Cover art IDs waiting to be aliased once the album's primary art finishes downloading
  private pendingCoverArtAliases: Map<string, string[]> = new Map();

  // Track auto-clear timeouts for completed downloads
  private autoClearTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // Session-level counters — survive auto-clears within a session so the
  // Overall Progress display stays accurate as completed items are removed.
  private sessionTotal: number = 0;
  private sessionCompleted: number = 0;
  private sessionFailed: number = 0;

  // Download speed / ETA tracking
  private speedSamples: Array<{ time: number; bytes: number }> = [];
  private downloadSpeedBps: number = 0;
  private currentContentLength: number = 0;
  private lastNotifMs: number = 0;
  private static readonly NOTIF_INTERVAL_MS = 1000;

  // Timestamp of last byte received — used to detect stuck downloads on foreground
  private lastProgressMs: number = 0;

  // Periodic stuck-download detector for the JS fetch path (Electron/web)
  private stuckCheckInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly STUCK_THRESHOLD_MS = 30_000;

  // AbortController for the active JS fetch — lets the stuck check cancel cleanly
  private currentAbortController: AbortController | null = null;

  private persistQueueTimer: ReturnType<typeof setTimeout> | null = null;

  // Serial queue for cache-index registrations. Prevents hundreds of concurrent
  // saveIndex()/saveRegistry() calls from duplicating large JSON blobs in V8 heap.
  private registrationQueue: Promise<void> = Promise.resolve();

  // Guard against concurrent cache verification runs
  private isVerifying: boolean = false;

  // Ensures the local-network permission dialog fires via a foreground URLSession
  // probe before the first background-session download. Reset on each JS session.
  private iosNetworkProbed = false;

  // iOS background download: pending resolve/reject callbacks keyed by songId.
  // A single persistent listener dispatches to whichever song is active.
  private iosPendingCallbacks = new Map<string, {
    resolve: (data: { audioHash: string; extension: string; fileSize: number }) => void;
    reject: (err: Error) => void;
  }>();

  constructor() {
    this.restoreQueue();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this));
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleNetworkRestore.bind(this));
    }
    this.initIOSListeners();
  }

  private initIOSListeners(): void {
    if (!BackgroundDownload) return;
    BackgroundDownload.addListener('backgroundDownloadCompleted', (data) => {
      const cb = this.iosPendingCallbacks.get(data.songId);
      if (cb) {
        this.iosPendingCallbacks.delete(data.songId);
        cb.resolve({ audioHash: data.audioHash, extension: data.extension, fileSize: data.fileSize });
      }
    }).catch(() => {});
    BackgroundDownload.addListener('backgroundDownloadFailed', (data) => {
      const cb = this.iosPendingCallbacks.get(data.songId);
      if (cb) { this.iosPendingCallbacks.delete(data.songId); cb.reject(new Error(data.error)); }
    }).catch(() => {});
    BackgroundDownload.addListener('downloadProgress', (data) => {
      const item = this.currentDownload;
      if (!item || item.song.id !== data.songId) return;
      const hasTotal = data.totalBytes > 0;
      if (hasTotal) item.progress = Math.round((data.bytesWritten / data.totalBytes) * 100);
      this.emit({ type: 'download-progress', item, progress: this.getProgress() });
      this.pushDownloadNotification(data.bytesWritten, !hasTotal);
    }).catch(() => {});
  }

  /**
   * Persist pending/in-progress items to localStorage so they survive process kills.
   * Debounced — coalesces rapid state changes (retries, sequential completions) into
   * a single write. Call persistQueueNow() for destructive user actions.
   */
  private persistQueue(): void {
    if (this.persistQueueTimer) clearTimeout(this.persistQueueTimer);
    this.persistQueueTimer = setTimeout(() => {
      this.persistQueueTimer = null;
      this.persistQueueNow();
    }, 300);
  }

  private persistQueueNow(): void {
    try {
      const toSave = this.queue
        .filter(i => i.status === 'pending' || i.status === 'downloading')
        .map(i => ({
          id: i.id,
          song: i.song,
          albumId: i.albumId,
          albumName: i.albumName,
          artistName: i.artistName,
          artistId: i.artistId,
          artistCoverArtId: i.artistCoverArtId,
          quality: i.quality,
          retryCount: 0,
          addedAt: i.addedAt,
        }));
      localStorage.setItem(DownloadManagerService.QUEUE_KEY, JSON.stringify(toSave));
    } catch { /* storage unavailable or full */ }
  }

  /**
   * Restore pending items from localStorage on startup.
   */
  private restoreQueue(): void {
    try {
      const raw = localStorage.getItem(DownloadManagerService.QUEUE_KEY);
      if (!raw) return;
      const saved = (JSON.parse(raw) as any[]).map(s => ({
        ...s,
        status: 'pending' as const,
        progress: 0,
        error: undefined,
        startedAt: undefined,
        completedAt: undefined,
      }));
      if (saved.length > 0) {
        this.queue = saved;
        this.sessionTotal = saved.length;
        logger.log('[DownloadManager] Restored', saved.length, 'pending items from storage');
      }
    } catch {
      try { localStorage.removeItem(DownloadManagerService.QUEUE_KEY); } catch {}
    }
  }

  /**
   * Called when the document becomes visible (app foregrounded on Android,
   * window shown on Electron).
   *
   * Native batch mode (Android): the DownloadService runs on its own thread with a
   * wakelock and does NOT need JS to be active. Never reset/restart a running batch
   * here — doing so launches a second concurrent batch which double-counts completions
   * and can crash the app.
   *
   * JS fetch mode (Electron): the while-loop reader genuinely freezes when the window
   * is hidden. Detect stale state and restart if needed.
   */
  private handleVisibilityChange(): void {
    if (document.visibilityState !== 'visible') return;

    const hasActiveWork = this.queue.some(i => i.status === 'pending' || i.status === 'downloading');
    if (!hasActiveWork) return;

    if (this.isDownloading) {
      // Native downloads are self-sufficient — leave them alone.
      if (NativeDownloader && this.useBatchMode) return;
      if (BackgroundDownload) return;

      // JS fetch path: detect a stuck read loop.
      const staleSec = (Date.now() - this.lastProgressMs) / 1000;
      if (staleSec <= 10) return;

      // Abort the frozen fetch cleanly so the AbortError flows through the
      // normal retry path — no direct state manipulation needed.
      logger.warn('[DownloadManager] Frozen JS download detected on foreground; aborting fetch');
      this.stopStuckCheck();
      this.currentAbortController?.abort();
      // Return — downloadSong's catch will reset state and re-call processQueue
      return;
    }

    if (!this.isPaused) {
      logger.log('[DownloadManager] App foregrounded — resuming queue');
      this.processQueue();
    }
  }

  /**
   * Fired by the browser when internet connectivity is restored.
   * Automatically retries any failed downloads so the user never needs to
   * press "Retry Failed" after a WiFi drop or network hiccup.
   */
  private handleNetworkRestore(): void {
    logger.log('[DownloadManager] Network restored — checking for stalled downloads');
    const hasFailed  = this.queue.some(i => i.status === 'failed');
    const hasPending = this.queue.some(i => i.status === 'pending');

    if (hasFailed && !this.isDownloading) {
      logger.log('[DownloadManager] Auto-retrying failed downloads after network restore');
      this.retryFailed();
    } else if (hasPending && !this.isDownloading && !this.isPaused) {
      logger.log('[DownloadManager] Resuming pending downloads after network restore');
      this.processQueue();
    } else if (this.isDownloading && !NativeDownloader) {
      // A JS fetch is marked as in-progress. If the window is hidden the reader is
      // just frozen and will resume naturally on foreground — leave it alone.
      // If the window is visible but the reader is somehow stuck, nudge it by
      // updating lastProgressMs so the stuck check gets a fresh window before firing.
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        this.lastProgressMs = Date.now();
      }
    }
  }

  /**
   * Tell the Electron main process whether downloads are active so it can
   * prevent the window from being closed silently. No-op on other platforms.
   */
  private notifyDownloadActive(active: boolean): void {
    try {
      getBridge().setDownloadActive(active);
    } catch { /* ignore */ }
  }

  /**
   * Resume the persisted queue after authentication and cache are ready.
   * Call this from the app once the user is logged in and the cache is init.
   */
  public tryResumeQueue(): void {
    if (!this.isDownloading && !this.isPaused && this.queue.some(i => i.status === 'pending')) {
      logger.log('[DownloadManager] tryResumeQueue — starting');
      this.processQueue();
    }
  }

  /**
   * Add event listener
   */
  addEventListener(listener: DownloadEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: DownloadEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  /**
   * Add album to download queue
   */
  addAlbumToQueue(request: AlbumDownloadRequest): void {
    logger.log('[DownloadManager] Adding album to queue:', request.albumName, `(${request.songs.length} songs)`);

    const activeIds = new Set(
      this.queue
        .filter(i => i.status === 'pending' || i.status === 'downloading')
        .map(i => i.song.id)
    );

    const newItems: DownloadQueueItem[] = request.songs
      .filter(song => !offlineCacheService.isCached(song.id) && !activeIds.has(song.id))
      .map(song => ({
        id: `${song.id}_${Date.now()}_${Math.random()}`,
        song,
        albumId: request.albumId,
        albumName: request.albumName,
        artistName: request.artistName,
        artistId: request.artistId,
        artistCoverArtId: request.artistCoverArtId,
        quality: request.quality,
        status: 'pending',
        progress: 0,
        retryCount: 0,
        addedAt: Date.now()
      }));

    if (newItems.length === 0) return;

    this.queue.push(...newItems);
    this.sessionTotal += newItems.length;
    this.persistQueue();
    this.emit({ type: 'queue-updated', progress: this.getProgress() });

    // Start downloading if not already
    if (!this.isDownloading && !this.isPaused) {
      this.processQueue();
    }
  }

  /**
   * Add single song to queue
   */
  addSongToQueue(song: DownloadableSong, albumId: string, albumName: string, artistName: string, quality: DownloadQuality): void {
    if (offlineCacheService.isCached(song.id)) return;
    if (this.queue.some(i => i.song.id === song.id && (i.status === 'pending' || i.status === 'downloading'))) return;

    const item: DownloadQueueItem = {
      id: `${song.id}_${Date.now()}`,
      song,
      albumId,
      albumName,
      artistName,
      quality,
      status: 'pending',
      progress: 0,
      retryCount: 0,
      addedAt: Date.now()
    };

    this.queue.push(item);
    this.sessionTotal++;
    this.persistQueue();
    this.emit({ type: 'queue-updated', progress: this.getProgress() });

    if (!this.isDownloading && !this.isPaused) {
      this.processQueue();
    }
  }

  /**
   * Merge items into the persistent pending-batch map so reconcileOrphans() can
   * recover songs whose songDownloaded event was lost to a renderer process crash.
   * Merges rather than overwrites so multiple crashed batches can all be recovered.
   */
  private savePendingBatch(items: DownloadQueueItem[]): void {
    try {
      const existing: Record<string, unknown> = JSON.parse(
        localStorage.getItem(DownloadManagerService.BATCH_PENDING_KEY) || '{}'
      );
      items.forEach(item => {
        existing[item.song.id] = {
          song:            item.song,
          quality:         item.quality,
          artistId:        item.artistId,
          artistCoverArtId: item.artistCoverArtId,
        };
      });
      localStorage.setItem(DownloadManagerService.BATCH_PENDING_KEY, JSON.stringify(existing));
    } catch { /* storage full / unavailable */ }
  }

  private clearPendingBatch(): void {
    try { localStorage.removeItem(DownloadManagerService.BATCH_PENDING_KEY); } catch {}
  }

  /**
   * Process the download queue.
   *
   * Android (NativeDownloader available): submits ALL pending items to the native
   * DownloadService as a single batch. The native thread downloads every song
   * without any JS round-trips between songs, so downloads continue even when
   * the WebView is backgrounded/throttled. JS receives songDownloaded events as
   * each finishes and registers them in the cache index concurrently.
   *
   * Electron/web: downloads one song at a time using the JS fetch path.
   */
  private async processQueue(): Promise<void> {
    if (this.isDownloading || this.isPaused || this.pendingClear) return;

    const serverUrl = localStorage.getItem('serverUrl');
    const username  = localStorage.getItem('username');
    const password  = localStorage.getItem('password');
    if (!serverUrl || !username || !password) {
      logger.log('[DownloadManager] processQueue deferred — not authenticated');
      return;
    }

    const pendingItems = this.queue.filter(item => item.status === 'pending');

    if (pendingItems.length === 0) {
      logger.log('[DownloadManager] Queue empty or all completed');
      this.isDownloading = false;
      this.currentDownload = null;
      this.persistQueue();
      this.notifyDownloadActive(false);
      BackgroundKeepAlive?.disarm().catch(() => {});

      this.downloadedAlbumCovers.clear();
      this.downloadedArtistCovers.clear();
      this.albumCoverArtMap.clear();
      this.pendingCoverArtAliases.clear();

      const completed  = this.queue.filter(i => i.status === 'completed');
      const hasFailed  = this.queue.some(i => i.status === 'failed');
      const allVerified = !hasFailed
        && completed.length > 0
        && completed.every(i => offlineCacheService.isCached(i.song.id));

      if (allVerified) {
        getBridge().showDownloadNotification({
          title: 'Download complete',
          text: 'All songs downloaded',
          progress: 100,
          ongoing: false,
        }).catch(() => {});
        setTimeout(() => this.hideDownloadNotificationNow(), 4000);
      } else {
        this.hideDownloadNotificationNow();
      }

      // Run cache verification after every completed batch
      if (completed.length > 0) {
        this.runCacheVerification().catch(() => {});
      }
      return;
    }

    this.isDownloading = true;
    this.notifyDownloadActive(true);
    BackgroundKeepAlive?.arm().catch(() => {});

    try {
      if (NativeDownloader && this.useBatchMode) {
        // Android batch mode — submit all pending items to native service in one call.
        // The native thread downloads every song without waiting for JS between songs.
        this.lastProgressMs = Date.now();
        this.currentDownload = pendingItems[0];
        // Exponential backoff when re-submitting a batch after previous failures.
        // retryCount is incremented by downloadBatchNative after each failed batch,
        // so retry 1→5s, 2→10s, 3→20s, 4→40s, capped at 60s.
        const maxRetry = pendingItems.reduce((m, i) => Math.max(m, i.retryCount), 0);
        if (maxRetry > 0 && !this.isPaused) {
          const backoffMs = Math.min(5000 * Math.pow(2, Math.min(maxRetry - 1, 3)), 60_000);
          logger.log(`[DownloadManager] Batch retry ${maxRetry} — waiting ${Math.round(backoffMs / 1000)}s`);
          await new Promise<void>(resolve => setTimeout(resolve, backoffMs));
          if (this.isPaused || this.pendingClear) {
            this.isDownloading = false;
            return;
          }
        }
        try {
          await this.downloadBatchNative(pendingItems, serverUrl, username, password);
        } catch (batchErr) {
          // startBatch rejected (APK not updated, service error, etc.).
          // Disable batch mode for this session to avoid an infinite retry loop,
          // then fall back to single-song native path for the current item.
          logger.warn('[DownloadManager] Batch mode unavailable, falling back to single-song:', batchErr);
          this.useBatchMode = false;
          const item = pendingItems[0];
          this.currentDownload = item;
          await this.downloadSong(item);
        }
      } else {
        // Electron/web, or Android with batch mode disabled: one song at a time.
        const item = pendingItems[0];

        // Exponential backoff between retries so the network has time to recover.
        // Retry 1 → 2 s, retry 2 → 4 s, retry 3 → 8 s … capped at 30 s.
        if (item.retryCount > 0) {
          const backoffMs = Math.min(2000 * Math.pow(2, item.retryCount - 1), 30_000);
          logger.log(`[DownloadManager] Retry ${item.retryCount} for "${item.song.title}" — waiting ${Math.round(backoffMs / 1000)}s`);
          await new Promise<void>(resolve => setTimeout(resolve, backoffMs));
          // Re-check state after sleeping — queue may have been cleared or paused
          if (this.isPaused || this.pendingClear || !this.queue.includes(item)) {
            this.isDownloading = false;
            return;
          }
        }

        // Reset progress timestamp and start the stuck-download detector now that
        // the backoff is over and an actual network transfer is about to begin.
        this.lastProgressMs = Date.now();
        this.currentDownload = item;
        this.startStuckCheck();
        await this.downloadSong(item);
        this.stopStuckCheck();
      }

      this.isDownloading = false;

      if (this.pendingClear) {
        this._executeClear();
        return;
      }

      if (!this.isPaused) {
        setTimeout(() => this.processQueue(), 100);
      }
    } catch (error) {
      logger.error('[DownloadManager] processQueue error:', error);
      this.isDownloading = false;
      this.stopStuckCheck();
      // Auto-restart if there are still items to download, rather than waiting
      // for a user action or visibility change.
      const hasPending = this.queue.some(i => i.status === 'pending');
      if (hasPending && !this.isPaused) {
        setTimeout(() => this.processQueue(), 5000);
      }
    }
  }

  /**
   * Android batch download: generates all stream URLs and submits the entire
   * pending queue to DownloadService in one native call.
   *
   * The native thread downloads every song sequentially without any JS
   * involvement between songs, so downloads continue even when Android
   * throttles or suspends the WebView. JS receives songDownloaded / songFailed
   * events as each song finishes and handles cache registration concurrently
   * without blocking the native download chain.
   */
  private async downloadBatchNative(
    items: DownloadQueueItem[],
    serverUrl: string,
    username: string,
    password: string
  ): Promise<void> {
    // Songs already in cache (e.g. reconciled from a previous OOM session):
    // mark complete immediately so the UI counter is correct from the start.
    const toDownload: DownloadQueueItem[] = [];
    for (const item of items) {
      if (offlineCacheService.isCached(item.song.id)) {
        item.status      = 'completed';
        item.completedAt = Date.now();
        item.progress    = 100;
        this.sessionCompleted++;
        this.scheduleAutoClear(item.id);
      } else {
        toDownload.push(item);
      }
    }
    if (this.sessionCompleted > 0) {
      this.persistQueue();
      this.emit({ type: 'queue-updated', progress: this.getProgress() });
    }
    if (toDownload.length === 0) return;

    const batchItems = toDownload.map(item => ({
      url:    getStreamUrl(serverUrl, username, password, item.song.id, this.qualityToBitrate(item.quality)),
      hash:   offlineCacheService.getAudioHash(item.song.id),
      songId: item.song.id,
      title:  item.song.title,
    }));

    const itemMap = new Map(toDownload.map(i => [i.song.id, i]));

    // Every VALIDATE_INTERVAL songs (completed or failed), cross-check failed items
    // against the native completion log. If a song appears in the log it was written
    // successfully — the JS failure event was spurious — so rescue it.
    const VALIDATE_INTERVAL = 25;
    let songsProcessed = 0;
    const validateFailed = async () => {
      const failedItems = [...itemMap.values()].filter(i => i.status === 'failed');
      if (failedItems.length === 0) return;
      let entries: Array<{ hash: string; songId: string; extension: string; bytesReceived: number }>;
      try {
        entries = (await NativeDownloader!.readCompletionLog()).entries ?? [];
      } catch { return; }
      const logById = new Map(entries.map(e => [e.songId, e]));
      let rescued = 0;
      for (const item of failedItems) {
        const entry = logById.get(item.song.id);
        if (!entry) continue;
        item.status      = 'completed';
        item.completedAt = Date.now();
        item.progress    = 100;
        this.sessionCompleted++;
        this.sessionFailed = Math.max(0, this.sessionFailed - 1);
        this.scheduleAutoClear(item.id);
        const songRef = { ...item.song };
        const { quality, artistId, artistCoverArtId } = item;
        this.registrationQueue = this.registrationQueue
          .then(() => offlineCacheService.registerNativeDownload(
            songRef, quality, entry.hash, entry.extension, entry.bytesReceived, artistId, artistCoverArtId
          ))
          .catch(e => logger.warn('[DownloadManager] rescue registration failed:', e));
        this.downloadCoverArt(item, serverUrl, username, password)
          .catch(() => {});
        rescued++;
      }
      if (rescued > 0) {
        logger.log(`[DownloadManager] Rescued ${rescued} false-failed songs`);
        this.persistQueue();
        this.emit({ type: 'queue-updated', progress: this.getProgress() });
        this.emit({ type: 'cache-updated' });
      }
    };

    let progressHandle:   PluginListenerHandle | null = null;
    let downloadedHandle: PluginListenerHandle | null = null;
    let failedHandle:     PluginListenerHandle | null = null;

    try {
      progressHandle = await NativeDownloader!.addListener('downloadProgress', (data) => {
        const item = itemMap.get(data.songId);
        if (!item) return;
        if (item.status === 'pending') {
          item.status    = 'downloading';
          item.startedAt = Date.now();
        }
        if (data.totalBytes > 0) item.progress = data.progress;
        this.currentDownload = item;
        this.lastProgressMs  = Date.now();
        this.pushDownloadNotification(data.bytesReceived, data.totalBytes <= 0);
        this.emit({ type: 'download-progress', item, progress: this.getProgress() });
      });

      // Each song that finishes on the native thread: register in cache index
      // fire-and-forget so the native thread never waits for JS.
      downloadedHandle = await NativeDownloader!.addListener('songDownloaded', (data) => {
        const item = itemMap.get(data.songId);
        if (!item) return;
        if (item.status === 'completed') return;

        item.status      = 'completed';
        item.completedAt = Date.now();
        item.progress    = 100;
        this.sessionCompleted++;
        this.persistQueue();
        this.emit({ type: 'download-completed', item, progress: this.getProgress() });
        this.emit({ type: 'cache-updated' });
        this.scheduleAutoClear(item.id);

        // Chain onto the serial registration queue instead of fire-and-forget.
        // Concurrent registrations each serialize the full cache index to JSON;
        // serialising them prevents hundreds of duplicate blobs in V8 heap (OOM fix).
        const songRef = { ...item.song };
        const { quality, artistId, artistCoverArtId } = item;
        const { extension, bytesReceived } = data;
        const audioHash = offlineCacheService.getAudioHash(songRef.id);
        this.registrationQueue = this.registrationQueue
          .then(() => offlineCacheService.registerNativeDownload(
            songRef, quality, audioHash, extension, bytesReceived, artistId, artistCoverArtId
          ))
          .catch(e => logger.warn('[DownloadManager] registerNativeDownload failed:', e));

        this.downloadCoverArt(item, serverUrl, username, password)
          .catch(e => logger.warn('[DownloadManager] Cover art download failed:', e));

        songsProcessed++;
        if (songsProcessed % VALIDATE_INTERVAL === 0) {
          validateFailed().catch(() => {});
        }
      });

      failedHandle = await NativeDownloader!.addListener('songFailed', (data) => {
        const item = itemMap.get(data.songId);
        if (!item) return;
        if (item.status === 'failed') return;
        item.status = 'failed';
        item.error  = data.error;
        this.sessionFailed++;
        this.persistQueue();
        this.emit({ type: 'download-failed', item, progress: this.getProgress(), error: data.error });

        songsProcessed++;
        if (songsProcessed % VALIDATE_INTERVAL === 0) {
          validateFailed().catch(() => {});
        }
      });

      // Persist song metadata before the native batch starts so reconcileOrphans()
      // can recover any songs whose songDownloaded event is lost to a renderer crash.
      this.savePendingBatch(toDownload);

      this.pushDownloadNotification(0, true);
      await NativeDownloader!.startBatch({ items: batchItems });
      // Final pass: rescue any false-failures in the tail that didn't hit the interval.
      await validateFailed();
      // Extra delayed pass — catches tail-end false-failures that resolved after the
      // first validateFailed() ran but before the native thread fully flushed its log.
      await new Promise<void>(resolve => setTimeout(resolve, 10_000));
      await validateFailed();
      // Drain all pending cache-index registrations before declaring the batch done.
      await this.registrationQueue;
      // Force the debounced index/registry saves to disk before the batch is declared done.
      await offlineCacheService.flushAll();
      // Batch completed normally — clear both recovery stores.
      this.clearPendingBatch();
      NativeDownloader!.clearCompletionLog().catch(() => {});

    } finally {
      progressHandle?.remove();
      downloadedHandle?.remove();
      failedHandle?.remove();
    }

    // Songs still 'failed' after validateFailed() could not rescue them are genuine
    // network failures. Reset to 'pending' with an incremented retryCount so the next
    // processQueue call sees pending items and re-submits the batch. processQueue uses
    // retryCount to calculate how long to back off before the next attempt.
    // Decrement sessionFailed for each item being auto-retried so the progress header
    // doesn't show an inflated "Failed: N" count during the retry backoff.
    let retriableCount = 0;
    for (const item of toDownload) {
      if (item.status === 'failed' && item.retryCount < this.maxRetries) {
        item.retryCount++;
        item.status = 'pending';
        item.error = `Retry ${item.retryCount}/${this.maxRetries}: network error`;
        retriableCount++;
      }
    }
    if (retriableCount > 0) {
      this.sessionFailed = Math.max(0, this.sessionFailed - retriableCount);
      logger.log(`[DownloadManager] Queued ${retriableCount} songs for batch retry`);
      this.persistQueue();
      this.emit({ type: 'queue-updated', progress: this.getProgress() });
    }
  }

  /**
   * Download a single song — routes to native (Android) or JS (Electron/web) path.
   */
  private async downloadSong(item: DownloadQueueItem): Promise<void> {
    logger.log('[DownloadManager] Downloading song:', item.song.title);

    item.status = 'downloading';
    item.startedAt = Date.now();
    this.emit({ type: 'download-started', item, progress: this.getProgress() });

    try {
      const serverUrl = localStorage.getItem('serverUrl');
      const username  = localStorage.getItem('username');
      const password  = localStorage.getItem('password');

      if (!serverUrl || !username || !password) {
        throw new Error('Missing authentication credentials');
      }

      if (offlineCacheService.isCached(item.song.id)) {
        logger.log('[DownloadManager] Song already cached, skipping:', item.song.title);
        item.status = 'completed';
        item.completedAt = Date.now();
        item.progress = 100;
        this.sessionCompleted++;
        this.emit({ type: 'download-completed', item, progress: this.getProgress() });
        return;
      }

      const bitrate   = this.qualityToBitrate(item.quality);
      const streamUrl = getStreamUrl(serverUrl, username, password, item.song.id, bitrate);

      // Show "starting" notification immediately (also starts DownloadService on Android)
      this.speedSamples = [];
      this.downloadSpeedBps = 0;
      this.currentContentLength = 0;
      this.lastNotifMs = 0;
      this.pushDownloadNotification(0, true);

      if (NativeDownloader) {
        await this.downloadSongNative(item, streamUrl, serverUrl, username, password);
      } else if (BackgroundDownload) {
        await this.downloadSongNativeIOS(item, streamUrl);
      } else {
        await this.downloadSongJS(item, streamUrl, serverUrl, username, password);
      }

    } catch (error) {
      logger.error('[DownloadManager] Download failed:', error);

      if (item.retryCount < this.maxRetries) {
        item.retryCount++;
        item.status = 'pending';
        item.error = `Retry ${item.retryCount}/${this.maxRetries}: ${(error as Error).message}`;
        logger.log('[DownloadManager] Retrying download:', item.retryCount);
      } else {
        item.status = 'failed';
        item.error = (error as Error).message;
        this.sessionFailed++;
      }

      this.persistQueue();
      this.emit({ type: 'download-failed', item, progress: this.getProgress(), error: item.error });
    }
  }

  /**
   * Android native download: Java background thread owns the HTTP transfer;
   * JS only updates the cache index after completion and handles cover art.
   */
  private async downloadSongNative(
    item: DownloadQueueItem,
    streamUrl: string,
    serverUrl: string,
    username: string,
    password: string
  ): Promise<void> {
    const audioHash = offlineCacheService.getAudioHash(item.song.id);
    let progressHandle: PluginListenerHandle | null = null;

    try {
      // Keep the in-app download window updated when the app is foregrounded
      progressHandle = await NativeDownloader!.addListener('downloadProgress', (data) => {
        if (data.songId !== item.song.id) return;
        if (data.totalBytes > 0) item.progress = data.progress;
        this.lastProgressMs = Date.now();
        this.emit({ type: 'download-progress', item, progress: this.getProgress() });
      });

      // Awaits until the native thread finishes writing the file
      const result = await NativeDownloader!.startDownload({
        url: streamUrl,
        hash: audioHash,
        songId: item.song.id,
        title: item.song.title
      });

      await offlineCacheService.registerNativeDownload(
        item.song,
        item.quality,
        audioHash,
        result.extension,
        result.bytesReceived,
        item.artistId,
        item.artistCoverArtId
      );

      if (!offlineCacheService.isCached(item.song.id)) {
        throw new Error('File not found in cache after native download — will retry');
      }

      logger.log('[DownloadManager] Song downloaded natively:', item.song.title);
      item.status = 'completed';
      item.completedAt = Date.now();
      item.progress = 100;
      this.sessionCompleted++;
      this.persistQueue();
      this.emit({ type: 'download-completed', item, progress: this.getProgress() });
      this.emit({ type: 'cache-updated' });
      this.scheduleAutoClear(item.id);

      await this.downloadCoverArt(item, serverUrl, username, password);

    } finally {
      if (progressHandle) progressHandle.remove();
    }
  }

  /**
   * iOS native background download: hands the HTTP transfer to URLSessionDownloadTask
   * so it survives WKWebView suspension. The Swift plugin writes the file directly to
   * permanent_cache/audio/<hash>/audio<ext> in the Documents directory, matching the
   * path capacitorBridge.saveAudioFile() produces. Completion is delivered via an event
   * that resolves the pending promise registered in iosPendingCallbacks.
   */
  private async downloadSongNativeIOS(
    item: DownloadQueueItem,
    streamUrl: string,
  ): Promise<void> {
    // iOS 14+: background URLSessions bypass the local-network permission dialog.
    // A foreground probe fires the dialog once so subsequent background downloads
    // are allowed. Errors are intentionally swallowed — we proceed regardless.
    if (!this.iosNetworkProbed) {
      this.iosNetworkProbed = true;
      await BackgroundDownload!.probeConnection({ url: streamUrl }).catch(() => {});
    }

    const audioHash = offlineCacheService.getAudioHash(item.song.id);

    // Register callbacks BEFORE startDownload to prevent a race where the native
    // side completes and fires the event before we're listening.
    // Single Promise merges the timeout so clearTimeout fires on every exit path.
    const result = await new Promise<{ audioHash: string; extension: string; fileSize: number }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.iosPendingCallbacks.delete(item.song.id);
          reject(new Error('iOS background download timed out — will retry'));
        }, 5 * 60 * 1000);

        this.iosPendingCallbacks.set(item.song.id, {
          resolve: (data) => { clearTimeout(timer); resolve(data); },
          reject:  (err)  => { clearTimeout(timer); reject(err); },
        });

        BackgroundDownload!.startDownload({
          url: streamUrl,
          songId: item.song.id,
          audioHash,
        }).catch((err: Error) => {
          clearTimeout(timer);
          this.iosPendingCallbacks.delete(item.song.id);
          reject(err);
        });
      }
    );

    await offlineCacheService.registerNativeDownload(
      item.song, item.quality,
      result.audioHash, result.extension, result.fileSize,
      item.artistId, item.artistCoverArtId
    );

    if (!offlineCacheService.isCached(item.song.id)) {
      throw new Error('File not found in cache after iOS background download — will retry');
    }

    logger.log('[DownloadManager] iOS background download complete:', item.song.title);
    item.status = 'completed';
    item.completedAt = Date.now();
    item.progress = 100;
    this.sessionCompleted++;
    this.persistQueue();
    this.emit({ type: 'download-completed', item, progress: this.getProgress() });
    this.emit({ type: 'cache-updated' });
    this.scheduleAutoClear(item.id);
  }

  /**
   * Electron / web download: streams audio through the JS fetch API.
   */
  private async downloadSongJS(
    item: DownloadQueueItem,
    streamUrl: string,
    serverUrl: string,
    username: string,
    password: string
  ): Promise<void> {
    // Keep the AbortController alive for the entire fetch + body read so the
    // stuck check can cancel both the initial request and a stalled read loop.
    const controller = new AbortController();
    this.currentAbortController = controller;

    try {
      const response = await fetch(streamUrl, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentLength    = parseInt(response.headers.get('content-length') || '0');
      const hasContentLength = contentLength > 0;
      this.currentContentLength = contentLength;

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Failed to get response reader');

      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;

        if (hasContentLength) {
          item.progress = Math.round((receivedBytes / contentLength) * 100);
        }
        this.emit({ type: 'download-progress', item, progress: this.getProgress() });
        this.pushDownloadNotification(receivedBytes, !hasContentLength);
      }

      const buffer = new Uint8Array(receivedBytes);
      let position = 0;
      for (const chunk of chunks) { buffer.set(chunk, position); position += chunk.length; }

      const contentType = response.headers.get('content-type') || 'audio/mpeg';
      let extension = '.mp3';
      if (contentType.includes('ogg')) extension = '.ogg';
      else if (contentType.includes('flac')) extension = '.flac';
      else if (contentType.includes('m4a')) extension = '.m4a';
      else if (contentType.includes('wav')) extension = '.wav';

      await offlineCacheService.addToCache(
        item.song, item.quality, buffer.buffer, extension, item.artistId, item.artistCoverArtId
      );

      if (!offlineCacheService.isCached(item.song.id)) {
        throw new Error('File not found in cache after download — will retry');
      }

      logger.log('[DownloadManager] Song downloaded successfully:', item.song.title);
      item.status = 'completed';
      item.completedAt = Date.now();
      item.progress = 100;
      this.sessionCompleted++;
      this.persistQueue();
      this.emit({ type: 'download-completed', item, progress: this.getProgress() });
      this.emit({ type: 'cache-updated' });
      this.scheduleAutoClear(item.id);

      await this.downloadCoverArt(item, serverUrl, username, password);
    } finally {
      this.currentAbortController = null;
    }
  }

  /**
   * Download and cache album + artist cover art for a completed song download.
   *
   * IMPORTANT: claim the dedup slot (add to the tracking Set) BEFORE any await
   * so that rapid concurrent songDownloaded events from the same album/artist
   * don't all pass the !has() check simultaneously and fire duplicate fetches.
   */
  private async downloadCoverArt(
    item: DownloadQueueItem,
    serverUrl: string,
    username: string,
    password: string
  ): Promise<void> {
    // ── Album cover art ──────────────────────────────────────────────────────
    if (item.song.coverArt) {
      const alreadyClaimed = this.downloadedAlbumCovers.has(item.albumId);

      // Claim the slot synchronously before any await so concurrent events
      // from the same album don't race past this guard.
      if (!alreadyClaimed) {
        this.downloadedAlbumCovers.add(item.albumId);
        this.albumCoverArtMap.set(item.albumId, item.song.coverArt);
      }

      if (!alreadyClaimed && !offlineCacheService.isCoverArtCached(item.song.coverArt)) {
        try {
          const salt  = Math.random().toString(36).substring(7);
          const token = md5(password + salt);
          const url   = `${serverUrl}/rest/getCoverArt.view?id=${item.song.coverArt}&u=${username}&t=${token}&s=${salt}&v=1.16.1&c=SubsonicMusicApp&f=json&size=500`;
          const res   = await fetch(url);
          if (res.ok) {
            const data = await res.arrayBuffer();
            const ct   = res.headers.get('content-type') || 'image/jpeg';
            const ext  = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
            await offlineCacheService.cacheCoverArt(item.song.coverArt, new Uint8Array(data), ext);
            // Apply any aliases that raced ahead before this download completed
            const pending = this.pendingCoverArtAliases.get(item.albumId) || [];
            this.pendingCoverArtAliases.delete(item.albumId);
            for (const aliasId of pending) {
              offlineCacheService.createCoverArtAlias(aliasId, item.song.coverArt).catch(() => {});
            }
          }
        } catch (e) {
          logger.warn('[DownloadManager] Failed to cache album cover art:', e);
        }
      } else if (alreadyClaimed && !offlineCacheService.isCoverArtCached(item.song.coverArt)) {
        // Different coverArt ID for the same album — alias to the primary
        const primaryId = this.albumCoverArtMap.get(item.albumId);
        if (primaryId && offlineCacheService.isCoverArtCached(primaryId)) {
          offlineCacheService.createCoverArtAlias(item.song.coverArt, primaryId).catch(() => {});
        } else {
          // Primary art is still downloading — buffer for when it completes
          const pending = this.pendingCoverArtAliases.get(item.albumId) || [];
          if (!pending.includes(item.song.coverArt)) pending.push(item.song.coverArt);
          this.pendingCoverArtAliases.set(item.albumId, pending);
        }
      }
    }

    // ── Artist cover art ─────────────────────────────────────────────────────
    const artistKey = item.artistId || item.artistName;
    if (item.artistCoverArtId && artistKey) {
      const alreadyClaimed = this.downloadedArtistCovers.has(artistKey);

      // Claim synchronously before any await.
      if (!alreadyClaimed) this.downloadedArtistCovers.add(artistKey);

      if (!alreadyClaimed && !offlineCacheService.isCoverArtCached(item.artistCoverArtId)) {
        let artistArtCached = false;
        try {
          const salt  = Math.random().toString(36).substring(7);
          const token = md5(password + salt);
          const url   = `${serverUrl}/rest/getCoverArt.view?id=${item.artistCoverArtId}&u=${username}&t=${token}&s=${salt}&v=1.16.1&c=SubsonicMusicApp&f=json&size=500`;
          const res   = await fetch(url);
          if (res.ok) {
            const data = await res.arrayBuffer();
            const ct   = res.headers.get('content-type') || 'image/jpeg';
            const ext  = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
            await offlineCacheService.cacheCoverArt(item.artistCoverArtId, new Uint8Array(data), ext);
            artistArtCached = true;
          }
        } catch (e) {
          logger.warn('[DownloadManager] Failed to cache artist cover art:', e);
        }

        if (!artistArtCached) {
          const albumCoverId = this.albumCoverArtMap.get(item.albumId) || item.song.coverArt;
          if (albumCoverId && offlineCacheService.isCoverArtCached(albumCoverId)) {
            offlineCacheService.createCoverArtAlias(item.artistCoverArtId, albumCoverId).catch(() => {});
          }
        }
      }
    }
  }

  private formatSpeed(bps: number): string {
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
    return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  }

  private pushDownloadNotification(receivedBytes: number, indeterminate: boolean = false): void {
    const now = Date.now();
    this.lastProgressMs = now;
    if (now - this.lastNotifMs < DownloadManagerService.NOTIF_INTERVAL_MS) return;
    this.lastNotifMs = now;

    // Rolling 3-second speed window
    this.speedSamples.push({ time: now, bytes: receivedBytes });
    this.speedSamples = this.speedSamples.filter(s => now - s.time <= 3000);
    if (this.speedSamples.length >= 2) {
      const oldest = this.speedSamples[0];
      const dt = (now - oldest.time) / 1000;
      this.downloadSpeedBps = dt > 0 ? (receivedBytes - oldest.bytes) / dt : 0;
    }

    const current = this.currentDownload;
    if (!current) return;

    const text = this.downloadSpeedBps > 1024 ? this.formatSpeed(this.downloadSpeedBps) : '';

    getBridge().showDownloadNotification({
      title: current.song.title,
      text,
      progress: current.progress,
      ongoing: true,
      indeterminate,
    }).catch(() => {});
  }

  private hideDownloadNotificationNow(): void {
    getBridge().hideDownloadNotification().catch(() => {});
  }

  /**
   * Convert quality to bitrate
   */
  private qualityToBitrate(quality: DownloadQuality): number | undefined {
    switch (quality) {
      case 'original': return undefined; // No transcoding
      case '320': return 320;
      case '256': return 256;
      case '128': return 128;
      case '64': return 64;
      default: return undefined;
    }
  }

  private startStuckCheck(): void {
    this.stopStuckCheck();
    this.stuckCheckInterval = setInterval(() => {
      if (!this.isDownloading) { this.stopStuckCheck(); return; }

      // Electron freezes the fetch body reader when the window is hidden.
      // lastProgressMs goes stale but the download isn't stuck — skip the check
      // to avoid aborting a download that will resume normally when refocused.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

      const stale = Date.now() - this.lastProgressMs;
      if (stale > DownloadManagerService.STUCK_THRESHOLD_MS) {
        // iOS native downloads have no JS progress updates — the URLSession delegate
        // feeds lastProgressMs via the downloadProgress event. Skip the abort here;
        // the stuck check keeps ticking and will fire if a genuine stall occurs.
        if (BackgroundDownload) return;
        logger.warn('[DownloadManager] Stuck JS download detected — aborting fetch');
        this.stopStuckCheck();
        // Abort the active fetch; the AbortError propagates through downloadSongJS →
        // downloadSong's catch block → normal retry logic. No state resets needed here.
        this.currentAbortController?.abort();
      }
    }, 10_000);
  }

  private stopStuckCheck(): void {
    if (this.stuckCheckInterval !== null) {
      clearInterval(this.stuckCheckInterval);
      this.stuckCheckInterval = null;
    }
  }

  /**
   * Schedule auto-clear for a completed download after 20 seconds
   */
  private scheduleAutoClear(itemId: string): void {
    // Clear any existing timeout for this item
    const existingTimeout = this.autoClearTimeouts.get(itemId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Schedule removal after 20 seconds
    const timeout = setTimeout(() => {
      const item = this.queue.find(i => i.id === itemId);
      
      // Only remove if still completed (not failed or paused)
      if (item && item.status === 'completed') {
        logger.log('[DownloadManager] Auto-clearing completed download:', item.song.title);
        this.removeFromQueue(itemId);
      }
      
      // Clean up timeout reference
      this.autoClearTimeouts.delete(itemId);
    }, 20000); // 20 seconds
    
    this.autoClearTimeouts.set(itemId, timeout);
  }
  
  /**
   * Clear auto-clear timeout for an item
   */
  private clearAutoClearTimeout(itemId: string): void {
    const timeout = this.autoClearTimeouts.get(itemId);
    if (timeout) {
      clearTimeout(timeout);
      this.autoClearTimeouts.delete(itemId);
    }
  }

  /**
   * Sanitize filename for safe file system storage
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid chars
      .replace(/\s+/g, ' ')           // Normalize spaces
      .trim()
      .substring(0, 100);             // Limit length
  }

  /**
   * Pause download queue
   */
  pauseQueue(): void {
    if (!this.isPaused) {
      this.isPaused = true;
      logger.log('[DownloadManager] Queue paused');
      this.emit({ type: 'queue-paused', progress: this.getProgress() });
    }
  }

  /**
   * Resume download queue
   */
  resumeQueue(): void {
    if (this.isPaused) {
      this.isPaused = false;
      logger.log('[DownloadManager] Queue resumed');
      this.emit({ type: 'queue-resumed', progress: this.getProgress() });
      
      if (!this.isDownloading) {
        this.processQueue();
      }
    }
  }

  /**
   * Clear completed and failed downloads from queue
   */
  clearCompleted(): void {
    const before = this.queue.length;
    const itemsToRemove = this.queue.filter(item =>
      item.status === 'completed' || item.status === 'failed'
    );
    const completedRemoved = itemsToRemove.filter(i => i.status === 'completed').length;
    const failedRemoved    = itemsToRemove.filter(i => i.status === 'failed').length;

    // Clear auto-clear timeouts for removed items
    itemsToRemove.forEach(item => this.clearAutoClearTimeout(item.id));

    this.queue = this.queue.filter(item =>
      item.status === 'pending' || item.status === 'downloading'
    );
    const removed = before - this.queue.length;

    // Adjust session counters so progress resets cleanly after a manual clear
    this.sessionTotal     = Math.max(0, this.sessionTotal     - completedRemoved - failedRemoved);
    this.sessionCompleted = Math.max(0, this.sessionCompleted - completedRemoved);
    this.sessionFailed    = Math.max(0, this.sessionFailed    - failedRemoved);

    if (removed > 0) {
      logger.log('[DownloadManager] Cleared', removed, 'completed/failed items');
      this.persistQueueNow();
      this.emit({ type: 'queue-updated', progress: this.getProgress() });
    }

    // If queue is now empty, clear cover art tracking
    if (this.queue.length === 0) {
      this.downloadedAlbumCovers.clear();
      this.downloadedArtistCovers.clear();
      this.albumCoverArtMap.clear();
      this.pendingCoverArtAliases.clear();
    }
  }

  /**
   * Retry all failed downloads
   */
  retryFailed(): void {
    const failedItems = this.queue.filter(item => item.status === 'failed');

    failedItems.forEach(item => {
      item.status = 'pending';
      item.error = undefined;
      item.retryCount = 0;
    });

    if (failedItems.length > 0) {
      // They're going back to pending — reverse the sessionFailed increment
      this.sessionFailed = Math.max(0, this.sessionFailed - failedItems.length);
      logger.log('[DownloadManager] Retrying', failedItems.length, 'failed downloads');
      this.emit({ type: 'queue-updated', progress: this.getProgress() });

      if (!this.isDownloading && !this.isPaused) {
        this.processQueue();
      }
    }
  }

  /**
   * Remove specific item from queue
   */
  removeFromQueue(itemId: string): void {
    this.clearAutoClearTimeout(itemId);
    this.queue = this.queue.filter(item => item.id !== itemId);
    this.persistQueueNow();
    this.emit({ type: 'queue-updated', progress: this.getProgress() });
  }

  /**
   * Clear entire queue.
   *
   * If a download is active, lets the current song finish to avoid leaving a
   * partial/corrupt file on disk, then wipes the queue. The UI immediately
   * reflects "stopping after current song" by dropping all other items.
   */
  clearQueue(): void {
    if (this.isDownloading) {
      // Signal the native thread to stop after the current song completes.
      if (NativeDownloader && this.useBatchMode) {
        NativeDownloader.cancelBatch().catch(() => {});
      }

      // Drop everything except the currently-downloading item so the UI shows
      // just the one song that is still in flight.
      this.autoClearTimeouts.forEach(timeout => clearTimeout(timeout));
      this.autoClearTimeouts.clear();
      this.queue = this.currentDownload ? [this.currentDownload] : [];
      this.pendingClear = true;
      this.sessionTotal     = this.queue.length;
      this.sessionCompleted = 0;
      this.sessionFailed    = 0;
      this.persistQueueNow();
      this.emit({ type: 'queue-updated', progress: this.getProgress() });
      return;
    }

    this._executeClear();
  }

  private _executeClear(): void {
    this.stopStuckCheck();
    this.autoClearTimeouts.forEach(timeout => clearTimeout(timeout));
    this.autoClearTimeouts.clear();
    this.queue = [];
    this.currentDownload = null;
    this.isDownloading = false;
    this.useBatchMode = true;
    this.pendingClear = false;
    this.sessionTotal = 0;
    this.sessionCompleted = 0;
    this.sessionFailed = 0;
    this.downloadedAlbumCovers.clear();
    this.downloadedArtistCovers.clear();
    this.albumCoverArtMap.clear();
    this.pendingCoverArtAliases.clear();
    logger.log('[DownloadManager] Queue cleared');
    this.persistQueueNow();
    this.notifyDownloadActive(false);
    this.hideDownloadNotificationNow();
    this.emit({ type: 'queue-updated', progress: this.getProgress() });
  }

  /**
   * Get current download progress
   */
  getProgress(): DownloadProgress {
    const totalSongs     = this.sessionTotal;
    const completedSongs = this.sessionCompleted;
    const failedSongs    = this.sessionFailed;
    // pending = everything not yet done (includes the currently-downloading item)
    const pendingSongs   = Math.max(0, totalSongs - completedSongs - failedSongs);

    let overallProgress = 0;
    if (totalSongs > 0) {
      // Only credit in-flight progress for the song that is currently downloading.
      // A completed song is already counted in completedSongs × 100; adding its
      // progress a second time makes overallProgress exceed 100%.
      const downloadingProgress = this.currentDownload?.status === 'downloading'
        ? (this.currentDownload.progress ?? 0)
        : 0;
      overallProgress = Math.min(100, Math.round((completedSongs * 100 + downloadingProgress) / totalSongs));
    }

    return {
      totalSongs,
      completedSongs,
      failedSongs,
      pendingSongs,
      currentSong: this.currentDownload || undefined,
      overallProgress,
      isPaused: this.isPaused,
      isDownloading: this.isDownloading,
      pendingClear: this.pendingClear,
    };
  }

  /**
   * Get queue items
   */
  getQueue(): DownloadQueueItem[] {
    return [...this.queue];
  }

  /**
   * Check if queue is empty
   */
  isQueueEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * Get queue status
   */
  getStatus(): { isPaused: boolean; isDownloading: boolean; queueLength: number } {
    return {
      isPaused: this.isPaused,
      isDownloading: this.isDownloading,
      queueLength: this.queue.length
    };
  }

  /**
   * iOS equivalent of the Android completion-log reconcile. When the app is woken
   * by the OS for a background URLSession event, the WebView may not be live yet.
   * The Swift plugin writes each completed download to UserDefaults so this startup
   * pass can register any songs whose event was never delivered to JS.
   */
  private async reconcileIOSOrphans(): Promise<void> {
    if (!BackgroundDownload) return;

    let entries: Array<{ songId: string; audioHash: string; extension: string; fileSize: number }>;
    try {
      const result = await BackgroundDownload.readCompletionLog();
      entries = result.entries ?? [];
    } catch {
      return;
    }
    if (entries.length === 0) return;

    let pending: Record<string, {
      song: DownloadableSong;
      quality: DownloadQuality;
      artistId?: string;
      artistCoverArtId?: string;
    }> = {};
    try {
      pending = JSON.parse(localStorage.getItem(DownloadManagerService.QUEUE_KEY) || '[]')
        .reduce((acc: any, item: any) => { acc[item.song?.id] = item; return acc; }, {});
    } catch {}

    let recovered = 0;
    for (const entry of entries) {
      if (offlineCacheService.isCached(entry.songId)) continue;
      const item = pending[entry.songId];
      if (!item) continue;
      try {
        await offlineCacheService.registerNativeDownload(
          item.song, item.quality, entry.audioHash, entry.extension, entry.fileSize,
          item.artistId, item.artistCoverArtId
        );
        recovered++;
      } catch (e) {
        logger.warn('[DownloadManager] reconcileIOSOrphans: failed to register', entry.songId, e);
      }
    }

    try { await BackgroundDownload.clearCompletionLog(); } catch {}

    if (recovered > 0) {
      logger.log(`[DownloadManager] iOS: recovered ${recovered} orphaned background downloads`);
      this.emit({ type: 'cache-updated' });
    }
  }

  /**
   * Re-register songs that were downloaded natively but whose songDownloaded event
   * was lost because the WebView renderer died mid-batch (e.g. Android OOM).
   *
   * Call on every app startup after the cache is initialized.
   * Reads the native completion log, cross-references against the JS cache index,
   * and registers any orphaned songs without re-downloading them.
   */
  public async reconcileOrphans(): Promise<void> {
    await this.reconcileIOSOrphans();
    if (!NativeDownloader) return;

    let entries: Array<{ hash: string; songId: string; extension: string; bytesReceived: number }>;
    try {
      const result = await NativeDownloader.readCompletionLog();
      entries = result.entries ?? [];
    } catch {
      return; // method not available in older APK — skip silently
    }
    if (entries.length === 0) return;

    let pending: Record<string, {
      song: DownloadableSong;
      quality: DownloadQuality;
      artistId?: string;
      artistCoverArtId?: string;
    }> = {};
    try {
      pending = JSON.parse(localStorage.getItem(DownloadManagerService.BATCH_PENDING_KEY) || '{}');
    } catch {}

    let recovered = 0;
    for (const entry of entries) {
      if (offlineCacheService.isCached(entry.songId)) continue;
      const item = pending[entry.songId];
      if (!item) continue;
      try {
        await offlineCacheService.registerNativeDownload(
          item.song, item.quality, entry.hash, entry.extension, entry.bytesReceived,
          item.artistId, item.artistCoverArtId
        );
        recovered++;
      } catch (e) {
        logger.warn('[DownloadManager] reconcileOrphans: failed to register', entry.songId, e);
      }
    }

    try { await NativeDownloader.clearCompletionLog(); } catch {}
    this.clearPendingBatch();

    if (recovered > 0) {
      logger.log(`[DownloadManager] Recovered ${recovered} orphaned songs from previous session`);
      this.emit({ type: 'cache-updated' });
    }
  }

  /**
   * Run permanent cache verification in the background.
   * Emits cache-verify-started, cache-verify-progress, and cache-verify-complete events.
   */
  private async runCacheVerification(): Promise<void> {
    if (this.isVerifying) return;
    this.isVerifying = true;
    const startMs = Date.now();

    this.emit({ type: 'cache-verify-started' });
    try {
      const result = await offlineCacheService.verifyPermanentCache((verified, total) => {
        this.emit({ type: 'cache-verify-progress', verifyProgress: { verified, total } });
      });
      this.emit({
        type: 'cache-verify-complete',
        verifyResult: { ...result, durationMs: Date.now() - startMs },
      });
    } catch (e) {
      logger.error('[DownloadManager] Cache verification failed:', e);
      this.emit({
        type: 'cache-verify-complete',
        verifyResult: { verified: 0, removed: 0, total: 0, durationMs: Date.now() - startMs },
      });
    } finally {
      this.isVerifying = false;
    }
  }

  /**
   * Manually trigger permanent cache verification (e.g. from the UI button).
   */
  public triggerCacheVerification(): void {
    if (!this.isVerifying) {
      this.runCacheVerification().catch(() => {});
    }
  }

  async clearAllNativeData(): Promise<void> {
    if (NativeDownloader) await NativeDownloader.clearAllNativeData();
  }
}

// Export singleton instance
export const downloadManager = new DownloadManagerService();
