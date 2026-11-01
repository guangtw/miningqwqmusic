package cn.miningqwq.music;

import android.app.Instrumentation;
import android.content.Intent;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Opt-in live regression: run bootstrap and coldStart in separate app processes. */
public class LiveSessionInstrumentedTest {
    private Instrumentation instrumentation;
    private MainActivity activity;
    private WebView web;
    private String email;

    @Before public void launch() throws Exception {
        email = InstrumentationRegistry.getArguments().getString("qaEmail", "");
        org.junit.Assume.assumeTrue("Pass a disposable @example.test identity", email.startsWith("android-qa-") && email.endsWith("@example.test"));
        instrumentation = InstrumentationRegistry.getInstrumentation();
        activity = (MainActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.runOnMainSync(() -> web = activity.getWebViewForTests());
        waitJs("!!window.__miningAndroidShell && !!document.body", 45000);
    }

    @After public void finish() { if (activity != null) instrumentation.runOnMainSync(activity::finish); }

    private String js(String source) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch complete = new CountDownLatch(1);
        instrumentation.runOnMainSync(() -> web.evaluateJavascript(source, value -> { result.set(value); complete.countDown(); }));
        assertTrue("JavaScript callback timed out", complete.await(15, TimeUnit.SECONDS));
        return result.get();
    }

    private void waitJs(String predicate, long timeout) throws Exception {
        long deadline = System.currentTimeMillis() + timeout;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(js("Boolean(" + predicate + ")"))) return;
            Thread.sleep(100);
        }
        fail("Condition not reached: " + predicate + "; status=" + js("JSON.stringify(window.__qaResult || null)"));
    }

    @Test public void bootstrap() throws Exception {
        String password = activity.getPreferences(0).getString("qaPassword", null);
        boolean register = password == null || !email.equals(activity.getPreferences(0).getString("qaEmail", ""));
        if (register) password = "Qa1!" + UUID.randomUUID();
        activity.getPreferences(0).edit().putString("qaEmail", email).putString("qaPassword", password).commit();
        String body = new JSONObject().put("email", email).put("password", password).put("nickname", "Android Session QA").toString();
        String path = register ? "register" : "login";
        js("window.__qaResult=null; void fetch('/api/account/auth/" + path + "',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:" + JSONObject.quote(body) + "}).then(async r=>{const p=await r.json();window.__qaResult={status:r.status,code:p.code};}).catch(()=>{window.__qaResult={networkError:true}});true");
        waitJs("window.__qaResult !== null", 20000);
        assertEquals("Registration/login failed: " + js("JSON.stringify(window.__qaResult)"), "true", js("window.__qaResult.status===200 && window.__qaResult.code===0"));
        assertEquals("Cookie did not reach WebView", "true", cookiePresent());
        instrumentation.runOnMainSync(() -> web.loadUrl(NavigationPolicy.HOME + "#/account"));
        waitJs("document.querySelector('.who-name')?.textContent==='Android Session QA'", 20000);
        // No test-side flush: exercise the application's own cookie durability.
    }

    private String cookiePresent() {
        AtomicReference<String> result = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> {
            String cookies = CookieManager.getInstance().getCookie(NavigationPolicy.HOME);
            result.set(String.valueOf(cookies != null && cookies.contains("mqm_refresh_token=")));
        });
        return result.get();
    }

    @Test public void coldStart() throws Exception {
        assertEquals("Persistent refresh cookie missing after process death", "true", cookiePresent());
        instrumentation.runOnMainSync(() -> web.loadUrl(NavigationPolicy.HOME + "#/account"));
        waitJs("document.querySelector('.who-name')?.textContent==='Android Session QA'", 20000);
        assertEquals("Password manager opt-out must remain enabled", android.view.View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS, web.getImportantForAutofill());
    }

    @Test public void refreshThenAwaitKill() throws Exception {
        instrumentation.runOnMainSync(() -> web.loadUrl(NavigationPolicy.HOME + "#/account"));
        waitJs("document.querySelector('.who-name')?.textContent==='Android Session QA'", 20000);
        js("window.__qaResult=null;void fetch('/api/account/auth/refresh',{method:'POST',credentials:'same-origin'}).then(async r=>{const p=await r.json();window.__qaResult={status:r.status,code:p.code};});true");
        waitJs("window.__qaResult!==null", 15000);
        assertEquals("Refresh failed before durability checkpoint", "true", js("window.__qaResult.status===200 && window.__qaResult.code===0"));
        AtomicReference<String> cookie = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> cookie.set(CookieManager.getInstance().getCookie(NavigationPolicy.HOME)));
        activity.getPreferences(0).edit().putString("qaRefreshFingerprint", fingerprint(cookie.get())).commit();
        android.os.Bundle checkpoint = new android.os.Bundle();
        checkpoint.putString("checkpoint", "COOKIE_ROTATED");
        instrumentation.sendStatus(0, checkpoint);
        // The host kills this process at the checkpoint, without an Activity pause.
        Thread.sleep(30000);
        fail("Host did not exercise abrupt process death");
    }

    static String fingerprint(String cookies) throws Exception {
        java.util.regex.Matcher token = java.util.regex.Pattern.compile("(?:^|;\\s*)mqm_refresh_token=([^;]+)").matcher(cookies);
        assertTrue("Refresh cookie missing", token.find());
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(token.group(1).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    @Test public void actualMedia() throws Exception {
        String ids = InstrumentationRegistry.getArguments().getString("qaTrackIds", "186016,347230");
        for (String id : ids.split(",")) {
            assertTrue(id.matches("[0-9]+"));
            js("window.__qaResult=null; void (async()=>{try {const r=await fetch('/api/music/track/"+id+"/play-url?level=standard');const p=await r.json(); if(!r.ok||p.code!==0){window.__qaResult={status:r.status,code:p.code};return;} const a=new Audio();window.__qaAudio=a; a.src=p.data.url; a.addEventListener('error',()=>{window.__qaResult={mediaError:a.error?.code,scheme:new URL(a.src).protocol};},{once:true}); await a.play(); await new Promise(done=>setTimeout(done,2500)); window.__qaResult={playing:!a.paused && a.currentTime>1,scheme:new URL(a.src).protocol,time:a.currentTime};a.pause();}catch(e){window.__qaResult={error:e.name};}})();true");
            waitJs("window.__qaResult!==null", 45000);
            assertEquals("Actual media did not advance: " + js("JSON.stringify(window.__qaResult)"), "true", js("window.__qaResult.playing===true"));
        }
    }

    @Test public void liveFlowUntilProcessDeath() throws Exception {
        bootstrap();
        CountDownLatch entitled = new CountDownLatch(1);
        android.content.BroadcastReceiver signal = new android.content.BroadcastReceiver() {
            @Override public void onReceive(android.content.Context context, Intent intent) {
                if (email.equals(intent.getStringExtra("qaEmail"))) entitled.countDown();
            }
        };
        android.content.IntentFilter filter = new android.content.IntentFilter("cn.miningqwq.music.QA_ENTITLED");
        if (android.os.Build.VERSION.SDK_INT >= 33) activity.registerReceiver(signal, filter, android.content.Context.RECEIVER_EXPORTED);
        else activity.registerReceiver(signal, filter);
        try {
            android.os.Bundle checkpoint = new android.os.Bundle();
            checkpoint.putString("checkpoint", "QA_ACCOUNT_READY");
            instrumentation.sendStatus(0, checkpoint);
            assertTrue("Host did not prepare the disposable playback identity", entitled.await(45, TimeUnit.SECONDS));
        } finally { activity.unregisterReceiver(signal); }
        actualMedia();
        android.os.Bundle playback = new android.os.Bundle();
        playback.putString("checkpoint", "TWO_REAL_TRACKS_ADVANCED");
        instrumentation.sendStatus(0, playback);
        refreshThenAwaitKill();
    }

}
