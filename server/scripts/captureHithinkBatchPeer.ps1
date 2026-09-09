param([Parameter(Mandatory = $true)][string]$PlanPath)
$ErrorActionPreference = 'Stop'
$plan = Get-Content -LiteralPath $PlanPath -Raw | ConvertFrom-Json
$start = [DateTime]::ParseExact($plan.window[0], 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
$end = [DateTime]::ParseExact($plan.window[1], 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
if ($end -lt $start -or ($end - $start).TotalDays -gt 31 -or $plan.samples.Count -gt 20) { throw 'Research capture exceeds bounded window or sample limit' }
$folder = Join-Path (Resolve-Path 'docs/research/hithink') ('batch-peer-' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ'))
New-Item -ItemType Directory -Path $folder | Out-Null
$entries = @()
foreach ($sample in $plan.samples) {
    $code = [string]$sample.code
    if ($code -notmatch '^\d{6}\.(SH|SZ|BJ)$') { throw 'Unsupported sample code' }
    $market = if ($code.EndsWith('.SH')) { '1' } else { '0' }
    $url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + $market + '.' + $code.Substring(0, 6) + '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&beg=' + $start.ToString('yyyyMMdd') + '&end=' + $end.ToString('yyyyMMdd') + '&lmt=100'
    $file = $code + '.json'
    $path = Join-Path $folder $file
    try {
        Invoke-WebRequest -Uri $url -TimeoutSec 20 -OutFile $path
        $entries += @{code = $code; url = $url; file = $file; captured = $true; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower(); receivedAt = [DateTime]::UtcNow.ToString('o')}
        Write-Host ($code + ' captured')
    } catch {
        $entries += @{code = $code; url = $url; captured = $false; error = 'Capture failed; partial file is not evidence'}
        Write-Host ($code + ' unavailable')
    }
    Start-Sleep -Milliseconds 600
}
$report = @{status = 'research-only'; eligibleAsTradeGate = $false; planSha256 = (Get-FileHash -LiteralPath $PlanPath -Algorithm SHA256).Hash.ToLower(); entries = $entries}
[IO.File]::WriteAllText((Join-Path $folder 'manifest.json'), ($report | ConvertTo-Json -Depth 10), [Text.UTF8Encoding]::new($false))
Write-Host $folder
