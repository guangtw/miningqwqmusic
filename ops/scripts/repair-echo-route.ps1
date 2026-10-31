param([switch]$Elevated)
$ErrorActionPreference = 'Stop'
$taskPrefix = '47.122.113.9/32'
$taskInterface = Get-NetIPConfiguration -InterfaceAlias 'WLAN'
$taskGateway = $taskInterface.IPv4DefaultGateway.NextHop
if (-not $taskGateway) { throw 'WLAN has no default gateway; no route changed.' }
$taskPersistent = @(Get-NetRoute -DestinationPrefix $taskPrefix -PolicyStore PersistentStore -ErrorAction SilentlyContinue)
if ($taskPersistent.Count -eq 1 -and $taskPersistent[0].InterfaceAlias -eq 'WLAN' -and $taskPersistent[0].NextHop -eq $taskGateway) {
    Write-Output 'Direct SSH route is already persistent.'
    exit 0
}
if ($taskPersistent.Count) { throw 'A different persistent server route exists; inspect it before changing networks.' }
$taskAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $taskAdmin) {
    if ($Elevated) { throw 'Administrator access was not granted.' }
    $taskProcess = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $PSCommandPath + '"'), '-Elevated') -PassThru -Wait
    if ($taskProcess.ExitCode -ne 0) { throw 'Persistent route setup failed.' }
    exit 0
}
$taskActive = @(Get-NetRoute -DestinationPrefix $taskPrefix -PolicyStore ActiveStore -ErrorAction SilentlyContinue)
if ($taskActive.Count -gt 1 -or ($taskActive.Count -eq 1 -and ($taskActive[0].InterfaceAlias -ne 'WLAN' -or $taskActive[0].NextHop -ne $taskGateway))) { throw 'A different active server route exists; no change made.' }
try {
    $taskActive | Remove-NetRoute -Confirm:$false
    & route.exe -p ADD 47.122.113.9 MASK 255.255.255.255 $taskGateway METRIC 1 IF $taskInterface.InterfaceIndex | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Windows route.exe could not create the persistent host route.' }
    if (-not (Get-NetRoute -DestinationPrefix $taskPrefix -PolicyStore PersistentStore -ErrorAction SilentlyContinue)) { throw 'Persistent host route verification failed.' }
} catch {
    if (-not (Get-NetRoute -DestinationPrefix $taskPrefix -PolicyStore ActiveStore -ErrorAction SilentlyContinue)) {
        New-NetRoute -DestinationPrefix $taskPrefix -InterfaceAlias 'WLAN' -NextHop $taskGateway -RouteMetric 1 -PolicyStore ActiveStore | Out-Null
    }
    throw
}
Write-Output 'Persistent direct route installed for the deployment server only.'
