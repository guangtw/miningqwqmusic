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

    @Test public void coversAndPaletteImagesLoadOverHttps() throws Exception {
        waitForShell();
        js("window.__coverQa=new Image();__coverQa.crossOrigin='anonymous';__coverQa.src='http://p3.music.126.net/-NVLOT5vt9I91LRiZV1TCQ==/109951170413587092.jpg?param=300y300';true");
        long until = System.currentTimeMillis() + 20000;
        while (System.currentTimeMillis() < until && !"true".equals(js("__coverQa.complete && __coverQa.naturalWidth>0"))) Thread.sleep(100);
        assertEquals("True cover pixels must load, including CORS for the palette extractor", "true", js("__coverQa.naturalWidth>0 && __coverQa.src.startsWith('https://')"));
        assertEquals("true", js("(() => {const i=new Image();i.setAttribute('src','http://p3.music.126.net/cover.jpg');i.srcset='http://p1.music.126.net/a.jpg 1x, http://p2.music.126.net/a.jpg 2x';return i.src.startsWith('https://')&&!i.srcset.includes('http://');})()"));
        assertEquals("true", js("(() => {const i=new Image();i.src='data:image/svg+xml,<svg xmlns=\"http://www.w3.org/2000/svg\"/>';return i.src.startsWith('data:image/svg+xml,');})()"));
        assertEquals("true", js("!window.MediaMetadata || new MediaMetadata({artwork:[{src:'http://p3.music.126.net/art.jpg'}]}).artwork[0].src.startsWith('https://')"));
    }

    @Test public void textAndAnimationMutationsDoNotRescanPageOrRecalculateTheme() throws Exception {
        waitForShell();
        js("(() => {window.__qaWork={scans:0,themeReads:0};const query=Document.prototype.querySelectorAll;const style=window.getComputedStyle;Document.prototype.querySelectorAll=function(...a){__qaWork.scans++;return query.apply(this,a)};window.getComputedStyle=function(...a){if(a[0]===document.documentElement)__qaWork.themeReads++;return style.apply(this,a)};const label=document.createElement('span');label.id='shell-perf-label';document.body.append(label);window.__qaWork.restore=()=>{Document.prototype.querySelectorAll=query;window.getComputedStyle=style;label.remove()};for(let i=0;i<500;i++){label.textContent=String(i);document.documentElement.style.setProperty('--shell-test-animation',String(i))}return true;})()");
        assertEquals("No full-document scan for unrelated mutations", "0", js("__qaWork.scans"));
        assertEquals("No root style read for unrelated animations", "0", js("__qaWork.themeReads"));
        js("__qaWork.restore();document.documentElement.style.removeProperty('--shell-test-animation');true");
        js("const dynamic=document.createElement('input');dynamic.id='shell-dynamic-field';document.body.append(dynamic);true");
        js("document.getElementById('shell-dynamic-field').type='password';true");
        assertEquals("Dynamic password fields remain protected", "true", js("document.getElementById('shell-dynamic-field').autocomplete==='new-password'"));
        js("document.getElementById('shell-dynamic-field').remove();true");
    }

    @Test public void backgroundCookiePersistenceAcknowledgesWithoutReplacingWebsiteUi() throws Exception {
        waitForShell();
        CountDownLatch set = new CountDownLatch(1);
        instrumentation.runOnMainSync(() -> android.webkit.CookieManager.getInstance().setCookie(
                NavigationPolicy.HOME, "shell_storage_qa=durable; Path=/; Secure; Max-Age=60; SameSite=Lax", ignored -> set.countDown()));
        assertTrue(set.await(5, TimeUnit.SECONDS));
        js("window.__storageQa=false;window.__oldShellReply=MiningAndroid.onmessage;MiningAndroid.onmessage=e=>{const r=JSON.parse(e.data);if(r.ack==='storage-qa')window.__storageQa=r.ok;else __oldShellReply(e)};MiningAndroid.postMessage(JSON.stringify({type:'persist-session',ack:'storage-qa'}));true");
        long deadline = System.currentTimeMillis() + 10000;
        while (System.currentTimeMillis() < deadline && !"true".equals(js("__storageQa"))) Thread.sleep(50);
        assertEquals("The background storage worker must acknowledge completion", "true", js("__storageQa"));
        js("MiningAndroid.onmessage=__oldShellReply;true");
        instrumentation.runOnMainSync(() -> android.webkit.CookieManager.getInstance().setCookie(
                NavigationPolicy.HOME, "shell_storage_qa=; Path=/; Secure; Max-Age=0", null));
    }
}
