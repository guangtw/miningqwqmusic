package cn.miningqwq.music;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** OS-managed transfers with an app-private, verified offline library. */
final class NativeOfflineAudio {
    static final String MEDIA_PATH = "/__android/audio/";
    static final String SHELL_PATH = "/__android/offline";
    private static final long MIB = 1024L * 1024L;
    private static final long MAX_FILE = 256 * MIB;
    private static final long CACHE_TTL = 7 * 24 * 60 * 60 * 1000L;
    private static final Set<String> LEVELS = new HashSet<>(Arrays.asList("standard", "higher", "exhigh", "lossless", "hires",
            "jyeffect", "sky", "dolby", "jymaster"));
    private static final Set<String> TYPES = new HashSet<>(Arrays.asList("audio/mpeg", "audio/flac", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav"));

    private final Context context;
    private final DownloadManager downloads;
    private final SharedPreferences index;
    private final File directory;
    private static final ExecutorService worker = Executors.newSingleThreadExecutor();

    NativeOfflineAudio(Context context) {
        this.context = context.getApplicationContext();
        downloads = context.getSystemService(DownloadManager.class);
        index = context.getSharedPreferences("offline-audio-v1", Context.MODE_PRIVATE);
        directory = new File(context.getFilesDir(), "offline-audio-v1");
    }

    interface Reply { void send(JSONObject data, String error); }

    void dispatch(JSONObject message, Reply reply) {
        worker.execute(() -> {
            try {
                reply.send(run(message), null);
            } catch (OfflineException error) {
                reply.send(null, error.getMessage());
            } catch (JSONException | IllegalArgumentException error) {
                reply.send(null, "invalid_request");
            } catch (IOException | SecurityException | IllegalStateException error) {
                reply.send(null, "storage_unavailable");
            }
        });
    }

    private JSONObject run(JSONObject request) throws JSONException, IOException {
        switch (request.optString("type")) {
            case "offline-capabilities":
                return settings();
            case "offline-list":
                return list();
            case "offline-start":
                return start(request);
            case "offline-find":
                return find(request);
            case "offline-remove":
                erase(read(request.getString("id")));
                return new JSONObject();
            case "offline-set-cache":
                long budget = request.getLong("maxBytes");
                if (budget < 64 * MIB || budget > 1024 * MIB) throw new OfflineException("invalid_request");
                boolean enabled = request.getBoolean("enabled");
                if (!index.edit().putBoolean("enabled", enabled)
                        .putLong("budget", budget).commit()) throw new IOException("settings");
                if (!enabled) for (JSONObject row : rows()) {
                    if ("cache".equals(row.optString("kind")) && !"ready".equals(row.optString("status"))) erase(row);
                }
                trimCache(0);
                return settings();
            case "offline-clear-cache":
                for (JSONObject row : rows()) if ("cache".equals(row.optString("kind"))) erase(row);
                return new JSONObject();
            case "offline-invalidate":
                String trackId = request.getString("trackId");
                for (JSONObject row : rows()) {
                    if (trackId.equals(row.optString("trackId")) && "cache".equals(row.optString("kind"))) erase(row);
                }
                return new JSONObject();
            default:
                throw new OfflineException("invalid_request");
        }
    }

    private JSONObject settings() throws JSONException {
        return new JSONObject().put("version", 1).put("cacheEnabled", cacheEnabled())
                .put("maxCacheBytes", cacheBudget());
    }

    private boolean cacheEnabled() { return index.getBoolean("enabled", false); }
    private long cacheBudget() { return index.getLong("budget", 512 * MIB); }

    private JSONObject start(JSONObject request) throws JSONException, IOException {
        String kind = request.getString("kind");
        boolean cache = "cache".equals(kind);
        if (!cache && !"download".equals(kind)) throw new OfflineException("invalid_request");
        JSONObject track = request.getJSONObject("track");
        JSONObject source = request.getJSONObject("source");
        String trackId = track.getString("id");
        String quality = request.getString("quality");
        String actualQuality = source.getString("level");
        String md5 = source.getString("md5");
        String mime = source.getString("mime");
        long bytes = source.getLong("bytes");
        long duration = source.getLong("durationMs");
        String url = source.getString("url");
        if (!trackId.matches("[0-9]{1,24}") || !LEVELS.contains(quality) || !LEVELS.contains(actualQuality)
                || !md5.matches("[a-f0-9]{32}") || !TYPES.contains(mime) || !trustedSource(url)
                || bytes <= 0 || bytes > MAX_FILE || duration <= 0) {
            throw new OfflineException("unsupported_source");
        }
        if (cache && (!cacheEnabled() || !unmeteredNetwork())) return new JSONObject();

        int pending = 0;
        for (JSONObject row : rows()) {
            if (!kind.equals(row.optString("kind"))) continue;
            refresh(row);
            if (expired(row)) { erase(row); continue; }
            String status = row.getString("status");
            if ("queued".equals(status) || "transferring".equals(status)) pending++;
            if (!trackId.equals(row.optString("trackId")) || !quality.equals(row.optString("quality"))) continue;
            if (!"failed".equals(status) && (!cache || md5.equals(row.optString("md5")))) return publicRow(row);
            if ("queued".equals(status) || "transferring".equals(status)) pending--;
            erase(row);
        }
        if (pending >= (cache ? 1 : 3)) throw new OfflineException("queue_full");
        if (cache && (bytes > cacheBudget() || !trimCache(bytes))) return new JSONObject();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("directory");
        if (directory.getUsableSpace() < Math.max(16 * MIB, bytes) + 8 * MIB) throw new OfflineException("space_low");

        long now = System.currentTimeMillis();
        String id = UUID.randomUUID().toString();
        JSONObject row = new JSONObject().put("id", id).put("kind", kind).put("trackId", trackId)
                .put("name", limited(track.optString("name", trackId))).put("artist", limited(track.optString("artist")))
                .put("durationMs", duration).put("quality", quality).put("level", actualQuality)
                .put("mime", mime).put("bytes", bytes).put("md5", md5).put("writtenBytes", 0)
                .put("status", "queued").put("createdAt", now).put("lastUsedAt", now);
        DownloadManager.Request transfer = new DownloadManager.Request(Uri.parse(url));
        boolean unmeteredOnly = cache || request.optBoolean("unmeteredOnly", true);
        transfer.setDestinationInExternalFilesDir(context, "offline-transfers", id + ".part");
        transfer.setAllowedOverMetered(!unmeteredOnly).setAllowedOverRoaming(!unmeteredOnly);
        transfer.setTitle(row.getString("name")).setMimeType(mime)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
        write(row);
        long job = 0;
        try {
            job = downloads.enqueue(transfer);
            row.put("job", job);
            write(row);
        } catch (IOException | IllegalArgumentException | SecurityException | IllegalStateException error) {
            if (job > 0) downloads.remove(job);
            erase(row);
            throw error;
        }
        return publicRow(row);
    }

    private JSONObject list() throws IOException, JSONException {
        JSONArray entries = new JSONArray();
        List<JSONObject> rows = rows();
        rows.sort(Comparator.comparingLong((JSONObject row) -> row.optLong("createdAt")).reversed());
        for (JSONObject row : rows) {
            refresh(row);
            if (expired(row)) erase(row);
            else entries.put(publicRow(row));
        }
        return settings().put("entries", entries);
    }

    private JSONObject find(JSONObject request) throws IOException, JSONException {
        String trackId = request.getString("trackId");
        String quality = request.getString("quality");
        String md5 = request.optString("md5");
        String entryId = request.optString("id");
        boolean anyQuality = request.optBoolean("anyQuality");
        JSONObject best = null;
        int rank = -1;
        for (JSONObject row : rows()) {
            if (!trackId.equals(row.optString("trackId")) || (!entryId.isEmpty() && !entryId.equals(row.optString("id")))) continue;
            boolean requestedQuality = quality.equals(row.optString("quality"));
            boolean actualQuality = quality.equals(row.optString("level"));
            if (!anyQuality && !requestedQuality && !actualQuality) continue;
            if (!md5.isEmpty() && !md5.equals(row.optString("md5"))) {
                // An accepted online source now identifies different content for this track and quality.
                if (requestedQuality && "cache".equals(row.optString("kind"))) erase(row);
                continue;
            }
            refresh(row);
            if (expired(row)) { erase(row); continue; }
            if (!"ready".equals(row.optString("status"))) continue;
            int candidate = (requestedQuality ? 4 : actualQuality ? 2 : 0) + ("download".equals(row.optString("kind")) ? 1 : 0);
            if (candidate > rank) { best = row; rank = candidate; }
        }
        if (best == null) return new JSONObject();
        best.put("lastUsedAt", System.currentTimeMillis());
        write(best);
        return publicRow(best).put("url", NavigationPolicy.ORIGIN + MEDIA_PATH + best.getString("id"));
    }

    private void refresh(JSONObject row) throws IOException, JSONException {
        String status = row.getString("status");
        if ("ready".equals(status)) {
            if (!file(row.getString("id")).isFile()) fail(row, "file_missing");
            return;
        }
        if ("failed".equals(status)) return;
        long job = row.optLong("job");
        if (job <= 0) { fail(row, "interrupted"); return; }
        try (Cursor cursor = downloads.query(new DownloadManager.Query().setFilterById(job))) {
            if (cursor == null || !cursor.moveToFirst()) { fail(row, "interrupted"); return; }
            int state = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long written = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long expected = row.optLong("bytes");
            if (written > MAX_FILE || (expected > 0 && written > expected)) { fail(row, "integrity_failed"); return; }
            row.put("writtenBytes", Math.max(0, written));
            if (state == DownloadManager.STATUS_SUCCESSFUL) {
                verify(row, job);
            } else if (state == DownloadManager.STATUS_FAILED) {
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                fail(row, reason == DownloadManager.ERROR_INSUFFICIENT_SPACE ? "space_low" : "transfer_failed");
            } else {
                row.put("status", state == DownloadManager.STATUS_RUNNING ? "transferring" : "queued");
                // Progress is read from the system. Only transitions requiring persistence write to disk.
            }
        }
    }

    private void verify(JSONObject row, long job) throws IOException, JSONException {
        String id = row.getString("id");
        File staging = new File(directory, id + ".part");
        File destination = file(id);
        try {
            long expected = row.optLong("bytes");
            try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(downloads.openDownloadedFile(job));
                 FileOutputStream output = new FileOutputStream(staging)) {
                if (!copyVerified(input, output, expected, row.getString("md5"))) throw new OfflineException("integrity_failed");
                output.getFD().sync();
            }
            if (!validDuration(staging, row.getLong("durationMs"))) throw new OfflineException("integrity_failed");
            if (!staging.renameTo(destination)) throw new IOException("rename");
            row.put("status", "ready").put("writtenBytes", expected)
                    .put("verifiedAt", System.currentTimeMillis());
            write(row);
            downloads.remove(job);
        } catch (OfflineException error) {
            fail(row, error.getMessage());
        } catch (IOException | NoSuchAlgorithmException error) {
            fail(row, "storage_unavailable");
        } finally {
            staging.delete();
        }
    }

    static boolean copyVerified(InputStream input, OutputStream output, long expected, String md5)
            throws IOException, NoSuchAlgorithmException {
        if (expected <= 0 || expected > MAX_FILE) return false;
        MessageDigest digest = MessageDigest.getInstance("MD5");
        byte[] buffer = new byte[64 * 1024];
        long length = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            length += count;
            if (length > expected) return false;
            digest.update(buffer, 0, count);
            output.write(buffer, 0, count);
        }
        StringBuilder hex = new StringBuilder(32);
        for (byte value : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return length == expected && md5.contentEquals(hex);
    }

    private static boolean validDuration(File file, long expected) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(file.getAbsolutePath());
            long duration = Long.parseLong(retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));
            long tolerance = Math.max(4000, Math.min(10_000, expected / 30));
            return duration > 0 && Math.abs(duration - expected) <= tolerance;
        } catch (RuntimeException error) {
            return false;
        } finally {
            try { retriever.release(); } catch (IOException | RuntimeException ignored) {}
        }
    }

    private boolean trimCache(long additional) throws JSONException, IOException {
        List<JSONObject> cache = new ArrayList<>();
        long total = additional;
        for (JSONObject row : rows()) {
            if (!"cache".equals(row.optString("kind"))) continue;
            refresh(row);
            if (expired(row) || "failed".equals(row.optString("status"))) { erase(row); continue; }
            cache.add(row);
            total += row.optLong("bytes");
        }
        cache.sort(Comparator.comparingLong((JSONObject row) -> row.optLong("lastUsedAt")));
        for (JSONObject row : cache) {
            if (total <= cacheBudget()) break;
            erase(row);
            total -= row.optLong("bytes");
        }
        return total <= cacheBudget();
    }

    private boolean expired(JSONObject row) {
        return "cache".equals(row.optString("kind")) && "ready".equals(row.optString("status"))
                && System.currentTimeMillis() - row.optLong("verifiedAt") >= CACHE_TTL;
    }

    private void fail(JSONObject row, String code) throws IOException, JSONException {
        long job = row.optLong("job");
        if (job > 0) downloads.remove(job);
        file(row.getString("id")).delete();
        row.put("status", "failed").put("error", code);
        row.remove("job");
        write(row);
    }

    private void erase(JSONObject row) throws IOException {
        if (row == null) return;
        long job = row.optLong("job");
        if (job > 0) downloads.remove(job);
        String id = row.optString("id");
        if (!index.edit().remove("entry:" + id).commit()) throw new IOException("index");
        file(id).delete();
        new File(directory, id + ".part").delete();
    }

    private File file(String id) { return new File(directory, id + ".audio"); }

    private void write(JSONObject row) throws IOException, JSONException {
        if (!index.edit().putString("entry:" + row.getString("id"), row.toString()).commit()) throw new IOException("index");
    }

    private JSONObject read(String id) {
        if (!id.matches("[a-f0-9-]{36}")) return null;
        String value = index.getString("entry:" + id, null);
        if (value == null) return null;
        try { return new JSONObject(value); } catch (JSONException error) { return null; }
    }

    private List<JSONObject> rows() {
        List<JSONObject> rows = new ArrayList<>();
        for (String key : index.getAll().keySet()) {
            if (!key.startsWith("entry:")) continue;
            JSONObject row = read(key.substring(6));
            if (row != null) rows.add(row);
        }
        return rows;
    }

    private static JSONObject publicRow(JSONObject row) throws JSONException {
        JSONObject copy = new JSONObject(row.toString());
        copy.remove("job");
        copy.remove("md5");
        return copy;
    }

    private boolean unmeteredNetwork() {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        NetworkCapabilities network = manager.getNetworkCapabilities(manager.getActiveNetwork());
        return network != null && network.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                && network.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
    }

    private static String limited(String text) { return text.substring(0, Math.min(text.length(), 256)); }

    static boolean trustedSource(String value) {
        try {
            URI url = URI.create(value);
            return "https".equalsIgnoreCase(url.getScheme()) && url.getPort() == -1 && url.getRawUserInfo() == null
                    && url.getHost() != null && url.getHost().toLowerCase(Locale.ROOT).endsWith(".music.126.net");
        } catch (IllegalArgumentException error) { return false; }
    }

    WebResourceResponse serveAudio(WebResourceRequest request) {
        String path = request.getUrl().getPath();
        if (path == null || !path.startsWith(MEDIA_PATH)) return null;
        JSONObject row = read(path.substring(MEDIA_PATH.length()));
        if (request.isForMainFrame() || !"GET".equals(request.getMethod()) || row == null ||
                !"ready".equals(row.optString("status")) || expired(row)) {
            return empty(404, "Not Found", Collections.emptyMap());
        }
        File file = file(row.optString("id"));
        long size = file.length();
        if (size <= 0 || size != row.optLong("bytes")) return empty(404, "Not Found", Collections.emptyMap());
        String range = null;
        for (Map.Entry<String, String> header : request.getRequestHeaders().entrySet()) {
            if ("range".equalsIgnoreCase(header.getKey())) range = header.getValue();
        }
        long[] bounds = AudioByteRange.bounds(range, size);
        if (bounds == null) {
            return empty(416, "Range Not Satisfiable", Collections.singletonMap("Content-Range", "bytes */" + size));
        }
        long length = bounds[1] - bounds[0] + 1;
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept-Ranges", "bytes");
        headers.put("Content-Length", String.valueOf(length));
        headers.put("Cache-Control", "no-store");
        if (range != null) {
            headers.put("Content-Range", "bytes " + bounds[0] + "-" + bounds[1] + "/" + size);
        }
        try {
            FileInputStream input = new FileInputStream(file);
            try { input.getChannel().position(bounds[0]); }
            catch (IOException error) { input.close(); throw error; }
            return new WebResourceResponse(row.optString("mime"), null, range == null ? 200 : 206,
                    range == null ? "OK" : "Partial Content", headers, new BoundedAudioStream(input, length));
        } catch (IOException error) { return empty(404, "Not Found", Collections.emptyMap()); }
    }

    private static WebResourceResponse empty(int code, String message, Map<String, String> headers) {
        return new WebResourceResponse("text/plain", "UTF-8", code, message, headers, null);
    }

    private static final class OfflineException extends IOException {
        OfflineException(String code) { super(code); }
    }

    private static final class BoundedAudioStream extends FilterInputStream {
        private long remaining;
        BoundedAudioStream(InputStream input, long length) { super(input); remaining = length; }
        @Override public int read() throws IOException {
            if (remaining == 0) return -1;
            int result = in.read();
            if (result != -1) remaining--;
            return result;
        }
        @Override public int read(byte[] bytes, int offset, int length) throws IOException {
            if (length == 0) return 0;
            if (remaining == 0) return -1;
            int count = in.read(bytes, offset, (int) Math.min(length, remaining));
            if (count > 0) remaining -= count;
            return count;
        }
        @Override public long skip(long count) throws IOException {
            long skipped = in.skip(Math.min(count, remaining));
            remaining -= skipped;
            return skipped;
        }
        @Override public int available() throws IOException { return (int) Math.min(in.available(), remaining); }
    }
}
