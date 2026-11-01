param([switch]$DesktopShortcut)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$source = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'MiningQwQMusic.exe')) { $PSScriptRoot } else { Join-Path $workspace 'artifacts\MiningQwQMusic-win-x64' }
if (!(Test-Path -LiteralPath (Join-Path $source 'MiningQwQMusic.exe'))) { throw '请先运行 scripts\build.ps1。' }
$destination = Join-Path $env:LOCALAPPDATA 'Programs\MiningQwQMusic'
if (Get-Process MiningQwQMusic -ErrorAction SilentlyContinue) { throw '请先关闭 Mining唱片行，再安装。' }
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force
$iconHash = (Get-FileHash -LiteralPath (Join-Path $destination 'Assets\AppIcon.ico') -Algorithm SHA256).Hash.Substring(0,12)
$shortcutIcon = Join-Path $destination "Assets\AppIcon-$iconHash.ico"
Copy-Item -LiteralPath (Join-Path $destination 'Assets\AppIcon.ico') -Destination $shortcutIcon -Force
$shortcutShell = New-Object -ComObject WScript.Shell
$shortcut = $shortcutShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Mining唱片行.lnk'))
$shortcut.TargetPath = Join-Path $destination 'MiningQwQMusic.exe'
$shortcut.WorkingDirectory = $destination
$shortcut.IconLocation = $shortcutIcon
$shortcut.Save()
if ($DesktopShortcut) {
    $desktop = $shortcutShell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Mining唱片行.lnk'))
    $desktop.TargetPath = $shortcut.TargetPath
    $desktop.WorkingDirectory = $destination
    $desktop.IconLocation = $shortcut.IconLocation
    $desktop.Save()
}
Write-Host 'Mining唱片行已安装到当前用户，并添加到开始菜单。'
