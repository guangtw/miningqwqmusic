package cn.miningqwq.music;

import org.junit.Test;
import static org.junit.Assert.*;

public class NavigationPolicyTest {
    @Test public void acceptsOnlyExactHttpsOrigin() {
        assertTrue(NavigationPolicy.isTrusted("https://echo.miningqwq.cn/#/settings"));
        assertTrue(NavigationPolicy.isTrusted("https://echo.miningqwq.cn:443/api/account"));
        for (String url : new String[] {
                "http://echo.miningqwq.cn/", "https://echo.miningqwq.cn:444/",
                "https://echo.miningqwq.cn.attacker.test/", "https://attacker.test/echo.miningqwq.cn",
                "https://user@echo.miningqwq.cn/", "intent://echo.miningqwq.cn/",
                "file:///sdcard/index.html", "javascript:alert(1)", "edge://settings",
                "https://echo.miningqwq.cn\\@attacker.test", "", null
        }) assertFalse(String.valueOf(url), NavigationPolicy.isTrusted(url));
    }
}
