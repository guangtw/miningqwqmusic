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

    @Override public void onPageCommitVisible(WebView view, String url) {
        if (NavigationPolicy.isTrusted(url)) activity.pageReady();
    }

    @Override public void onPageFinished(WebView view, String url) {
        if (NavigationPolicy.isTrusted(url)) activity.installShellScript();
    }

    @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request.isForMainFrame()) activity.pageFailed();
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
