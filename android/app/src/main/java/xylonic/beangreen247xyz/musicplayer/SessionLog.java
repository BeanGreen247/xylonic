package xylonic.beangreen247xyz.musicplayer;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;
import android.os.SystemClock;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Verbose per-launch session log. Each app launch writes a new file
 * {@code xylonic-yyyyMMdd-HHmmss.log} under {@code <external files>/logs}
 * (pull with: adb pull /sdcard/Android/data/<pkg>/files/logs). Records lifecycle, SD wait,
 * playback transitions, uncaught crashes, a full copy of this process's logcat (which
 * includes WebView console output), and on the next launch how the previous process died.
 */
final class SessionLog {
    private static final int KEEP = 40;
    private static final String CLEAN_MARK = "SESSION END (clean)";
    private static final Object LOCK = new Object();
    private static PrintWriter out;
    private static File current;
    private static java.lang.Process logcat;
    private static boolean handlerInstalled;

    private SessionLog() {}

    private static String now() {
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US).format(new Date());
    }

    /** Starts a new session file (closing the previous one if this process still has it open). */
    static void start(Context ctx, String reason) {
        synchronized (LOCK) {
            Context app = ctx.getApplicationContext();
            if (out != null) endLocked("superseded by new launch");
            File dir = app.getExternalFilesDir("logs");
            if (dir == null) dir = new File(app.getFilesDir(), "logs");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            String prevNote = inspectPrevious(dir);
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
            current = new File(dir, "xylonic-" + stamp + ".log");
            try {
                out = new PrintWriter(new FileWriter(current, true), false);
            } catch (IOException e) {
                out = null;
                return;
            }
            writeLocked("SESSION START " + now() + " reason=" + reason);
            writeLocked("app=" + app.getPackageName() + " pid=" + android.os.Process.myPid()
                + " device=" + Build.MANUFACTURER + " " + Build.MODEL + " android=" + Build.VERSION.RELEASE
                + " sdk=" + Build.VERSION.SDK_INT + " uptime_s=" + SystemClock.elapsedRealtime() / 1000);
            writeLocked(prevNote);
            writeExitReasonsLocked(app);
            installCrashHandler();
            startLogcatLocked();
            prune(dir);
        }
    }

    private static String inspectPrevious(File dir) {
        File[] files = dir.listFiles((d, n) -> n.startsWith("xylonic-") && n.endsWith(".log"));
        if (files == null || files.length == 0) return "previous session: none";
        Arrays.sort(files, Comparator.comparing(File::getName));
        File last = files[files.length - 1];
        try (BufferedReader r = new BufferedReader(new java.io.FileReader(last))) {
            String line, tail = "";
            boolean clean = false;
            while ((line = r.readLine()) != null) {
                tail = line;
                if (line.contains(CLEAN_MARK) || line.contains("superseded by new launch")) clean = true;
            }
            return "previous session " + last.getName() + (clean ? ": ended cleanly"
                : ": DID NOT END CLEANLY (crash/kill/power loss). Last line: " + tail);
        } catch (IOException e) {
            return "previous session " + last.getName() + ": unreadable";
        }
    }

    private static void writeExitReasonsLocked(Context app) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return;
        try {
            ActivityManager am = (ActivityManager) app.getSystemService(Context.ACTIVITY_SERVICE);
            List<ApplicationExitInfo> list = am.getHistoricalProcessExitReasons(app.getPackageName(), 0, 3);
            for (ApplicationExitInfo i : list) {
                writeLocked("prior process exit: " + new Date(i.getTimestamp()) + " reason=" + i.getReason()
                    + " status=" + i.getStatus() + " importance=" + i.getImportance()
                    + " desc=" + i.getDescription());
            }
        } catch (Exception e) {
            writeLocked("exit-reason query failed: " + e);
        }
    }

    private static void installCrashHandler() {
        if (handlerInstalled) return;
        handlerInstalled = true;
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
            StringWriter sw = new StringWriter();
            e.printStackTrace(new PrintWriter(sw));
            synchronized (LOCK) {
                writeLocked("CRASH in thread '" + t.getName() + "' at " + now() + "\n" + sw);
                writeLocked("SESSION END (crash)");
            }
            if (prev != null) prev.uncaughtException(t, e);
        });
    }

    private static void startLogcatLocked() {
        if (logcat != null) logcat.destroy();
        try {
            logcat = new ProcessBuilder("logcat", "-v", "threadtime", "--pid=" + android.os.Process.myPid())
                .redirectErrorStream(true).start();
            final java.lang.Process p = logcat;
            Thread th = new Thread(() -> {
                try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null) {
                        synchronized (LOCK) {
                            if (p != logcat || out == null) return;
                            out.println("LC " + line);
                            out.flush();
                        }
                    }
                } catch (IOException ignored) {}
            }, "SessionLog-logcat");
            th.setDaemon(true);
            th.start();
        } catch (IOException e) {
            writeLocked("logcat capture unavailable: " + e);
        }
    }

    private static void prune(File dir) {
        File[] files = dir.listFiles((d, n) -> n.startsWith("xylonic-") && n.endsWith(".log"));
        if (files == null || files.length <= KEEP) return;
        Arrays.sort(files, Comparator.comparing(File::getName));
        for (int i = 0; i < files.length - KEEP; i++) {
            //noinspection ResultOfMethodCallIgnored
            files[i].delete();
        }
    }

    private static void writeLocked(String msg) {
        if (out == null) return;
        out.println(now() + " " + msg);
        out.flush();
    }

    /** Appends one event line. Safe from any thread. */
    static void i(String tag, String msg) {
        synchronized (LOCK) {
            writeLocked("[" + tag + "] " + msg);
        }
    }

    static void end(String why) {
        synchronized (LOCK) {
            endLocked(why);
        }
    }

    private static void endLocked(String why) {
        if (out == null) return;
        writeLocked(CLEAN_MARK.replace("(clean)", "(clean)") + " " + why);
        if (logcat != null) {
            logcat.destroy();
            logcat = null;
        }
        out.close();
        out = null;
    }
}
