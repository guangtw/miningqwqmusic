using System.Text.Json;
using Microsoft.UI;
using Microsoft.UI.Input;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;
using MiningQwQMusic.Services;
using Windows.Graphics;
using Windows.Storage.Pickers;
using Windows.System;

namespace MiningQwQMusic;

public sealed partial class MainWindow : Window
{
    private readonly AppPreferences preferences = AppPreferences.Load();
    private readonly SemaphoreSlim dialogQueue = new(1, 1);
    private readonly List<CoreWebView2DownloadOperation> downloads = [];
    private readonly List<string> externalDownloads = [];
    private readonly CancellationTokenSource lifetime = new();
    private bool initialized;
    private bool starting;
    private bool closed;
    private bool fullScreen;
    private bool replaceWebView;
    private bool exiting;
    private readonly TrayIcon tray;
    private readonly nint hwnd;
    private CoreWebView2? Core => MusicWebView.CoreWebView2;

    public MainWindow()
    {
        InitializeComponent();
        hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(null);
        AppWindow.TitleBar.PreferredHeightOption = TitleBarHeightOption.Standard;
        Root.SizeChanged += (_, _) => { SetDragRegions(); UpdateWindowAppearance(); };
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "AppIcon.ico"));
        tray = new TrayIcon(hwnd, Path.Combine(AppContext.BaseDirectory, "Assets", "TrayIcon.ico"), RestoreFromTray, Command, ExitApplication);
        AppWindow.Closing += (_, args) =>
        {
            if (exiting || !preferences.CloseToTray) return;
            args.Cancel = true;
            RememberPlacement();
            preferences.Save();
            if (tray.EnsureAvailable()) AppWindow.Hide();
            else ShowNotice("暂时无法收进托盘", "请通过菜单退出唱片行。", InfoBarSeverity.Warning);
        };
        ApplyTheme();
        Root.ActualThemeChanged += (_, _) => UpdateCaptionTheme();
        RestorePlacement();
        AppWindow.Changed += (_, args) =>
        {
            if (args.DidPositionChange || args.DidSizeChange || args.DidPresenterChange) RememberPlacement();
        };
        Closed += (_, _) =>
        {
            closed = true;
            tray.Dispose();
            lifetime.Cancel();
            RememberPlacement();
            preferences.Save();
            foreach (var download in downloads.Where(d => d.State == CoreWebView2DownloadState.InProgress)) download.Cancel();
            MusicWebView.Close();
        };
    }

    private void RestorePlacement()
    {
        var display = DisplayArea.GetFromWindowId(AppWindow.Id, DisplayAreaFallback.Primary);
        var area = display.WorkArea;
        var width = Math.Clamp(preferences.Width, 640, Math.Max(640, area.Width));
        var height = Math.Clamp(preferences.Height, 480, Math.Max(480, area.Height));
        var x = preferences.X ?? area.X + (area.Width - width) / 2;
        var y = preferences.Y ?? area.Y + (area.Height - height) / 2;
        // Saved monitor may have been removed; keep the entire window on a visible monitor.
        var candidate = new RectInt32(x, y, width, height);
        var savedDisplay = DisplayArea.GetFromRect(candidate, DisplayAreaFallback.Nearest);
        area = savedDisplay.WorkArea;
        width = Math.Min(width, area.Width);
        height = Math.Min(height, area.Height);
        AppWindow.MoveAndResize(new RectInt32(Math.Clamp(x, area.X, area.X + area.Width - width), Math.Clamp(y, area.Y, area.Y + area.Height - height), width, height));
        if (preferences.Maximized && AppWindow.Presenter is OverlappedPresenter presenter) presenter.Maximize();
    }

    private void RememberPlacement()
    {
        if (fullScreen || AppWindow.Presenter is not OverlappedPresenter presenter) return;
        if (presenter.State == OverlappedPresenterState.Minimized) return;
        preferences.Maximized = presenter.State == OverlappedPresenterState.Maximized;
        if (preferences.Maximized) return;
        preferences.Width = AppWindow.Size.Width;
        preferences.Height = AppWindow.Size.Height;
        preferences.X = AppWindow.Position.X;
        preferences.Y = AppWindow.Position.Y;
    }

    private async void Root_Loaded(object sender, RoutedEventArgs e) => await InitializeWebViewAsync();

    private async Task InitializeWebViewAsync()
    {
        if (starting || initialized || closed) return;
        starting = true;
        ShowLoading();
        try
        {
            if (replaceWebView)
            {
                var previous = MusicWebView;
                var host = (Panel)previous.Parent;
                MusicWebView = new WebView2 { Visibility = Visibility.Collapsed };
                host.Children.Insert(0, MusicWebView);
                host.Children.Remove(previous);
                previous.Close();
                replaceWebView = false;
            }
            var options = new CoreWebView2EnvironmentOptions { AllowSingleSignOnUsingOSPrimaryAccount = false };
            var environment = await CoreWebView2Environment.CreateWithOptionsAsync(null,
                Path.Combine(AppPreferences.DataDirectory, "WebView2"), options);
            if (closed) return;
            await MusicWebView.EnsureCoreWebView2Async(environment);
            if (closed) return;
            var core = Core!;
            WebViewPolicy.Apply(core);
            core.NavigationStarting += NavigationStarting;
            core.NavigationCompleted += NavigationCompleted;
            core.NewWindowRequested += NewWindowRequested;
            core.ScriptDialogOpening += ScriptDialogOpening;
            core.DownloadStarting += DownloadStarting;
            core.WebMessageReceived += WebMessageReceived;
            core.ProcessFailed += (_, args) =>
            {
                if (args.ProcessFailedKind is CoreWebView2ProcessFailedKind.RenderProcessExited or CoreWebView2ProcessFailedKind.BrowserProcessExited)
                {
                    initialized = false;
                    replaceWebView = true;
                    ShowError("播放器意外停止", "重新打开播放器即可继续。登录和音乐库会保留。");
                }
            };
            foreach (var script in new[] { "desktop-bridge.js", "desktop-settings.js" })
                await core.AddScriptToExecuteOnDocumentCreatedAsync(await File.ReadAllTextAsync(Path.Combine(AppContext.BaseDirectory, "Assets", script)));
            initialized = true;
            core.Navigate(NavigationPolicy.Home.AbsoluteUri);
        }
        catch (Exception ex)
        {
            Diagnostics.Log("初始化播放器", ex);
            ShowError("播放器未能启动", "请确认已安装 Microsoft Edge WebView2 Runtime，然后重试。");
        }
        finally { starting = false; }
    }

    private void NavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs args)
    {
        if (!NavigationPolicy.IsTrusted(args.Uri))
        {
            args.Cancel = true;
            if (args.IsUserInitiated) _ = OpenExternalAsync(args.Uri);
            return;
        }
        ShowLoading();
    }

    private void NavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
    {
        if (closed) return;
        LoadingRing.IsActive = false;
        LoadingPanel.Visibility = Visibility.Collapsed;
        if (args.IsSuccess && args.HttpStatusCode < 400)
        {
            ErrorPanel.Visibility = Visibility.Collapsed;
            MusicWebView.Visibility = Visibility.Visible;
            UpdateWindowAppearance();
            MusicWebView.Focus(FocusState.Programmatic);
        }
        else if (args.WebErrorStatus != CoreWebView2WebErrorStatus.OperationCanceled)
            ShowError("暂时无法连接唱片行", "检查网络连接后再试一次。你的登录和音乐库仍会保留。");
    }

    private void NewWindowRequested(CoreWebView2 sender, CoreWebView2NewWindowRequestedEventArgs args)
    {
        args.Handled = true;
        if (NavigationPolicy.IsTrusted(args.Uri)) Core?.Navigate(args.Uri);
        else _ = OpenExternalAsync(args.Uri, true);
    }

    private async Task OpenExternalAsync(string value, bool allowDownload = false)
    {
        if (!NavigationPolicy.IsExternalWebLink(value)) return;
        var uri = new Uri(value);
        var result = await ShowDialogAsync(new ContentDialog
        {
            Title = "打开外部链接？",
            Content = new TextBlock { Text = $"此链接将使用默认浏览器打开：\n{uri.Host}", TextWrapping = TextWrapping.Wrap },
            PrimaryButtonText = "打开链接", CloseButtonText = "取消", DefaultButton = ContentDialogButton.Close,
            SecondaryButtonText = allowDownload && uri.Scheme == Uri.UriSchemeHttps ? "下载文件" : ""
        });
        try
        {
            if (result == ContentDialogResult.Primary) await Launcher.LaunchUriAsync(uri);
            else if (result == ContentDialogResult.Secondary) await DownloadExternalAsync(uri);
        }
        catch (Exception ex) { Diagnostics.Log("打开外部链接", ex); ShowNotice("链接未打开", "请稍后重试。", InfoBarSeverity.Warning); }
    }

    private async Task DownloadExternalAsync(Uri uri)
    {
        var picker = new FileSavePicker { SuggestedFileName = "唱片行下载" };
        picker.FileTypeChoices.Add("音频文件", [".mp3", ".flac", ".m4a", ".wav", ".ogg"]);
        WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
        var file = await picker.PickSaveFileAsync();
        if (file is null || closed) return;
        var index = externalDownloads.Count;
        externalDownloads.Add($"{file.Name}\n下载中");
        try
        {
            using var client = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromMinutes(30) };
            using var response = await client.GetAsync(uri, System.Net.Http.HttpCompletionOption.ResponseHeadersRead, lifetime.Token);
            response.EnsureSuccessStatusCode();
            await using var source = await response.Content.ReadAsStreamAsync(lifetime.Token);
            await using var destination = await file.OpenStreamForWriteAsync();
            destination.SetLength(0);
            await source.CopyToAsync(destination, lifetime.Token);
            externalDownloads[index] = $"{file.Name}\n已完成";
            ShowNotice("下载完成", file.Name, InfoBarSeverity.Success);
        }
        catch (OperationCanceledException) { externalDownloads[index] = $"{file.Name}\n已取消"; }
        catch (Exception ex)
        {
            Diagnostics.Log("下载外部音频", ex);
            externalDownloads[index] = $"{file.Name}\n下载中断";
            ShowNotice("下载中断", "请重新下载。", InfoBarSeverity.Warning);
        }
    }

    private async void ScriptDialogOpening(CoreWebView2 sender, CoreWebView2ScriptDialogOpeningEventArgs args)
    {
        using var deferral = args.GetDeferral();
        try
        {
            if (!NavigationPolicy.IsTrusted(args.Uri)) return;
            var panel = new StackPanel { Spacing = 12 };
            panel.Children.Add(new TextBlock { Text = args.Message, TextWrapping = TextWrapping.Wrap, MaxWidth = 440 });
            TextBox? input = null;
            if (args.Kind == CoreWebView2ScriptDialogKind.Prompt)
            {
                input = new TextBox { Text = args.DefaultText };
                panel.Children.Add(input);
            }
            var result = await ShowDialogAsync(new ContentDialog
            {
                Title = "Mining唱片行", Content = panel, PrimaryButtonText = "确定",
                CloseButtonText = args.Kind == CoreWebView2ScriptDialogKind.Alert ? "" : "取消",
                DefaultButton = ContentDialogButton.Primary
            });
            if (result == ContentDialogResult.Primary)
            {
                if (input is not null) args.ResultText = input.Text;
                args.Accept();
            }
        }
        catch (Exception ex) { Diagnostics.Log("应用对话框", ex); }
        finally { deferral.Complete(); }
    }

    private async void DownloadStarting(CoreWebView2 sender, CoreWebView2DownloadStartingEventArgs args)
    {
        using var deferral = args.GetDeferral();
        args.Handled = true;
        args.Cancel = true;
        try
        {
            var name = Path.GetFileName(args.ResultFilePath);
            if (string.IsNullOrWhiteSpace(name)) name = "唱片行下载.mp3";
            var extension = Path.GetExtension(name);
            var picker = new FileSavePicker { SuggestedFileName = name };
            picker.FileTypeChoices.Add("下载文件", [string.IsNullOrEmpty(extension) ? ".mp3" : extension]);
            WinRT.Interop.InitializeWithWindow.Initialize(picker, hwnd);
            var file = await picker.PickSaveFileAsync();
            if (file is null || closed) return;
            args.ResultFilePath = file.Path;
            args.Cancel = false;
            var operation = args.DownloadOperation;
            downloads.Add(operation);
            ShowNotice("正在下载", name, InfoBarSeverity.Informational);
            operation.StateChanged += (_, _) =>
            {
                if (closed) return;
                if (operation.State == CoreWebView2DownloadState.Completed) ShowNotice("下载完成", name, InfoBarSeverity.Success);
                else if (operation.State == CoreWebView2DownloadState.Interrupted) ShowNotice("下载中断", $"{name}，请重试。", InfoBarSeverity.Warning);
            };
        }
        catch (Exception ex) { Diagnostics.Log("下载文件", ex); ShowNotice("无法保存文件", "请重新选择保存位置。", InfoBarSeverity.Error); }
        finally { deferral.Complete(); }
    }

    private void WebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        if (!NavigationPolicy.IsTrusted(args.Source) || args.WebMessageAsJson.Length > 4096) return;
        try
        {
            using var json = JsonDocument.Parse(args.WebMessageAsJson);
            var root = json.RootElement;
            if (root.TryGetProperty("type", out var type) && type.GetString() == "caption-layout")
            {
                if (root.TryGetProperty("regions", out var regions) && regions.ValueKind == JsonValueKind.Array && regions.GetArrayLength() <= 32)
                    SetDragRegions(regions);
                return;
            }
            if (DesktopRequest.TryParse(root, out var request))
            {
                switch (request.Action)
                {
                    case "ready": UpdateWindowAppearance(); break;
                    case "closeToTray": preferences.CloseToTray = request.Value; preferences.Save(); UpdateWindowAppearance(); break;
                    case "fullScreen": ToggleFullScreen(); break;
                    case "downloads": _ = ShowDownloadsAsync(); break;
                    case "reload": Refresh(); break;
                    case "exit": ExitApplication(); break;
                }
                return;
            }
            if (root.GetProperty("type").GetString() != "state") return;
            var title = root.GetProperty("title").GetString() ?? "";
            Title = title.Length == 0 || title == "唱机空着" ? "Mining唱片行" : $"{title} · Mining唱片行";
            tray.Update(title, root.GetProperty("artist").GetString() ?? "", root.GetProperty("playing").GetBoolean());
            Root.RequestedTheme = root.GetProperty("dark").GetBoolean() ? ElementTheme.Dark : ElementTheme.Light;
            ApplyPalette(root.GetProperty("palette"));
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or KeyNotFoundException) { Diagnostics.Log("播放器状态", ex); }
    }

    private void ApplyTheme()
    {
        Root.RequestedTheme = ElementTheme.Default;
        ApplyPalette();
    }

    private void ApplyPalette(JsonElement? palette = null)
    {
        var dark = Root.ActualTheme == ElementTheme.Dark;
        var colors = new[] { dark ? "#0d0d0e" : "#f3f2ee", dark ? "#18181a" : "#ffffff", dark ? "#232326" : "#e9e8e3", dark ? "#f1f0ec" : "#111111", dark ? "#a9a8a2" : "#57564f" };
        var keys = new[] { "bg", "surface", "surface-2", "ink", "ink-2" };
        var brushes = new[] { "ShellBackgroundBrush", "ShellSurfaceBrush", "ShellHoverBrush", "ShellInkBrush", "ShellSecondaryBrush" };
        for (var i = 0; i < keys.Length; i++)
        {
            var value = palette?.GetProperty(keys[i]).GetString() ?? colors[i];
            if (value.Length != 7 || value[0] != '#' || !uint.TryParse(value.AsSpan(1), System.Globalization.NumberStyles.HexNumber, null, out var rgb)) continue;
            ((SolidColorBrush)Application.Current.Resources[brushes[i]]).Color = Windows.UI.Color.FromArgb(255, (byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb);
        }
        UpdateCaptionTheme();
    }

    private void UpdateCaptionTheme()
    {
        var titleBar = AppWindow.TitleBar;
        titleBar.ButtonBackgroundColor = Colors.Transparent;
        titleBar.ButtonInactiveBackgroundColor = Colors.Transparent;
        titleBar.ButtonForegroundColor = Root.ActualTheme == ElementTheme.Dark ? Colors.White : Colors.Black;
    }

    private async Task<ContentDialogResult> ShowDialogAsync(ContentDialog dialog)
    {
        await dialogQueue.WaitAsync();
        try
        {
            if (closed) return ContentDialogResult.None;
            dialog.XamlRoot = Root.XamlRoot;
            dialog.RequestedTheme = Root.ActualTheme;
            dialog.FontFamily = new FontFamily("Microsoft YaHei");
            dialog.KeyboardAcceleratorPlacementMode = Microsoft.UI.Xaml.Input.KeyboardAcceleratorPlacementMode.Hidden;
            dialog.Resources["ContentDialogBackground"] = Application.Current.Resources["ShellBackgroundBrush"];
            dialog.Resources["ContentDialogForeground"] = Application.Current.Resources["ShellInkBrush"];
            dialog.Background = (SolidColorBrush)Application.Current.Resources["ShellBackgroundBrush"];
            dialog.Foreground = (SolidColorBrush)Application.Current.Resources["ShellInkBrush"];
            dialog.CornerRadius = new CornerRadius(14);
            return await dialog.ShowAsync();
        }
        catch (Exception ex) { Diagnostics.Log("显示对话框", ex); return ContentDialogResult.None; }
        finally { dialogQueue.Release(); }
    }

    private void ShowLoading()
    {
        ErrorPanel.Visibility = Visibility.Collapsed;
        LoadingPanel.Visibility = Visibility.Visible;
        LoadingRing.IsActive = true;
    }
    private void ShowError(string title, string message)
    {
        LoadingRing.IsActive = false;
        LoadingPanel.Visibility = Visibility.Collapsed;
        ErrorTitle.Text = title;
        ErrorMessage.Text = message;
        MusicWebView.Visibility = Visibility.Collapsed;
        ErrorPanel.Visibility = Visibility.Visible;
    }
    private void ShowNotice(string title, string message, InfoBarSeverity severity)
    {
        Notice.Title = title; Notice.Message = message; Notice.Severity = severity; Notice.IsOpen = true;
    }
    private void Command(string command)
    {
        if (Core is { } core && NavigationPolicy.IsTrusted(core.Source))
            core.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "command", command }));
    }
    private void Refresh() { if (initialized) { ShowLoading(); Core?.Reload(); } else _ = InitializeWebViewAsync(); }
    private void ToggleFullScreen()
    {
        fullScreen = !fullScreen;
        AppWindow.SetPresenter(fullScreen ? AppWindowPresenterKind.FullScreen : AppWindowPresenterKind.Default);
        SetDragRegions();
        UpdateWindowAppearance();
    }
    private void UpdateWindowAppearance()
    {
        if (Core is not { } core || !NavigationPolicy.IsTrusted(core.Source)) return;
        var scale = Root.XamlRoot?.RasterizationScale ?? 1;
        core.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "window", fullScreen, captionInset = fullScreen ? 0 : AppWindow.TitleBar.RightInset / scale }));
        core.PostWebMessageAsJson(JsonSerializer.Serialize(new { type = "desktop-settings", protocol = 1, closeToTray = preferences.CloseToTray, fullScreen }));
    }
    private void SetDragRegions(JsonElement? regions = null)
    {
        if (closed) return;
        var scale = Root.XamlRoot?.RasterizationScale ?? 1;
        var available = Math.Max(0, AppWindow.Size.Width - AppWindow.TitleBar.RightInset);
        var rectangles = new List<RectInt32>();
        if (!fullScreen && regions is { } values)
        {
            foreach (var region in values.EnumerateArray())
            {
                if (!region.TryGetProperty("x", out var xElement) || !xElement.TryGetDouble(out var x)
                    || !region.TryGetProperty("width", out var widthElement) || !widthElement.TryGetDouble(out var width)
                    || !double.IsFinite(x) || !double.IsFinite(width) || x < 0 || width <= 0) continue;
                var left = Math.Min(available, x * scale);
                var right = Math.Min(available, (x + width) * scale);
                if (right > left) rectangles.Add(new RectInt32((int)left, 0, (int)(right - left), (int)(24 * scale)));
            }
        }
        else if (!fullScreen && available > 0) rectangles.Add(new RectInt32(0, 0, available, (int)(24 * scale)));
        InputNonClientPointerSource.GetForWindowId(AppWindow.Id).SetRegionRects(NonClientRegionKind.Caption, rectangles.ToArray());
    }
    public void RestoreFromTray()
    {
        if (closed) return;
        AppWindow.Show();
        if (AppWindow.Presenter is OverlappedPresenter presenter && presenter.State == OverlappedPresenterState.Minimized) presenter.Restore();
        Activate();
    }
    private void ExitApplication() { exiting = true; Close(); }
    private void Back_Invoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args) { if (Core?.CanGoBack == true) Core.GoBack(); args.Handled = true; }
    private void Refresh_Invoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args) { Refresh(); args.Handled = true; }
    private void FullScreen_Invoked(KeyboardAccelerator sender, KeyboardAcceleratorInvokedEventArgs args) { ToggleFullScreen(); args.Handled = true; }
    private async void Retry_Click(object sender, RoutedEventArgs e) { if (initialized) { ShowLoading(); Core?.Navigate(NavigationPolicy.Home.AbsoluteUri); } else await InitializeWebViewAsync(); }

    private async Task ShowDownloadsAsync()
    {
        var panel = new StackPanel { Spacing = 12, MinWidth = 320 };
        if (downloads.Count + externalDownloads.Count == 0) panel.Children.Add(new TextBlock { Text = "还没有下载任务。\n在歌曲菜单中选择下载，即可保存音乐。", TextWrapping = TextWrapping.Wrap });
        foreach (var download in externalDownloads.TakeLast(15)) panel.Children.Add(new TextBlock { Text = download, TextWrapping = TextWrapping.Wrap });
        foreach (var download in downloads.TakeLast(15))
        {
            var state = download.State switch { CoreWebView2DownloadState.Completed => "已完成", CoreWebView2DownloadState.Interrupted => "已中断", _ => "下载中" };
            panel.Children.Add(new TextBlock { Text = $"{Path.GetFileName(download.ResultFilePath)}\n{state} · {download.BytesReceived / 1024d / 1024d:F1} MB", TextWrapping = TextWrapping.Wrap });
        }
        await ShowDialogAsync(new ContentDialog { Title = "下载任务", Content = new ScrollViewer { Content = panel, MaxHeight = 400 }, CloseButtonText = "关闭" });
    }

}
