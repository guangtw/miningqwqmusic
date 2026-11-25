using System.Runtime.InteropServices;
using Microsoft.UI.Composition;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace MiningQwQMusic.Services;

/// <summary>
/// Makes a WinUI window per-pixel transparent. Without a backdrop WinUI fills the window with the
/// theme background (the RGB 243,243,243 measured on the first prototype), so this backdrop supplies
/// a fully transparent system brush, and DWM is told to blend the window with an empty blur region
/// so the alpha channel of the content reaches the desktop instead of being composited on black.
/// </summary>
internal sealed class TransparentBackdrop(nint window) : SystemBackdrop
{
    private static object? dispatcherQueueController;
    private Windows.UI.Composition.Compositor? compositor;

    protected override void OnTargetConnected(ICompositionSupportsSystemBackdrop connectedTarget, XamlRoot xamlRoot)
    {
        base.OnTargetConnected(connectedTarget, xamlRoot);
        EnsureSystemDispatcherQueue();
        compositor ??= new Windows.UI.Composition.Compositor();
        connectedTarget.SystemBackdrop = compositor.CreateColorBrush(Windows.UI.Color.FromArgb(0, 0, 0, 0));
        EnableDesktopAlpha(window);
    }

    protected override void OnTargetDisconnected(ICompositionSupportsSystemBackdrop disconnectedTarget)
    {
        disconnectedTarget.SystemBackdrop = null;
        base.OnTargetDisconnected(disconnectedTarget);
    }

    internal static void EnableDesktopAlpha(nint window)
    {
        // An empty, off-screen blur region turns on alpha blending for the whole window without blurring.
        var region = CreateRectRgn(-2, -2, -1, -1);
        try
        {
            var blur = new BlurBehind { Flags = 1 | 2, Enable = 1, Region = region };
            DwmEnableBlurBehindWindow(window, ref blur);
        }
        finally { if (region != 0) DeleteObject(region); }
        // Windows 11: no system backdrop, no rounded corners and no accent border around the lyric.
        var none = 1;
        DwmSetWindowAttribute(window, 38, ref none, sizeof(int));
        DwmSetWindowAttribute(window, 33, ref none, sizeof(int));
        var noBorder = unchecked((int)0xFFFFFFFE);
        DwmSetWindowAttribute(window, 34, ref noBorder, sizeof(int));
    }

    // Windows.UI.Composition needs a system DispatcherQueue on this thread.
    private static void EnsureSystemDispatcherQueue()
    {
        if (Windows.System.DispatcherQueue.GetForCurrentThread() is not null || dispatcherQueueController is not null) return;
        var options = new DispatcherQueueOptions { Size = Marshal.SizeOf<DispatcherQueueOptions>(), ThreadType = 2, ApartmentType = 2 };
        object? controller = null;
        if (CreateDispatcherQueueController(options, ref controller) >= 0) dispatcherQueueController = controller;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BlurBehind { public uint Flags; public int Enable; public nint Region; public int TransitionOnMaximized; }
    [StructLayout(LayoutKind.Sequential)]
    private struct DispatcherQueueOptions { public int Size; public int ThreadType; public int ApartmentType; }
    [DllImport("dwmapi.dll")] private static extern int DwmEnableBlurBehindWindow(nint window, ref BlurBehind blur);
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(nint window, int attribute, ref int value, int size);
    [DllImport("gdi32.dll")] private static extern nint CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DeleteObject(nint handle);
    [DllImport("CoreMessaging.dll")] private static extern int CreateDispatcherQueueController(DispatcherQueueOptions options, [MarshalAs(UnmanagedType.IUnknown)] ref object? controller);
}
