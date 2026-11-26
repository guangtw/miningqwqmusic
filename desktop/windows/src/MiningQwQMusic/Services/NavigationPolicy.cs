namespace MiningQwQMusic.Services;

internal static class NavigationPolicy
{
    public static readonly Uri Home = new("https://echo.miningqwq.cn/");
    public static bool IsTrusted(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps && uri.IdnHost == Home.IdnHost && uri.Port == Home.Port && string.IsNullOrEmpty(uri.UserInfo);
    // The lyric window loads its own page with NavigateToString, which WebView2 reports as a
    // data:text/html navigation (not about:blank). The player WebView never accepts it.
    public static bool IsLocalRenderer(string value) => value.StartsWith("data:text/html,", StringComparison.Ordinal)
        || value.StartsWith("data:text/html;", StringComparison.Ordinal);
    public static bool IsExternalWebLink(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) && string.IsNullOrEmpty(uri.UserInfo);
}
