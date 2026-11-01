package cn.miningqwq.music;

import android.net.Uri;
import android.os.Message;
import android.webkit.GeolocationPermissions;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

/** All browser-owned prompts are handled here, never by the WebView defaults. */
final class ShellChromeClient extends WebChromeClient {
    private final MainActivity activity;

    ShellChromeClient(MainActivity activity) { this.activity = activity; }

    @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
        result.cancel();
        return true;
    }

    @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
        result.cancel();
        return true;
    }

    @Override public boolean onJsPrompt(WebView view, String url, String message,
                                       String defaultValue, JsPromptResult result) {
        result.cancel();
        return true;
    }

    @Override public boolean onJsBeforeUnload(WebView view, String url, String message, JsResult result) {
        result.confirm();
        return true;
    }

    @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, Message result) {
        return false;
    }

    @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }

    @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
        callback.invoke(origin, false, false);
    }

    @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        // A user-requested system document picker is allowed; no browser UI is involved.
        return activity.chooseFile(callback, params);
    }
}
