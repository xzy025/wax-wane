import { fetchAShareData } from './ashare'
import { fetchIndexQuotes, type IndexQuote, type IndexSpec } from './emQuotes'
import { fetchMacroData, type MacroIndicator } from './macro'
import { fetchNewsFlash, type NewsFlashItem } from './newsFlash'
import { fetchUSData } from './us'

export type ExternalRiskState = 'risk-on' | 'mixed' | 'risk-off' | 'panic' | 'unavailable'
export type MarketGateState = 'normal' | 'cautious' | 'restricted' | 'frozen' | 'unavailable'
export type MarketGatePhase = 'premarket' | 'auction' | 'open'
export type ThemePermissionState = 'allowed' | 'conditional' | 'blocked'
export type ThemeRiskClass = 'high-beta' | 'defensive' | 'cyclical' | 'neutral'
export type MarketRepairState =
  | 'unconfirmed'
  | 'broad-repair'
  | 'weight-led-repair'
  | 'small-cap-repair'
  | 'mixed'
  | 'risk-continuation'

export interface MarketRiskQuote {
  code: string
  name: string
  changePct: number
  price: number
}

export interface MarketRiskMacro {
  id: string
  value: number
  previousClose: number
  changePct: number
  deltaBps: number | null
}

export interface MarketRiskHeadline {
  time: string
  source: string
  title: string
  severity: number
  direction: 'risk' | 'support'
}

export interface PremarketRiskSnapshot {
  signalDate: string
  tradeDate: string
  capturedAt: string
  frozenAt: string
  late: boolean
  state: ExternalRiskState
  riskScore: number | null
  /** Split display evidence; omitted by legacy archives and never used as a new candidate factor. */
  usRiskScore?: number | null
  asiaRiskScore?: number | null
  coverage: number
  us: MarketRiskQuote[]
  asia: MarketRiskQuote[]
  macro: MarketRiskMacro[]
  headlines: MarketRiskHeadline[]
  sources: string[]
  reasons: string[]
  warnings: string[]
}

export interface DomesticMarketSnapshot {
  capturedAt: string
  indices: MarketRiskQuote[]
  styleIndices: MarketRiskQuote[]
  advance: number | null
  decline: number | null
  flat: number | null
  limitUp: number | null
  limitDown: number | null
  indexRiskScore: number | null
  breadthRiskScore: number | null
  highBoardRiskScore: number | null
  riskScore: number | null
  coverage: number
  reasons: string[]
  warnings: string[]
}

export interface MarketRepairContext {
  state: MarketRepairState
  capturedAt: string
  applicable: boolean
  confidence: number
  largeCapChangePct: number | null
  smallCapChangePct: number | null
  sizeSpreadPct: number | null
  advanceRate: number | null
  largeCapAuctionAmountSharePct: number | null
  highBoardState:
    | 'expansion'
    | 'divergence'
    | 'contraction'
    | 'panic'
    | null
  reasons: string[]
  warnings: string[]
}

export interface ThemePermission {
  theme: string
  riskClass: ThemeRiskClass
  state: ThemePermissionState
  score: number
  independentStrength: boolean
  directionScore: number | null
  positiveRate: number | null
  assistantCount: number
  environmentAdjustment: number
  reasons: string[]
}

export interface MarketRiskGate {
  signalDate: string
  tradeDate: string
  generatedAt: string
  phase: MarketGatePhase
  state: MarketGateState
  riskScore: number | null
  externalRiskScore: number | null
  domesticRiskScore: number | null
  domesticConfirmed: boolean
  premarket: PremarketRiskSnapshot | null
  domestic: DomesticMarketSnapshot | null
  repairContext?: MarketRepairContext
  themePermissions: ThemePermission[]
  reasons: string[]
  warnings: string[]
}

export interface MarketGateArchive {
  signalDate: string
  tradeDate: string
  generatedAt: string
  ruleVersion: string
  premarket: PremarketRiskSnapshot | null
  auction: MarketRiskGate | null
  open: MarketRiskGate | null
}

export interface AuctionThemeInput {
  theme: string
  score: number | null
  state: 'leading' | 'resonant' | 'isolated-one-price' | 'weak' | 'unavailable'
  positiveRate: number | null
  assistantCount: number
}

export interface ThemeRiskInput {
  theme: string
  highLowSwitch: boolean
  score: number
}

const ASIA_INDICES: IndexSpec[] = [
  { secid: '100.N225', code: 'N225' },
  { secid: '100.KS11', code: 'KS11' },
]

const SIZE_STYLE_INDICES: IndexSpec[] = [
  { secid: '1.000016', code: 'SSE50' },
  { secid: '1.000300', code: 'CSI300' },
  { secid: '1.000852', code: 'CSI1000' },
  { secid: '1.932000', code: 'CSI2000' },
]

const HIGH_BETA_RE =
  /科技|人工智能|ai|算力|芯片|半导体|机器人|软件|通信|电子|光模块|cpo|计算机|消费电子/i
const DEFENSIVE_RE =
  /农业|种业|粮食|农机|养殖|猪肉|鸡肉|水产|食品|饮料|医药|医疗|中药|公用事业/i
const CYCLICAL_RE = /黄金|有色|煤炭|钢铁|化工|石油|油气|稀土|航运|资源/i

function clamp(value: number, lower = 0, upper = 100): number {
  return Math.min(upper, Math.max(lower, value))
}

function r2(value: number): number {
  return Math.round(value * 100) / 100
}

function weightedAvailable(
  values: Array<{ value: number | null | undefined; weight: number }>,
): number | null {
  const valid = values.filter(
    (item): item is { value: number; weight: number } =>
      typeof item.value === 'number' && Number.isFinite(item.value),
  )
  const weight = valid.reduce((sum, item) => sum + item.weight, 0)
  return weight > 0
    ? valid.reduce((sum, item) => sum + item.value * item.weight, 0) / weight
    : null
}

function quoteRisk(changePct: number): number {
  if (changePct >= 1) return 10
  if (changePct >= 0) return 25
  if (changePct >= -1) return 45
  if (changePct >= -2) return 65
  if (changePct >= -3) return 85
  return 100
}

function quoteRows(rows: IndexQuote[]): MarketRiskQuote[] {
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    changePct: r2(row.changePct),
    price: row.price,
  }))
}

function quoteBasketRisk(
  rows: MarketRiskQuote[],
  weights: Record<string, number>,
): number | null {
  return weightedAvailable(
    rows.map((row) => ({
      value: quoteRisk(row.changePct),
      weight: weights[row.code] ?? 1,
    })),
  )
}

function macroRows(rows: MacroIndicator[]): MarketRiskMacro[] {
  return rows
    .filter((row): row is MacroIndicator & { value: number; previousClose: number } =>
      row.status !== 'unavailable' &&
      row.value != null &&
      row.previousClose != null &&
      row.previousClose > 0,
    )
    .map((row) => {
      const changePct = ((row.value - row.previousClose) / row.previousClose) * 100
      return {
        id: row.id,
        value: row.value,
        previousClose: row.previousClose,
        changePct: r2(changePct),
        deltaBps:
          row.id === 'us10y' || row.id === 'us5y'
            ? r2((row.value - row.previousClose) * 100)
            : null,
      }
    })
}

function macroRisk(rows: MarketRiskMacro[], id: string): number | null {
  const row = rows.find((item) => item.id === id)
  if (!row) return null
  if (id === 'us10y' || id === 'us5y') {
    const delta = row.deltaBps
    return delta == null ? null : clamp(delta <= 0 ? 20 + delta : 25 + delta * 3)
  }
  if (id === 'vix') return clamp(25 + row.changePct * 2)
  if (id === 'usdcny') return clamp(25 + row.changePct * 30)
  return null
}

function headlineSignal(item: NewsFlashItem): MarketRiskHeadline | null {
  const text = `${item.title} ${item.summary}`
  const severe =
    /暴跌|熔断|股灾|战争升级|大规模冲突|金融危机|债务违约|流动性危机|紧急加息/i.test(
      text,
    )
  const risk =
    /美债收益率.*(?:飙升|大涨|走高)|通胀.*超预期|加息|关税|制裁|冲突|地缘风险|风险资产.*下跌|股市.*大跌/i.test(
      text,
    )
  const support = /降息|降准|流动性投放|稳定资本市场|回购增持再贷款/i.test(text)
  if (!severe && !risk && !support) return null
  return {
    time: item.time,
    source: item.source,
    title: item.title,
    severity: severe ? 90 : item.important ? 70 : 55,
    direction: support && !severe && !risk ? 'support' : 'risk',
  }
}

function riskState(score: number | null): ExternalRiskState {
  if (score == null) return 'unavailable'
  if (score < 30) return 'risk-on'
  if (score < 50) return 'mixed'
  if (score < 70) return 'risk-off'
  return 'panic'
}

function gateState(score: number, phase: MarketGatePhase): MarketGateState {
  if (score < 35) return 'normal'
  if (score < 55) return 'cautious'
  if (score < 75) return 'restricted'
  return phase === 'premarket' ? 'restricted' : 'frozen'
}

export function classifyThemeRisk(theme: string): ThemeRiskClass {
  if (HIGH_BETA_RE.test(theme)) return 'high-beta'
  if (DEFENSIVE_RE.test(theme)) return 'defensive'
  if (CYCLICAL_RE.test(theme)) return 'cyclical'
  return 'neutral'
}

export function buildPremarketRiskSnapshot(args: {
  signalDate: string
  tradeDate: string
  capturedAt: string
  frozenAt?: string
  late?: boolean
  us: IndexQuote[]
  asia: IndexQuote[]
  macro: MacroIndicator[]
  news: NewsFlashItem[]
  newsWindowStart: string
  newsWindowEnd: string
  sourceStatus?: Record<string, boolean>
}): PremarketRiskSnapshot {
  const us = quoteRows(args.us)
  const asia = quoteRows(args.asia)
  const macro = macroRows(args.macro)
  const start = Date.parse(args.newsWindowStart)
  const end = Date.parse(args.newsWindowEnd)
  const headlines = args.news
    .filter((item) => {
      const at = Date.parse(item.time)
      return Number.isFinite(at) && at >= start && at <= end
    })
    .map(headlineSignal)
    .filter((item): item is MarketRiskHeadline => !!item)
    .slice(0, 8)
  const newsRisk =
    headlines.length > 0
      ? clamp(
          35 +
            Math.max(
              ...headlines.map((item) =>
                item.direction === 'risk' ? item.severity - 35 : -(item.severity - 35),
              ),
            ),
        )
      : null
  const usRiskScore = quoteBasketRisk(us, { IXIC: 0.5, SPX: 0.3, DJI: 0.2 })
  const asiaRiskScore = quoteBasketRisk(asia, { N225: 0.55, KS11: 0.45 })
  const components = [
    { value: usRiskScore, weight: 0.35 },
    { value: asiaRiskScore, weight: 0.25 },
    { value: macroRisk(macro, 'us10y'), weight: 0.15 },
    { value: macroRisk(macro, 'vix'), weight: 0.1 },
    { value: macroRisk(macro, 'usdcny'), weight: 0.05 },
    { value: newsRisk, weight: 0.1 },
  ]
  const rawScore = weightedAvailable(components)
  const score = rawScore == null ? null : r2(rawScore)
  const availableWeight = components
    .filter((item) => item.value != null)
    .reduce((sum, item) => sum + item.weight, 0)
  const coverage = r2(availableWeight * 100)
  const state = riskState(score)
  const reasons: string[] = []
  const nasdaq = us.find((row) => row.code === 'IXIC')
  const weakestAsia = [...asia].sort((a, b) => a.changePct - b.changePct)[0]
  const tenYear = macro.find((row) => row.id === 'us10y')
  if (nasdaq && nasdaq.changePct <= -1) reasons.push(`纳指${nasdaq.changePct.toFixed(2)}%`)
  if (weakestAsia && weakestAsia.changePct <= -1) {
    reasons.push(`${weakestAsia.name}${weakestAsia.changePct.toFixed(2)}%`)
  }
  if (tenYear?.deltaBps != null && tenYear.deltaBps >= 8) {
    reasons.push(`美债10Y上行${tenYear?.deltaBps?.toFixed(1)}bp`)
  }
  if (headlines.some((item) => item.direction === 'risk')) {
    reasons.push('隔夜宏观快讯存在风险事件')
  }
  if (!reasons.length) {
    reasons.push(
      score == null ? '外部市场风险数据不可用，不能判定风险状态' : '外盘未形成明确系统性风险共振',
    )
  }
  const sources = [
    ...(us.length ? ['eastmoney-us'] : []),
    ...(asia.length ? ['eastmoney-asia'] : []),
    ...(macro.length ? ['macro-live'] : []),
    ...(headlines.length ? ['news-flash'] : []),
  ]
  const warnings: string[] = []
  if (coverage < 70) warnings.push(`盘前外部数据覆盖率仅${coverage.toFixed(1)}%`)
  if (args.late) warnings.push('盘前快照在9:15后补采，仅作降级风险证据')
  if (!macro.length) warnings.push('美债/VIX/人民币真实行情缺失，宏观因子已重归一化')
  if (
    args.sourceStatus &&
    Object.values(args.sourceStatus).some((available) => !available)
  ) {
    warnings.push('宏观快讯来源部分缺失')
  }
  return {
    signalDate: args.signalDate,
    tradeDate: args.tradeDate,
    capturedAt: args.capturedAt,
    frozenAt: args.frozenAt ?? args.capturedAt,
    late: !!args.late,
    state,
    riskScore: score,
    usRiskScore,
    asiaRiskScore,
    coverage,
    us,
    asia,
    macro,
    headlines,
    sources,
    reasons,
    warnings,
  }
}

export async function fetchPremarketRiskSnapshot(args: {
  signalDate: string
  tradeDate: string
  capturedAt?: string
  late?: boolean
}): Promise<PremarketRiskSnapshot> {
  const [us, asia, macro, news] = await Promise.allSettled([
    fetchUSData(),
    fetchIndexQuotes(ASIA_INDICES),
    fetchMacroData(),
    fetchNewsFlash(),
  ])
  const capturedAt = args.capturedAt ?? new Date().toISOString()
  const newsData = news.status === 'fulfilled' ? news.value : null
  return buildPremarketRiskSnapshot({
    ...args,
    capturedAt,
    frozenAt: capturedAt,
    us: us.status === 'fulfilled' ? us.value.indices : [],
    asia: asia.status === 'fulfilled' ? asia.value : [],
    macro: macro.status === 'fulfilled' ? macro.value : [],
    news: newsData?.items ?? [],
    newsWindowStart: `${args.signalDate}T15:00:00+08:00`,
    newsWindowEnd: `${args.tradeDate}T09:15:00+08:00`,
    sourceStatus: newsData?.sources,
  })
}

function breadthRisk(advance: number | null, decline: number | null): number | null {
  if (advance == null || decline == null) return null
  const total = advance + decline
  if (total <= 0) return null
  const declineRate = (decline / total) * 100
  return clamp(20 + (declineRate - 40) * 2)
}

export function buildDomesticMarketSnapshot(args: {
  capturedAt: string
  indices: IndexQuote[]
  styleIndices?: IndexQuote[]
  advance: number | null
  decline: number | null
  flat: number | null
  limitUp: number | null
  limitDown: number | null
  highBoardState?: 'expansion' | 'divergence' | 'contraction' | 'panic' | null
}): DomesticMarketSnapshot {
  const indices = quoteRows(args.indices)
  const styleIndices = quoteRows(args.styleIndices ?? [])
  const indexRiskScore = quoteBasketRisk(indices, {
    '000001': 0.3,
    '399001': 0.35,
    '399006': 0.35,
  })
  const breadthRiskScore = breadthRisk(args.advance, args.decline)
  const highBoardRiskScore =
    args.highBoardState == null
      ? null
      : {
          expansion: 20,
          divergence: 45,
          contraction: 70,
          panic: 100,
        }[args.highBoardState]
  const rawScore = weightedAvailable([
    { value: indexRiskScore, weight: 0.4 },
    { value: breadthRiskScore, weight: 0.35 },
    { value: highBoardRiskScore, weight: 0.25 },
  ])
  const score = rawScore == null ? null : r2(rawScore)
  const available = [
    indexRiskScore != null ? 0.4 : 0,
    breadthRiskScore != null ? 0.35 : 0,
    highBoardRiskScore != null ? 0.25 : 0,
  ].reduce((sum, value) => sum + value, 0)
  const reasons: string[] = []
  const weakest = [...indices].sort((a, b) => a.changePct - b.changePct)[0]
  if (weakest && weakest.changePct <= -1) {
    reasons.push(`${weakest.name}${weakest.changePct.toFixed(2)}%`)
  }
  const total = args.advance != null && args.decline != null ? args.advance + args.decline : null
  if (total != null && total > 0 && args.decline != null && args.decline / total >= 0.65) {
    reasons.push(`竞价下跌家数占${((args.decline / total) * 100).toFixed(1)}%`)
  }
  if (args.highBoardState === 'panic' || args.highBoardState === 'contraction') {
    reasons.push(`高标风偏${args.highBoardState === 'panic' ? '恐慌' : '收缩'}`)
  }
  if (!reasons.length) reasons.push('A股竞价未确认系统性风险扩散')
  const warnings: string[] = []
  if (available < 0.75) warnings.push('A股竞价风险数据覆盖不足')
  if (args.advance == null || args.decline == null) warnings.push('A股市场宽度不可用')
  return {
    capturedAt: args.capturedAt,
    indices,
    styleIndices,
    advance: args.advance,
    decline: args.decline,
    flat: args.flat,
    limitUp: args.limitUp,
    limitDown: args.limitDown,
    indexRiskScore: indexRiskScore == null ? null : r2(indexRiskScore),
    breadthRiskScore: breadthRiskScore == null ? null : r2(breadthRiskScore),
    highBoardRiskScore,
    riskScore: score,
    coverage: r2(available * 100),
    reasons,
    warnings,
  }
}

export async function fetchDomesticMarketSnapshot(
  highBoardState?: 'expansion' | 'divergence' | 'contraction' | 'panic' | null,
): Promise<DomesticMarketSnapshot> {
  const [data, styleIndices] = await Promise.all([
    fetchAShareData(),
    fetchIndexQuotes(SIZE_STYLE_INDICES).catch(() => []),
  ])
  return buildDomesticMarketSnapshot({
    capturedAt: new Date().toISOString(),
    indices: data.indices,
    styleIndices,
    advance: data.advance,
    decline: data.decline,
    flat: data.flat,
    limitUp: data.limitUpCount,
    limitDown: data.limitDownCount,
    highBoardState,
  })
}

function averageChange(
  rows: MarketRiskQuote[],
  codes: string[],
): number | null {
  const values = rows
    .filter((row) => codes.includes(row.code))
    .map((row) => row.changePct)
    .filter(Number.isFinite)
  return values.length
    ? r2(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null
}

export function buildMarketRepairContext(args: {
  phase: MarketGatePhase
  domestic?: DomesticMarketSnapshot | null
  largeCapAuctionAmountSharePct?: number | null
  highBoardState?:
    | 'expansion'
    | 'divergence'
    | 'contraction'
    | 'panic'
    | null
  frozenContext?: MarketRepairContext | null
}): MarketRepairContext {
  if (args.phase === 'open' && args.frozenContext) return args.frozenContext
  if (args.phase === 'premarket' || !args.domestic) {
    return {
      state: 'unconfirmed',
      capturedAt: args.domestic?.capturedAt ?? '',
      applicable: false,
      confidence: 0,
      largeCapChangePct: null,
      smallCapChangePct: null,
      sizeSpreadPct: null,
      advanceRate: null,
      largeCapAuctionAmountSharePct: null,
      highBoardState: args.highBoardState ?? null,
      reasons: ['指数修复预期等待9:25大小盘与市场宽度确认'],
      warnings:
        args.phase === 'open'
          ? ['9:25修复结构快照缺失，禁止使用9:35数据回填']
          : [],
    }
  }

  const largeCapChangePct = averageChange(args.domestic.styleIndices, [
    'SSE50',
    'CSI300',
  ])
  const largeCapRepairConfirmed = args.domestic.styleIndices.some(
    (row) =>
      (row.code === 'SSE50' || row.code === 'CSI300') &&
      row.changePct >= 0.3,
  )
  const smallCapChangePct = averageChange(args.domestic.styleIndices, [
    'CSI1000',
    'CSI2000',
  ])
  const sizeSpreadPct =
    largeCapChangePct != null && smallCapChangePct != null
      ? r2(largeCapChangePct - smallCapChangePct)
      : null
  const breadthTotal = args.domestic.advance != null && args.domestic.decline != null
    ? args.domestic.advance + args.domestic.decline
    : null
  const advanceRate =
    breadthTotal != null && breadthTotal > 0 && args.domestic.advance != null
      ? r2((args.domestic.advance / breadthTotal) * 100)
      : null
  const largeCapAuctionAmountSharePct =
    args.largeCapAuctionAmountSharePct ?? null
  const highBoardState = args.highBoardState ?? null
  const confidence = r2(
    (largeCapChangePct != null ? 25 : 0) +
      (smallCapChangePct != null ? 25 : 0) +
      (advanceRate != null ? 25 : 0) +
      (largeCapAuctionAmountSharePct != null ? 15 : 0) +
      (highBoardState != null ? 10 : 0),
  )

  let state: MarketRepairState = 'mixed'
  if (
    largeCapChangePct != null &&
    smallCapChangePct != null &&
    largeCapChangePct > 0 &&
    smallCapChangePct > 0 &&
    advanceRate != null &&
    advanceRate >= 55 &&
    highBoardState !== 'panic'
  ) {
    state = 'broad-repair'
  } else if (
    largeCapRepairConfirmed &&
    (sizeSpreadPct ?? -Infinity) >= 0.5 &&
    ((advanceRate != null && advanceRate < 45) ||
      (largeCapAuctionAmountSharePct != null &&
        largeCapAuctionAmountSharePct >= 60))
  ) {
    state = 'weight-led-repair'
  } else if (
    (smallCapChangePct ?? -Infinity) >= 0.3 &&
    (sizeSpreadPct ?? Infinity) <= -0.5 &&
    advanceRate != null &&
    advanceRate >= 50 &&
    highBoardState !== 'panic'
  ) {
    state = 'small-cap-repair'
  } else if (
    (largeCapChangePct != null &&
      smallCapChangePct != null &&
      advanceRate != null &&
      largeCapChangePct <= 0 &&
      smallCapChangePct <= 0 &&
      advanceRate < 35) ||
    (highBoardState === 'panic' && advanceRate != null && advanceRate < 45)
  ) {
    state = 'risk-continuation'
  }

  const reasons: string[] = []
  if (largeCapChangePct != null) {
    reasons.push(`大盘指数${largeCapChangePct >= 0 ? '+' : ''}${largeCapChangePct.toFixed(2)}%`)
  }
  if (smallCapChangePct != null) {
    reasons.push(`小盘指数${smallCapChangePct >= 0 ? '+' : ''}${smallCapChangePct.toFixed(2)}%`)
  }
  if (sizeSpreadPct != null) {
    reasons.push(`大盘相对小盘${sizeSpreadPct >= 0 ? '+' : ''}${sizeSpreadPct.toFixed(2)}pct`)
  }
  if (advanceRate != null) reasons.push(`上涨家数占比${advanceRate.toFixed(1)}%`)
  if (largeCapAuctionAmountSharePct != null) {
    reasons.push(`大市值竞价成交占比${largeCapAuctionAmountSharePct.toFixed(1)}%`)
  }
  if (highBoardState) reasons.push(`高标风偏${highBoardState}`)
  const applicable = confidence >= 60
  const warnings = applicable
    ? []
    : [`修复结构数据覆盖率仅${confidence.toFixed(1)}%，仅展示不参与评分`]
  return {
    state,
    capturedAt: args.domestic.capturedAt,
    applicable,
    confidence,
    largeCapChangePct,
    smallCapChangePct,
    sizeSpreadPct,
    advanceRate,
    largeCapAuctionAmountSharePct,
    highBoardState,
    reasons,
    warnings,
  }
}

export function buildThemePermissions(args: {
  gateState: MarketGateState
  externalState?: ExternalRiskState | null
  themes: string[]
  auctionThemes?: AuctionThemeInput[]
  themeRisk?: ThemeRiskInput[]
}): ThemePermission[] {
  const auctionMap = new Map((args.auctionThemes ?? []).map((row) => [row.theme, row]))
  const riskMap = new Map((args.themeRisk ?? []).map((row) => [row.theme, row]))
  return Array.from(new Set(args.themes)).map((theme): ThemePermission => {
    const riskClass = classifyThemeRisk(theme)
    const direction = auctionMap.get(theme)
    const risk = riskMap.get(theme)
    const independentStrength =
      !!direction &&
      ((direction.state === 'leading' && direction.assistantCount >= 2) ||
        (direction.state === 'resonant' &&
          (direction.score ?? 0) >= 65 &&
          (direction.positiveRate ?? 0) >= 60 &&
          direction.assistantCount >= 2) ||
        (!!risk?.highLowSwitch && risk.score >= 60))
    let state: ThemePermissionState
    if (args.gateState === 'normal') {
      state = direction && (direction.score ?? 0) < 45 ? 'conditional' : 'allowed'
    } else if (args.gateState === 'cautious') {
      state = independentStrength ? 'allowed' : 'conditional'
    } else if (args.gateState === 'restricted') {
      if (riskClass === 'high-beta') state = 'blocked'
      else if (independentStrength) state = 'allowed'
      else state = 'conditional'
    } else {
      state = 'blocked'
    }
    if (
      riskClass === 'high-beta' &&
      (args.externalState === 'risk-off' || args.externalState === 'panic') &&
      !independentStrength
    ) {
      state = args.gateState === 'normal' ? 'conditional' : 'blocked'
    }
    const environmentAdjustment =
      state === 'blocked'
        ? -8
        : state === 'conditional'
          ? riskClass === 'high-beta'
            ? -4
            : -1
          : riskClass === 'defensive' && independentStrength && args.gateState !== 'normal'
            ? 5
            : independentStrength
              ? 2
              : 0
    const reasons: string[] = []
    if (riskClass === 'high-beta') reasons.push('高Beta/利率敏感题材')
    if (riskClass === 'defensive') reasons.push('低Beta题材，仅在竞价独立走强后放行')
    if (independentStrength) reasons.push('竞价形成核心、助攻与题材广度共振')
    else if (args.gateState !== 'normal') reasons.push('尚未形成逆势独立强度')
    if (state === 'blocked') reasons.push('上层市场闸门禁止执行')
    return {
      theme,
      riskClass,
      state,
      score: direction?.score ?? (independentStrength ? risk?.score ?? 60 : 50),
      independentStrength,
      directionScore: direction?.score ?? null,
      positiveRate: direction?.positiveRate ?? null,
      assistantCount: direction?.assistantCount ?? 0,
      environmentAdjustment,
      reasons,
    }
  })
}

export function buildMarketRiskGate(args: {
  signalDate: string
  tradeDate: string
  phase: MarketGatePhase
  premarket: PremarketRiskSnapshot | null
  domestic?: DomesticMarketSnapshot | null
  themes: string[]
  auctionThemes?: AuctionThemeInput[]
  themeRisk?: ThemeRiskInput[]
  largeCapAuctionAmountSharePct?: number | null
  highBoardState?:
    | 'expansion'
    | 'divergence'
    | 'contraction'
    | 'panic'
    | null
  frozenRepairContext?: MarketRepairContext | null
}): MarketRiskGate {
  const external = args.premarket?.riskScore ?? null
  const domestic = args.domestic?.riskScore ?? null
  const combined =
    args.phase === 'premarket'
      ? external
      : weightedAvailable([
          { value: external, weight: 0.35 },
          { value: domestic, weight: 0.65 },
        ])
  let state: MarketGateState = combined == null ? 'unavailable' : gateState(combined, args.phase)
  const domesticConfirmed =
    external != null &&
    external >= 50 &&
    domestic != null &&
    domestic >= 55
  if (domesticConfirmed && external != null && external >= 70 && domestic != null && domestic >= 60 && state === 'cautious') {
    state = 'restricted'
  }
  if (args.phase !== 'premarket' && external != null && external >= 70 && domestic != null && domestic >= 80) {
    state = 'frozen'
  }
  const themePermissions = buildThemePermissions({
    gateState:
      args.phase === 'premarket' && state === 'restricted' ? 'cautious' : state,
    externalState:
      args.phase === 'premarket' ? null : args.premarket?.state,
    themes: args.themes,
    auctionThemes: args.auctionThemes,
    themeRisk: args.themeRisk,
  })
  const repairContext = buildMarketRepairContext({
    phase: args.phase,
    domestic: args.domestic,
    largeCapAuctionAmountSharePct:
      args.largeCapAuctionAmountSharePct,
    highBoardState: args.highBoardState,
    frozenContext: args.frozenRepairContext,
  })
  const reasons = [
    ...(args.premarket?.reasons ?? []),
    ...(args.domestic?.reasons ?? []),
  ]
  if (domesticConfirmed) reasons.push('外盘风险已被A股竞价负反馈确认')
  else if (args.phase !== 'premarket' && external != null && external >= 50) {
    reasons.push('外盘风险尚未被A股竞价全面确认')
  }
  const warnings = [
    ...(args.premarket?.warnings ?? []),
    ...(args.domestic?.warnings ?? []),
    ...repairContext.warnings,
  ]
  if (combined == null) warnings.push('市场风险数据不可用，禁止形成确认结论')
  return {
    signalDate: args.signalDate,
    tradeDate: args.tradeDate,
    generatedAt: new Date().toISOString(),
    phase: args.phase,
    state,
    riskScore: combined == null ? null : r2(combined),
    externalRiskScore: external,
    domesticRiskScore: domestic,
    domesticConfirmed,
    premarket: args.premarket,
    domestic: args.domestic ?? null,
    repairContext,
    themePermissions,
    reasons: Array.from(new Set(reasons)),
    warnings: Array.from(new Set(warnings)),
  }
}
