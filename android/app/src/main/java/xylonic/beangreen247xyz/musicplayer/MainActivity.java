package xylonic.beangreen247xyz.musicplayer;

import android.Manifest;
import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.storage.StorageManager;
import android.os.storage.StorageVolume;
import android.provider.Settings;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERM_REQUEST_CODE = 1001;
    private long lastResumedAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SessionLog.start(this, savedInstanceState == null ? "launch" : "recreate");
        registerPlugin(MediaControlPlugin.class);
        registerPlugin(RemoteDiscoveryPlugin.class);
        registerPlugin(DownloadNotificationPlugin.class);
        registerPlugin(NativeDownloaderPlugin.class);
        registerPlugin(ScreenOrientationPlugin.class);
        registerPlugin(CacheStoragePlugin.class);

        // Lock portrait on phones; leave tablets and TVs free to rotate
        if (!isTabletOrTv()) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        }

        super.onCreate(savedInstanceState);
        // Register AFTER super.onCreate() so our callback sits on top of the LIFO stack
        // and runs before BridgeActivity's own OnBackPressedCallback. This fires a window
        // event that JS handles for in-app navigation instead of letting the framework exit.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Discard back events that fire during the Activity's opening transition.
                // A back gesture in-flight while the app is foregrounded fires immediately
                // on resume, causing the JS handler to call minimizeApp() and visibly
                // close the app. 400ms covers the standard enter animation (~300ms) + margin.
                if (System.currentTimeMillis() - lastResumedAt < 600) return;
                getBridge().triggerWindowJSEvent("backbutton");
            }
        });
        waitForSdCard();
        // Delay permission dialogs until after the WebView finishes its first-time
        // initialization. Showing a system dialog during cold-start init triggers
        // onPause() which can crash the Capacitor bridge on first launch.
        new Handler(Looper.getMainLooper()).postDelayed(
            this::requestRequiredPermissions, 1500);
        // Battery-optimisation check runs after the app is fully visible and interactive.
        // Calling it here (from MainActivity.onCreate) is the only guaranteed-reliable way
        // to launch a system settings dialog — plugin getActivity() can silently be null.
        new Handler(Looper.getMainLooper()).postDelayed(
            this::requestBatteryOptimization, 3000);
    }

    /**
     * Cold boot as Home app: if a removable SD card is present but still mounting (or is
     * expected to appear shortly after boot), cover the UI with a progress bar until it is
     * mounted, up to a timeout. No-op when no SD card is involved.
     */
    private void waitForSdCard() {
        final StorageManager sm = (StorageManager) getSystemService(Context.STORAGE_SERVICE);
        if (sm == null) return;
        final long start = SystemClock.elapsedRealtime();
        final boolean freshBoot = start < 60_000;
        if (!sdPending(sm, freshBoot, 0)) { SessionLog.i("sd", "no SD wait needed"); return; }
        SessionLog.i("sd", "waiting for SD card (freshBoot=" + freshBoot + ")");

        final long timeoutMs = 30_000;
        final FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(0xFF000000);
        overlay.setClickable(true);
        final ProgressBar bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(1000);
        final TextView label = new TextView(this);
        label.setText("Loading SD card\u2026");
        label.setTextColor(0xFFFFFFFF);
        label.setGravity(Gravity.CENTER);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        lp.setMargins(64, 0, 64, 0);
        FrameLayout.LayoutParams lpl = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER);
        lpl.setMargins(64, 0, 64, 120);
        overlay.addView(label, lpl);
        overlay.addView(bar, lp);
        addContentView(overlay, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        final Handler h = new Handler(Looper.getMainLooper());
        h.post(new Runnable() {
            @Override public void run() {
                long elapsed = SystemClock.elapsedRealtime() - start;
                bar.setProgress((int) Math.min(950, elapsed * 950 / timeoutMs));
                if (elapsed >= timeoutMs || !sdPending(sm, freshBoot, elapsed)) {
                    SessionLog.i("sd", (elapsed >= timeoutMs ? "SD wait TIMED OUT after " : "SD ready after ") + elapsed + "ms");
                    ViewGroup parent = (ViewGroup) overlay.getParent();
                    if (parent != null) parent.removeView(overlay);
                    return;
                }
                h.postDelayed(this, 250);
            }
        });
    }

    /** True while a removable volume exists and is not mounted, or none has shown up yet on a fresh boot. */
    private boolean sdPending(StorageManager sm, boolean freshBoot, long elapsedMs) {
        boolean found = false;
        for (StorageVolume v : sm.getStorageVolumes()) {
            if (!v.isRemovable() || v.isPrimary()) continue;
            found = true;
            String st = v.getState();
            if (!Environment.MEDIA_MOUNTED.equals(st) && !Environment.MEDIA_MOUNTED_READ_ONLY.equals(st)) {
                return true;
            }
        }
        // Card may not be enumerated yet right after boot: give it a short grace period.
        return !found && freshBoot && elapsedMs < 8_000;
    }

    /** Restores the app's normal orientation policy after a screen (Car Mode) forced landscape. */
    void restoreDefaultOrientation() {
        setRequestedOrientation(isTabletOrTv()
            ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            : ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
    }

    private boolean isTabletOrTv() {
        UiModeManager uiMode = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
        if (uiMode != null && uiMode.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
            return true;
        }
        return getResources().getConfiguration().smallestScreenWidthDp >= 600;
    }

    /**
     * Called by DownloadNotificationPlugin when a download session starts.
     * Runs on the main thread with a valid, resumed Activity — the only safe
     * place to launch the battery-optimisation system dialog.
     */
    void requestBatteryOptimization() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;

        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;

        String pkg = getPackageName();
        if (pm.isIgnoringBatteryOptimizations(pkg)) return; // already unrestricted

        // Primary: standard Android "Allow app to always run in the background?" dialog.
        // Accepting this is equivalent to choosing "Unrestricted" in battery settings.
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + pkg));
            startActivity(intent);
            return;
        } catch (Exception ignored) {}

        // Fallback A: app-specific battery page used by Samsung One UI / MIUI
        // (shows the Restricted / Optimised / Unrestricted three-way toggle).
        try {
            Intent intent = new Intent("android.settings.APP_BATTERY_USAGE_SETTINGS");
            intent.setData(Uri.fromParts("package", pkg, null));
            startActivity(intent);
            return;
        } catch (Exception ignored) {}

        // Fallback B: generic App Info → user taps Battery → Unrestricted
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.fromParts("package", pkg, null));
            startActivity(intent);
        } catch (Exception ignored) {}
    }

    /**
     * When downloads are active, counteract BridgeActivity's webView.onPause() which
     * tells Chrome to throttle JS timers.
     */
    @Override
    public void onPause() {
        super.onPause();
        SessionLog.i("lifecycle", "MainActivity onPause finishing=" + isFinishing());
        if (DownloadService.instance != null || MusicService.instance != null) {
            WebView wv = getBridge().getWebView();
            wv.onResume();
            wv.resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        SessionLog.i("lifecycle", "MainActivity onStop");
        if (DownloadService.instance != null || MusicService.instance != null) {
            WebView wv = getBridge().getWebView();
            wv.onResume();
            wv.resumeTimers();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        SessionLog.i("lifecycle", "MainActivity onResume");
        lastResumedAt = System.currentTimeMillis();
    }

    @Override
    public void onDestroy() {
        SessionLog.i("lifecycle", "MainActivity onDestroy finishing=" + isFinishing());
        super.onDestroy();
        if (isFinishing()) SessionLog.end("activity finished");
    }

    @Override
    public void onLowMemory() {
        SessionLog.i("memory", "onLowMemory");
        super.onLowMemory();
    }

    @Override
    public void onTrimMemory(int level) {
        SessionLog.i("memory", "onTrimMemory level=" + level);
        super.onTrimMemory(level);
    }

    private void requestRequiredPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{ Manifest.permission.POST_NOTIFICATIONS },
                        PERM_REQUEST_CODE);
            }
        }
    }
}
