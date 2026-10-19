package xylonic.beangreen247xyz.musicplayer;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;

/**
 * Where the permanent cache (downloaded audio, cover art, indexes) lives. By default it is
 * the app's internal files directory; the user can pick another volume the app may write to
 * (see CacheStoragePlugin). Every native writer and the WebView's file access go through
 * this one resolver so they always agree. If the chosen volume is missing (an unmounted SD
 * card) it falls back to the internal directory without deleting anything.
 */
final class CacheStorage {
    private static final String PREFS = "xylonic_storage";
    private static final String KEY_BASE = "cache_base";

    private CacheStorage() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The directory that holds "permanent_cache": the chosen volume, or internal files. */
    static File base(Context ctx) {
        String chosen = prefs(ctx).getString(KEY_BASE, null);
        if (chosen != null) {
            File dir = new File(chosen);
            if (dir.isDirectory() && dir.canWrite()) return dir;
        }
        return ctx.getFilesDir();
    }

    /** The cache root itself. */
    static File root(Context ctx) {
        return new File(base(ctx), "permanent_cache");
    }

    /** True when a custom base is stored and currently usable. */
    static boolean isCustom(Context ctx) {
        return !base(ctx).equals(ctx.getFilesDir());
    }

    /** The user's stored choice, even if the volume is currently unavailable (null = internal). */
    static String storedBase(Context ctx) {
        return prefs(ctx).getString(KEY_BASE, null);
    }

    static void setBase(Context ctx, File base) {
        SharedPreferences.Editor editor = prefs(ctx).edit();
        if (base == null || base.equals(ctx.getFilesDir())) editor.remove(KEY_BASE);
        else editor.putString(KEY_BASE, base.getAbsolutePath());
        editor.commit();
    }
}
