using System.Runtime.InteropServices;
using Windows.Graphics;

namespace MiningQwQMusic.Services;

internal static class CaptionButtons
{
    // DWM returns the three buttons as one physical rectangle relative to the window, including its frame.
    internal static SizeInt32 Measure(nint hwnd, int fallbackWidth, int fallbackHeight)
    {
        if (DwmGetWindowAttribute(hwnd, 5, out var buttons, Marshal.SizeOf<Rect>()) == 0 &&
            buttons.Right > buttons.Left && buttons.Bottom > buttons.Top &&
            GetWindowRect(hwnd, out var window) && GetClientRect(hwnd, out var client))
        {
            var point = new Point { X = window.Left + buttons.Left, Y = window.Top + buttons.Bottom };
            if (ScreenToClient(hwnd, ref point))
            {
                var width = client.Right - point.X;
                if (width > 0 && width <= client.Right && point.Y > 0 && point.Y <= client.Bottom)
                    return new SizeInt32(width, point.Y);
            }
        }
        return new SizeInt32(fallbackWidth, fallbackHeight);
    }

    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint hwnd, uint attribute, out Rect rect, int size);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool GetClientRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern bool ScreenToClient(nint hwnd, ref Point point);
}
