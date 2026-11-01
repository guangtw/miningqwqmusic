param([string]$SourceDirectory, [string]$SourceCommit)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$workspace = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $workspace 'src\MiningQwQMusic\Assets'
if ($SourceDirectory) {
    Copy-Item -LiteralPath (Join-Path $SourceDirectory 'icon-512.png') -Destination (Join-Path $assets 'Music.png') -Force
    Copy-Item -LiteralPath (Join-Path $SourceDirectory 'icon-512.svg') -Destination (Join-Path $assets 'AppIcon.svg') -Force
    [ordered]@{
        repository = 'https://github.com/guangtw/miningqwqmusic'
        commit = $SourceCommit
        source = 'public/icons/icon-512.png'
        sha256 = (Get-FileHash -LiteralPath (Join-Path $assets 'Music.png')).Hash.ToLowerInvariant()
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $assets 'BrandSource.json') -Encoding utf8
}
# Keep the exact upstream artwork; only resize it into Windows icon frames.
$source = [Drawing.Image]::FromFile((Join-Path $assets 'Music.png'))
$icon = [IO.BinaryWriter]::new([IO.File]::Create((Join-Path $assets 'AppIcon.ico')))
try {
    $sizes = @(16,24,32,48,64,128,256)
    $images = foreach ($size in $sizes) {
        $bitmap = [Drawing.Bitmap]::new($size,$size)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($source,0,0,$size,$size)
        $stream = [IO.MemoryStream]::new()
        $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
        [pscustomobject]@{Size=$size; Bytes=$stream.ToArray()}
        $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
    }
    $icon.Write([uint16]0); $icon.Write([uint16]1); $icon.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    foreach ($entry in $images) {
        $dimension = if ($entry.Size -eq 256) {0} else {$entry.Size}
        $icon.Write([byte]$dimension); $icon.Write([byte]$dimension)
        $icon.Write([byte]0); $icon.Write([byte]0); $icon.Write([uint16]1); $icon.Write([uint16]32)
        $icon.Write([uint32]$entry.Bytes.Length); $icon.Write([uint32]$offset)
        $offset += $entry.Bytes.Length
    }
    foreach ($entry in $images) { $icon.Write([byte[]]$entry.Bytes) }
} finally { $icon.Dispose(); $source.Dispose() }
Copy-Item -LiteralPath (Join-Path $assets 'AppIcon.ico') -Destination (Join-Path $assets 'TrayIcon.ico') -Force
