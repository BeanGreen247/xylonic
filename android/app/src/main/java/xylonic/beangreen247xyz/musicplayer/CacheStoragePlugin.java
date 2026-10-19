package xylonic.beangreen247xyz.musicplayer;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Lets the user choose where the permanent cache is stored (internal storage, or another
 * volume the app can write to without extra permissions: the app-specific directory of an
 * SD card or adopted storage), moving what is already cached. Also opens the system's app
 * settings, where Android lets the user move the app itself to adoptable storage.
 */
@CapacitorPlugin(name = "CacheStorage")
public class CacheStoragePlugin extends Plugin {

    private volatile boolean moving = false;

    private static long sizeOf(File f) {
        if (f == null || !f.exists()) return 0;
        if (f.isFile()) return f.length();
        long total = 0;
        File[] children = f.listFiles();
        if (children != null) for (File c : children) total += sizeOf(c);
        return total;
    }

    private static boolean deleteTree(File f) {
        if (f == null || !f.exists()) return true;
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteTree(c);
        return f.delete();
    }

    private JSObject describe(String id, String label, File dir, boolean removable, File current) {
        JSObject o = new JSObject();
        o.put("id", id);
        o.put("label", label);
        o.put("path", dir.getAbsolutePath());
        o.put("freeBytes", dir.getUsableSpace());
        o.put("totalBytes", dir.getTotalSpace());
        o.put("removable", removable);
        o.put("selected", dir.equals(current));
        return o;
    }

    /** Every location the cache may live in: internal files plus each external volume's app directory. */
    private java.util.List<File> candidates(Context ctx) {
        java.util.List<File> list = new java.util.ArrayList<>();
        list.add(ctx.getFilesDir());
        File[] external = ctx.getExternalFilesDirs(null);
        if (external != null) {
            for (File dir : external) {
                if (dir != null && !list.contains(dir)
                    && Environment.MEDIA_MOUNTED.equals(Environment.getExternalStorageState(dir))) {
                    list.add(dir);
                }
            }
        }
        return list;
    }

    @PluginMethod
    public void getVolumes(PluginCall call) {
        Context ctx = getContext();
        File current = CacheStorage.base(ctx);
        JSArray volumes = new JSArray();
        java.util.List<File> dirs = candidates(ctx);
        for (int i = 0; i < dirs.size(); i++) {
            File dir = dirs.get(i);
            boolean removable = false;
            String label;
            if (i == 0) {
                label = "Internal storage";
            } else {
                try { removable = Environment.isExternalStorageRemovable(dir); } catch (Exception ignored) {}
                label = removable ? "SD card" : "Shared storage";
            }
            volumes.put(describe("v" + i, label, dir, removable, current));
        }
        JSObject result = new JSObject();
        result.put("volumes", volumes);
        result.put("cacheBytes", sizeOf(CacheStorage.root(ctx)));
        String stored = CacheStorage.storedBase(ctx);
        result.put("storedUnavailable", stored != null && !CacheStorage.isCustom(ctx));
        call.resolve(result);
    }

    /** The cache root the WebView should read and write ({} = the default internal location). */
    @PluginMethod
    public void getCacheRoot(PluginCall call) {
        JSObject result = new JSObject();
        Context ctx = getContext();
        if (CacheStorage.isCustom(ctx)) result.put("path", CacheStorage.root(ctx).getAbsolutePath());
        call.resolve(result);
    }

    /** Moves the cache to the chosen volume, then switches to it. Emits "moveProgress" while copying. */
    @PluginMethod
    public void setLocation(final PluginCall call) {
        final Context ctx = getContext();
        final String requested = call.getString("path");
        if (requested == null) { call.reject("No path"); return; }
        File target = null;
        for (File dir : candidates(ctx)) if (dir.getAbsolutePath().equals(requested)) target = dir;
        if (target == null) { call.reject("Not an allowed storage location"); return; }
        if (moving) { call.reject("A move is already running"); return; }
        final File targetBase = target;
        final File from = CacheStorage.root(ctx);
        final File to = new File(targetBase, "permanent_cache");
        if (from.equals(to)) { call.resolve(new JSObject()); return; }

        moving = true;
        new Thread(() -> {
            try {
                long total = sizeOf(from);
                if (targetBase.getUsableSpace() < total + total / 10 + (16L << 20)) {
                    throw new IOException("Not enough free space on that storage");
                }
                if (to.exists()) deleteTree(to);
                long[] copied = {0};
                long[] lastEmit = {0};
                copyTree(from, to, total, copied, lastEmit);
                emit(copied[0], total);
                CacheStorage.setBase(ctx, targetBase);
                deleteTree(from);
                JSObject ok = new JSObject();
                ok.put("movedBytes", copied[0]);
                call.resolve(ok);
            } catch (Exception e) {
                deleteTree(to); // keep the original untouched; drop the partial copy
                call.reject(e.getMessage() != null ? e.getMessage() : "Move failed");
            } finally {
                moving = false;
            }
        }).start();
    }

    private void copyTree(File from, File to, long total, long[] copied, long[] lastEmit) throws IOException {
        if (from.isDirectory()) {
            if (!to.exists() && !to.mkdirs()) throw new IOException("Cannot create " + to.getName());
            File[] children = from.listFiles();
            if (children != null) for (File c : children) copyTree(c, new File(to, c.getName()), total, copied, lastEmit);
            return;
        }
        File parent = to.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) throw new IOException("Cannot create " + parent.getName());
        try (InputStream in = new FileInputStream(from); OutputStream out = new FileOutputStream(to)) {
            byte[] buffer = new byte[256 * 1024];
            int n;
            while ((n = in.read(buffer)) > 0) {
                out.write(buffer, 0, n);
                copied[0] += n;
                long now = System.currentTimeMillis();
                if (now - lastEmit[0] > 250) { lastEmit[0] = now; emit(copied[0], total); }
            }
        }
    }

    private void emit(long copied, long total) {
        JSObject p = new JSObject();
        p.put("copiedBytes", copied);
        p.put("totalBytes", total);
        notifyListeners("moveProgress", p);
    }

    /** Opens this app's page in Android settings (Storage → Change moves the app to adoptable storage). */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }
}
