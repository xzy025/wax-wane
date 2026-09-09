param([switch]$BseOnly)
$ErrorActionPreference = 'Stop'
$folder = Join-Path (Resolve-Path 'docs/research/hithink') ('universe-public-' + [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH-mm-ss-fffZ'))
New-Item -ItemType Directory -Path $folder | Out-Null
$entries = @()
$requests = @(
    @{ id = 'szse-delisted'; url = 'https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1793_ssgs&TABKEY=tab2&PAGENO=1'; referer = 'https://www.szse.cn/market/stock/suspend/index.html' },
    @{ id = 'sse-delisted'; url = 'https://query.sse.com.cn/commonQuery.do?sqlId=COMMON_SSE_CP_GPJCTPZ_GPLB_GP_L&isPagination=true&STOCK_TYPE=1%2C8&COMPANY_STATUS=3&type=inParams&pageHelp.pageSize=500&pageHelp.pageNo=1&pageHelp.beginPage=1&pageHelp.endPage=1&pageHelp.cacheSize=1'; referer = 'https://www.sse.com.cn/' }
)
if ($BseOnly) {
    $requests = @(
        @{id='bse-notice'; url='https://www.bse.cn/important_news/200026735.html'; referer='https://www.bse.cn/'; extension='html'},
        @{id='bse-mapping'; url='https://www.bse.cn/service/code_mapping.html'; referer='https://www.bse.cn/'; extension='html'}
    )
}
foreach ($request in $requests) {
    $extension = if ($request.extension) { $request.extension } else { 'json' }
    $path = Join-Path $folder ($request.id + '.' + $extension)
    try {
        Invoke-WebRequest -Uri $request.url -TimeoutSec 25 -Headers @{Referer=$request.referer; 'User-Agent'='Mozilla/5.0'} -OutFile $path
        $entries += @{id=$request.id; url=$request.url; file=[IO.Path]::GetFileName($path); captured=$true; receivedAt=[DateTime]::UtcNow.ToString('o'); sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLower()}
        Write-Host ($request.id + ' captured')
        if ($request.id -eq 'szse-delisted') {
            $tabs = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
            $tab = $tabs | Where-Object { $_.metadata.tabkey -eq 'tab2' }
            $pageCount = [int]$tab.metadata.pagecount
            if ($pageCount -lt 1 -or $pageCount -gt 50) { throw 'Invalid page count' }
            for ($page = 2; $page -le $pageCount; $page++) {
                $pageUrl = $request.url.Replace('PAGENO=1', ('PAGENO=' + $page))
                $pagePath = Join-Path $folder ('szse-delisted-' + $page + '.json')
                Invoke-WebRequest -Uri $pageUrl -TimeoutSec 25 -Headers @{Referer=$request.referer; 'User-Agent'='Mozilla/5.0'} -OutFile $pagePath
                $entries += @{id=('szse-delisted-' + $page); url=$pageUrl; file=[IO.Path]::GetFileName($pagePath); captured=$true; receivedAt=[DateTime]::UtcNow.ToString('o'); sha256=(Get-FileHash -LiteralPath $pagePath -Algorithm SHA256).Hash.ToLower()}
                Write-Host ('szse page ' + $page + '/' + $pageCount + ' captured')
                Start-Sleep -Milliseconds 300
            }
        }
    } catch {
        $entries += @{id=$request.id; url=$request.url; captured=$false; error='Capture failed; partial files are not validated evidence'}
        Write-Host ($request.id + ' unavailable')
    }
}
[IO.File]::WriteAllText((Join-Path $folder 'manifest.json'), (@{status='research-only'; entries=$entries} | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Write-Host $folder
