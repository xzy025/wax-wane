$ErrorActionPreference = 'Stop'
$folder = Join-Path (Resolve-Path 'docs/research/hithink') ('public-' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ'))
New-Item -ItemType Directory -Path $folder | Out-Null
$entries = @()
$requests = @(
    @{ id = '000001-raw-daily'; url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=0.000001&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&beg=20251127&end=20251201&lmt=10'; extension = 'json' },
    @{ id = '603883-2023-distribution'; url = 'https://static.cninfo.com.cn/finalpage/2024-06-21/1220415873.PDF'; extension = 'pdf' }
)
foreach ($request in $requests) {
    $path = Join-Path $folder ($request.id + '.' + $request.extension)
    try {
        Invoke-WebRequest -Uri $request.url -TimeoutSec 30 -OutFile $path
        $entries += @{ id = $request.id; url = $request.url; file = [IO.Path]::GetFileName($path); sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower(); receivedAt = [DateTime]::UtcNow.ToString('o'); captured = $true }
    } catch {
        $entries += @{ id = $request.id; url = $request.url; captured = $false; error = 'Public capture failed; partial file is not validated evidence' }
    }
}
$manifest = @{ status = 'research-only'; eligibleAsTradeGate = $false; entries = $entries }
$json = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $folder 'manifest.json'), $json, [Text.UTF8Encoding]::new($false))
@{folder = $folder; entries = $entries} | ConvertTo-Json -Depth 8
