using System.Runtime.InteropServices;

namespace MiningQwQMusic.Services;

/// <summary>Owns the notification-area icon and its native Windows message lifetime.</summary>
internal sealed class TrayIcon : IDisposable
{
    private const uint CallbackMessage = 0x8000 + 73;
    private readonly nint window;
    private readonly SubclassProc callback;
    private readonly uint taskbarCreated = RegisterWindowMessage("TaskbarCreated");
    private readonly Action restore;
    private readonly Action<string> command;
    private readonly Action exit;
    private NotifyIconData data;
    private bool disposed;
    public bool IsAvailable { get; private set; }
    public bool IsPlaying { get; set; }

    public TrayIcon(nint window, string iconPath, Action restore, Action<string> command, Action exit)
    {
        this.window = window;
        this.restore = restore;
        this.command = command;
        this.exit = exit;
        callback = WindowMessage;
        data = new NotifyIconData
        {
            Size = (uint)Marshal.SizeOf<NotifyIconData>(), Window = window, Id = 1,
            Flags = 1 | 2 | 4 | 0x80, CallbackMessage = CallbackMessage,
            Icon = LoadImage(0, iconPath, 1, 0, 0, 0x10), Tip = "Mining唱片行", Info = "", InfoTitle = ""
        };
        if (data.Icon == 0 || !SetWindowSubclass(window, callback, 73, 0))
        {
            if (data.Icon != 0) DestroyIcon(data.Icon);
            data.Icon = 0;
            return;
        }
        AddIcon();
    }

    private void AddIcon()
    {
        if (disposed || data.Icon == 0) return;
        IsAvailable = ShellNotifyIcon(0, ref data);
        if (!IsAvailable) return;
        data.Version = 4;
        ShellNotifyIcon(4, ref data);
    }

    public bool EnsureAvailable()
    {
        if (!IsAvailable) AddIcon();
        return IsAvailable;
    }

    public void Update(string title, string artist, bool playing)
    {
        IsPlaying = playing;
        var text = string.IsNullOrWhiteSpace(title) || title == "唱机空着" ? "Mining唱片行" : $"{title} · {artist}\nMining唱片行";
        data.Tip = text.Length <= 127 ? text : text[..126];
        if (IsAvailable && !disposed) ShellNotifyIcon(1, ref data);
    }

    private nint WindowMessage(nint hwnd, uint message, nuint wParam, nint lParam, nuint id, nuint reference)
    {
        // No exception may cross the unmanaged window procedure boundary.
        try
        {
            if (message == taskbarCreated) { IsAvailable = false; AddIcon(); }
            if (message == CallbackMessage)
            {
                var notification = (uint)((long)lParam & 0xffff);
                if (notification is 0x400 or 0x401 or 0x203) restore();
                else if (notification == 0x7b) ShowMenu();
                return 0;
            }
        }
        catch (Exception ex) { Diagnostics.Log("托盘操作", ex); }
        return DefSubclassProc(hwnd, message, wParam, lParam);
    }

    private void ShowMenu()
    {
        var menu = CreatePopupMenu();
        if (menu == 0) return;
        try
        {
            AppendMenu(menu, 0, 1, "打开唱片行");
            AppendMenu(menu, 0x800, 0, "");
            AppendMenu(menu, 0, 2, IsPlaying ? "暂停" : "播放");
            AppendMenu(menu, 0, 3, "上一首");
            AppendMenu(menu, 0, 4, "下一首");
            AppendMenu(menu, 0x800, 0, "");
            AppendMenu(menu, 0, 5, "退出唱片行");
            GetCursorPos(out var point);
            SetForegroundWindow(window);
            var selected = TrackPopupMenuEx(menu, 0x100 | 2, point.X, point.Y, window, 0);
            PostMessage(window, 0, 0, 0);
            switch (selected)
            {
                case 1: restore(); break;
                case 2: command("play"); break;
                case 3: command("previous"); break;
                case 4: command("next"); break;
                case 5: exit(); break;
            }
        }
        finally { DestroyMenu(menu); }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        ShellNotifyIcon(2, ref data);
        RemoveWindowSubclass(window, callback, 73);
        if (data.Icon != 0) DestroyIcon(data.Icon);
        IsAvailable = false;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NotifyIconData
    {
        public uint Size;
        public nint Window;
        public uint Id, Flags, CallbackMessage;
        public nint Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Tip;
        public uint State, StateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Info;
        public uint Version;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string InfoTitle;
        public uint InfoFlags;
        public Guid Guid;
        public nint BalloonIcon;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [UnmanagedFunctionPointer(CallingConvention.Winapi)] private delegate nint SubclassProc(nint hwnd, uint message, nuint wParam, nint lParam, nuint id, nuint reference);
    [DllImport("shell32.dll", EntryPoint = "Shell_NotifyIconW", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ShellNotifyIcon(uint message, ref NotifyIconData data);
    [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetWindowSubclass(nint window, SubclassProc callback, nuint id, nuint reference);
    [DllImport("comctl32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool RemoveWindowSubclass(nint window, SubclassProc callback, nuint id);
    [DllImport("comctl32.dll")] private static extern nint DefSubclassProc(nint window, uint message, nuint wParam, nint lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessage(string name);
    [DllImport("user32.dll", EntryPoint = "LoadImageW", CharSet = CharSet.Unicode)] private static extern nint LoadImage(nint instance, string name, uint type, int x, int y, uint flags);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DestroyIcon(nint icon);
    [DllImport("user32.dll")] private static extern nint CreatePopupMenu();
    [DllImport("user32.dll", EntryPoint = "AppendMenuW", CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AppendMenu(nint menu, uint flags, nuint id, string text);
    [DllImport("user32.dll")] private static extern uint TrackPopupMenuEx(nint menu, uint flags, int x, int y, nint window, nint parameters);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DestroyMenu(nint menu);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetForegroundWindow(nint window);
    [DllImport("user32.dll", EntryPoint = "PostMessageW")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PostMessage(nint window, uint message, nuint wParam, nint lParam);
}
