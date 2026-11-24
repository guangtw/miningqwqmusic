package cn.miningqwq.music;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Binder;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Base64;

import org.json.JSONObject;

/** Android transport and foreground lifetime for the single WebView audio player. */
public final class PlaybackService extends Service {
    interface Commands { void send(String action, long position); }
    final class LocalBinder extends Binder { PlaybackService service() { return PlaybackService.this; } }

    private static final String CHANNEL = "playback";
    private static final int CARD = 100;
    private static final long ACTIONS = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
            | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT
            | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final LocalBinder binder = new LocalBinder();
    private MediaSession session;
    private NotificationManager notifications;
    private PendingIntent openApp;
    private JSONObject track;
    private Bitmap artwork;
    private Commands commands;
    private boolean foreground, starting;
    private int state;
    private final Runnable demote = () -> {
        if (foreground) stopForeground(STOP_FOREGROUND_DETACH);
        foreground = false;
        stopSelf();
    };

    @Override public void onCreate() {
        super.onCreate();
        notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(CHANNEL, "音乐播放", NotificationManager.IMPORTANCE_LOW));
        openApp = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        session = new MediaSession(this, "MiningQwQMusic");
        session.setSessionActivity(openApp);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { command("play", 0); }
            @Override public void onPause() { command("pause", 0); }
            @Override public void onSkipToPrevious() { command("previous", 0); }
            @Override public void onSkipToNext() { command("next", 0); }
            @Override public void onSeekTo(long position) { command("seek", Math.max(0, position)); }
        });
    }

    void attach(Commands owner) { commands = owner; }

    void detach(Commands owner) {
        if (commands != owner) return;
        commands = null;
        clear();
    }

    void clear() {
        handler.removeCallbacks(demote);
        track = null;
        artwork = null;
        session.setActive(false);
        session.setMetadata(null);
        session.setPlaybackState(null);
        stopForeground(STOP_FOREGROUND_REMOVE);
        notifications.cancel(CARD);
        foreground = false;
        if (!starting) stopSelf();
    }

    void update(JSONObject snapshot) {
        if (snapshot.optString("id").isEmpty()) { clear(); return; }
        boolean changed = track == null || !snapshot.optString("id").equals(track.optString("id"));
        boolean coverChanged = changed || !snapshot.optString("cover").equals(track.optString("cover"));
        boolean metadataChanged = coverChanged || snapshot.optLong("duration") != track.optLong("duration")
                || !snapshot.optString("lyric").equals(track.optString("lyric"))
                || !snapshot.optString("title").equals(track.optString("title"))
                || !snapshot.optString("artist").equals(track.optString("artist"))
                || !snapshot.optString("album").equals(track.optString("album"));
        if (coverChanged) artwork = null;
        track = snapshot;
        if (metadataChanged) metadata();
        int previous = state;
        switch (track.optString("status")) {
            case "playing": state = PlaybackState.STATE_PLAYING; break;
            case "buffering": state = PlaybackState.STATE_BUFFERING; break;
            default: state = PlaybackState.STATE_PAUSED;
        }
        session.setPlaybackState(new PlaybackState.Builder().setActions(ACTIONS)
                .setState(state, Math.max(0, track.optLong("position")), state == PlaybackState.STATE_PLAYING ? 1f : 0f).build());
        session.setActive(true);
        if (state != PlaybackState.STATE_PAUSED) {
            handler.removeCallbacks(demote);
            if (!foreground && !starting) {
                try {
                    startForegroundService(new Intent(this, PlaybackService.class));
                    starting = true;
                } catch (IllegalStateException denied) {
                    // Android may defer foreground promotion if playback started in the background.
                }
            }
        } else if (foreground && state != previous) {
            handler.postDelayed(demote, 60_000);
        }
        if ((foreground || state == PlaybackState.STATE_PAUSED) && (metadataChanged || previous != state))
            refreshCard();
    }

    void artwork(JSONObject message) {
        if (track == null || !track.optString("id").equals(message.optString("id"))) return;
        String data = message.optString("jpeg");
        if (data.length() > 160_000) return;
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            BitmapFactory.Options size = new BitmapFactory.Options();
            size.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, size);
            if (size.outWidth != 256 || size.outHeight != 256) return;
            artwork = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            metadata();
            if (foreground || state == PlaybackState.STATE_PAUSED) refreshCard();
        } catch (IllegalArgumentException ignored) { /* Invalid image data. */ }
    }

    private String subtitle() {
        if (track == null) return "";
        String artist = track.optString("artist");
        String lyric = track.optString("lyric");
        if (lyric.isEmpty()) return artist;
        return artist.isEmpty() ? lyric : artist + " · " + lyric;
    }

    private void metadata() {
        session.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, track.optString("title"))
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE, track.optString("title"))
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, subtitle())
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_DESCRIPTION, track.optString("album"))
                .putString(MediaMetadata.METADATA_KEY_ALBUM_ART_URI, track.optString("cover"))
                .putString(MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI, track.optString("cover"))
                .putString(MediaMetadata.METADATA_KEY_ARTIST, track.optString("artist"))
                .putString(MediaMetadata.METADATA_KEY_ALBUM, track.optString("album"))
                .putLong(MediaMetadata.METADATA_KEY_DURATION, track.optLong("duration"))
                .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork).build());
    }

    private void command(String action, long position) {
        if (commands != null && track != null) commands.send(action, position);
    }

    private Notification.Action button(int icon, String label, String action) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        return new Notification.Action.Builder(android.graphics.drawable.Icon.createWithResource(this, icon), label,
                PendingIntent.getService(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)).build();
    }

    // An active MediaSession's MediaStyle notification is exempt on Android 13+.
    @android.annotation.SuppressLint("NotificationPermission")
    private void refreshCard() { notifications.notify(CARD, card()); }

    private Notification card() {
        boolean paused = state == PlaybackState.STATE_PAUSED;
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(track == null ? "音乐播放" : track.optString("title"))
                .setContentText(subtitle())
                .setCategory(Notification.CATEGORY_TRANSPORT)
                .setLargeIcon(artwork).setOnlyAlertOnce(true).setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC).setContentIntent(openApp)
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2))
                .addAction(button(android.R.drawable.ic_media_previous, "上一首", "previous"))
                .addAction(paused ? button(android.R.drawable.ic_media_play, "播放", "play")
                        : button(android.R.drawable.ic_media_pause, "暂停", "pause"))
                .addAction(button(android.R.drawable.ic_media_next, "下一首", "next")).build();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            command(intent.getAction(), 0);
            if (!foreground && !starting) stopSelf(startId);
        } else {
            starting = false;
            startForeground(CARD, card());
            foreground = true;
            if (track == null) clear();
            else if (state == PlaybackState.STATE_PAUSED) handler.postDelayed(demote, 60_000);
        }
        return START_NOT_STICKY;
    }

    @Override public IBinder onBind(Intent intent) { return binder; }
    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        session.release();
        notifications.cancel(CARD);
        super.onDestroy();
    }
}
