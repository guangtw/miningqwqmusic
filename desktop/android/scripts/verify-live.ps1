param([string]$Serial = 'emulator-5554', [string]$Server = 'aliyun-ai', [switch]$AllowProductionTestAccount)
$ErrorActionPreference = 'Stop'
if (-not $AllowProductionTestAccount) {
    throw 'Production test account creation is disabled by default. Use guest-only ArtworkAuditInstrumentedTest and ShellInstrumentedTest, or explicitly pass -AllowProductionTestAccount in an authorized maintenance run.'
}
& ssh -o BatchMode=yes -o ConnectTimeout=8 $Server 'sudo -n true'
if ($LASTEXITCODE -ne 0) { throw 'SSH cleanup access is unavailable; no production account was created.' }
$project = Split-Path $PSScriptRoot -Parent
if (-not $env:ANDROID_HOME) { throw 'Set ANDROID_HOME first.' }
$adb = Join-Path $env:ANDROID_HOME 'platform-tools/adb.exe'
$email = 'android-qa-' + [guid]::NewGuid().ToString('N') + '@example.test'
$work = Join-Path ([IO.Path]::GetTempPath()) ('mining-android-qa-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null

function Invoke-AccountQa([string]$Action) {
    # The remote helper accepts only this run's random @example.test identity.
    Get-Content -LiteralPath (Join-Path $PSScriptRoot 'qa-account.cjs') -Raw |
        & ssh -o BatchMode=yes -o ConnectTimeout=8 $Server "sudo -n /www/server/nvm/versions/node/v24.15.0/bin/node - $email $Action"
    if ($LASTEXITCODE -ne 0) { throw "Disposable account operation failed: $Action" }
}

Push-Location $project
try {
    & $adb -s $Serial get-state
    if ($LASTEXITCODE -ne 0) { throw 'Start the dedicated QA emulator first.' }
    & .\gradlew.bat assembleDebug assembleDebugAndroidTest testDebugUnitTest lintDebug
    if ($LASTEXITCODE -ne 0) { throw 'Android build/checks failed.' }
    # Never uninstall an existing client or erase its library. A signing mismatch
    # means the caller should choose a separate QA emulator.
    & $adb -s $Serial install -t -r app/build/outputs/apk/debug/app-debug.apk
    if ($LASTEXITCODE -ne 0) { throw 'Install failed; use a dedicated QA emulator.' }
    & $adb -s $Serial install -t -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
    if ($LASTEXITCODE -ne 0) { throw 'Test APK install failed.' }
    $log = Join-Path $work 'rotation.log'
    $child = Start-Process -FilePath $adb -WindowStyle Hidden -ArgumentList @('-s',$Serial,'shell','am','instrument','-w','-e','class','cn.miningqwq.music.LiveSessionInstrumentedTest#liveFlowUntilProcessDeath','-e','qaEmail',$email,'cn.miningqwq.music.test/androidx.test.runner.AndroidJUnitRunner') -RedirectStandardOutput $log -RedirectStandardError (Join-Path $work 'rotation-error.log') -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    $checkpoint = $false
    $entitled = $false
    $mediaVerified = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $output = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Raw } else { '' }
        if (-not $entitled -and $output -match 'checkpoint=QA_ACCOUNT_READY') {
            Invoke-AccountQa 'probe'
            & $adb -s $Serial shell am broadcast -a cn.miningqwq.music.QA_ENTITLED -p cn.miningqwq.music --es qaEmail $email
            $entitled = $true
        }
        if ($output -match 'checkpoint=TWO_REAL_TRACKS_ADVANCED') { $mediaVerified = $true }
        if ($output -match 'checkpoint=COOKIE_ROTATED') { $checkpoint = $true; break }
        if ($child.HasExited) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $checkpoint -or -not $mediaVerified) {
        Get-Content -LiteralPath $log -Tail 40
        throw 'Real media/cookie durability checkpoint was not reached.'
    }
    Write-Output 'TWO_REAL_TRACKS_ADVANCED'
    & $adb -s $Serial shell am force-stop cn.miningqwq.music
    $child.WaitForExit(5000) | Out-Null
    $result = & $adb -s $Serial shell am instrument -w -e class cn.miningqwq.music.ColdCookieInstrumentedTest -e qaEmail $email cn.miningqwq.music.test/androidx.test.runner.AndroidJUnitRunner 2>&1
    Write-Output $result
    if (($result -join "`n") -notmatch 'OK \(1 test\)') { throw 'The persisted cookie did not authenticate from a fresh process.' }
    Write-Output 'LIVE_MEDIA_AND_PROCESS_DEATH_SESSION_VERIFIED'
} finally {
    try { Invoke-AccountQa 'cleanup' } finally { Pop-Location }
}
