package cn.miningqwq.music;

import java.net.URI;
import java.net.URISyntaxException;

final class NavigationPolicy {
    static final String ORIGIN = "https://echo.miningqwq.cn";
    static final String HOME = ORIGIN + "/";

    private NavigationPolicy() {}

    static boolean isTrusted(String url) {
        try {
            URI uri = new URI(url);
            return "https".equalsIgnoreCase(uri.getScheme())
                    && "echo.miningqwq.cn".equalsIgnoreCase(uri.getHost())
                    && (uri.getPort() == -1 || uri.getPort() == 443)
                    && uri.getRawUserInfo() == null;
        } catch (URISyntaxException | NullPointerException e) {
            return false;
        }
    }
}
