$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$signingFile = Join-Path $project 'signing.properties'
if (Test-Path -LiteralPath $signingFile) { throw 'signing.properties already exists; keep the existing key for upgrades.' }
$keyDirectory = Join-Path $env:LOCALAPPDATA 'MiningQwQMusicAndroid\signing'
New-Item -ItemType Directory -Force -Path $keyDirectory | Out-Null
$keyPath = Join-Path $keyDirectory 'release.jks'
if (Test-Path -LiteralPath $keyPath) { throw 'Release key already exists. Restore its original signing.properties rather than replacing the key.' }
$random = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($random)
$rng.Dispose()
$password = [Convert]::ToBase64String($random)
$env:MINING_ANDROID_SIGN_PASSWORD = $password
try {
    & keytool -genkeypair -keystore $keyPath -storetype JKS -alias miningqwqmusic -keyalg RSA -keysize 4096 -validity 10000 -storepass:env MINING_ANDROID_SIGN_PASSWORD -keypass:env MINING_ANDROID_SIGN_PASSWORD -dname 'CN=MiningQwQ Music, O=MiningQwQ, C=CN'
    if ($LASTEXITCODE -ne 0) { throw 'Release key generation failed.' }
    $properties = "storeFile=$($keyPath.Replace('\', '/'))`nstorePassword=$password`nkeyAlias=miningqwqmusic`nkeyPassword=$password`n"
    [IO.File]::WriteAllText($signingFile, $properties, [Text.UTF8Encoding]::new($false))
    # Keep a private recovery copy beside the key, outside the checkout.
    [IO.File]::WriteAllText((Join-Path $keyDirectory 'signing.properties'), $properties, [Text.UTF8Encoding]::new($false))
    Write-Output "Signing key saved outside the repository: $keyPath"
} finally { Remove-Item Env:MINING_ANDROID_SIGN_PASSWORD -ErrorAction SilentlyContinue }
