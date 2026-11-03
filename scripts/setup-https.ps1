param([string]$LanIp)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $LanIp) {
  $network = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Select-Object -First 1
  $LanIp = $network.IPv4Address.IPAddress
}
$parsedIp = $null
if (-not [System.Net.IPAddress]::TryParse($LanIp, [ref]$parsedIp) -or $parsedIp.AddressFamily -ne 'InterNetwork') {
  throw 'Specify your laptop Wi-Fi IPv4 address: npm run setup:https -- -LanIp 192.168.1.8'
}
$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
if (-not $mkcert) {
  throw 'Install mkcert from https://github.com/FiloSottile/mkcert#installation (Windows: winget install --id FiloSottile.mkcert -e), reopen PowerShell, and rerun this command.'
}
$certDir = Join-Path $projectRoot '.certs'
New-Item -ItemType Directory -Path $certDir -Force | Out-Null
& $mkcert.Source -key-file (Join-Path $certDir 'miro-key.pem') -cert-file (Join-Path $certDir 'miro.pem') localhost 127.0.0.1 ::1 $LanIp
if ($LASTEXITCODE -ne 0) { throw 'Certificate generation failed.' }
$caRoot = & $mkcert.Source -CAROOT
# Trust for this Windows user only; no system-wide administrator prompt.
& certutil.exe -user -f -addstore Root (Join-Path $caRoot 'rootCA.pem') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Current-user CA trust installation failed.' }
Copy-Item -LiteralPath (Join-Path $caRoot 'rootCA.pem') -Destination (Join-Path $certDir 'phone-rootCA.crt')
@{ lanIp = $LanIp; phoneUrl = "https://${LanIp}:5173" } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $certDir 'network.json')
Write-Host "Laptop: https://localhost:5173"
Write-Host "Phone:  https://${LanIp}:5173"
Write-Host "Transfer only .certs/phone-rootCA.crt to the phone and install/trust it. Never transfer a private key. See NETWORK_SETUP.md."
