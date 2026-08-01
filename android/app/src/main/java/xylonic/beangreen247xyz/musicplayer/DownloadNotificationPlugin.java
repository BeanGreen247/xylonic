package xylonic.beangreen247xyz.musicplayer;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DownloadNotification")
public class DownloadNotificationPlugin extends Plugin {

    @PluginMethod
    public void showProgress(PluginCall call) {
        String  title         = call.getString("title",        "Downloading");
        String  text          = call.getString("text",         "");
        Integer progress      = call.getInt("progress",        0);
        Boolean ongoing       = call.getBoolean("ongoing",     true);
        Boolean indeterminate = call.getBoolean("indeterminate", false);

        int     pct   = progress      != null ? progress      : 0;
        boolean indet = Boolean.TRUE.equals(indeterminate);

        if (Boolean.FALSE.equals(ongoing)) {
            DownloadService svc = DownloadService.instance;
            if (svc != null) {
                svc.showComplete(title, text);
            }
            call.resolve();
            return;
        }

        // ongoing == true: start or update the foreground service
        DownloadService svc = DownloadService.instance;
        if (svc != null) {
            svc.updateProgress(title, text, pct, indet);
        } else {
            Intent intent = new Intent(getContext(), DownloadService.class);
            intent.setAction(DownloadService.ACTION_START);
            intent.putExtra("title",         title);
            intent.putExtra("text",          text);
            intent.putExtra("progress",      pct);
            intent.putExtra("indeterminate", indet);
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    getContext().startForegroundService(intent);
                } else {
                    getContext().startService(intent);
                }
            } catch (Exception ignored) {
                // ForegroundServiceStartNotAllowedException on Android 12+ when called
                // from background — the next JS call (1 s later) will retry.
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void hide(PluginCall call) {
        DownloadService svc = DownloadService.instance;
        if (svc != null) {
            svc.shutdown();
        } else {
            android.app.NotificationManager nm = (android.app.NotificationManager)
                getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(DownloadService.NOTIF_ID);
        }
        call.resolve();
    }
}
