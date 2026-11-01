param([switch]$Run)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$project = Join-Path $workspace 'src\MiningQwQMusic\MiningQwQMusic.csproj'
$destination = Join-Path $workspace 'artifacts\MiningQwQMusic-win-x64'
& dotnet publish $project -c Release -p:Platform=x64 -o $destination
if ($LASTEXITCODE -ne 0) { throw '客户端编译失败。' }
Write-Host "客户端已生成：$destination\MiningQwQMusic.exe"
if ($Run) { Start-Process -FilePath (Join-Path $destination 'MiningQwQMusic.exe') -WorkingDirectory $destination -WindowStyle Normal }
