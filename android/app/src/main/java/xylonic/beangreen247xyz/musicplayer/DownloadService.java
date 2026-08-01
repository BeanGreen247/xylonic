package xylonic.beangreen247xyz.musicplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileWriter;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class DownloadService extends Service {

    static final String CHANNEL_ID      = "xylonic_downloads";
    static final String CHANNEL_DONE_ID = "xylonic_downloads_done";
    static final int    NOTIF_ID        = 2;
    static final String ACTION_START    = "xylonic.download.START";
    static final String ACTION_STOP     = "xylonic.download.STOP";

    /** Safety-net wakelock duration — refreshed every watchdog tick so it never actually expires. */
    private static final long WAKELOCK_TIMEOUT_MS = 2 * 60 * 60 * 1000L; // 2 hours
    /** Stall threshold before the watchdog switches the notification to indeterminate. */
    private static final long JS_STALL_MS      = 4_000;
    private static final long WATCHDOG_TICK_MS = 2_000;

    public static volatile DownloadService instance = null;

    private NotificationManager notifManager;
    private PowerManager.WakeLock wakeLock;
    private Handler handler;

    private ExecutorService downloadExecutor;
    private volatile boolean isFileDownloading    = false;
    volatile boolean         cancelAfterCurrent   = false;

    // Broadcast targets for the active batch. Updated atomically when a new JS
    // session reconnects after a WebView renderer OOM so the ongoing native thread
    // sends events to the new WebView instead of the dead one.
    private volatile NativeDownloaderPlugin broadcastPlugin = null;
    private volatile PluginCall             batchCall       = null;

    private String  currentTitle    = "Downloading";
    private String  currentText     = "";
    private int     currentProgress = 0;
    private boolean indeterminate   = false;
    private boolean displayIndet    = false;
    private boolean isForeground    = false;
    private long    lastJsUpdateMs  = 0;

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (!isForeground) return;
            // Refresh the wakelock every tick so it never expires due to a backgrounded WebView
            // failing to send notification updates (which was the previous refresh mechanism).
            acquireWakeLock();
            if (lastJsUpdateMs > 0 &&
                    System.currentTimeMillis() - lastJsUpdateMs > JS_STALL_MS) {
                displayIndet = true;
                notifManager.notify(NOTIF_ID, buildOngoing());
            }
            handler.postDelayed(this, WATCHDOG_TICK_MS);
        }
    };

    // ─── Batch item ────────────────────────────────────────────────────────────

    static class BatchItem {
        final String url, hash, songId, title;
        BatchItem(String url, String hash, String songId, String title) {
            this.url = url; this.hash = hash;
            this.songId = songId; this.title = title;
        }
    }

    // ─── Lifecycle ─────────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        notifManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        downloadExecutor = Executors.newSingleThreadExecutor();

        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Xylonic:DownloadWakeLock");
        wakeLock.setReferenceCounted(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel progress = new NotificationChannel(
                CHANNEL_ID, "Download progress", NotificationManager.IMPORTANCE_LOW);
            progress.setDescription("Silent progress bar while songs are downloading");
            progress.setSound(null, null);
            notifManager.createNotificationChannel(progress);

            NotificationChannel done = new NotificationChannel(
                CHANNEL_DONE_ID, "Download complete", NotificationManager.IMPORTANCE_DEFAULT);
            done.setDescription("Plays a sound when all songs have finished downloading");
            notifManager.createNotificationChannel(done);
        }

        // Set instance LAST — after all fields are initialized — so other threads
        // that observe instance != null are guaranteed to see a fully-ready object.
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            acquireWakeLock();
            goForeground();
            return START_STICKY;
        }

        if (ACTION_STOP.equals(intent.getAction())) {
            shutdown();
            return START_NOT_STICKY;
        }

        String  title    = intent.getStringExtra("title");
        String  text     = intent.getStringExtra("text");
        int     progress = intent.getIntExtra("progress", currentProgress);
        boolean indet    = intent.getBooleanExtra("indeterminate", false);
        if (title != null) currentTitle   = title;
        if (text  != null) currentText    = text;
        currentProgress    = progress;
        this.indeterminate = indet;
        lastJsUpdateMs     = System.currentTimeMillis();
        displayIndet       = false;

        acquireWakeLock();
        goForeground();
        return START_STICKY;
    }

    // ─── Download execution ────────────────────────────────────────────────────

    /**
     * Submit a batch of songs to download sequentially on the service's protected
     * background thread. JS fires-and-forgets between songs; this thread never waits
     * for JS acknowledgement between items.
     *
     * @param singleSongCompat  When true, resolve the call with {extension, bytesReceived}
     *                          (legacy single-song API). When false, resolve with {done:true}
     *                          and emit songDownloaded/songFailed events per item.
     */
    void submitBatch(List<BatchItem> items, NativeDownloaderPlugin plugin,
                     PluginCall call, boolean singleSongCompat) {
        if (!singleSongCompat) {
            // Redirect broadcast targets to this JS session. If the WebView renderer
            // was OOM-killed while a batch was running, the existing native thread will
            // now fire events to the new WebView and resolve the new JS call when done —
            // no duplicate batch needed.
            broadcastPlugin = plugin;
            batchCall       = call;
            if (isFileDownloading) return;
        }

        isFileDownloading = true;
        acquireWakeLock();

        downloadExecutor.submit(() -> {
            String lastExtension = ".mp3";
            long   lastBytes     = 0;

            for (BatchItem item : items) {
                if (Thread.interrupted()) break;

                final File[] destRef = { null };
                try {
                    DownloadResult result = doDownload(
                        item.url, item.hash, item.songId, item.title, destRef,
                        singleSongCompat ? plugin : null);

                    lastExtension = result.extension;
                    lastBytes     = result.bytesReceived;

                    // Record completion natively before notifying JS.
                    // If the renderer process dies before JS receives songDownloaded,
                    // reconcileOrphans() on next launch reads this log and re-registers
                    // the song in the cache index without re-downloading.
                    appendCompletionLog(item.hash, item.songId, result.extension, result.bytesReceived);

                    if (singleSongCompat) {
                        // Legacy single-song: resolve immediately
                        final String ext   = result.extension;
                        final long   bytes = result.bytesReceived;
                        handler.post(() -> {
                            isFileDownloading = false;
                            JSObject res = new JSObject();
                            res.put("extension", ext);
                            res.put("bytesReceived", bytes);
                            call.resolve(res);
                        });
                        return; // single song — done
                    } else {
                        // Batch: fire songDownloaded event so JS can register cache index
                        // asynchronously. We don't wait for JS before starting next song.
                        final String ext   = result.extension;
                        final long   bytes = result.bytesReceived;
                        final String sid   = item.songId;
                        handler.post(() -> {
                            JSObject ev = new JSObject();
                            ev.put("songId",        sid);
                            ev.put("extension",     ext);
                            ev.put("bytesReceived", bytes);
                            NativeDownloaderPlugin p = broadcastPlugin;
                            if (p != null) p.broadcastSongDownloaded(ev);
                        });
                    }

                } catch (Exception e) {
                    if (destRef[0] != null && destRef[0].exists()) destRef[0].delete();
                    final String msg = e.getMessage() != null ? e.getMessage() : "Download failed";

                    if (singleSongCompat) {
                        handler.post(() -> {
                            isFileDownloading = false;
                            call.reject(msg);
                        });
                        return;
                    } else {
                        final String sid = item.songId;
                        handler.post(() -> {
                            JSObject ev = new JSObject();
                            ev.put("songId", sid);
                            ev.put("error",  msg);
                            NativeDownloaderPlugin p = broadcastPlugin;
                            if (p != null) p.broadcastSongFailed(ev);
                        });
                    }
                }

                // JS called cancelBatch() — finish the file we just wrote, then stop.
                if (cancelAfterCurrent) {
                    cancelAfterCurrent = false;
                    break;
                }
            }

            // All batch items done (or cancelled after current)
            handler.post(() -> {
                isFileDownloading = false;
                if (singleSongCompat) return; // already resolved above
                PluginCall bc = batchCall;
                if (bc != null) {
                    JSObject res = new JSObject();
                    res.put("done", true);
                    bc.resolve(res);
                    batchCall       = null;
                    broadcastPlugin = null;
                }
            });
        });
    }

    private DownloadResult doDownload(String urlStr, String hash, String songId,
                                      String title, File[] destRef,
                                      NativeDownloaderPlugin plugin) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(30_000);
        conn.setReadTimeout(300_000); // 5 min — covers slow servers / large FLAC
        conn.setInstanceFollowRedirects(true);
        conn.connect();

        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) throw new Exception("HTTP " + code);

        long   totalBytes = conn.getContentLengthLong();
        String extension  = extensionFrom(conn.getContentType());

        File destDir = new File(getFilesDir(), "permanent_cache/audio/" + hash);
        if (!destDir.exists() && !destDir.mkdirs())
            throw new Exception("Failed to create cache directory");

        File destFile = new File(destDir, "audio" + extension);
        destRef[0] = destFile;

        long receivedBytes  = 0;
        long lastProgressMs = 0;
        long windowStart    = System.currentTimeMillis();
        long windowBytes    = 0;
        long speedBps       = 0;

        try (InputStream in = conn.getInputStream();
             FileOutputStream out = new FileOutputStream(destFile)) {
            // 64 KB buffer — reduces syscall overhead vs the old 16 KB
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                receivedBytes += n;

                long now = System.currentTimeMillis();
                if (now - lastProgressMs >= 500) {
                    long dt = now - windowStart;
                    if (dt >= 1000) {
                        speedBps    = (long) ((receivedBytes - windowBytes) * 1000.0 / dt);
                        windowStart = now;
                        windowBytes = receivedBytes;
                    }

                    int pct = totalBytes > 0 ? (int) (receivedBytes * 100L / totalBytes) : 0;

                    final long fRec = receivedBytes;
                    final long fTot = totalBytes;
                    final long fSpd = speedBps;
                    final int  fPct = pct;

                    handler.post(() -> {
                        String speedText = fSpd > 1024 ? formatSpeed(fSpd) : "";
                        updateProgress(title, speedText, fPct, fTot <= 0);

                        // plugin is non-null for single-song-compat; null for batch (use broadcastPlugin)
                        NativeDownloaderPlugin p = (plugin != null) ? plugin : broadcastPlugin;
                        if (p != null) {
                            JSObject ev = new JSObject();
                            ev.put("songId",        songId);
                            ev.put("progress",      fPct);
                            ev.put("bytesReceived", fRec);
                            ev.put("totalBytes",    fTot);
                            ev.put("speedBps",      fSpd);
                            p.broadcastProgress(ev);
                        }
                    });

                    lastProgressMs = now;
                }
            }
        }

        return new DownloadResult(extension, receivedBytes);
    }

    private void appendCompletionLog(String hash, String songId, String extension, long bytesReceived) {
        try {
            File logFile = new File(getFilesDir(), "permanent_cache/completion_log.ndjson");
            File parent  = logFile.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            String line = "{\"hash\":\"" + hash + "\",\"songId\":\"" + songId
                        + "\",\"extension\":\"" + extension + "\",\"bytesReceived\":" + bytesReceived + "}\n";
            try (FileWriter fw = new FileWriter(logFile, true)) {
                fw.write(line);
            }
        } catch (Exception ignored) {}
    }

    private String extensionFrom(String contentType) {
        if (contentType == null) return ".mp3";
        String ct = contentType.toLowerCase();
        if (ct.contains("ogg"))                        return ".ogg";
        if (ct.contains("flac"))                       return ".flac";
        if (ct.contains("m4a") || ct.contains("mp4")) return ".m4a";
        if (ct.contains("wav"))                        return ".wav";
        return ".mp3";
    }

    private String formatSpeed(long bps) {
        if (bps < 1024L * 1024) return (bps / 1024) + " KB/s";
        return String.format("%.1f MB/s", bps / (1024.0 * 1024));
    }

    static class DownloadResult {
        final String extension;
        final long   bytesReceived;
        DownloadResult(String ext, long bytes) { extension = ext; bytesReceived = bytes; }
    }

    // ─── Notification / lifecycle ──────────────────────────────────────────────

    private void acquireWakeLock() {
        if (wakeLock == null) return;
        // Always call acquire() even when already held: with setReferenceCounted(false)
        // this removes the old scheduled-release callback and posts a fresh one, effectively
        // extending the timeout.  Guarding on isHeld() would prevent this refresh.
        wakeLock.acquire(WAKELOCK_TIMEOUT_MS);
    }

    private void goForeground() {
        if (!isForeground) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIF_ID, buildOngoing(),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIF_ID, buildOngoing());
                }
                isForeground = true;
                handler.post(watchdog);
            } catch (Exception ignored) { }
        } else {
            notifManager.notify(NOTIF_ID, buildOngoing());
        }
    }

    void updateProgress(String title, String text, int progress, boolean indeterminate) {
        currentTitle       = title;
        currentText        = text;
        currentProgress    = progress;
        this.indeterminate = indeterminate;
        lastJsUpdateMs     = System.currentTimeMillis();
        displayIndet       = false;
        if (isForeground) notifManager.notify(NOTIF_ID, buildOngoing());
    }

    void showComplete(String title, String text) {
        stopWatchdog();
        currentTitle    = title;
        currentText     = text;
        currentProgress = 100;
        indeterminate   = false;
        displayIndet    = false;

        releaseWakeLock();

        if (isForeground) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                stopForeground(Service.STOP_FOREGROUND_DETACH);
            } else {
                stopForeground(false);
            }
            isForeground = false;
        }

        Notification notif = new NotificationCompat.Builder(this, CHANNEL_DONE_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentText)
            .setSmallIcon(R.drawable.ic_notif_logo)
            .setOngoing(false)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
        notifManager.notify(NOTIF_ID, notif);

        stopSelf();
    }

    void shutdown() {
        stopWatchdog();
        releaseWakeLock();
        if (isForeground) {
            stopForeground(true);
            isForeground = false;
        }
        notifManager.cancel(NOTIF_ID);
        stopSelf();
    }

    private void stopWatchdog() {
        handler.removeCallbacks(watchdog);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    private Notification buildOngoing() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(currentTitle)
            .setContentText(currentText)
            .setSmallIcon(R.drawable.ic_notif_logo)
            .setProgress(100, currentProgress, displayIndet || indeterminate)
            .setOngoing(true)
            .setContentIntent(openPi)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        downloadExecutor.shutdownNow();
        stopWatchdog();
        releaseWakeLock();
        instance = null;
        super.onDestroy();
    }
}
