param([string]$Version = '1.0.0', [string]$SourceCommit)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    if (-not (Test-Path -LiteralPath 'signing.properties')) { throw 'Create local signing.properties first; see README.md.' }
    if (-not $SourceCommit) { $SourceCommit = git rev-parse HEAD }
    & .\gradlew.bat testDebugUnitTest lintRelease assembleRelease
    if ($LASTEXITCODE -ne 0) { throw 'Release validation/build failed.' }
    $metadata = Get-Content -LiteralPath 'app/build/outputs/apk/release/output-metadata.json' -Raw | ConvertFrom-Json
    if ($metadata.elements[0].versionName -ne $Version) { throw 'Version must match app/build.gradle versionName.' }
    if ($env:ANDROID_HOME) {
        $apkSigner = Join-Path $env:ANDROID_HOME 'build-tools/35.0.0/apksigner.bat'
        & $apkSigner verify --verbose 'app/build/outputs/apk/release/app-release.apk'
        if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    }
    $output = Join-Path (Get-Location) 'artifacts'
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    $apkName = "MiningQwQMusic-android-v$Version.apk"
    Copy-Item -LiteralPath 'app/build/outputs/apk/release/app-release.apk' -Destination (Join-Path $output $apkName)
    $hash = (Get-FileHash -LiteralPath (Join-Path $output $apkName) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $apkName" | Set-Content -LiteralPath (Join-Path $output 'SHA256SUMS.txt') -Encoding utf8
    [ordered]@{ version = $Version; sourceCommit = $SourceCommit; applicationId = 'cn.miningqwq.music'; minimumAndroid = '8.0'; sha256 = $hash } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output 'build-info.json') -Encoding utf8
    Write-Output "Release APK: $output\$apkName"
} finally { Pop-Location }
