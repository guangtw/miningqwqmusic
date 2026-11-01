namespace MiningQwQMusic.Services;

internal static class NavigationPolicy
{
    public static readonly Uri Home = new("https://echo.miningqwq.cn/");
    public static bool IsTrusted(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps && uri.IdnHost == Home.IdnHost && uri.Port == Home.Port && string.IsNullOrEmpty(uri.UserInfo);
    public static bool IsExternalWebLink(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) && string.IsNullOrEmpty(uri.UserInfo);
}
