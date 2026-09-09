param([string]$SnapshotPath = 'docs/research/hithink/research-integration-2026-09-07T06-30-27-800Z/snapshot.json')
$ErrorActionPreference = 'Stop'
$snapshot = Get-Content -LiteralPath $SnapshotPath -Raw | ConvertFrom-Json
if ($snapshot.thscode -notmatch '^\d{6}\.(SH|SZ|BJ)$') { throw 'Invalid snapshot code' }
$folder = Join-Path (Resolve-Path 'docs/research/hithink') ('financial-peer-' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ'))
New-Item -ItemType Directory -Path $folder | Out-Null
$specs = @(
    @{ dataset = 'income'; report = 'RPT_DMSK_FN_INCOME'; fields = @{ parent_holder_net_profit = 'PARENT_NETPROFIT'; net_profit = 'NETPROFIT'; profit_total = 'TOTAL_PROFIT' } },
    @{ dataset = 'balance'; report = 'RPT_DMSK_FN_BALANCE'; fields = @{ assets_total = 'TOTAL_ASSETS'; total_debt = 'TOTAL_LIABILITIES'; holder_equity_total = 'TOTAL_EQUITY' } },
    @{ dataset = 'cashflow'; report = 'RPT_DMSK_FN_CASHFLOW'; fields = @{ act_cash_flow_net = 'NETCASH_OPERATE'; invest_cash_flow_net = 'NETCASH_INVEST'; financing_cash_flow_net = 'NETCASH_FINANCE' } }
)
$entries = @()
$checks = @()
foreach ($spec in $specs) {
    $filter = '(SECURITY_CODE="' + $snapshot.thscode.Substring(0,6) + '")'
    $url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=' + $spec.report + '&columns=ALL&filter=' + [uri]::EscapeDataString($filter) + '&pageNumber=1&pageSize=4&sortColumns=REPORT_DATE&sortTypes=-1'
    $path = Join-Path $folder ($spec.dataset + '.json')
    Invoke-WebRequest -Uri $url -OutFile $path -TimeoutSec 25
    $peer = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if (-not $peer.success -or -not $peer.result.data) { throw 'Independent financial response unavailable' }
    $entries += @{ dataset = $spec.dataset; url = $url; file = (Split-Path $path -Leaf); sha256 = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower(); receivedAt = [DateTime]::UtcNow.ToString('o') }
    $own = ($snapshot.datasets | Where-Object dataset -eq $spec.dataset).data.item
    foreach ($row in $own) {
        $date = [DateTimeOffset]::FromUnixTimeMilliseconds($row.period_end_ms).ToOffset([TimeSpan]::FromHours(8)).ToString('yyyy-MM-dd')
        $matches = @($peer.result.data | Where-Object { $_.REPORT_DATE.Substring(0,10) -eq $date -and $_.SECURITY_CODE -eq $snapshot.thscode.Substring(0,6) })
        foreach ($field in $spec.fields.Keys) {
            $peerField = $spec.fields[$field]
            $other = if ($matches.Count -eq 1) { $matches[0].$peerField } else { $null }
            $state = if ($null -eq $row.$field -or $null -eq $other) { 'unavailable' } elseif ([math]::Abs([decimal]$row.$field - [decimal]$other) -le 1) { 'match' } else { 'mismatch' }
            $checks += @{ dataset = $spec.dataset; periodEnd = $date; field = $field; peerField = $peerField; own = $row.$field; peer = $other; status = $state }
        }
    }
}
$report = @{ status = 'research-only'; eligibleAsTradeGate = $false; snapshotSha256 = (Get-FileHash -LiteralPath $SnapshotPath -Algorithm SHA256).Hash.ToLower(); toleranceCny = 1; entries = $entries; checks = $checks; notes = @('Latest four periods only; independent aggregator comparison, not original-announcement or PIT verification', 'Revenue excluded because operating income differs from total operating income; valuation requires aligned timestamps') }
[IO.File]::WriteAllText((Join-Path $folder 'comparison.json'), ($report | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
Write-Output $folder
$checks | Group-Object status | Select-Object Name,Count
