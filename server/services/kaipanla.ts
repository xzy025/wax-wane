// 市场情绪温度计
// Source: 开盘啦 (Kaipanla) — unofficial app backend at longhuvip.com.
// No official API exists; params are reverse-engineered (no login needed:
// fixed DeviceID, UserID=0, Token=0). The endpoint returns the raw breadth /
// limit-up metrics behind 开盘啦's "情绪温度计"; the 0-100 temperature itself is
// a documented heuristic we compute here, NOT an official value from the app.

import { createCache, sessionTtl } from '../lib/cache'
import { fetchWithProxy } from '../lib/llm'
import type { DataStatus } from '../market-data/dataQuality'
import { fetchAShareData } from './ashare'

export interface SentimentData {
  date: string
  limitUp: number | null // 涨停家数 (ZT)
  limitDown: number | null // 跌停家数 (DT)
  breakRate: number | null // 破板率 % (ZBL) — lower is stronger
  riseCount: number | null // 上涨家数 (SZJS)
  fallCount: number | null // 下跌家数 (XDJS)
  yestLimitPerf: number | null // 昨日涨停今日表现 % (yestRase) — 赚钱效应
  temperature: number | null // 0-100 综合情绪温度 (heuristic)
  /** Available temperature weight (0..1); 0.5 is the minimum usable coverage. */
  coverage: number
  status: DataStatus
  missingReasons: string[]
  warnings: string[]
  /**
   * 数据来源:kaipanla=开盘啦原始;derived=开盘啦失败后由 A 股真实宽度/涨跌停推导。
   * 不可得的因子保持 null；不得用 mock 或中性值代替市场事实。
   */
  source: 'kaipanla' | 'derived'
}

const KPL_URL = 'https://apphq.longhuvip.com/w1/api/index.php'
const KPL_HEADERS = {
  'User-Agent': 'lhb/5.18.0 (iPhone; iOS 16.0)',
  'Content-Type': 'application/x-www-form-urlencoded',
}
// Fixed device id from the public reverse-engineering of the 开盘啦 app; the
// endpoint accepts it with UserID=0 / Token=0 (anonymous, read-only).
const KPL_DEVICE_ID = '00000000-025d-1ffd-fa71-8fd5272bb997'

const fullSentimentTtl = sessionTtl(60_000, 30 * 60_000)
const sentimentCache = createCache<SentimentData>({
  name: 'Sentiment',
  // A failed/partial feed can recover after close. Do not pin that degraded
  // result for the full closed-session TTL; retain cache deduplication while
  // allowing the next request after one minute to probe the provider again.
  ttl: (): number => sentimentCache.peek()?.status === 'full' ? fullSentimentTtl() : 60_000,
  fetcher: fetchSentimentFresh,
})

export function clearSentimentCache() {
  sentimentCache.clear()
}

export function fetchSentiment(): Promise<SentimentData> {
  return sentimentCache.get()
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * Compose a 0-100 sentiment "temperature" from breadth and limit-up metrics.
 * Heuristic (not 开盘啦's official value), weighted:
 *   - 赚钱效应 (yesterday's limit-ups today): -10%..+10% → 0..1, weight 0.35
 *   - 市场宽度 (advancers share): weight 0.30
 *   - 封板稳定 (100 - 破板率): weight 0.15
 *   - 涨停强度 (limit-ups vs limit-ups+downs): weight 0.20
 */
export function computeTemperature(n: {
  limitUp: number | null
  limitDown: number | null
  breakRate: number | null
  riseCount: number | null
  fallCount: number | null
  yestLimitPerf: number | null
}): { temperature: number | null; coverage: number; missingReasons: string[] } {
  const components: Array<{ value: number; weight: number }> = []
  const missingReasons: string[] = []
  if (n.yestLimitPerf != null) {
    components.push({ value: clamp01((n.yestLimitPerf + 10) / 20), weight: 0.35 })
  } else {
    missingReasons.push('昨日涨停今日表现不可用')
  }
  if (n.riseCount != null && n.fallCount != null) {
    const total = n.riseCount + n.fallCount
    components.push({ value: total > 0 ? n.riseCount / total : 0.5, weight: 0.3 })
  } else {
    missingReasons.push('市场涨跌宽度不可用')
  }
  if (n.breakRate != null) {
    components.push({ value: clamp01((100 - n.breakRate) / 100), weight: 0.15 })
  } else {
    missingReasons.push('破板率不可用')
  }
  if (n.limitUp != null && n.limitDown != null) {
    const total = n.limitUp + n.limitDown
    components.push({ value: total > 0 ? n.limitUp / total : 0.5, weight: 0.2 })
  } else {
    missingReasons.push('涨跌停宽度不可用')
  }
  const coverage = components.reduce((sum, component) => sum + component.weight, 0)
  if (coverage < 0.5) return { temperature: null, coverage, missingReasons }
  const weighted = components.reduce((sum, component) => sum + component.value * component.weight, 0)
  return {
    temperature: Math.round(clamp01(weighted / coverage) * 100),
    coverage,
    missingReasons,
  }
}

function withTemperature(
  base: Omit<SentimentData, 'temperature' | 'coverage' | 'status' | 'missingReasons' | 'warnings'> & {
    missingReasons?: string[]
    warnings?: string[]
  },
): SentimentData {
  const calculated = computeTemperature(base)
  const missingReasons = [...new Set([...(base.missingReasons ?? []), ...calculated.missingReasons])]
  return {
    ...base,
    temperature: calculated.temperature,
    coverage: calculated.coverage,
    status: calculated.temperature == null ? 'unavailable' : missingReasons.length ? 'degraded' : 'full',
    missingReasons,
    warnings: [...new Set([...(base.warnings ?? []), ...missingReasons])],
  }
}

async function fetchSentimentFresh(): Promise<SentimentData> {
  console.log('[Sentiment] Fetching market sentiment from 开盘啦...')
  try {
    const body = new URLSearchParams({
      a: 'GetPlateInfo',
      st: '10',
      apiv: 'w18',
      c: 'DailyLimitResumption',
      PhoneOSNew: '1',
      DeviceID: KPL_DEVICE_ID,
      Index: '20',
    }).toString()

    const res = await fetchWithProxy(KPL_URL, {
      method: 'POST',
      headers: KPL_HEADERS,
      body,
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as {
      nums?: {
        ZT?: number
        DT?: number
        ZBL?: number
        SZJS?: number
        XDJS?: number
        yestRase?: number
      }
      date?: string
    }
    const nums = json.nums
    if (!nums || typeof nums.ZT !== 'number') throw new Error('unexpected payload shape')
    const numberOrNull = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) ? value : null

    return withTemperature({
      date: json.date ?? '',
      limitUp: numberOrNull(nums.ZT),
      limitDown: numberOrNull(nums.DT),
      breakRate: numberOrNull(nums.ZBL),
      riseCount: numberOrNull(nums.SZJS),
      fallCount: numberOrNull(nums.XDJS),
      yestLimitPerf: numberOrNull(nums.yestRase),
      source: 'kaipanla',
    })
  } catch (err) {
    console.warn('[Sentiment] 开盘啦失败,改用东财推导:', err instanceof Error ? err.message : err)
  }
  // 二级兜底:东财真实涨跌停池 + 涨跌家数(ashare.ts 自带 EM 主源 + Sina 备源)。
  // 2026-07 起开盘啦 DailyLimitResumption 返回空 list(payload 变形),若不推导,
  // 静默 mock 会把假 涨停60/跌停10 喂给 screener regime 与市场结构存档。
  try {
    return await deriveSentimentFromAShare()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn('[Sentiment] 东财推导也失败:', reason)
    throw new Error(`市场情绪数据不可用：开盘啦与 A 股推导均失败（${reason}）`, { cause: err })
  }
}

async function deriveSentimentFromAShare(): Promise<SentimentData> {
  const a = await fetchAShareData()
  if (a.limitUpCount == null || a.limitDownCount == null) {
    throw new Error('A 股涨跌停池不可用')
  }
  return withTemperature({
    date: '',
    limitUp: a.limitUpCount,
    limitDown: a.limitDownCount,
    breakRate: null,
    riseCount: a.advance,
    fallCount: a.decline,
    yestLimitPerf: null,
    source: 'derived',
    missingReasons: ['开盘啦破板率不可用', '开盘啦昨日涨停今日表现不可用'],
    warnings: ['仅使用 A 股真实涨跌停与宽度推导市场情绪'],
  })
}
