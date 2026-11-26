using System.Text.Json;

namespace MiningQwQMusic.Services;

internal sealed record DesktopLyricFrame(string Title, string Artist, string Primary, string Secondary,
    double? Start, double? End, double Position, bool Playing, bool Reduced)
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    internal static DesktopLyricFrame? Read(JsonElement root)
    {
        var frame = root.Deserialize<DesktopLyricFrame>(Options);
        if (frame is not { Title.Length: <= 120, Artist.Length: <= 100, Primary.Length: <= 200, Secondary.Length: <= 200 }
            || !double.IsFinite(frame.Position) || frame.Position < 0) return null;
        if (frame.Start is null && frame.End is null) return frame;
        return frame.Start is double start && frame.End is double end && double.IsFinite(start) && double.IsFinite(end)
            && start >= 0 && end >= start ? frame : null;
    }
}
