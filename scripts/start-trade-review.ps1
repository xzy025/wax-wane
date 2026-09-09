[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $repoRoot '.runtime'
$serverEnvPath = Join-Path $repoRoot 'server\.env'

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

function Test-ListeningPort {
  param([Parameter(Mandatory)][int]$Port)

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connect = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(1000, $false)) {
      return $false
    }
    $client.EndConnect($connect)
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Get-DotEnvValue {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return ''
  }
  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -Last 1
  if (-not $line) {
    return ''
  }
  return (($line -split '=', 2)[1].Trim() -replace '^["'']|["'']$', '')
}

function Send-StartupFailure {
  param([Parameter(Mandatory)][string]$Message)

  $enabled = Get-DotEnvValue -Path $serverEnvPath -Name 'AUCTION_PUSH_ENABLED'
  $sendKey = Get-DotEnvValue -Path $serverEnvPath -Name 'SERVERCHAN_SEND_KEY'
  if ($enabled -ne 'true' -or [string]::IsNullOrWhiteSpace($sendKey)) {
    return
  }
  try {
    $encodedKey = [uri]::EscapeDataString($sendKey)
    Invoke-RestMethod `
      -Method Post `
      -Uri "https://sctapi.ftqq.com/$encodedKey.send" `
      -ContentType 'application/x-www-form-urlencoded' `
      -Body @{
        title = 'Auction brief service startup failed'
        desp = "$Message`n`nCheck the local network and server log before 09:15."
      } `
      -TimeoutSec 8 | Out-Null
  } catch {
    # The local log remains the final fallback when both startup and notification fail.
  }
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

if (-not (Test-ListeningPort -Port 3002)) {
  Start-Process `
    -FilePath $npm `
    -ArgumentList @('--prefix', 'server', 'run', 'start') `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDir 'server.out.log') `
    -RedirectStandardError (Join-Path $runtimeDir 'server.err.log')
}

if (-not (Test-ListeningPort -Port 3000)) {
  Start-Process `
    -FilePath $npm `
    -ArgumentList @('run', 'dev', '--', '--host', '0.0.0.0', '--port', '3000') `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $runtimeDir 'web.out.log') `
    -RedirectStandardError (Join-Path $runtimeDir 'web.err.log')
}

Start-Sleep -Seconds 12
if (-not (Test-ListeningPort -Port 3002)) {
  $message = "Backend port 3002 is not listening. Log: $(Join-Path $runtimeDir 'server.err.log')"
  Add-Content -LiteralPath (Join-Path $runtimeDir 'startup.err.log') -Value $message
  Send-StartupFailure -Message $message
  exit 1
}

if (-not (Test-ListeningPort -Port 3000)) {
  $message = "Frontend port 3000 is not listening. Log: $(Join-Path $runtimeDir 'web.err.log')"
  Add-Content -LiteralPath (Join-Path $runtimeDir 'startup.err.log') -Value $message
  Send-StartupFailure -Message $message
  exit 1
}

exit 0
