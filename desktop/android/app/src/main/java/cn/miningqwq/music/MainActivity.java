package cn.miningqwq.music;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public final class MainActivity extends Activity {
    private static final int FILE_REQUEST = 42;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private FrameLayout root;
    private String shellScript;
    private boolean failed;
    private boolean destroyed;
    private ValueCallback<Uri[]> fileCallback;
    private ConnectivityManager connectivity;
    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) { handler.post(() -> { if (failed) retry(); }); }
    };
    private final Runnable retryTask = this::retry;
    private NativeDownloads downloads;

    @Override @SuppressWarnings("deprecation") public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(243, 242, 238));
        // Set this on BOTH the ancestor and the WebView before the first navigation.
        // setSavePassword/setSaveFormData alone do not disable Android/Edge autofill.
        root.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        if (Build.VERSION.SDK_INT >= 30) root.setImportantForContentCapture(View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS);
        setContentView(root);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        webView = new WebView(this);
        webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        if (Build.VERSION.SDK_INT >= 30) webView.setImportantForContentCapture(View.IMPORTANT_FOR_CONTENT_CAPTURE_NO_EXCLUDE_DESCENDANTS);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSavePassword(false);
        settings.setSaveFormData(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setGeolocationEnabled(false);
        settings.setSafeBrowsingEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // The site resolves a signed URL asynchronously after a user taps Play.
        // WebView otherwise rejects that later play() call after the gesture expires.
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setUserAgentString(settings.getUserAgentString() + " MiningQwQMusicAndroid/1.0.3");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setOnLongClickListener(view -> true);
        webView.setWebViewClient(new ShellWebViewClient(this));
        webView.setWebChromeClient(new ShellChromeClient(this));
        downloads = new NativeDownloads(this);
        webView.setDownloadListener((url, agent, disposition, mime, length) -> downloads.downloadUrl(url, agent, disposition, mime));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        try (InputStream stream = getAssets().open("android-shell.js")) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int count;
            while ((count = stream.read(chunk)) != -1) buffer.write(chunk, 0, count);
            shellScript = new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) { throw new IllegalStateException("Missing Android shell asset", e); }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "MiningAndroid", Collections.singleton(NavigationPolicy.ORIGIN),
                    (view, message, origin, mainFrame, reply) -> {
                        if (!mainFrame || !NavigationPolicy.isTrusted(origin.toString())) return;
                        try {
                            JSONObject payload = new JSONObject(message.getData());
                            if (payload.optString("type").equals("persist-session")) {
                                // Refresh rotates and revokes the previous server token. Commit
                                // its replacement before the page treats the request as complete.
                                CookieManager.getInstance().flush();
                                reply.postMessage("{\"ack\":" + JSONObject.quote(payload.optString("ack")) + ",\"ok\":true}");
                            } else if (payload.optString("type").startsWith("blob-")) {
                                downloads.transfer(payload, ok -> {
                                    if (!destroyed) reply.postMessage("{\"ack\":" + JSONObject.quote(payload.optString("ack")) + ",\"ok\":" + ok + "}");
                                });
                            } else handleMessage(payload);
                        }
                        catch (JSONException | IllegalStateException ignored) { /* malformed/untrusted payload */ }
                    });
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, shellScript, Collections.singleton(NavigationPolicy.ORIGIN));
        }
        connectivity = getSystemService(ConnectivityManager.class);
        connectivity.registerDefaultNetworkCallback(networkCallback);
        webView.loadUrl(NavigationPolicy.HOME);
    }

    private void handleMessage(JSONObject message) throws JSONException {
        switch (message.optString("type")) {
            case "navigate": {
                String url = message.optString("url");
                if (NavigationPolicy.isTrusted(url)) webView.loadUrl(url);
                break;
            }
            case "download":
                downloads.downloadUrl(message.optString("url"), webView.getSettings().getUserAgentString(),
                        message.optString("name"), message.optString("mime", "audio/mpeg"));
                break;
            case "state": updateSystemBars(message.optBoolean("dark")); break;
            default: break;
        }
    }

    @SuppressWarnings("deprecation") private void updateSystemBars(boolean dark) {
        int flags = dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        getWindow().getDecorView().setSystemUiVisibility(flags);
        int color = dark ? Color.rgb(23, 22, 20) : Color.rgb(243, 242, 238);
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        root.setBackgroundColor(color);
    }

    void installShellScript() {
        if (!destroyed) webView.evaluateJavascript(shellScript, null);
    }

    void pageReady() {
        if (destroyed || failed) return;
        handler.removeCallbacks(retryTask);
        webView.setVisibility(View.VISIBLE);
    }

    void pageFailed() {
        if (destroyed) return;
        failed = true;
        // Never expose Chromium's built-in net::ERR_* page. There is no second error UI.
        webView.setVisibility(View.INVISIBLE);
        handler.removeCallbacks(retryTask);
        handler.postDelayed(retryTask, 10_000);
    }

    private void retry() {
        if (destroyed || !failed) return;
        failed = false;
        webView.loadUrl(NavigationPolicy.HOME);
    }

    boolean chooseFile(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
        String[] accepts = params.getAcceptTypes();
        intent.setType(accepts.length == 1 && accepts[0].contains("/") ? accepts[0] : "*/*");
        if (accepts.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, accepts);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        try { startActivityForResult(intent, FILE_REQUEST); }
        catch (ActivityNotFoundException e) { callback.onReceiveValue(null); fileCallback = null; }
        return true;
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != FILE_REQUEST || fileCallback == null) return;
        Uri[] files = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                files = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < files.length; i++) files[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) { files = new Uri[] { data.getData() }; }
        }
        fileCallback.onReceiveValue(files);
        fileCallback = null;
    }

    @Override protected void onResume() { super.onResume(); if (failed) retry(); }

    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }

    @Override public void onBackPressed() {
        if (webView.canGoBack() && !failed) webView.goBack();
        else moveTaskToBack(true);
    }

    @Override protected void onDestroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        if (connectivity != null) connectivity.unregisterNetworkCallback(networkCallback);
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        downloads.close();
        root.removeView(webView);
        webView.stopLoading();
        webView.destroy();
        super.onDestroy();
    }

    WebView getWebViewForTests() { return webView; }
}
