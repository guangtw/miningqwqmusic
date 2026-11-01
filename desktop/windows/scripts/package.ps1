param([string]$Version = '1.0.0', [switch]$SkipBuild, [string]$SourceCommit = '')
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid package version.' }
$workspace = Split-Path -Parent $PSScriptRoot
if (!$SkipBuild) { & (Join-Path $PSScriptRoot 'build.ps1') }
$published = Join-Path $workspace 'artifacts\MiningQwQMusic-win-x64'
$release = Join-Path $workspace 'artifacts\release'
New-Item -ItemType Directory -Path $release -Force | Out-Null
$staging = Join-Path $workspace ('artifacts\package-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null
$portable = Join-Path $staging 'MiningQwQMusic'
New-Item -ItemType Directory -Path $portable | Out-Null
Copy-Item -Path (Join-Path $published '*') -Destination $portable -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install.ps1') -Destination (Join-Path $portable 'Install.ps1')
New-Item -ItemType Directory -Path (Join-Path $portable 'notices') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $workspace 'packaging\languages\LICENSE') -Destination (Join-Path $portable 'notices\InstallerTranslation-LICENSE.txt')
@"
Mining唱片行 $Version · Windows x64

直接运行 MiningQwQMusic.exe。请保留完整目录。
也可以安装同一 Release 中的 Setup.exe。
默认关闭到系统托盘；关闭行为和其他选项位于原有设置页。
需要联网访问音乐服务及系统中的 WebView2 Runtime。
项目主页：https://github.com/guangtw/miningqwqmusic
源码提交：$SourceCommit
"@ | Set-Content -LiteralPath (Join-Path $portable '使用说明.txt') -Encoding utf8
$zip = Join-Path $release "MiningQwQMusic-Windows-$Version-x64-Portable.zip"
Compress-Archive -LiteralPath $portable -DestinationPath $zip -CompressionLevel Optimal -Force
$compiler = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$compiler) { throw 'Inno Setup 6 is required for the installer.' }
& $compiler /Q "/DAppVersion=$Version" "/DSourceDir=$published" "/DOutputDir=$release" (Join-Path $workspace 'packaging\MiningQwQMusic.iss')
if ($LASTEXITCODE -ne 0) { throw 'Installer compilation failed.' }
$installer = Join-Path $release "MiningQwQMusic-Windows-$Version-x64-Setup.exe"
$hashes = foreach ($asset in @($zip,$installer)) { $hash=Get-FileHash -LiteralPath $asset -Algorithm SHA256; "$($hash.Hash.ToLowerInvariant())  $([IO.Path]::GetFileName($asset))" }
$hashes | Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt') -Encoding ascii
Write-Host "Release assets: $release"
