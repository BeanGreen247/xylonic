package xylonic.beangreen247xyz.musicplayer;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebStorage;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.List;

/**
 * Thin Capacitor bridge for native audio downloads.
 * Actual download work is executed by DownloadService so it runs entirely
 * inside the foreground-service process boundary, preventing OS kill.
 *
 * Events emitted to JS:
 *   downloadProgress  — per-chunk progress while a song is downloading
 *   songDownloaded    — a song finished successfully (JS should register cache index)
 *   songFailed        — a song failed (JS should mark it failed in queue)
 */
@CapacitorPlugin(name = "NativeDownloader")
public class NativeDownloaderPlugin extends Plugin {

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    // ─── Single-song download (kept for backward compat) ──────────────────────

    @PluginMethod
    public void startDownload(PluginCall call) {
        String url    = call.getString("url");
        String hash   = call.getString("hash");
        String songId = call.getString("songId");
        String title  = call.getString("title", "Downloading");

        if (url == null || hash == null || songId == null) {
            call.reject("Missing url, hash, or songId");
            return;
        }

        List<DownloadService.BatchItem> batch = new ArrayList<>();
        batch.add(new DownloadService.BatchItem(url, hash, songId, title));

        dispatchBatch(batch, call, true /* singleSongCompat */);
    }

    // ─── Batch download — downloads all items sequentially without JS round-trips ─

    @PluginMethod
    public void startBatch(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("Missing or empty items array");
            return;
        }

        List<DownloadService.BatchItem> batch = new ArrayList<>();
        for (int i = 0; i < items.length(); i++) {
            try {
                JSONObject obj = items.getJSONObject(i);
                batch.add(new DownloadService.BatchItem(
                    obj.getString("url"),
                    obj.getString("hash"),
                    obj.getString("songId"),
                    obj.optString("title", "Downloading")
                ));
            } catch (JSONException e) {
                call.reject("Invalid item at index " + i + ": " + e.getMessage());
                return;
            }
        }

        // Keep the call open until every song in the batch has finished.
        call.setKeepAlive(true);
        dispatchBatch(batch, call, false);
    }

    // ─── Cancel after current song ────────────────────────────────────────────

    @PluginMethod
    public void cancelBatch(PluginCall call) {
        DownloadService svc = DownloadService.instance;
        if (svc != null) svc.cancelAfterCurrent = true;
        call.resolve();
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    private void dispatchBatch(List<DownloadService.BatchItem> batch,
                                PluginCall call, boolean singleSongCompat) {
        DownloadService svc = DownloadService.instance;
        if (svc != null) {
            svc.submitBatch(batch, this, call, singleSongCompat);
        } else {
            Intent intent = new Intent(getContext(), DownloadService.class);
            intent.setAction(DownloadService.ACTION_START);
            intent.putExtra("title", batch.isEmpty() ? "Downloading" : batch.get(0).title);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            List<DownloadService.BatchItem> batchFinal = batch;
            mainHandler.postDelayed(() -> {
                DownloadService svc2 = DownloadService.instance;
                if (svc2 != null) {
                    svc2.submitBatch(batchFinal, this, call, singleSongCompat);
                } else {
                    call.reject("Download service failed to start");
                }
            }, 600);
        }
    }

    // ─── Orphan recovery ─────────────────────────────────────────────────────

    /**
     * Returns every line from permanent_cache/completion_log.ndjson as a JSON array.
     * Called on app startup; reconcileOrphans() in JS cross-references the entries
     * against the JS cache index and re-registers any songs whose songDownloaded event
     * was lost because the WebView renderer died mid-batch.
     */
    @PluginMethod
    public void readCompletionLog(PluginCall call) {
        File logFile = new File(getContext().getFilesDir(), "permanent_cache/completion_log.ndjson");
        JSArray entries = new JSArray();
        if (logFile.exists()) {
            try (BufferedReader br = new BufferedReader(new FileReader(logFile))) {
                String line;
                while ((line = br.readLine()) != null) {
                    line = line.trim();
                    if (line.isEmpty()) continue;
                    try {
                        entries.put(new JSONObject(line));
                    } catch (JSONException ignored) {}
                }
            } catch (Exception ignored) {}
        }
        JSObject result = new JSObject();
        result.put("entries", entries);
        call.resolve(result);
    }

    /** Deletes the completion log after reconcileOrphans() has processed it. */
    @PluginMethod
    public void clearCompletionLog(PluginCall call) {
        File logFile = new File(getContext().getFilesDir(), "permanent_cache/completion_log.ndjson");
        if (logFile.exists()) logFile.delete();
        call.resolve();
    }

    // ─── System-level data wipe ───────────────────────────────────────────────

    /**
     * Clears everything the JS layer cannot reach:
     *   • App HTTP cache directory (WebView disk cache lives here)
     *   • WebView cookies
     *   • WebView Web Storage (localStorage physical SQLite files, WebSQL)
     *   • All SharedPreferences files (Capacitor plugin storage, secure credentials)
     *
     * Must run on the main thread for WebStorage / CookieManager APIs.
     * Call resolve() is posted back after all deletes complete.
     */
    @PluginMethod
    public void clearAllNativeData(PluginCall call) {
        call.setKeepAlive(true);
        new Handler(Looper.getMainLooper()).post(() -> {
            try {
                Context ctx = getContext();

                // Permanent audio/cover-art cache — delete the whole tree so orphaned
                // files and other-user audio (skipped by JS ref-counting) are removed too.
                deleteRecursive(new File(ctx.getFilesDir(), "permanent_cache"));

                // WebView disk HTTP cache
                deleteRecursive(ctx.getCacheDir());

                // WebView cookies
                CookieManager mgr = CookieManager.getInstance();
                mgr.removeAllCookies(null);
                mgr.flush();

                // WebView localStorage / WebSQL physical files
                WebStorage.getInstance().deleteAllData();

                // SharedPreferences — Capacitor plugin data, secure credential cache, etc.
                File prefsDir = new File(ctx.getApplicationInfo().dataDir, "shared_prefs");
                deleteRecursive(prefsDir);

                call.resolve();
            } catch (Exception e) {
                call.reject("clearAllNativeData failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void minimizeApp(PluginCall call) {
        if (getActivity() == null) { call.reject("no activity"); return; }
        getActivity().moveTaskToBack(true);
        call.resolve();
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) for (File c : children) deleteRecursive(c);
        }
        f.delete();
    }

    // ─── Event helpers called by DownloadService ──────────────────────────────

    /** Per-chunk progress while a song is downloading. */
    void broadcastProgress(JSObject ev) {
        notifyListeners("downloadProgress", ev);
    }

    /** A song finished successfully; JS should register it in the cache index. */
    void broadcastSongDownloaded(JSObject ev) {
        notifyListeners("songDownloaded", ev);
    }

    /** A song failed; JS should mark it failed in the queue. */
    void broadcastSongFailed(JSObject ev) {
        notifyListeners("songFailed", ev);
    }
}
