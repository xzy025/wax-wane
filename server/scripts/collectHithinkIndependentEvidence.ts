import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// Public, unauthenticated cross-checks. These captures do not modify source data.
async function main() {
  const folder = resolve('docs/research/hithink', `independent-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  await mkdir(folder, { recursive: true })
  const entries = []
  const requests = [{
    id: '000001-raw-daily',
    url: 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=0.000001&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&beg=20251127&end=20251201&lmt=10',
  }, ...['000601', '000812', '603883'].map((code) => ({
    id: `${code}-dividends`,
    url: `https://datacenter-web.eastmoney.com/api/data/v1/get?${new URLSearchParams({ reportName: 'RPT_SHAREBONUS_DET', columns: 'ALL', filter: `(SECURITY_CODE="${code}")`, pageSize: '100', pageNumber: '1', sortColumns: 'EX_DIVIDEND_DATE', sortTypes: '-1' })}`,
  }))]
  for (const request of requests) {
    try {
      const response = await fetch(request.url, { signal: AbortSignal.timeout(25_000) })
      const payload = await response.text()
      const parsed = JSON.parse(payload)
      const receivedAt = new Date().toISOString()
      await writeFile(resolve(folder, `${request.id}.json`), payload, { flag: 'wx' })
      entries.push({ ...request, httpStatus: response.status, receivedAt, sha256: createHash('sha256').update(payload).digest('hex'),
        success: response.ok && (parsed.success === true || parsed.rc === 0), rows: parsed.result?.data?.length ?? parsed.data?.klines?.length ?? 0, pages: parsed.result?.pages ?? null })
    } catch { entries.push({ ...request, success: false, error: 'Request or JSON capture failed' }) }
  }
  await writeFile(resolve(folder, 'manifest.json'), JSON.stringify({ status: 'research-only', eligibleAsTradeGate: false, entries }, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ folder, entries }, null, 2))
}
main().catch(() => { console.error('Independent evidence collection failed'); process.exitCode = 1 })
