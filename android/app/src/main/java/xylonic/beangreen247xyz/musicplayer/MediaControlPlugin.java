package xylonic.beangreen247xyz.musicplayer;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MediaControl")
public class MediaControlPlugin extends Plugin {

    // Pending state — buffered when service hasn't started yet (MusicService.instance == null)
    private String  pendingTitle, pendingArtist, pendingAlbum, pendingArtwork;
    private boolean hasPendingMeta    = false;
    private boolean pendingIsPlaying;
    private long    pendingPositionMs, pendingDurationMs;
    private boolean hasPendingPlayback = false;
    private boolean pendingLiked;
    private int     pendingRepeatMode;
    private boolean hasPendingNotif   = false;

    @Override
    public void load() {
        MusicService.plugin = this;
    }

    // Called by MusicService.onCreate() after mediaSession is ready — replays buffered state
    void serviceStarted(MusicService svc) {
        if (hasPendingMeta) {
            svc.updateMetadata(pendingTitle, pendingArtist, pendingAlbum, pendingArtwork);
            hasPendingMeta = false;
        }
        if (hasPendingPlayback) {
            svc.updatePlaybackState(pendingIsPlaying, pendingPositionMs, pendingDurationMs);
            hasPendingPlayback = false;
        }
        if (hasPendingNotif) {
            svc.updateShuffleRepeatLike(pendingLiked, pendingRepeatMode);
            hasPendingNotif = false;
        }
    }

    // ── Service lifecycle ─────────────────────────────────────────────────────

    @PluginMethod
    public void startService(PluginCall call) {
        String title      = call.getString("title",      "");
        String artist     = call.getString("artist",     "");
        String album      = call.getString("album",      "");
        String artworkUrl = call.getString("artworkUrl", "");

        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(MusicService.ACTION_START);
        intent.putExtra("title",      title);
        intent.putExtra("artist",     artist);
        intent.putExtra("album",      album);
        intent.putExtra("artworkUrl", artworkUrl);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stopService(PluginCall call) {
        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(MusicService.ACTION_STOP);
        getContext().startService(intent);
        call.resolve();
    }

    // ── Metadata & state updates from JS ──────────────────────────────────────

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        String title      = call.getString("title",      "");
        String artist     = call.getString("artist",     "");
        String album      = call.getString("album",      "");
        String artworkUrl = call.getString("artworkUrl", "");

        MusicService svc = MusicService.instance;
        if (svc != null) {
            svc.updateMetadata(title, artist, album, artworkUrl);
        } else {
            pendingTitle = title; pendingArtist = artist;
            pendingAlbum = album; pendingArtwork = artworkUrl;
            hasPendingMeta = true;
        }
        call.resolve();
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        Boolean isPlaying  = call.getBoolean("isPlaying", false);
        Double  positionMs = call.getDouble("positionMs", 0.0);
        Double  durationMs = call.getDouble("durationMs", 0.0);

        MusicService svc = MusicService.instance;
        if (svc != null) {
            svc.updatePlaybackState(
                Boolean.TRUE.equals(isPlaying),
                positionMs.longValue(),
                durationMs.longValue()
            );
        } else {
            pendingIsPlaying  = Boolean.TRUE.equals(isPlaying);
            pendingPositionMs = positionMs.longValue();
            pendingDurationMs = durationMs.longValue();
            hasPendingPlayback = true;
        }
        call.resolve();
    }

    @PluginMethod
    public void updateShuffleRepeatLike(PluginCall call) {
        Boolean liked      = call.getBoolean("liked", false);
        // repeatMode: 0=off, 1=all, 2=one
        Integer repeatMode = call.getInt("repeatMode", 0);

        MusicService svc = MusicService.instance;
        if (svc != null) {
            svc.updateShuffleRepeatLike(
                Boolean.TRUE.equals(liked),
                repeatMode != null ? repeatMode : 0
            );
        } else {
            pendingLiked      = Boolean.TRUE.equals(liked);
            pendingRepeatMode = repeatMode != null ? repeatMode : 0;
            hasPendingNotif   = true;
        }
        call.resolve();
    }

    @PluginMethod
    public void preloadNextArtwork(PluginCall call) {
        String artworkUrl = call.getString("artworkUrl", "");
        MusicService svc = MusicService.instance;
        if (svc != null && artworkUrl != null && !artworkUrl.isEmpty()) {
            svc.preloadNextArtwork(artworkUrl);
        }
        call.resolve();
    }

    // ── Events fired TO JS ────────────────────────────────────────────────────

    void notifyControl(String action) {
        JSObject data = new JSObject();
        data.put("action", action);
        notifyListeners("mediaControl", data);
    }

    void notifySeek(long positionMs) {
        JSObject data = new JSObject();
        data.put("action", "seek");
        data.put("positionMs", positionMs);
        notifyListeners("mediaControl", data);
    }
}
