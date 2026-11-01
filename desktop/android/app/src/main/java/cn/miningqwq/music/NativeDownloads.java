package cn.miningqwq.music;

import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.CookieManager;
import android.webkit.URLUtil;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URI;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** User-initiated downloads use Android storage, never a browser tab or download panel. */
final class NativeDownloads {
    private static final long MAX_BYTES = 256L * 1024 * 1024;
    private final Context context;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Transfer> active = new HashMap<>();

    NativeDownloads(Context context) { this.context = context.getApplicationContext(); }

    void downloadUrl(String url, String agent, String name, String mime) {
        try {
            URI uri = URI.create(url);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null) return;
            String filename = safeName(name != null && !name.isEmpty() && !name.contains("filename=")
                    ? name : URLUtil.guessFileName(url, name, mime));
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(filename).setMimeType(mime);
            request.addRequestHeader("User-Agent", agent);
            if (NavigationPolicy.isTrusted(url)) {
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
            }
            if (Build.VERSION.SDK_INT >= 29)
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "MiningQwQMusic/" + filename);
            else request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, filename);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            context.getSystemService(DownloadManager.class).enqueue(request);
        } catch (IllegalArgumentException | SecurityException ignored) { /* no browser fallback */ }
    }

    void transfer(JSONObject message, Consumer<Boolean> done) {
        worker.execute(() -> {
            boolean success = false;
            String id = message.optString("id");
            try {
                switch (message.optString("type")) {
                    case "blob-start": start(id, message); break;
                    case "blob-chunk": append(id, message.optString("data")); break;
                    case "blob-end": finish(id); break;
                    default: throw new IOException("Unsupported transfer");
                }
                success = true;
            } catch (IOException | IllegalArgumentException | SecurityException e) { abort(id); }
            boolean result = success;
            main.post(() -> done.accept(result));
        });
    }

    private void start(String id, JSONObject message) throws IOException {
        long size = message.optLong("size", -1);
        if (id.isEmpty() || id.length() > 64 || active.size() >= 3 || active.containsKey(id) || size < 0 || size > MAX_BYTES)
            throw new IOException("Invalid transfer");
        String name = safeName(message.optString("name", "Music.mp3"));
        Uri destination;
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, message.optString("mime", "audio/mpeg"));
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MiningQwQMusic");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            destination = context.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        } else {
            File directory = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (directory == null) throw new IOException("Storage unavailable");
            File file = new File(directory, name);
            for (int n = 1; file.exists(); n++) file = new File(directory, n + "-" + name);
            destination = Uri.fromFile(file);
        }
        if (destination == null) throw new IOException("Storage unavailable");
        Transfer transfer = new Transfer(destination, size);
        active.put(id, transfer);
        transfer.stream = context.getContentResolver().openOutputStream(destination);
        if (transfer.stream == null) throw new IOException("Storage unavailable");
    }

    private void append(String id, String encoded) throws IOException {
        Transfer transfer = active.get(id);
        if (transfer == null || encoded.length() > 65536) throw new IOException("Invalid chunk");
        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
        if (transfer.written + bytes.length > transfer.expected) throw new IOException("Too much data");
        transfer.stream.write(bytes);
        transfer.written += bytes.length;
    }

    private void finish(String id) throws IOException {
        Transfer transfer = active.get(id);
        if (transfer == null || transfer.written != transfer.expected) throw new IOException("Incomplete download");
        transfer.stream.close();
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            context.getContentResolver().update(transfer.uri, values, null, null);
        }
        active.remove(id);
    }

    private void abort(String id) {
        Transfer transfer = active.remove(id);
        if (transfer == null) return;
        try { if (transfer.stream != null) transfer.stream.close(); } catch (IOException ignored) {}
        try {
            if ("file".equals(transfer.uri.getScheme())) new File(transfer.uri.getPath()).delete();
            else context.getContentResolver().delete(transfer.uri, null, null);
        } catch (RuntimeException ignored) {}
    }

    void close() {
        worker.execute(() -> { for (String id : active.keySet().toArray(new String[0])) abort(id); });
        worker.shutdown();
    }

    static String safeName(String name) {
        String safe = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ").trim();
        if (safe.isEmpty() || safe.equals(".") || safe.equals("..")) return "Music.mp3";
        return safe.substring(0, Math.min(150, safe.length()));
    }

    private static final class Transfer {
        final Uri uri;
        final long expected;
        OutputStream stream;
        long written;
        Transfer(Uri uri, long expected) { this.uri = uri; this.expected = expected; }
    }
}
