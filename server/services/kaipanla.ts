// 市场情绪温度计
// Source: 开盘啦 (Kaipanla) — unofficial app backend at longhuvip.com.
// No official API exists; params are reverse-engineered (no login needed:
// fixed DeviceID, UserID=0, Token=0). The endpoint returns the raw breadth /
// limit-up metrics behind 开盘啦's "情绪温度计"; the 0-100 temperature itself is
// a documented heuristic we compute here, NOT an official value from the app.

import { createCache, sessionTtl } from '../lib/cache'
import { fetchAShareData } from './ashare'

export interface SentimentData {
  date: string
  limitUp: number // 涨停家数 (ZT)
  limitDown: number // 跌停家数 (DT)
  breakRate: number // 破板率 % (ZBL) — lower is stronger
  riseCount: number // 上涨家数 (SZJS)
  fallCount: number // 下跌家数 (XDJS)
  yestLimitPerf: number // 昨日涨停今日表现 % (yestRase) — 赚钱效应
  temperature: number // 0-100 综合情绪温度 (heuristic)
  /**
   * 数据来源:kaipanla=开盘啦原始;derived=开盘啦挂掉后由东财真实涨跌停/宽度推导
   * (破板率/昨停表现无免费替代源,取中性值);mock=连东财也挂了的最后兜底(全假数据)。
   * 下游(screener regime/市场结构)据此判断可信度,勿把 mock 当真实情绪落盘分析。
   */
  source: 'kaipanla' | 'derived' | 'mock'
}

const KPL_URL = 'https://apphq.longhuvip.com/w1/api/index.php'
const KPL_HEADERS = {
  'User-Agent': 'lhb/5.18.0 (iPhone; iOS 16.0)',
  'Content-Type': 'application/x-www-form-urlencoded',
}
// Fixed device id from the public reverse-engineering of the 开盘啦 app; the
// endpoint accepts it with UserID=0 / Token=0 (anonymous, read-only).
const KPL_DEVICE_ID = '00000000-025d-1ffd-fa71-8fd5272bb997'

const sentimentCache = createCache<SentimentData>({
  name: 'Sentiment',
  ttl: sessionTtl(60_000, 30 * 60_000),
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
  limitUp: number
  limitDown: number
  breakRate: number
  riseCount: number
  fallCount: number
  yestLimitPerf: number
}): number {
  const moneyEffect = clamp01((n.yestLimitPerf + 10) / 20)
  const totalAdvDec = n.riseCount + n.fallCount
  const breadth = totalAdvDec > 0 ? n.riseCount / totalAdvDec : 0.5
  const sealStability = clamp01((100 - n.breakRate) / 100)
  const limitStrength = n.limitUp + n.limitDown > 0 ? n.limitUp / (n.limitUp + n.limitDown) : 0.5
  const score = moneyEffect * 0.35 + breadth * 0.3 + sealStability * 0.15 + limitStrength * 0.2
  return Math.round(clamp01(score) * 100)
}

function withTemperature(base: Omit<SentimentData, 'temperature'>): SentimentData {
  return { ...base, temperature: computeTemperature(base) }
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

    const res = await fetch(KPL_URL, {
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

    return withTemperature({
      date: json.date ?? '',
      limitUp: nums.ZT ?? 0,
      limitDown: nums.DT ?? 0,
      breakRate: nums.ZBL ?? 0,
      riseCount: nums.SZJS ?? 0,
      fallCount: nums.XDJS ?? 0,
      yestLimitPerf: nums.yestRase ?? 0,
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
    console.warn('[Sentiment] 东财推导也失败,退最后 mock:', err instanceof Error ? err.message : err)
    return getMockSentiment()
  }
}

async function deriveSentimentFromAShare(): Promise<SentimentData> {
  const a = await fetchAShareData()
  if (a.limitUpCount + a.limitDownCount === 0) throw new Error('ashare limit pools empty')
  return withTemperature({
    date: '',
    limitUp: a.limitUpCount,
    limitDown: a.limitDownCount,
    breakRate: 25, // 破板率无免费替代源→中性(仅占温度权重 0.15)
    riseCount: a.advance,
    fallCount: a.decline,
    yestLimitPerf: 0, // 昨停表现同上→中性(0 经 clamp 映射为 0.5)
    source: 'derived',
  })
}

function getMockSentiment(): SentimentData {
  return withTemperature({
    date: '',
    limitUp: 60,
    limitDown: 10,
    breakRate: 25,
    riseCount: 2800,
    fallCount: 2200,
    yestLimitPerf: 0.5,
    source: 'mock',
  })
}
