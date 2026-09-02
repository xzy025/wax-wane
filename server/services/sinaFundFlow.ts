// 新浪资金流只做候选级交叉验证，不参与绝对金额混算。
// 公开接口较老且可能限流：逐股、小并发、短缓存；失败返回缺失，由评分层取中性。
import { EM_HEADERS } from '../lib/emHeaders'

const HOSTS = ['https://vip.stock.finance.sina.com.cn', 'https://money.finance.sina.com.cn']
const TTL = 10 * 60_000
const cache = new Map<string, { data: SinaFundFlow | null; expires: number }>()

export interface SinaFundFlow {
  mainNet: number // 万元
  mainRatio?: number
  retailNet: number // 万元
  retailRatio?: number
}

export interface SinaBoardDirection {
  name: string
  netInflow: number
}

const finite = (value: unknown): number | undefined => {
  const n = typeof value === 'string' ? Number.parseFloat(value) : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function symbol(code: string): string {
  return `${code.startsWith('6') ? 'sh' : 'sz'}${code}`
}

function parsePayload(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed
  } catch {
    return null
  }
}

export async function fetchSinaFundFlow(code: string): Promise<SinaFundFlow | null> {
  const hit = cache.get(code)
  if (hit && hit.expires > Date.now()) return hit.data
  let result: SinaFundFlow | null = null
  for (const host of HOSTS) {
    const url = `${host}/quotes_service/api/json_v2.php/MoneyFlow.ssi_ssfx_flzjtj?daima=${symbol(code)}`
    try {
      const res = await fetch(url, { headers: { ...EM_HEADERS, Referer: 'https://money.finance.sina.com.cn/moneyflow/' }, signal: AbortSignal.timeout(6000) })
      if (!res.ok) continue
      const row = parsePayload(await res.text())
      const mainNet = finite(row?.r0_net)
      const retailNet = finite(row?.r3_net)
      if (mainNet == null || retailNet == null) continue
      result = { mainNet, retailNet, mainRatio: finite(row?.r0_ratio), retailRatio: finite(row?.r3_ratio) }
      break
    } catch { /* best-effort */ }
  }
  cache.set(code, { data: result, expires: Date.now() + TTL })
  return result
}

export async function fetchSinaFundFlowForCodes(codes: string[], concurrency = 3): Promise<Map<string, SinaFundFlow>> {
  const out = new Map<string, SinaFundFlow>()
  let cursor = 0
  const worker = async () => {
    while (cursor < codes.length) {
      const code = codes[cursor++]
      const row = await fetchSinaFundFlow(code)
      if (row) out.set(code, row)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, codes.length) }, worker))
  return out
}

/** 新浪行业排行。旧公开接口不可用时返回空表，评分层保持板块校验中性。 */
export async function fetchSinaIndustryDirections(boardNames: string[], limit = 200): Promise<Map<string, number>> {
  const url = `${HOSTS[0]}/quotes_service/api/json_v2.php/MoneyFlow.ssl_bkzj_ssggzj?page=1&num=${limit}&sort=netamount&asc=0&bankuai=&shichang=`
  try {
    const res = await fetch(url, { headers: { ...EM_HEADERS, Referer: 'https://money.finance.sina.com.cn/moneyflow/' }, signal: AbortSignal.timeout(7000) })
    if (!res.ok) return new Map()
    const parsed = JSON.parse(await res.text())
    if (!Array.isArray(parsed)) return new Map()
    const expected = new Set(boardNames)
    const out = new Map<string, number>()
    for (const row of parsed) {
      const name = String(row?.name ?? row?.bankuai ?? '').trim()
      const net = finite(row?.netamount)
      if (name && net != null && expected.has(name)) out.set(name, net)
    }
    return out
  } catch {
    return new Map()
  }
}

export function clearSinaFundFlowCache(): void {
  cache.clear()
}
