// 股东户数(a-stock-data 移植计划⑤数据侧)——东财 RPT_HOLDERNUMLATEST,datacenter 纯 JSON GET 零签名。
// ⚠ 实抓列名(2026-07-23)与上游 SKILL 有漂移:户均持股是 AVG_HOLD_NUM(SKILL 写的 AVG_FREE_SHARES 不存在);
//   HOLDER_NUM_RATIO 已是百分数(-7.32=环比降 7.32%,无需×100);END_DATE/HOLD_NOTICE_DATE 带 " 00:00:00" 需切 10 位。
// 表结构:LATEST 表每股仅**最新一期**一行(历史期数在另一张 RPT_HOLDERNUM,本侧不取)。
// 取数姿势:filter=(SECURITY_CODE in ("A","B",...)) 批量拉(实测可用),吸筹监控 ~23 只一次请求全覆盖。
// 用途:吸筹监控组确认因子**纯展示**(户数下降=筹码集中,与持续放量横盘互为佐证);
//   ⚠ 回测裁决通过前不进任何战法评分——季度披露有前视风险,badge 带披露日(HOLD_NOTICE_DATE)供人工判断时效。
// 缓存:按 code 逐条缓存(季度级数据,盘中 30min/盘后 12h 只为兜手动刷新);查无行的 code 不缓存(仓库惯例:空结果不缓存)。
import { EM_HEADERS } from '../lib/emHeaders'
import { emFetch } from '../lib/emFetch'
import { sessionTtl } from '../lib/cache'
import { HOLDERNUM } from '../config/screener'

/** 挂在吸筹候选上的股东户数徽标(最新一期;纯展示确认因子)。 */
export interface HolderNumBadge {
  /** 报告期末(YYYY-MM-DD,如 2026-03-31=一季报口径)。 */
  endDate: string
  /** 披露公告日(YYYY-MM-DD)——防前视锚点:数据自该日起才为市场所知。 */
  noticeDate: string
  /** 最新一期股东户数。 */
  holderNum: number
  /** 户数环比%(两位;负=户数下降=筹码集中)。 */
  changePct: number
  /** 户均持股数(股,整数)。 */
  avgHoldShares: number
}

export type HolderNumByCode = Map<string, HolderNumBadge>

const RPT = 'RPT_HOLDERNUMLATEST'
const COLS = 'SECURITY_CODE,HOLDER_NUM,HOLDER_NUM_RATIO,END_DATE,HOLD_NOTICE_DATE,AVG_HOLD_NUM'

const norm = (d: unknown): string => String(d ?? '').slice(0, 10)

/** 行映射(纯函数,fixture 可测):脏行(缺 code/期末日/户数非正)跳过;环比已是百分数,只舍入两位。 */
export function mapHolderNumRows(data: unknown[]): HolderNumByCode {
  const out: HolderNumByCode = new Map()
  for (const raw of data) {
    const d = raw as Record<string, unknown>
    const code = String(d.SECURITY_CODE ?? '')
    const endDate = norm(d.END_DATE)
    const holderNum = Number(d.HOLDER_NUM)
    if (!/^\d{6}$/.test(code) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(holderNum) || holderNum <= 0) continue
    out.set(code, {
      endDate,
      noticeDate: norm(d.HOLD_NOTICE_DATE),
      holderNum,
      changePct: Math.round((Number(d.HOLDER_NUM_RATIO) || 0) * 100) / 100,
      avgHoldShares: Math.round(Number(d.AVG_HOLD_NUM) || 0),
    })
  }
  return out
}

/** 代码分片(纯函数):去重去脏后按 size 切,保持输入序。 */
export function chunkCodes(codes: string[], size: number): string[][] {
  const clean = [...new Set(codes.filter((c) => /^\d{6}$/.test(c)))]
  const out: string[][] = []
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size))
  return out
}

async function fetchChunk(codes: string[]): Promise<HolderNumByCode> {
  const filter = `(SECURITY_CODE in (${codes.map((c) => `"${c}"`).join(',')}))`
  const url =
    `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${RPT}` +
    `&columns=${COLS}&source=WEB&client=WEB` +
    `&sortColumns=SECURITY_CODE&sortTypes=1&pageSize=${codes.length}&pageNumber=1` +
    `&filter=${encodeURIComponent(filter)}`
  const res = await emFetch(url, { headers: EM_HEADERS, timeoutMs: 12000 })
  if (!res.ok) throw new Error(`HolderNum HTTP ${res.status}`)
  const json = (await res.json()) as { result?: { data?: unknown[] } }
  return mapHolderNumRows(json?.result?.data ?? [])
}

// 逐 code 缓存(键极少=榜单代码,季度级数据 TTL 给足;防长跑进程无界增长设上限清空)。
const TTL = sessionTtl(30 * 60_000, 12 * 60 * 60_000)
const cache = new Map<string, { badge: HolderNumBadge; expires: number }>()

/** 批量取最新一期股东户数:code → 徽标。命中缓存的 code 不重取;首片失败 throw(调用方降级),
 *  后续片失败用已取部分(与 liftBan 翻页同款半途容错)。查无行的 code 静默缺席(新股/停牌口径)。 */
export async function fetchHolderNums(codes: string[]): Promise<HolderNumByCode> {
  const now = Date.now()
  const out: HolderNumByCode = new Map()
  const misses: string[] = []
  for (const code of [...new Set(codes)].slice(0, HOLDERNUM.MAX_CODES)) {
    const hit = cache.get(code)
    if (hit && hit.expires > now) out.set(code, hit.badge)
    else misses.push(code)
  }
  const chunks = chunkCodes(misses, HOLDERNUM.BATCH_SIZE)
  for (let i = 0; i < chunks.length; i++) {
    let got: HolderNumByCode
    try {
      got = await fetchChunk(chunks[i])
    } catch (err) {
      if (i === 0 && out.size === 0) throw err // 一行都没有=真失败,交调用方降级
      console.warn(`[HolderNum] 第 ${i + 1}/${chunks.length} 片取数失败,用已取 ${out.size} 只继续:`, err instanceof Error ? err.message : err)
      break
    }
    const expires = Date.now() + TTL()
    for (const [code, badge] of got) {
      out.set(code, badge)
      if (cache.size > 4096) cache.clear()
      cache.set(code, { badge, expires })
    }
  }
  return out
}
