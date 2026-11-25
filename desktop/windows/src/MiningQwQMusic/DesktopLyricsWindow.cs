using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using MiningQwQMusic.Services;
using Windows.Graphics;

namespace MiningQwQMusic;

/// <summary>
/// Borderless, always-on-top, transparent lyric overlay. The line is drawn by a local page
/// (desktop-lyrics-view.html) so the sweep and line change reuse the player's CSS. Unlocked it can
/// be dragged; locked it ignores the mouse (unlock from the tray menu or the settings page).
/// </summary>
internal sealed class DesktopLyricsWindow : Window
{
    private const int WidthDip = 780, HeightDip = 176, BottomGapDip = 56;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private readonly AppPreferences preferences;
    private readonly Action<string> request;
    private readonly WebView2 view = new() { DefaultBackgroundColor = Colors.Transparent };
    private readonly nint hwnd;
    private DesktopLyricFrame? frame;
    private bool ready, navigated, closed, locked, dark;
    private string ink = "#111111", background = "#f3f2ee";

    /// <param name="request">"close", "lock" or "restart" (renderer browser process lost).</param>
    public DesktopLyricsWindow(AppPreferences preferences, Action<string> request)
    {
        this.preferences = preferences;
        this.request = request;
        hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        Title = "Mining唱片行 桌面歌词";
        Content = new Grid { Children = { view } };
        SystemBackdrop = new TransparentBackdrop(hwnd);

        var presenter = OverlappedPresenter.Create();
        presenter.SetBorderAndTitleBar(false, false);
        presenter.IsResizable = false;
        presenter.IsMaximizable = false;
        presenter.IsMinimizable = false;
        presenter.IsAlwaysOnTop = true;
        AppWindow.SetPresenter(presenter);
        AppWindow.IsShownInSwitchers = false;
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico"));
        Place();
        AppWindow.Changed += (_, args) =>
        {
            if (args.DidPositionChange && !closed) { preferences.LyricsX = AppWindow.Position.X; preferences.LyricsY = AppWindow.Position.Y; }
        };
        Closed += (_, _) => { closed = true; view.Close(); };
        locked = preferences.LyricsLocked;
        SetStyles();
        _ = InitializeAsync();
    }

    /// <summary>Show without taking focus from whatever the user is working in.</summary>
    public void ShowPassive()
    {
        var previous = GetForegroundWindow();
        Activate();
        SetStyles();
        if (previous != 0 && previous != hwnd) SetForegroundWindow(previous);
    }

    // Subscribed to MainWindow.DesktopLyricsChanged on the UI thread; null clears the line.
    public void Render(DesktopLyricFrame? value)
    {
        frame = value;
        Post(new { type = "frame", frame = value });
    }

    public void SetAppearance(bool isDark, string inkColor, string backgroundColor)
    {
        dark = isDark; ink = inkColor; background = backgroundColor;
        SendAppearance();
    }

    public void SetLocked(bool value)
    {
        locked = value;
        SetStyles();
        SendAppearance();
    }

    private void SendAppearance() => Post(new { type = "appearance", dark, ink, bg = background, locked });

    private void Post(object message)
    {
        if (!ready || closed || view.CoreWebView2 is not { } core) return;
        core.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json));
    }

    private void Place()
    {
        var scale = Math.Max(1, GetDpiForWindow(hwnd)) / 96d;
        var width = (int)Math.Round(WidthDip * scale);
        var height = (int)Math.Round(HeightDip * scale);
        var primary = DisplayArea.Primary.WorkArea;
        var x = preferences.LyricsX ?? primary.X + (primary.Width - width) / 2;
        var y = preferences.LyricsY ?? primary.Y + primary.Height - height - (int)(BottomGapDip * scale);
        // The saved monitor may be gone: keep the whole overlay on a visible work area.
        var area = DisplayArea.GetFromRect(new RectInt32(x, y, width, height), DisplayAreaFallback.Nearest).WorkArea;
        width = Math.Min(width, area.Width);
        height = Math.Min(height, area.Height);
        AppWindow.MoveAndResize(new RectInt32(Math.Clamp(x, area.X, area.X + area.Width - width), Math.Clamp(y, area.Y, area.Y + area.Height - height), width, height));
    }

    private async Task InitializeAsync()
    {
        try
        {
            var environment = await WebViewPolicy.CreateEnvironmentAsync();
            if (closed) return;
            await view.EnsureCoreWebView2Async(environment);
            if (closed) return;
            var core = view.CoreWebView2;
            WebViewPolicy.Apply(core);
            core.NavigationStarting += (_, args) =>
            {
                // Only the page this window hands to NavigateToString may load, and only once.
                if (navigated || !NavigationPolicy.IsLocalRenderer(args.Uri)) { args.Cancel = true; return; }
                navigated = true;
            };
            core.NewWindowRequested += (_, args) => args.Handled = true;
            core.DownloadStarting += (_, args) => args.Cancel = true;
            core.WebMessageReceived += WebMessageReceived;
            core.ProcessFailed += (_, args) =>
            {
                ready = false;
                if (closed) return;
                if (args.ProcessFailedKind == CoreWebView2ProcessFailedKind.RenderProcessExited) Load(core);
                else if (args.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited) request("restart");
            };
            Load(core);
        }
        catch (Exception ex) { Diagnostics.Log("初始化桌面歌词", ex); }
    }

    private void Load(CoreWebView2 core)
    {
        navigated = false;
        var assets = Path.Combine(AppContext.BaseDirectory, "Assets");
        var page = File.ReadAllText(Path.Combine(assets, "desktop-lyrics-view.html"))
            .Replace("<!-- view-script -->", "<script>" + File.ReadAllText(Path.Combine(assets, "desktop-lyrics-view.js")) + "</script>", StringComparison.Ordinal);
        core.NavigateToString(page);
    }

    private void WebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!NavigationPolicy.IsLocalRenderer(args.Source) || args.WebMessageAsJson.Length > 256) return;
        try
        {
            using var json = JsonDocument.Parse(args.WebMessageAsJson);
            if (!json.RootElement.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String) return;
            switch (type.GetString())
            {
                case "ready":
                    ready = true;
                    SendAppearance();
                    Post(new { type = "frame", frame });
                    break;
                case "drag" when !locked:
                    // Hand the press to the system move loop, like dragging a title bar.
                    ReleaseCapture();
                    SendMessage(hwnd, 0x00A1, 2, 0);
                    break;
                case "lock": request("lock"); break;
                case "close": request("close"); break;
            }
        }
        catch (JsonException ex) { Diagnostics.Log("桌面歌词消息", ex); }
    }

    private void SetStyles()
    {
        const int ToolWindow = 0x80, NoActivate = 0x08000000, Layered = 0x80000, Transparent = 0x20;
        var style = IntPtr.Size == 8 ? GetWindowLongPtr(hwnd, -20) : GetWindowLong(hwnd, -20);
        // Tool window: no taskbar button or Alt+Tab entry. No-activate: clicking the lyric never steals focus.
        style |= ToolWindow | NoActivate;
        // Locked: layered + transparent lets every click fall through to the window underneath.
        style = locked ? style | Layered | Transparent : style & ~(nint)(Layered | Transparent);
        if (IntPtr.Size == 8) SetWindowLongPtr(hwnd, -20, style); else SetWindowLong(hwnd, -20, (int)style);
        if (locked) SetLayeredWindowAttributes(hwnd, 0, 255, 2);
        SetWindowPos(hwnd, 0, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020);
        TransparentBackdrop.EnableDesktopAlpha(hwnd);
    }

    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(nint window);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetForegroundWindow(nint window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ReleaseCapture();
    [DllImport("user32.dll", EntryPoint = "SendMessageW")] private static extern nint SendMessage(nint window, uint message, nint wParam, nint lParam);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern nint GetWindowLongPtr(nint window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] private static extern nint SetWindowLongPtr(nint window, int index, nint value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(nint window, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] private static extern int SetWindowLong(nint window, int index, int value);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetLayeredWindowAttributes(nint window, uint key, byte alpha, uint flags);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetWindowPos(nint window, nint after, int x, int y, int width, int height, uint flags);
}
