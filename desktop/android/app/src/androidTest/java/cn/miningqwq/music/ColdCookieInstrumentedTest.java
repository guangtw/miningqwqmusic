package cn.miningqwq.music;

import android.app.Instrumentation;
import android.webkit.CookieManager;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** A fresh Android process reads persisted cookies, with no surviving WebView cache. */
public class ColdCookieInstrumentedTest {
    @Test public void persistedCookieStillAuthenticatesAfterProcessDeath() throws Exception {
        String email = InstrumentationRegistry.getArguments().getString("qaEmail", "");
        org.junit.Assume.assumeTrue(email.matches("android-qa-[a-f0-9]{32}@example\\.test"));
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        AtomicReference<String> persisted = new AtomicReference<>();
        instrumentation.runOnMainSync(() -> persisted.set(CookieManager.getInstance().getCookie(NavigationPolicy.HOME)));
        assertNotNull("No cookie was recovered from disk", persisted.get());
        assertTrue("Refresh cookie missing from disk", persisted.get().contains("mqm_refresh_token="));
        String expected = instrumentation.getTargetContext().getSharedPreferences("MainActivity", 0).getString("qaRefreshFingerprint", null);
        assertNotNull("Durability checkpoint fingerprint missing", expected);
        assertEquals("The rotated cookie was not preserved", expected, LiveSessionInstrumentedTest.fingerprint(persisted.get()));
        HttpURLConnection request = (HttpURLConnection) new URL(NavigationPolicy.ORIGIN + "/api/account/auth/session").openConnection();
        request.setConnectTimeout(15000);
        request.setReadTimeout(15000);
        request.setRequestProperty("Cookie", persisted.get());
        try {
            assertEquals("Persisted cookie was rejected by the real backend", 200, request.getResponseCode());
            try (InputStream stream = request.getInputStream(); ByteArrayOutputStream result = new ByteArrayOutputStream()) {
                byte[] bytes = new byte[4096];
                int count;
                while ((count = stream.read(bytes)) != -1) result.write(bytes, 0, count);
                JSONObject response = new JSONObject(new String(result.toByteArray(), StandardCharsets.UTF_8));
                assertEquals(0, response.getInt("code"));
                assertTrue(response.getJSONObject("data").getJSONObject("playbackAuthorization").getBoolean("enabled"));
            }
        } finally { request.disconnect(); }
    }
}
