using MiningQwQMusic.Services;

var trusted = new[] { "https://echo.miningqwq.cn/", "https://echo.miningqwq.cn/#/library", "https://echo.miningqwq.cn:443/api/account/login" };
var blocked = new[] { "http://echo.miningqwq.cn/", "https://echo.miningqwq.cn.evil.test/", "https://evil.test/?echo.miningqwq.cn", "https://echo.miningqwq.cn:444/", "https://user@echo.miningqwq.cn/", "javascript:alert(1)", "file:///C:/Windows/", "edge://wallet/", "data:text/html,test", "https://example.test/", "not a URL" };
foreach (var value in trusted) if (!NavigationPolicy.IsTrusted(value)) throw new Exception("Trusted origin rejected");
foreach (var value in blocked) if (NavigationPolicy.IsTrusted(value)) throw new Exception("Origin boundary bypass");
foreach (var value in blocked.Where(value => !value.StartsWith("http"))) if (NavigationPolicy.IsExternalWebLink(value)) throw new Exception("External scheme bypass");
if (!NavigationPolicy.IsExternalWebLink("https://example.test/music")) throw new Exception("External HTTPS link rejected");
Console.WriteLine($"PASS: {trusted.Length + blocked.Length + 1} navigation policy cases");
var legacy = System.Text.Json.JsonSerializer.Deserialize<AppPreferences>("{\"Width\":1280,\"Height\":860}")!;
if (!legacy.CloseToTray) throw new Exception("Upgrading existing settings must default to the tray");
legacy.CloseToTray = false;
var roundTrip = System.Text.Json.JsonSerializer.Deserialize<AppPreferences>(System.Text.Json.JsonSerializer.Serialize(legacy))!;
if (roundTrip.CloseToTray) throw new Exception("Explicit exit preference must survive restart");
var nativeData = typeof(TrayIcon).GetNestedType("NotifyIconData", System.Reflection.BindingFlags.NonPublic)!;
if (System.Runtime.InteropServices.Marshal.SizeOf(nativeData) != (IntPtr.Size == 8 ? 976 : 956)) throw new Exception("Notification icon native ABI mismatch");
Console.WriteLine("PASS: tray default migration, preference persistence and native icon ABI");
foreach (var payload in new[] { "{\"type\":\"desktop-ready\"}", "{\"type\":\"desktop-action\",\"action\":\"closeToTray\",\"value\":false}", "{\"type\":\"desktop-action\",\"action\":\"downloads\"}" })
{
    using var json = System.Text.Json.JsonDocument.Parse(payload);
    if (!DesktopRequest.TryParse(json.RootElement, out _)) throw new Exception("Valid desktop request rejected");
}
foreach (var payload in new[] { "[]", "{}", "{\"type\":1}", "{\"type\":\"desktop-action\",\"action\":\"run\"}", "{\"type\":\"desktop-action\",\"action\":\"closeToTray\",\"value\":\"false\"}", "{\"type\":\"desktop-action\",\"action\":\"closeToTray\"}" })
{
    using var json = System.Text.Json.JsonDocument.Parse(payload);
    if (DesktopRequest.TryParse(json.RootElement, out _)) throw new Exception("Invalid desktop request accepted");
}
Console.WriteLine("PASS: desktop capability request allowlist and value types");
using (var json = System.Text.Json.JsonDocument.Parse("""
    {"type":"desktop-lyric","title":"Song","artist":"Artist","primary":"Line","secondary":"Translation","start":1000,"end":4500,"position":2410,"playing":true,"reduced":false}
    """))
{
    if (DesktopLyricFrame.Read(json.RootElement) is not { Start: 1000, End: 4500, Position: 2410, Playing: true })
        throw new Exception("Lyric frame timing must retain millisecond precision");
}
using (var json = System.Text.Json.JsonDocument.Parse("""{"title":"","artist":"","primary":"","secondary":"","start":4500,"end":1000}"""))
{
    if (DesktopLyricFrame.Read(json.RootElement) is not null) throw new Exception("Inverted lyric timestamps accepted");
}
Console.WriteLine("PASS: desktop lyric frame decoding");
