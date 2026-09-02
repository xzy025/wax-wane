[CmdletBinding()]
param(
  [string]$TaskName = 'AshareAuctionBrief'
)

$ErrorActionPreference = 'Stop'
$startScript = Join-Path $PSScriptRoot 'start-trade-review.ps1'
if (-not (Test-Path -LiteralPath $startScript)) {
  throw "Startup script not found: $startScript"
}

$powerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction `
  -Execute $powerShell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""
$triggers = @(
  New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
  New-ScheduledTaskTrigger `
    -Weekly `
    -WeeksInterval 1 `
    -DaysOfWeek Monday, Tuesday, Wednesday, Thursday, Friday `
    -At '09:05'
)
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$principal = New-ScheduledTaskPrincipal `
  -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $triggers `
  -Settings $settings `
  -Principal $principal `
  -Description 'Starts auction sampling at 09:05 and sends 09:28/09:35 ServerChan briefs' `
  -Force | Out-Null

Write-Host "Registered task: $TaskName"
Write-Host "Startup script: $startScript"
Write-Host "Run Start-ScheduledTask -TaskName '$TaskName' to verify it now."
