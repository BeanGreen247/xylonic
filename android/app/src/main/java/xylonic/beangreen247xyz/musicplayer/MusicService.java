package xylonic.beangreen247xyz.musicplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.AudioManager;
import android.os.Build;
import android.content.pm.ServiceInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;
import androidx.palette.graphics.Palette;

import java.io.IOException;
import java.io.InputStream;
import java.net.URL;

public class MusicService extends Service {

    static final String CHANNEL_ID     = "xylonic_playback";
    static final int    NOTIF_ID       = 1;
    static final String ACTION_START   = "xylonic.action.START";
    static final String ACTION_STOP    = "xylonic.action.STOP";

    // Custom action IDs — used both in PlaybackState (API 33+) and as intent actions (fallback)
    static final String CUSTOM_LIKE    = "xylonic.custom.LIKE";
    static final String CUSTOM_REPEAT  = "xylonic.custom.REPEAT";

    public static MusicService instance = null;
    static MediaControlPlugin plugin = null;

    private MediaSessionCompat  mediaSession;
    private NotificationManager notifManager;
    private PowerManager.WakeLock wakeLock;
    private BroadcastReceiver   noisyReceiver    = null;
    private boolean             isPlaying        = false;
    private boolean             isForeground     = false;
    private boolean             isLiked          = false;
    // 0 = off, 1 = all, 2 = one
    private int                 repeatMode       = 0;
    private long                currentDurationMs  = 0;
    private long                currentPositionMs  = 0;
    private int                 albumDominantColor = Color.parseColor("#1a1a2e"); // fallback dark navy
    private final Handler       mainHandler        = new Handler(Looper.getMainLooper());
    private boolean             notifPending       = false;
    private static final int    NOTIF_DEBOUNCE_MS  = 200;
    // Cached fields so buildNotification() never depends on the session controller read-back
    private String              cachedTitle        = "";
    private String              cachedArtist       = "";
    private Bitmap              cachedArt          = null;
    private Bitmap              nextCachedArt      = null;
    private final java.util.concurrent.atomic.AtomicInteger artFetchGen = new java.util.concurrent.atomic.AtomicInteger(0);

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notifManager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);

        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Xylonic:MusicWakeLock");
        wakeLock.setReferenceCounted(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "Xylonic Playback", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Music playback controls");
            notifManager.createNotificationChannel(ch);
        }

        mediaSession = new MediaSessionCompat(this, "XylonicSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay()           { sendControl("play");     }
            @Override public void onPause()          { sendControl("pause");    }
            @Override public void onSkipToNext()     { sendControl("next");     }
            @Override public void onSkipToPrevious() { sendControl("previous_force"); }
            @Override public void onSeekTo(long pos) {
                if (plugin != null) plugin.notifySeek(pos);
            }

            // API 33+: custom action buttons in the notification are routed here
            @Override
            public void onCustomAction(String action, Bundle extras) {
                if (CUSTOM_LIKE.equals(action)) {
                    isLiked = !isLiked;
                    sendControl("like");
                    refreshPlaybackState();
                } else if (CUSTOM_REPEAT.equals(action)) {
                    cycleRepeat();
                }
            }
        });
        mediaSession.setPlaybackState(buildState(false, 0));
        mediaSession.setActive(true);

        noisyReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                    sendControl("pause");
                }
            }
        };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(noisyReceiver,
                new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(noisyReceiver,
                new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        }

        // startForeground intentionally NOT called here — only called on ACTION_START
        // to avoid ForegroundServiceStartNotAllowedException when launched from background

        // Replay any state updates that arrived before onCreate (race condition on first play)
        if (plugin != null) plugin.serviceStarted(this);
    }

    private void sendControl(String action) {
        if (plugin != null) plugin.notifyControl(action);
    }

    private void cycleRepeat() {
        repeatMode = (repeatMode + 1) % 3;
        String repeatAction = repeatMode == 0 ? "repeat_off"
                            : repeatMode == 1 ? "repeat_all"
                            :                   "repeat_one";
        sendControl(repeatAction);
        refreshPlaybackState();
    }

    // Debounced notification post — coalesces rapid calls into one update per NOTIF_DEBOUNCE_MS.
    // Prevents hitting Android's 5/s rate limit during bursts (song change + artwork + state).
    private void scheduleNotifUpdate() {
        if (!isForeground) return;
        if (notifPending) return;
        notifPending = true;
        mainHandler.postDelayed(() -> {
            notifPending = false;
            if (isForeground) notifManager.notify(NOTIF_ID, buildNotification());
        }, NOTIF_DEBOUNCE_MS);
    }

    // Rebuilds PlaybackState (refreshes custom action icons) and re-posts the notification
    private void refreshPlaybackState() {
        if (mediaSession == null) return;
        mediaSession.setPlaybackState(buildState(isPlaying, currentPositionMs));
        scheduleNotifUpdate();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Android restarted us after a kill (START_STICKY) — re-enter foreground
            goForeground();
            return START_STICKY;
        }

        if (ACTION_STOP.equals(intent.getAction())) {
            shutdown();
            return START_NOT_STICKY;
        }

        // Pre-API-33 fallback: custom buttons fire service intents instead of onCustomAction
        if (CUSTOM_LIKE.equals(intent.getAction())) {
            isLiked = !isLiked;
            sendControl("like");
            refreshPlaybackState();
            return START_STICKY;
        }

        if (CUSTOM_REPEAT.equals(intent.getAction())) {
            cycleRepeat();
            return START_STICKY;
        }

        // Route hardware / Bluetooth media button events through the session
        MediaButtonReceiver.handleIntent(mediaSession, intent);

        // If restarted by a media-button intent while not yet foreground (e.g., OEM killed the
        // service on task removal and MediaButtonReceiver restarted it), re-enter foreground so
        // the notification stays visible and the service isn't immediately eligible for OOM kill.
        if (!ACTION_START.equals(intent.getAction()) && !isForeground) {
            goForeground();
        }

        if (ACTION_START.equals(intent.getAction())) {
            // Apply metadata from intent extras — this arrives atomically with the service
            // start, so the notification is correct the first time startForeground() is called.
            String title      = intent.getStringExtra("title");
            String artist     = intent.getStringExtra("artist");
            String album      = intent.getStringExtra("album");
            String artworkUrl = intent.getStringExtra("artworkUrl");
            if (title != null && !title.isEmpty()) {
                updateMetadata(title, artist, album, artworkUrl);
            }
            goForeground();
        }

        return START_STICKY;
    }

    private void goForeground() {
        if (!wakeLock.isHeld()) wakeLock.acquire();
        if (!isForeground) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIF_ID, buildNotification(),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                } else {
                    startForeground(NOTIF_ID, buildNotification());
                }
                isForeground = true;
            } catch (Exception e) {
                // ForegroundServiceStartNotAllowedException (Android 12+) when called
                // from background — silently continue; session still works
            }
        } else {
            scheduleNotifUpdate();
        }
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ── Called by MediaControlPlugin ──────────────────────────────────────────

    void updateMetadata(String title, String artist, String album, String artworkUrl) {
        if (mediaSession == null) return;

        // Update cached fields immediately — buildNotification() reads from these, not the session
        cachedTitle  = title  != null ? title  : "";
        cachedArtist = artist != null ? artist : "";
        // Use preloaded next-song art immediately so the notification updates without delay
        cachedArt = nextCachedArt;
        nextCachedArt = null;
        albumDominantColor = Color.parseColor("#1a1a2e");

        // Push text-only metadata right away so the session (seek bar, lock screen) is current
        mediaSession.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE,  cachedTitle)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, cachedArtist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM,  album != null ? album : "")
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)
            .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, cachedArt)
            .build());
        scheduleNotifUpdate();

        // Fetch artwork + palette on a background thread, then re-post notification.
        // artworkUrl may be a remote http(s) URL or an inline data:image/...;base64,... URL
        // produced by reading cover art from the local permanent cache (works offline).
        if (artworkUrl == null || artworkUrl.isEmpty()) return;
        final String albumCopy = album != null ? album : "";
        final String artworkUrlCopy = artworkUrl;
        final int myGen = artFetchGen.incrementAndGet();
        new Thread(() -> {
            try {
                Bitmap bmp;
                if (artworkUrlCopy.startsWith("data:image/")) {
                    int commaIdx = artworkUrlCopy.indexOf(',');
                    if (commaIdx < 0) return;
                    byte[] bytes = android.util.Base64.decode(
                        artworkUrlCopy.substring(commaIdx + 1), android.util.Base64.DEFAULT);
                    bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                } else {
                    java.net.URLConnection conn = new URL(artworkUrlCopy).openConnection();
                    conn.setConnectTimeout(6000);
                    conn.setReadTimeout(10000);
                    bmp = BitmapFactory.decodeStream(conn.getInputStream());
                }
                if (bmp == null) return;

                Palette palette = Palette.from(bmp).maximumColorCount(8).generate();
                Palette.Swatch swatch = palette.getVibrantSwatch();
                if (swatch == null) swatch = palette.getDominantSwatch();
                if (swatch == null) swatch = palette.getDarkVibrantSwatch();
                final int color = swatch != null ? darkenColor(swatch.getRgb(), 0.55f)
                                                 : Color.parseColor("#1a1a2e");
                final Bitmap finalBmp = bmp;

                mainHandler.post(() -> {
                    if (mediaSession == null) return;
                    // Discard if a newer song's fetch has already completed
                    if (myGen != artFetchGen.get()) return;
                    cachedArt = scaleForNotification(finalBmp);
                    albumDominantColor = color;
                    mediaSession.setMetadata(new MediaMetadataCompat.Builder()
                        .putString(MediaMetadataCompat.METADATA_KEY_TITLE,  cachedTitle)
                        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, cachedArtist)
                        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM,  albumCopy)
                        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, currentDurationMs)
                        .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, cachedArt)
                        .build());
                    scheduleNotifUpdate();
                });
            } catch (Exception e) {
                android.util.Log.w("MusicService", "Artwork fetch failed: " + e);
            }
        }).start();
    }

    void updatePlaybackState(boolean playing, long positionMs, long durationMs) {
        if (mediaSession == null) return;
        isPlaying = playing;
        currentPositionMs = positionMs;

        // Patch duration into metadata whenever it changes so the seek bar stays accurate
        if (durationMs > 0 && durationMs != currentDurationMs) {
            currentDurationMs = durationMs;
            MediaMetadataCompat existing = mediaSession.getController().getMetadata();
            if (existing != null) {
                mediaSession.setMetadata(new MediaMetadataCompat.Builder(existing)
                    .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                    .build());
            }
        }
        mediaSession.setPlaybackState(buildState(playing, positionMs));
        scheduleNotifUpdate();
    }

    void updateShuffleRepeatLike(boolean liked, int repeat) {
        if (mediaSession == null) return;
        isLiked    = liked;
        repeatMode = repeat;
        refreshPlaybackState();
    }

    void preloadNextArtwork(String artworkUrl) {
        if (artworkUrl == null || artworkUrl.isEmpty()) return;
        new Thread(() -> {
            try {
                Bitmap bmp;
                if (artworkUrl.startsWith("data:image/")) {
                    int commaIdx = artworkUrl.indexOf(',');
                    if (commaIdx < 0) return;
                    byte[] bytes = android.util.Base64.decode(
                        artworkUrl.substring(commaIdx + 1), android.util.Base64.DEFAULT);
                    bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                } else {
                    java.net.URLConnection conn = new URL(artworkUrl).openConnection();
                    conn.setConnectTimeout(6000);
                    conn.setReadTimeout(10000);
                    bmp = BitmapFactory.decodeStream(conn.getInputStream());
                }
                if (bmp == null) return;
                final Bitmap scaled = scaleForNotification(bmp);
                mainHandler.post(() -> nextCachedArt = scaled);
            } catch (Exception e) {
                android.util.Log.w("MusicService", "Next artwork preload failed: " + e);
            }
        }).start();
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private PlaybackStateCompat buildState(boolean playing, long positionMs) {
        long actions = PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_SEEK_TO;

        int state = playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;

        // Custom actions — on API 33+ the system places these in the notification slots:
        // slot 0 (far-left): like/heart
        // slot 4 (far-right): repeat
        int likeIcon = isLiked ? R.drawable.ic_notif_heart_filled : R.drawable.ic_notif_heart_empty;
        String likeLabel = isLiked ? "Unlike" : "Like";

        int repeatIcon = repeatMode == 0 ? R.drawable.ic_notif_repeat_off
                       : repeatMode == 1 ? R.drawable.ic_notif_repeat
                       :                   R.drawable.ic_notif_repeat_one;
        String repeatLabel = repeatMode == 0 ? "Repeat Off"
                           : repeatMode == 1 ? "Repeat All"
                           :                   "Repeat One";

        return new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, positionMs, 1.0f)
            .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
                CUSTOM_LIKE, likeLabel, likeIcon).build())
            .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
                CUSTOM_REPEAT, repeatLabel, repeatIcon).build())
            .build();
    }

    private static Bitmap scaleForNotification(Bitmap bmp) {
        if (bmp == null) return null;
        int maxDim = 256;
        if (bmp.getWidth() <= maxDim && bmp.getHeight() <= maxDim) return bmp;
        float scale = Math.min((float) maxDim / bmp.getWidth(), (float) maxDim / bmp.getHeight());
        return Bitmap.createScaledBitmap(bmp,
            Math.round(bmp.getWidth() * scale), Math.round(bmp.getHeight() * scale), true);
    }

    // Darken a color by the given factor (0 = black, 1 = original)
    private static int darkenColor(int color, float factor) {
        float[] hsv = new float[3];
        Color.colorToHSV(color, hsv);
        hsv[2] *= factor;
        return Color.HSVToColor(hsv);
    }

    private PendingIntent buildActionIntent(String action) {
        Intent intent = new Intent(this, MusicService.class);
        intent.setAction(action);
        return PendingIntent.getService(this, action.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        PendingIntent prevPi      = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS);
        PendingIntent playPausePi = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_PLAY_PAUSE);
        PendingIntent nextPi      = MediaButtonReceiver.buildMediaButtonPendingIntent(
            this, PlaybackStateCompat.ACTION_SKIP_TO_NEXT);
        PendingIntent likePi      = buildActionIntent(CUSTOM_LIKE);
        PendingIntent repeatPi    = buildActionIntent(CUSTOM_REPEAT);

        String title  = cachedTitle.isEmpty()  ? "Xylonic" : cachedTitle;
        String artist = cachedArtist;
        Bitmap art    = cachedArt;

        int    ppIcon  = isPlaying ? R.drawable.ic_notif_pause : R.drawable.ic_notif_play;
        String ppLabel = isPlaying ? "Pause" : "Play";

        int    likeIcon  = isLiked ? R.drawable.ic_notif_heart_filled : R.drawable.ic_notif_heart_empty;
        String likeLabel = isLiked ? "Unlike" : "Like";

        int    repeatIcon  = repeatMode == 0 ? R.drawable.ic_notif_repeat_off
                          : repeatMode == 1 ? R.drawable.ic_notif_repeat
                          :                   R.drawable.ic_notif_repeat_one;
        String repeatLabel = repeatMode == 0 ? "Repeat Off"
                           : repeatMode == 1 ? "Repeat All"
                           :                   "Repeat One";

        // addAction() used by pre-API-33 — on API 33+ the system uses PlaybackState custom actions
        // Layout: Like(0) | Prev(1) | Play/Pause(2) | Next(3) | Repeat(4)
        // Compact view shows: 1, 2, 3
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(artist)
            .setSmallIcon(R.drawable.ic_notif_logo)
            .setLargeIcon(art)
            .setContentIntent(openPi)
            .setSilent(true)
            .setOngoing(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(albumDominantColor)
            .setColorized(true)
            .addAction(likeIcon,   likeLabel,   likePi)      // 0
            .addAction(R.drawable.ic_notif_prev,      "Previous",  prevPi)      // 1
            .addAction(ppIcon,     ppLabel,     playPausePi) // 2
            .addAction(R.drawable.ic_notif_next,      "Next",      nextPi)      // 3
            .addAction(repeatIcon, repeatLabel, repeatPi)    // 4
            .setStyle(new MediaStyle()
                .setMediaSession(mediaSession.getSessionToken())
                .setShowActionsInCompactView(1, 2, 3))
            .build();
    }

    private void shutdown() {
        cachedTitle  = "";
        cachedArtist = "";
        cachedArt    = null;
        albumDominantColor = Color.parseColor("#1a1a2e");
        mediaSession.setActive(false);
        if (isForeground) {
            stopForeground(true);
            isForeground = false;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (noisyReceiver != null) {
            unregisterReceiver(noisyReceiver);
            noisyReceiver = null;
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        instance = null;
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }
}
