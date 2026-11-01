using System.Text.Json;

namespace MiningQwQMusic.Services;

internal readonly record struct DesktopRequest(string Action, bool Value = false)
{
    public static bool TryParse(JsonElement root, out DesktopRequest request)
    {
        request = default;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String) return false;
        if (type.GetString() == "desktop-ready") { request = new("ready"); return true; }
        if (type.GetString() != "desktop-action" || !root.TryGetProperty("action", out var action) || action.ValueKind != JsonValueKind.String) return false;
        var name = action.GetString();
        if (name == "closeToTray")
        {
            if (!root.TryGetProperty("value", out var value) || value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
            request = new(name, value.GetBoolean());
            return true;
        }
        if (name is not ("fullScreen" or "downloads" or "reload" or "exit")) return false;
        request = new(name);
        return true;
    }
}
