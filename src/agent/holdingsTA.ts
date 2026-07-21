// 盘后持仓深度技术分析 · 前端数据层:服务端类型镜像 + best-effort fetch。
// 任何失败一律返回 null/[](静默降级)——深度 TA 是持仓复盘看板的增强层,
// 绝不影响既有 runReview(quote+轻量技术面)的可用性。
export type TABias = 'demand' | 'supply' | 'neutral'
export type MAKey = 'ma5' | 'ma10' | 'ma20' | 'ma60' | 'ma250'
export const MA_KEYS: readonly MAKey[] = ['ma5', 'ma10', 'ma20', 'ma60', 'ma250'] as const

export interface TechnicalCombo {
  score01: number
  bias: TABias
  distribution: boolean
  wyckoffPhase: string
  tags: string[]
  note: string
}

export interface HoldingTADelta {
  prevDate: string
  score01: number
  biasChanged: { from: TABias; to: TABias } | null
  wyckoffChanged: { from: string; to: string } | null
  distributionNew: boolean
  maCrossings: string[]
  trendTemplateChanged: boolean
  relStrengthDelta: number | null
  dist52PctDelta: number
  volRatioDelta: number
}

export interface HoldingTAItem {
  code: string
  name: string
  date: string
  close: number
  changePct: number
  combo: TechnicalCombo
  trendTemplateOk: boolean | null
  ma: Record<MAKey, number>
  aboveMa: Record<MAKey, boolean>
  volRatio: number
  breakoutVolRatio: number
  hi52: number
  dist52Pct: number
  rsRaw: number
  relStrength?: number
  counterTrend?: boolean
  atr14: number
  atrStop: number
  pivotHigh250: number
  pivots: { r1: number; r2: number; s1: number; s2: number }
  delta?: HoldingTADelta | null
  error?: string
}

export interface HoldingsTANarrative {
  tone: string
  markdown: string
  generatedAt: string
}

export interface HoldingsTAResult {
  date: string
  generatedAt: string
  settled: boolean
  prevDate: string | null
  benchmarks: { hs300: number; chinext: number; star50: number }
  items: HoldingTAItem[]
  narrative: HoldingsTANarrative | null
}

export interface HoldingsTAPosition {
  code: string
  avgCost?: number
}

/** 深度 TA 整包(POST:avgCost 属个人数据不进 URL)。失败 → null。 */
export async function fetchHoldingsTA(positions: HoldingsTAPosition[]): Promise<HoldingsTAResult | null> {
  if (positions.length === 0) return null
  try {
    const res = await fetch('/api/holdings/ta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positions }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as HoldingsTAResult
    return Array.isArray(data?.items) ? data : null
  } catch {
    return null
  }
}

/** 清服务端缓存(刷新按钮强制重扫用)。 */
export async function refreshHoldingsTACache(): Promise<void> {
  try {
    await fetch('/api/refresh?market=holdings-ta', { method: 'POST' })
  } catch {
    /* best-effort */
  }
}

/** 历史存档日期(倒序)。失败 → []。 */
export async function fetchTaArchiveDates(): Promise<string[]> {
  try {
    const res = await fetch('/api/holdings/ta/archive')
    if (!res.ok) return []
    const data = (await res.json()) as { dates?: unknown }
    return Array.isArray(data?.dates) ? (data.dates as string[]) : []
  } catch {
    return []
  }
}

/** 指定日期的历史存档。失败/缺档 → null。 */
export async function fetchTaArchive(date: string): Promise<HoldingsTAResult | null> {
  try {
    const res = await fetch(`/api/holdings/ta/archive/${date}`)
    if (!res.ok) return null
    const data = (await res.json()) as HoldingsTAResult
    return Array.isArray(data?.items) ? data : null
  } catch {
    return null
  }
}
