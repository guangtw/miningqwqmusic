package cn.miningqwq.music;

import android.net.http.SslError;
import android.webkit.ClientCertRequest;
import android.webkit.HttpAuthHandler;
import android.webkit.SafeBrowsingResponse;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.util.Collections;

final class ShellWebViewClient extends WebViewClient {
    private final MainActivity activity;

    ShellWebViewClient(MainActivity activity) { this.activity = activity; }

    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        // Reject redirects and iframe attempts to launch intent://, external apps or external sites.
        return !NavigationPolicy.isTrusted(request.getUrl().toString());
    }

    @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return !NavigationPolicy.isTrusted(url);
    }

    @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
        activity.resetPlayback();
    }

    @Override public void onPageCommitVisible(WebView view, String url) {
        if (NavigationPolicy.isTrusted(url)) activity.pageReady();
    }

    @Override public void onPageFinished(WebView view, String url) {
        if (NavigationPolicy.isTrusted(url)) activity.installShellScript();
    }

    @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (!request.isForMainFrame()) return;
        int code = error.getErrorCode();
        if ((code == ERROR_HOST_LOOKUP || code == ERROR_CONNECT || code == ERROR_TIMEOUT || code == ERROR_IO)
                && !NativeOfflineAudio.SHELL_PATH.equals(request.getUrl().getPath()) && activity.openOfflineShell()) return;
        activity.pageFailed();
    }

    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        if (!NavigationPolicy.isTrusted(request.getUrl().toString())) return null;
        if (request.isForMainFrame() && NativeOfflineAudio.SHELL_PATH.equals(request.getUrl().getPath())) {
            try {
                return new WebResourceResponse("text/html", "UTF-8", 200, "OK",
                        Collections.singletonMap("Cache-Control", "no-store"), activity.getAssets().open("android-offline.html"));
            } catch (IOException unavailable) {
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(), null);
            }
        }
        NativeOfflineAudio offline = activity.offlineAudio();
        return offline == null ? null : offline.serveAudio(request);
    }

    @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
        if (request.isForMainFrame() && response.getStatusCode() >= 400) activity.pageFailed();
    }

    @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        handler.cancel();
        if (error.getUrl() != null && error.getUrl().equals(view.getUrl())) activity.pageFailed();
    }

    @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler handler, String host, String realm) {
        handler.cancel();
    }

    @Override public void onReceivedClientCertRequest(WebView view, ClientCertRequest request) { request.cancel(); }

    @android.annotation.TargetApi(27)
    @Override public void onSafeBrowsingHit(WebView view, WebResourceRequest request, int threatType,
                                          SafeBrowsingResponse response) {
        response.backToSafety(false);
        if (request.isForMainFrame()) activity.pageFailed();
    }
}
