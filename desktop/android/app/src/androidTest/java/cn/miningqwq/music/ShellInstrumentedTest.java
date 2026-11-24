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

    private void tap(String selector) throws Exception {
        org.json.JSONObject bounds = new org.json.JSONObject(new org.json.JSONTokener(js(
                "JSON.stringify((()=>{const r=document.querySelector(" + org.json.JSONObject.quote(selector)
                        + ").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:innerWidth}})())")).nextValue().toString());
        int[] origin = new int[2];
        AtomicReference<Float> scale = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> {
            web.getLocationOnScreen(origin);
            scale.set((float) web.getWidth());
        });
        float factor = scale.get() / (float) bounds.getDouble("width");
        float x = origin[0] + (float) bounds.getDouble("x") * factor;
        float y = origin[1] + (float) bounds.getDouble("y") * factor;
        long down = android.os.SystemClock.uptimeMillis();
        android.view.MotionEvent press = android.view.MotionEvent.obtain(down, down, android.view.MotionEvent.ACTION_DOWN, x, y, 0);
        android.view.MotionEvent release = android.view.MotionEvent.obtain(down, down + 60, android.view.MotionEvent.ACTION_UP, x, y, 0);
        try {
            instrumentation.sendPointerSync(press);
            instrumentation.sendPointerSync(release);
        } finally { press.recycle(); release.recycle(); }
    }

    @Test public void mediaSessionControlsBackgroundAudio() throws Exception {
        instrumentation.runOnMainSync(() -> web.loadDataWithBaseURL(NavigationPolicy.HOME,
                "<!doctype html><title>Media fixture</title>", "text/html", "utf-8", null));
        awaitJs("document.title === 'Media fixture' && !!window.__miningAndroidShell");
        String clip = pcmClip();
        js("window.clip=new Audio('data:audio/wav;base64," + clip + "');"
                + "const s=navigator.mediaSession; s.metadata=new MediaMetadata({title:'Media fixture',artist:'QA'});"
                + "s.setActionHandler('play',()=>clip.play());s.setActionHandler('pause',()=>clip.pause());"
                + "s.setActionHandler('seekto',e=>clip.currentTime=e.seekTime);"
                + "s.setActionHandler('nexttrack',()=>window.skipped='next');"
                + "s.setActionHandler('previoustrack',()=>window.skipped='previous');void clip.play();true");
        awaitJs("clip.currentTime > 0");
        android.app.NotificationManager manager = activity.getSystemService(android.app.NotificationManager.class);
        android.app.Notification card = awaitPlaybackCard(manager);
        android.media.session.MediaSession.Token token = card.extras.getParcelable(android.app.Notification.EXTRA_MEDIA_SESSION);
        assertNotNull("Media session token missing", token);
        android.media.session.MediaController controller = new android.media.session.MediaController(activity, token);
        assertEquals("Media fixture", controller.getMetadata().getString(android.media.MediaMetadata.METADATA_KEY_TITLE));
        instrumentation.runOnMainSync(() -> activity.moveTaskToBack(true));
        awaitJs("document.hidden");
        android.media.session.MediaController.TransportControls transport = controller.getTransportControls();
        // Some system UIs use the MediaStyle PendingIntents; Android 13+ can
        // instead use the session actions. Exercise both against the same audio.
        assertEquals(3, card.actions.length);
        card.actions[1].actionIntent.send();
        awaitJs("clip.paused");
        waitForState(controller, android.media.session.PlaybackState.STATE_PAUSED);
        card.actions[2].actionIntent.send();
        awaitJs("window.skipped === 'next'");
        card.actions[0].actionIntent.send();
        awaitJs("window.skipped === 'previous'");
        js("window.skipped=null");
        dispatchMediaKey("play");
        awaitJs("!clip.paused");
        waitForState(controller, android.media.session.PlaybackState.STATE_PLAYING);
        transport.pause();
        awaitJs("clip.paused");
        transport.seekTo(12000);
        awaitJs("Math.abs(clip.currentTime - 12) < 0.1");
        transport.play();
        awaitJs("clip.currentTime > 12.2");
        // The playback clock must continue after screen-off, and a headset
        // transport key must reach the existing page without reopening it.
        shellCommand("input keyevent KEYCODE_SLEEP");
        try {
            double before = Double.parseDouble(js("clip.currentTime"));
            awaitJs("clip.currentTime > " + (before + 3));
            dispatchMediaKey("play-pause");
            awaitJs("clip.paused");
        } finally {
            shellCommand("input keyevent KEYCODE_WAKEUP");
        }
        transport.skipToNext();
        awaitJs("window.skipped === 'next'");
        transport.skipToPrevious();
        awaitJs("window.skipped === 'previous'");
        js("clip.pause();clip.removeAttribute('src');clip.load()");
        for (int i = 0; i < 100 && controller.getPlaybackState() != null; i++) Thread.sleep(100);
        assertNull(controller.getPlaybackState());
    }

    private String pcmClip() {
        // A local PCM clip exercises the WebView decoder without an account or audio CDN.
        int samples = 8000 * 60;
        java.nio.ByteBuffer wav = java.nio.ByteBuffer.allocate(44 + samples).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        wav.putInt(0x46464952).putInt(36 + samples).putInt(0x45564157).putInt(0x20746d66)
                .putInt(16).putShort((short) 1).putShort((short) 1).putInt(8000).putInt(8000)
                .putShort((short) 1).putShort((short) 8).putInt(0x61746164).putInt(samples);
        return android.util.Base64.encodeToString(wav.array(), android.util.Base64.NO_WRAP);
    }

    @Test public void legacyControlsKeepArtworkAndLyricsWithCurrentTrack() throws Exception {
        instrumentation.runOnMainSync(() -> {
            web.setWebViewClient(new android.webkit.WebViewClient() {
                @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,
                        android.webkit.WebResourceRequest request) {
                    String path = request.getUrl().getPath();
                    if (path == null || !path.endsWith("/lyric")) return null;
                    String id = path.contains("/first/") ? "first" : "second";
                    String lines = id.equals("first")
                            ? "[{\"timeMs\":0,\"text\":\"第一句\"},{\"timeMs\":9000,\"text\":\"第二句\"}]" : "[]";
                    String body = "{\"data\":{\"trackId\":\"" + id + "\",\"lines\":" + lines + "}}";
                    return new android.webkit.WebResourceResponse("application/json", "utf-8",
                            new java.io.ByteArrayInputStream(body.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                }
            });
            web.loadDataWithBaseURL(NavigationPolicy.HOME, "<title>Legacy fixture</title>"
                    + "<div class='player'><button class='play-btn' aria-label='暂停' onclick='clip.pause()'></button></div>",
                    "text/html", "utf-8", null);
        });
        awaitJs("document.title === 'Legacy fixture' && !!window.__miningAndroidShell");
        // Simulate registration before shell installation. The detached audio is first played later.
        js("window.savedQueue=localStorage.getItem('cph.player.v2')");
        try {
            js("const c=document.createElement('canvas');c.width=c.height=2;"
                    + "const ctx=c.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,2,2);"
                    + "window.fixtureTrack=(id,cover)=>localStorage.setItem('cph.player.v2',JSON.stringify({index:0,queue:["
                    + "{id,name:id,artists:[{name:'歌手'}],album:{name:'专辑'},coverUrl:cover}]}));"
                    + "fixtureTrack('first',c.toDataURL());window.clip=new Audio('data:audio/wav;base64," + pcmClip()
                    + "');void clip.play();true");
            awaitJs("clip.currentTime > 0");
            android.app.NotificationManager manager = activity.getSystemService(android.app.NotificationManager.class);
            android.app.Notification card = awaitPlaybackCard(manager);
            android.media.session.MediaController controller = new android.media.session.MediaController(activity,
                    (android.media.session.MediaSession.Token) card.extras.getParcelable(android.app.Notification.EXTRA_MEDIA_SESSION));
            awaitMetadata(controller, "first", "歌手 · 第一句", true);
            controller.getTransportControls().pause();
            awaitJs("clip.paused");
            controller.getTransportControls().seekTo(12000);
            awaitMetadata(controller, "first", "歌手 · 第二句", true);
            controller.getTransportControls().seekTo(1000);
            awaitMetadata(controller, "first", "歌手 · 第一句", true);
            js("fixtureTrack('second','');clip.src=URL.createObjectURL(new Blob([new Uint8Array("
                    + "atob(clip.src.split(',')[1]).split('').map(ch=>ch.charCodeAt(0)))],{type:'audio/wav'}));void clip.play()");
            awaitMetadata(controller, "second", "歌手", false);
        } finally {
            js("if(savedQueue===null)localStorage.removeItem('cph.player.v2');else localStorage.setItem('cph.player.v2',savedQueue)");
        }
    }

    private void awaitMetadata(android.media.session.MediaController controller, String title,
            String subtitle, boolean hasCover) throws Exception {
        for (int i = 0; i < 120; i++) {
            android.media.MediaMetadata m = controller.getMetadata();
            if (m != null && title.equals(m.getString(android.media.MediaMetadata.METADATA_KEY_TITLE))
                    && "专辑".equals(m.getString(android.media.MediaMetadata.METADATA_KEY_ALBUM))
                    && "歌手".equals(m.getString(android.media.MediaMetadata.METADATA_KEY_ARTIST))
                    && subtitle.contentEquals(m.getDescription().getSubtitle())) {
                android.graphics.Bitmap bitmap = m.getBitmap(android.media.MediaMetadata.METADATA_KEY_ALBUM_ART);
                android.app.Notification card = awaitPlaybackCard(activity.getSystemService(android.app.NotificationManager.class));
                if (subtitle.equals(card.extras.getString(android.app.Notification.EXTRA_TEXT))
                        && (bitmap != null) == hasCover
                        && (!hasCover || android.graphics.Color.red(bitmap.getPixel(0, 0)) > 240)) return;
            }
            Thread.sleep(100);
        }
        fail("Missing metadata for " + title + " / " + subtitle);
    }

    private android.app.Notification awaitPlaybackCard(android.app.NotificationManager manager) throws Exception {
        for (int i = 0; i < 100; i++) {
            for (android.service.notification.StatusBarNotification card : manager.getActiveNotifications()) {
                if (card.getNotification().extras.containsKey(android.app.Notification.EXTRA_MEDIA_SESSION))
                    return card.getNotification();
            }
            Thread.sleep(100);
        }
        throw new AssertionError("MediaStyle notification missing");
    }

    private void waitForState(android.media.session.MediaController controller, int expected) throws Exception {
        for (int i = 0; i < 100; i++) {
            android.media.session.PlaybackState snapshot = controller.getPlaybackState();
            if (snapshot != null && snapshot.getState() == expected) return;
            Thread.sleep(100);
        }
        fail("PlaybackState did not reach " + expected);
    }

    private void dispatchMediaKey(String key) throws Exception {
        String tool = android.os.Build.VERSION.SDK_INT >= 30 ? "cmd media_session" : "media";
        shellCommand(tool + " dispatch " + key);
    }

    private void shellCommand(String command) throws Exception {
        android.os.ParcelFileDescriptor output = instrumentation.getUiAutomation()
                .executeShellCommand(command);
        try (java.io.InputStream stream = new android.os.ParcelFileDescriptor.AutoCloseInputStream(output)) {
            while (stream.read() != -1) { /* Wait for the input command. */ }
        }
    }

    private void awaitJs(String condition) throws Exception {
        for (int i = 0; i < 100; i++) {
            if ("true".equals(js(condition))) return;
            Thread.sleep(100);
        }
        fail(condition);
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

    @Test public void nativeBackReturnsToWarmHomeWithoutDocumentReloadOrLoadingState() throws Exception {
        waitForShell();
        long until = System.currentTimeMillis() + 30_000;
        while (System.currentTimeMillis() < until && !"true".equals(js("!!document.querySelector('.masthead') && !document.querySelector('.main .loading')"))) Thread.sleep(100);
        assertEquals("Home must finish its initial load", "true", js("!document.querySelector('.main .loading')"));
        js("window.__backDocumentMarker=true;true");
        tap("a[href=\"#/charts\"]");
        until = System.currentTimeMillis() + 30_000;
        while (System.currentTimeMillis() < until && !"true".equals(js("location.hash==='#/charts' && !document.querySelector('.main .loading') && !!document.querySelector('.toplist')"))) Thread.sleep(100);
        assertEquals("Charts route must be entered", "true", js("location.hash==='#/charts'"));
        js("window.__backShowedLoading=false;window.__backObserver=new MutationObserver(()=>{if(location.hash!=='#/charts'&&document.querySelector('.main .loading'))window.__backShowedLoading=true});__backObserver.observe(document.querySelector('.main'),{childList:true,subtree:true});true");
        instrumentation.runOnMainSync(() -> activity.onBackPressed());
        until = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < until && !"true".equals(js("location.hash==='' || location.hash==='#/'"))) Thread.sleep(100);
        Thread.sleep(1000);
        assertEquals("Returning must preserve the same document", "true", js("window.__backDocumentMarker===true"));
        assertEquals("Warm home must not show a data loading state", "false", js("window.__backShowedLoading"));
        assertEquals("Home route must be restored", "true", js("location.hash==='' || location.hash==='#/'"));
        js("__backObserver.disconnect();true");
    }

    @Test public void cookiePersistenceAcknowledgesWithoutReplacingWebsiteUi() throws Exception {
        waitForShell();
        CountDownLatch set = new CountDownLatch(1);
        instrumentation.runOnMainSync(() -> android.webkit.CookieManager.getInstance().setCookie(
                NavigationPolicy.HOME, "shell_storage_qa=durable; Path=/; Secure; Max-Age=60; SameSite=Lax", ignored -> set.countDown()));
        assertTrue(set.await(5, TimeUnit.SECONDS));
        js("window.__storageQa=false;window.__oldShellReply=MiningAndroid.onmessage;MiningAndroid.onmessage=e=>{const r=JSON.parse(e.data);if(r.ack==='storage-qa')window.__storageQa=r.ok;else __oldShellReply(e)};MiningAndroid.postMessage(JSON.stringify({type:'persist-session',ack:'storage-qa'}));true");
        long deadline = System.currentTimeMillis() + 10000;
        while (System.currentTimeMillis() < deadline && !"true".equals(js("__storageQa"))) Thread.sleep(50);
        assertEquals("Cookie storage must acknowledge completion", "true", js("__storageQa"));
        js("MiningAndroid.onmessage=__oldShellReply;true");
        instrumentation.runOnMainSync(() -> android.webkit.CookieManager.getInstance().setCookie(
                NavigationPolicy.HOME, "shell_storage_qa=; Path=/; Secure; Max-Age=0", null));
    }
}
