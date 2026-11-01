package cn.miningqwq.music;

import android.app.Instrumentation;
import android.content.Intent;
import android.view.View;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

public class ShellInstrumentedTest {
    private Instrumentation instrumentation;
    private MainActivity activity;
    private WebView web;

    @Before public void launch() {
        instrumentation = InstrumentationRegistry.getInstrumentation();
        Intent intent = new Intent(instrumentation.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        activity = (MainActivity) instrumentation.startActivitySync(intent);
        instrumentation.runOnMainSync(() -> web = activity.getWebViewForTests());
    }

    @After public void finish() { instrumentation.runOnMainSync(() -> activity.finish()); }

    private String js(String source) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch complete = new CountDownLatch(1);
        instrumentation.runOnMainSync(() -> web.evaluateJavascript(source, value -> { result.set(value); complete.countDown(); }));
        assertTrue("JavaScript timed out", complete.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private void waitForShell() throws Exception {
        long until = System.currentTimeMillis() + 45_000;
        while (System.currentTimeMillis() < until) {
            if ("true".equals(js("!!window.__miningAndroidShell && !!document.querySelector('.player')"))) return;
            Thread.sleep(250);
        }
        fail("Online website and Android shell did not become ready");
    }

    @Test public void nativePolicyBlocksAutofillAndBrowserUiBeforeNavigation() {
        instrumentation.runOnMainSync(() -> {
            assertEquals(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS, web.getImportantForAutofill());
            assertEquals(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS, ((View) web.getParent()).getImportantForAutofill());
            assertFalse(web.getSettings().getSaveFormData());
            assertFalse(web.getSettings().supportZoom());
            assertFalse(web.getSettings().getDisplayZoomControls());
            assertFalse(web.getSettings().getAllowFileAccess());
            assertFalse(web.getSettings().getAllowContentAccess());
            assertFalse(web.getSettings().getJavaScriptCanOpenWindowsAutomatically());
            assertFalse(web.getSettings().getMediaPlaybackRequiresUserGesture());
            assertEquals(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW, web.getSettings().getMixedContentMode());
            assertTrue(web.getSettings().supportMultipleWindows());
            assertFalse(web.isVerticalScrollBarEnabled());
            assertFalse(new ShellChromeClient(activity).onCreateWindow(web, true, true, null));
            ShellWebViewClient policy = new ShellWebViewClient(activity);
            assertTrue(policy.shouldOverrideUrlLoading(web, "intent://open/#Intent;scheme=https;end"));
            assertTrue(policy.shouldOverrideUrlLoading(web, "https://www.microsoft.com/"));
            assertFalse(policy.shouldOverrideUrlLoading(web, NavigationPolicy.HOME + "#/settings"));
        });
    }

    @Test public void scriptDialogsAndPasswordFieldsCannotOpenBrowserPrompts() throws Exception {
        waitForShell();
        assertEquals("true", js("alert('test'); confirm('test') === false && prompt('test') === null && window.open('https://example.com') === null"));
        js("document.body.insertAdjacentHTML('beforeend','<form id=android-test-form><input name=username><input name=password type=password></form>'); true");
        assertEquals("true", js("document.querySelector('#android-test-form input[type=password]').autocomplete === 'new-password' && document.querySelector('#android-test-form input[name=username]').autocomplete === 'off'"));
        assertEquals("true", js("location.origin === 'https://echo.miningqwq.cn' && typeof window.MiningAndroid?.postMessage === 'function'"));
        js("document.getElementById('android-test-form').remove(); true");
    }

    @Test public void mainFrameFailureDoesNotShowChromiumErrorPage() {
        instrumentation.runOnMainSync(() -> {
            activity.pageFailed();
            assertEquals(View.INVISIBLE, web.getVisibility());
        });
    }

    @Test public void scopedBlobDownloadCompletesWithoutBrowserUi() throws Exception {
        waitForShell();
        js("(() => { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['android-shell-download-test'],{type:'text/plain'})); a.download='android-shell-test.txt'; document.body.append(a); a.click(); a.remove(); return true; })()");
        // A separate storage query verifies the bytes, rather than just the injected click handler.
        long until = System.currentTimeMillis() + 10_000;
        boolean found = false;
        while (System.currentTimeMillis() < until && !found) {
            try (android.database.Cursor cursor = activity.getContentResolver().query(
                    android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                    new String[] { "_id", "_size" }, "_display_name = ? AND is_pending = 0",
                    new String[] { "android-shell-test.txt" }, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    android.net.Uri uri = android.content.ContentUris.withAppendedId(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cursor.getLong(0));
                    try (java.io.InputStream stream = activity.getContentResolver().openInputStream(uri)) {
                        byte[] bytes = new byte[64];
                        int count = stream.read(bytes);
                        assertEquals("android-shell-download-test", new String(bytes, 0, count, java.nio.charset.StandardCharsets.UTF_8));
                    }
                    activity.getContentResolver().delete(uri, null, null);
                    found = true;
                }
            }
            if (!found) Thread.sleep(100);
        }
        assertTrue("Blob download did not reach Android Downloads", found);
    }

    @Test public void insecureMediaIsUpgradedAndOriginalProgressBarIsPreserved() throws Exception {
        waitForShell();
        assertEquals("true", js("(() => { const a=new Audio();a.preload='none';a.src='http://m701.music.126.net/test.mp3';return a.src==='https://m701.music.126.net/test.mp3'; })()"));
        assertEquals("true", js("(() => { const a=new Audio();a.preload='none';a.setAttribute('src','http://bd-er.kuwo.cn/test.mp3');return a.src==='https://bd-er.kuwo.cn/test.mp3'; })()"));
        assertEquals("An original progress indicator must remain visible", "true", js("[...document.querySelectorAll('.player .mini-progress,.player .progress-row')].some(element=>getComputedStyle(element).display!=='none' && element.getClientRects().length>0)"));
    }
}
