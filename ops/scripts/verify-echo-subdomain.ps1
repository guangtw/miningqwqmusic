param(
  [string]$Subdomain = "echo.miningqwq.cn",
  [string]$RootDomain = "miningqwq.cn",
  [string]$ApiPath = "/api/music/search?q=%E6%99%B4%E5%A4%A9&page=1&pageSize=5"
)

$ErrorActionPreference = "Stop"

function Write-Ok($Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Warn($Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Err($Message) {
  Write-Host "[ERR] $Message" -ForegroundColor Red
}

Write-Host "== 1) DNS check: $Subdomain =="
try {
  $dns = Resolve-DnsName -Name $Subdomain -Type A -ErrorAction Stop
  $ips = ($dns | Where-Object { $_.Type -eq "A" } | Select-Object -ExpandProperty IPAddress) -join ", "
  if ([string]::IsNullOrWhiteSpace($ips)) {
    Write-Warn "No A record found yet. Wait for DNS propagation."
  } else {
    Write-Ok "A records: $ips"
  }
} catch {
  Write-Warn "DNS lookup failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "== 2) HTTP/HTTPS reachability =="
try {
  $httpResp = Invoke-WebRequest -Uri "http://$Subdomain" -Method Head -MaximumRedirection 0 -SkipHttpErrorCheck
  $httpCode = [int]$httpResp.StatusCode
} catch {
  if ($_.Exception.Response) {
    $httpCode = [int]$_.Exception.Response.StatusCode
  } else {
    $httpCode = 0
  }
}

try {
  $httpsResp = Invoke-WebRequest -Uri "https://$Subdomain" -Method Head -MaximumRedirection 0 -SkipHttpErrorCheck
  $httpsCode = [int]$httpsResp.StatusCode
} catch {
  if ($_.Exception.Response) {
    $httpsCode = [int]$_.Exception.Response.StatusCode
  } else {
    $httpsCode = 0
  }
}

if ($httpCode -in 200,301,302) {
  Write-Ok "http://$Subdomain -> $httpCode"
} else {
  Write-Warn "http://$Subdomain -> $httpCode (expected 200/301/302)"
}

if ($httpsCode -in 200,301,302) {
  Write-Ok "https://$Subdomain -> $httpsCode"
} else {
  Write-Err "https://$Subdomain -> $httpsCode (expected 200/301/302)"
}

Write-Host ""
Write-Host "== 3) BFF API check =="
$apiUrl = "https://$Subdomain$ApiPath"
try {
  $apiRaw = Invoke-RestMethod -Uri $apiUrl -Method Get
  if ($null -ne $apiRaw.code -and [int]$apiRaw.code -eq 0) {
    Write-Ok "API OK: $apiUrl"
  } else {
    Write-Warn "API response does not contain code:0. Check upstream and BFF."
    $apiRaw | ConvertTo-Json -Depth 6
  }
} catch {
  Write-Warn "API request failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host "== 4) Root domain isolation check =="
try {
  $rootResp = Invoke-WebRequest -Uri "https://$RootDomain" -Method Head -MaximumRedirection 0 -SkipHttpErrorCheck
  $rootCode = [int]$rootResp.StatusCode
} catch {
  if ($_.Exception.Response) {
    $rootCode = [int]$_.Exception.Response.StatusCode
  } else {
    $rootCode = 0
  }
}

Write-Warn "Please manually verify root domain is not serving this frontend."
Write-Host "https://$RootDomain -> $rootCode"

Write-Host ""
Write-Ok "Done. If WARN/ERR appears, follow docs/echo-subdomain-deploy.md."
