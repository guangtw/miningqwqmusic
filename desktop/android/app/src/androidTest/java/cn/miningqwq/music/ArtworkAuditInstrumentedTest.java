package cn.miningqwq.music;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Guest-only artwork checks. Never registers or logs in to a production account. */
public class ArtworkAuditInstrumentedTest {
    private Instrumentation instrumentation;
    private MainActivity activity;
    private WebView web;

    private String js(String script) throws Exception {
        AtomicReference<String> value = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        instrumentation.runOnMainSync(() -> web.evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
        assertTrue(done.await(10, TimeUnit.SECONDS));
        return value.get();
    }

    private void waitFor(String condition, long timeout) throws Exception {
        long until = System.currentTimeMillis() + timeout;
        while (System.currentTimeMillis() < until) {
            if ("true".equals(js("Boolean(" + condition + ")"))) return;
            Thread.sleep(150);
        }
        fail("Artwork flow did not become ready: " + condition + "; images=" + js("JSON.stringify([...document.querySelectorAll('.main img')].filter(i=>{const r=i.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0}).map(i=>({url:i.currentSrc||i.src,complete:i.complete,width:i.naturalWidth,loading:i.loading})))"));
    }

    private void checkVisibleImages(String page) throws Exception {
        String expression = "[...document.querySelectorAll('.main img')].filter(i=>{const r=i.getBoundingClientRect();return r.width>0&&r.height>0&&r.left<innerWidth&&r.right>0&&r.top<innerHeight-90&&r.bottom>80})";
        waitFor(expression + ".length>0", 30000);
        waitFor(expression + ".every(i=>i.complete)", 25000);
        String report = js("JSON.stringify({total:" + expression + ".length,loaded:" + expression + ".filter(i=>i.naturalWidth>0).length,insecure:" + expression + ".filter(i=>i.currentSrc.startsWith('http://')).length})");
        JSONObject statistics = new JSONObject(new org.json.JSONTokener(report).nextValue().toString());
        assertEquals(page + " has failed visible artwork: " + statistics, statistics.getInt("total"), statistics.getInt("loaded"));
        assertEquals(page + " has insecure artwork", 0, statistics.getInt("insecure"));
        Bundle evidence = new Bundle();
        evidence.putString("artwork_" + page, statistics.toString());
        instrumentation.sendStatus(0, evidence);
    }

    private void screenshot(String name) throws Exception {
        // Only public guest pages are captured; never account/profile content.
        Thread.sleep(400);
        android.graphics.Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot();
        assertNotNull("Screenshot unavailable", bitmap);
        java.io.File directory = activity.getExternalFilesDir("artwork-qa");
        assertNotNull(directory);
        try (java.io.OutputStream stream = new java.io.FileOutputStream(new java.io.File(directory, name + ".png"))) {
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream);
        } finally { bitmap.recycle(); }
    }

    @Test public void homePlaylistChartsAndArtistKeepRealArtwork() throws Exception {
        instrumentation = InstrumentationRegistry.getInstrumentation();
        activity = (MainActivity) instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.runOnMainSync(() -> web = activity.getWebViewForTests());
        try {
            waitFor("!!document.querySelector('.feature .cover.ready')", 45000);
            checkVisibleImages("home");
            js("document.querySelector('.main').scrollTop=innerHeight*1.5;true");
            checkVisibleImages("homeGrid");
            screenshot("home-grid");
            waitFor("!!document.querySelector('a[href^=\"#/playlist/\"]')", 20000);
            String playlist = js("document.querySelector('a[href^=\"#/playlist/\"]').getAttribute('href')");
            js("location.hash=" + playlist + ";true");
            waitFor("!!document.querySelector('.track')", 30000);
            checkVisibleImages("playlist");
            String album = js("document.querySelector('.main a[href^=\"#/album/\"]')?.getAttribute('href') || '#/album/18905'");
            js("document.querySelector('.main').scrollTop=innerHeight;true");
            checkVisibleImages("playlistTracks");
            screenshot("playlist-tracks");
            js("location.hash='#/charts';true");
            waitFor("!!document.querySelector('.main .toplist')", 30000);
            checkVisibleImages("charts");
            js("location.hash='#/artist/6452';true");
            waitFor("!!document.querySelector('.track')", 30000);
            checkVisibleImages("artist");
            js("location.hash=" + album + ";true");
            waitFor("!!document.querySelector('.main .detail-title') && !!document.querySelector('.track')", 30000);
            checkVisibleImages("album");
            screenshot("album");
        } finally { instrumentation.runOnMainSync(activity::finish); }
    }
}
