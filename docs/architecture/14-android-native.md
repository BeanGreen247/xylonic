# Android Native Layer

Xylonic's Android build (via Capacitor 8) includes several native Java plugins that extend beyond what the WebView can do alone. All plugins are registered in `MainActivity.java` and exposed to JavaScript through the `PlatformBridge` interface (`src/platform/bridge.ts`). Electron and web builds receive silent no-op implementations of the same interface.

### Plugin Overview

| Plugin class | Capacitor name | Purpose |
|---|---|---|
| `MediaControlPlugin` | `MediaControl` | Drives the `MusicService` foreground service; controls playback notification and MediaSession |
| `RemoteDiscoveryPlugin` | `RemoteDiscovery` | UDP LAN discovery (port 7766) + HTTP command server (port 7767) for cross-device remote control |
| `DownloadNotificationPlugin` | `DownloadNotification` | Starts/updates/stops the `DownloadService` foreground service; relays speed/ETA from JS to native |
| `NativeDownloaderPlugin` | `NativeDownloader` | Thin Capacitor bridge; delegates all HTTP file download work to `DownloadService.submitDownload()` so the transfer runs entirely on a native Java thread, immune to WebView throttling |

### Download Notification & Background Service

#### Problem

Android aggressively throttles or kills WebView JS execution when an app is moved to the background. A `fetch()` streaming download stalls or aborts as soon as the user switches apps or turns the screen off.

#### Solution: Native `HttpURLConnection` inside `DownloadService`

The actual HTTP transfer is performed by a native Java thread inside `DownloadService`, completely independent of the WebView. Chrome throttling is irrelevant because no JS executes during the download.

```
JS downloadManagerService.ts (Android path)
        │  downloadSongNative()
        │  NativeDownloader.startDownload({ url, hash, songId, title })
        │
NativeDownloaderPlugin.java        ← thin Capacitor bridge
        │
        ├─ DownloadService.instance.submitDownload()  ← service already up
        └─ startForegroundService(intent) → 600 ms retry  ← first download
                │
        DownloadService.java               ← Android foreground service
                │  ExecutorService (single-thread queue)
                │  HttpURLConnection  ← native HTTP, no WebView involvement
                │  FileOutputStream  → permanent_cache/audio/{hash}/audio.ext
                │
                ├─ updateProgress()   → foreground notification (always live)
                └─ plugin.broadcastProgress() → JS `downloadProgress` event
                        │
                JS listener in downloadSongNative() → in-app progress UI
```

**Key behaviour:**

- `DownloadService` calls `startForeground()` with `FOREGROUND_SERVICE_TYPE_DATA_SYNC` (API 29+), signalling to Android that this process is doing meaningful background work and must not be killed.
- The download itself runs on `ExecutorService.newSingleThreadExecutor()` inside the service — not in the WebView. JS throttling has no effect on `HttpURLConnection`.
- `android:stopWithTask="false"` in `AndroidManifest.xml` keeps the service alive even when the user swipes the app from the recents screen.
- A `PowerManager.PARTIAL_WAKE_LOCK` prevents the CPU from sleeping mid-download when the screen turns off.
- `START_STICKY` causes Android to restart the service automatically if it is killed under memory pressure.
- The foreground notification is updated directly from the Java download thread every 500 ms, so it remains live regardless of JS state.
- After all downloads complete, `DownloadService` transitions to a non-ongoing "Downloads complete" notification, then stops itself. The JS side calls `hideDownloadNotification()` 4 seconds later to dismiss the completion notification.
- If the user clears the queue (`clearQueue()`), `DownloadService.shutdown()` is called immediately, cancelling both the notification and the service.

#### `NativeDownloaderPlugin` Bridge Detail

`NativeDownloaderPlugin` is deliberately minimal — it only bridges the Capacitor call to the service:

```java
@PluginMethod
public void startDownload(PluginCall call) {
    // Validate params, then:
    DownloadService svc = DownloadService.instance;
    if (svc != null) {
        svc.submitDownload(url, hash, songId, title, this, call);
    } else {
        // Start service, retry after 600 ms
        startForegroundService(new Intent(ACTION_START));
        mainHandler.postDelayed(() -> svc2.submitDownload(...), 600);
    }
}

void broadcastProgress(JSObject ev) {
    notifyListeners("downloadProgress", ev);  // → JS addListener callback
}
```

The TypeScript side uses `registerPlugin<NativeDownloaderPlugin>('NativeDownloader')` and splits on platform:

```typescript
// downloadManagerService.ts
private async downloadSong(item, ...): Promise<void> {
    if (Capacitor.isNativePlatform() && NativeDownloader) {
        return this.downloadSongNative(item, ...);   // → Java HttpURLConnection
    }
    return this.downloadSongJS(item, ...);            // → JS fetch() (Electron)
}
```

After a native download completes, `offlineCacheService.registerNativeDownload()` updates the audio registry and cache index without re-writing the audio bytes (the file is already on disk from the Java thread).

`registerNativeDownload` calls are serialized through a `registrationQueue: Promise<void>` chain in `downloadManagerService.ts`. Without this, 1000+ concurrent fire-and-forget registrations each serialize the full cache JSON, causing a V8 heap OOM crash in the WebView renderer.

#### Orphan Recovery (`reconcileOrphans`)

**Problem:** Android OOM kills the WebView renderer process during long downloads. `DownloadService` (in the main app process) continues writing files to `permanent_cache/audio/`, but `songDownloaded` events have nowhere to go — JS is dead. On the next launch those songs appear as failed even though their audio files exist.

**Three-part fix:**

1. **`DownloadService.java`** — `appendCompletionLog()` appends `{hash, songId, extension, bytesReceived}` to `permanent_cache/completion_log.ndjson` after every successful download, before notifying JS. The log file survives renderer death because it is written by the foreground service (main process).

2. **`NativeDownloaderPlugin.java`** — `readCompletionLog()` returns the log as a JS array; `clearCompletionLog()` deletes it after reconciliation.

3. **`downloadManagerService.ts`** — `savePendingBatch()` persists `{song, quality, artistId, artistCoverArtId}` keyed by `songId` to localStorage before submitting to native. `reconcileOrphans()` (public): reads completion log + pending map → registers unindexed songs via `registerNativeDownload()` → clears both stores. Called in `MainApp.tsx` before `tryResumeQueue()` on every app start.

#### Wakelock Watchdog

`DownloadService.java` holds a `PowerManager.PARTIAL_WAKE_LOCK` to prevent the CPU from sleeping mid-download. The lock is refreshed by a `Runnable` that calls `acquireWakeLock()` every 2 seconds, independently of any WebView/JS activity. This prevents the lock from expiring after ~30 minutes when Android backgrounds the WebView renderer.

#### Notification Channel

| Field | Value |
|---|---|
| Channel ID | `xylonic_downloads` |
| Channel name | Downloads |
| Importance | `IMPORTANCE_LOW` (silent, no heads-up) |
| Notification ID | `2` (distinct from music playback ID `1`) |

#### Speed & ETA Calculation (JS side)

`downloadManagerService.ts` maintains a rolling 3-second sample buffer of `{time, bytes}` pairs:

```
speed (bytes/sec) = (latestBytes − oldestBytes) / (latestTime − oldestTime)

ETA = (contentLength − receivedBytes) / speed          ← current song
    + pendingSongs × (contentLength / speed)            ← remaining songs (proxy)
```

Bridge calls are throttled to **one per 800 ms** to avoid flooding the Android notification manager. The formatted notification text looks like:

```
Title:  Song Name
Text:   3/10 songs · 2.4 MB/s · ~1m 30s
```

#### Bridge Interface Methods

```typescript
// bridge.ts
showDownloadNotification(opts: {
  title: string;    // current song name
  text: string;     // "3/10 songs · 2.4 MB/s · ~45s"
  progress: number; // 0–100 overall
  ongoing: boolean; // false = "complete" state
}): Promise<void>;

hideDownloadNotification(): Promise<void>;
```

- **Android**: routes through `DownloadNotificationPlugin` → `DownloadService`
- **Electron / web**: silent no-op (defined in `electronBridge.ts` and `fallbackBridge.ts`)

#### Android Manifest Declarations

```xml
<!-- Service declaration — stopWithTask=false keeps it alive after recents swipe -->
<service
    android:name=".DownloadService"
    android:foregroundServiceType="dataSync"
    android:exported="false"
    android:stopWithTask="false" />

<!-- Required permissions -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />
```

> **Android 14 note:** `dataSync` foreground services have a system-enforced 10-minute running limit on Android 14 (API 34). This is sufficient for typical album downloads. Very large batch downloads (>10 min) may need a future migration to `FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING` (API 35+).

#### Battery Optimization Exemption (`MainActivity`)

OEM "task killer" features (Doze, Samsung Adaptive Battery, MIUI MIUI Autostart) can terminate the foreground service or deny CPU time even with `PARTIAL_WAKE_LOCK`. To reliably prevent this, Xylonic requests the "Unrestricted" battery exemption on first launch:

```java
// MainActivity.java — called 3 s after onCreate() via Handler
void requestBatteryOptimization() {
    if (pm.isIgnoringBatteryOptimizations(pkg)) return; // already exempt

    // Primary: standard Android "Always run in background?" dialog
    startActivity(new Intent(ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                             Uri.parse("package:" + pkg)));

    // Fallback A: Samsung One UI / MIUI 3-way battery toggle
    // Fallback B: generic App Info page → Battery → Unrestricted
}
```

The 3-second delay avoids showing a system dialog during cold-start WebView initialisation (which triggers `onPause()` and can crash the Capacitor bridge). The call lives in `MainActivity` rather than any plugin because `getActivity()` in a Capacitor plugin can silently return `null` before the Activity is fully resumed.

### Music Playback Foreground Service (`MusicService`)

The existing `MusicService` (channel `xylonic_playback`, notification ID `1`) manages the media notification, MediaSession, and hardware/Bluetooth media button routing. It is a separate foreground service from `DownloadService` and both can run simultaneously without conflict.

```
MusicService   (mediaPlayback type)  →  notification ID 1  →  channel: xylonic_playback
DownloadService (dataSync type)       →  notification ID 2  →  channel: xylonic_downloads
```

---

**Last Updated:** July 6, 2026  
**Version:** 26.7.6
