using System.Text.Json;

namespace MiningQwQMusic.Services;

internal sealed class AppPreferences
{
    internal static string DataDirectory { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MiningQwQMusic");
    private static string SettingsPath => Path.Combine(DataDirectory, "settings.json");
    public bool CloseToTray { get; set; } = true;
    public int Width { get; set; } = 1280;
    public int Height { get; set; } = 860;
    public int? X { get; set; }
    public int? Y { get; set; }
    public bool Maximized { get; set; }
    public static AppPreferences Load()
    {
        try { return JsonSerializer.Deserialize<AppPreferences>(File.ReadAllText(SettingsPath)) ?? new(); }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException) { return new(); }
    }
    public void Save()
    {
        try
        {
            Directory.CreateDirectory(DataDirectory);
            var temporary = SettingsPath + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(this));
            File.Move(temporary, SettingsPath, true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Diagnostics.Log("保存窗口设置", ex); }
    }
}
