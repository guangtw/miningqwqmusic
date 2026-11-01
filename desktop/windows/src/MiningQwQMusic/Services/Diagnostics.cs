namespace MiningQwQMusic.Services;

internal static class Diagnostics
{
    // Never log URLs, page data, credentials or tokens.
    public static void Log(string operation, Exception exception)
    {
        try
        {
            Directory.CreateDirectory(AppPreferences.DataDirectory);
            var path = Path.Combine(AppPreferences.DataDirectory, "app.log");
            if (File.Exists(path) && new FileInfo(path).Length > 256 * 1024) File.WriteAllText(path, "");
            File.AppendAllText(path, $"{DateTimeOffset.Now:O} {operation}: {exception.GetType().Name} 0x{exception.HResult:X8}{Environment.NewLine}");
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
    }
}
