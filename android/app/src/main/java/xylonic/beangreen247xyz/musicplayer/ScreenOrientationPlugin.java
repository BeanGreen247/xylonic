package xylonic.beangreen247xyz.musicplayer;

import android.content.pm.ActivityInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Lets a screen (Car Mode) request landscape. "landscape" follows the
 * accelerometer between both landscape orientations; "landscape-primary" and
 * "landscape-secondary" pin one of them (used by the flip button when the
 * sensor does not rotate the screen); "default" restores the app's policy.
 */
@CapacitorPlugin(name = "ScreenOrientation")
public class ScreenOrientationPlugin extends Plugin {

    @PluginMethod
    public void setMode(PluginCall call) {
        final String mode = call.getString("mode", "default");
        final MainActivity activity = (MainActivity) getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        activity.runOnUiThread(() -> {
            switch (mode) {
                case "landscape":
                    activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                    break;
                case "landscape-primary":
                    activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
                    break;
                case "landscape-secondary":
                    activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE);
                    break;
                default:
                    activity.restoreDefaultOrientation();
            }
            call.resolve();
        });
    }
}
