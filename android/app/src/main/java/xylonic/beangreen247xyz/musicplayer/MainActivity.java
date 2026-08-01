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
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int PERM_REQUEST_CODE = 1001;
    private long lastResumedAt = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaControlPlugin.class);
        registerPlugin(RemoteDiscoveryPlugin.class);
        registerPlugin(DownloadNotificationPlugin.class);
        registerPlugin(NativeDownloaderPlugin.class);

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
        if (DownloadService.instance != null || MusicService.instance != null) {
            WebView wv = getBridge().getWebView();
            wv.onResume();
            wv.resumeTimers();
        }
    }

    @Override
    public void onStop() {
        super.onStop();
        if (DownloadService.instance != null || MusicService.instance != null) {
            WebView wv = getBridge().getWebView();
            wv.onResume();
            wv.resumeTimers();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        lastResumedAt = System.currentTimeMillis();
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
