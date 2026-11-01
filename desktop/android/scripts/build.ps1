param([switch]$Test, [switch]$Release)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    if ($Test) {
        & .\gradlew.bat testDebugUnitTest lintDebug connectedDebugAndroidTest
        if ($LASTEXITCODE -ne 0) { throw 'Android validation failed.' }
    }
    $buildTask = if ($Release) { 'assembleRelease' } else { 'assembleDebug' }
    & .\gradlew.bat $buildTask
    if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
} finally { Pop-Location }
