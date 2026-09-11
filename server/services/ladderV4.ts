import { createHash } from 'crypto'
import { emFetch } from '../lib/emFetch'
import { fetchNewsFlash, type NewsFlashItem } from './newsFlash'
import type { ScreenerLiveQuote } from './screenerDataContract'

export type MarketPositionRole =
  | 'space-leader'
  | 'co-space-leader'
  | 'high-anchor'
  | 'normal'
export type ThemePositionRole =
  | 'theme-position-leader'
  | 'co-theme-position-leader'
  | 'core-assistant'
  | 'follower'
export type LadderHeightTier = 'high' | 'middle' | 'low'
export type LadderLifecycle =
  | 'acceleration'
  | 'consensus'
  | 'divergence'
  | 'broken-maintain'
  | 'repair-relaunch'
  | 'ebb'

export interface RoleStockInput {
  code: string
  name: string
  consecutiveDays: number
  primaryTheme: string
  themes: string[]
  firstTime?: string
  openCount?: number
  onePrice?: boolean
}

export interface RoleHistoryDay {
  asof: string
  stocks: Array<{
    code: string
    consecutiveDays: number
    primaryTheme: string
    role?: string
    roleProfile?: LadderRoleProfile
  }>
}

export interface RoleAnchorInput {
  code: string
  name: string
  themes: string[]
  priorMaxBoards: number
  active: boolean
  onePrice?: boolean
}

export interface LadderRoleProfile {
  code: string
  name: string
  primaryTheme: string
  themes: string[]
  boards: number
  marketRole: MarketPositionRole
  themeRole: ThemePositionRole
  heightTier: LadderHeightTier
  lifecycle: LadderLifecycle
  onePrice: boolean
  positionDelta: number
  peerCodes: string[]
  leadingDays: number
  cardedCodes: string[]
  wasCardedBy: string[]
  followerCount: number
  confidence: number
  evidence: string[]
}

export interface LadderRoleMap {
  maxBoards: number
  spaceLeaderCodes: string[]
  profiles: LadderRoleProfile[]
  brokenAnchors: LadderRoleProfile[]
}

export type LadderEventScope = 'stock' | 'theme' | 'market'
export type LadderEventCategory =
  | 'trading-halt'
  | 'delisting-risk'
  | 'regulatory-restriction'
  | 'abnormal-monitoring'
  | 'inquiry'
  | 'reduction'
  | 'unlock'
  | 'policy'
  | 'earnings'
  | 'other'
export type LadderEventDirection = 'positive' | 'negative' | 'neutral'
export type LadderEventConfidence = 'official' | 'verified' | 'unverified'
export type LadderEventAction = 'hard-block' | 'risk-cap' | 'theme-adjust' | 'informational'

export interface LadderRiskEvent {
  id: string
  publishedAt: string
  source: string
  sourceUrl: string
  title: string
  summary: string
  codes: string[]
  themes: string[]
  scope: LadderEventScope
  category: LadderEventCategory
  direction: LadderEventDirection
  severity: 1 | 2 | 3 | 4 | 5
  confidence: LadderEventConfidence
  action: LadderEventAction
  effectiveUntil: string
  evidence: string[]
}

export interface LadderEventGate {
  generatedAt: string
  coverage: number
  sourceStatus: Record<string, boolean>
  events: LadderRiskEvent[]
  hardBlockedCodes: string[]
  riskCappedCodes: string[]
  themeAdjustments: Record<string, number>
  marketRisk: 'normal' | 'elevated' | 'severe'
  warnings: string[]
}

export type PromotionConfidence = 'low' | 'medium' | 'high'
export interface PromotionRateEstimate {
  rawRate: number | null
  adjustedRate: number | null
  promoted: number
  valid: number
  confidence: PromotionConfidence
}
export interface PromotionWindowStatistics {
  day1: PromotionRateEstimate
  day5: PromotionRateEstimate
  day20: PromotionRateEstimate
  day60: PromotionRateEstimate
}
export interface PromotionStatistics {
  generatedAt: string
  priorStrength: number
  overall: PromotionWindowStatistics
  byLane: Record<string, PromotionWindowStatistics>
  byMarketCycle: Record<string, PromotionWindowStatistics>
  byRole: Record<string, PromotionWindowStatistics>
  byThemeState: Record<string, PromotionWindowStatistics>
  sampleDates: string[]
}

export interface PromotionObservation {
  signalDate: string
  lane: string
  promoted: boolean
  marketCycle?: string
  marketRole?: string
  themeState?: string
}

export type RiskAppetiteState = 'expansion' | 'divergence' | 'contraction' | 'panic'
export interface HighBoardRiskMetrics {
  sampleSize: number
  positiveRate: number | null
  nuclearRate: number | null
  onePriceRetentionRate: number | null
  weightedGapPct: number | null
  processStrength: number | null
  vwapHoldRate: number | null
  waterfallRate: number | null
  resealRate: number | null
}
export interface HighBoardMemberFeedback {
  code: string
  name: string
  theme: string
  boards: number
  marketRole: MarketPositionRole
  heightTier: LadderHeightTier
  gapPct: number | null
  changePct: number | null
  processScore: number | null
  aboveVwap: boolean | null
  priorOnePrice: boolean
  onePriceRetained: boolean | null
  resealed: boolean
  nuclear: boolean
}
export interface ThemeRiskAppetite {
  theme: string
  score: number
  state: RiskAppetiteState
  confidence: number
  sampleSize: number
  highLowSwitch: boolean
}
export interface HighBoardRiskContext {
  capturedAt: string
  phase: 'auction' | 'open'
  score: number
  state: RiskAppetiteState
  confidence: number
  metrics: HighBoardRiskMetrics
  members: HighBoardMemberFeedback[]
  themes: ThemeRiskAppetite[]
  warnings: string[]
}

export interface LadderEventReaction {
  state: 'absorbed' | 'neutral' | 'amplified' | 'unavailable'
  score: number | null
  affectedCodes: string[]
  positiveCodes: string[]
  negativeCodes: string[]
  evidence: string[]
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const r2 = (value: number) => Math.round(value * 100) / 100
const mean = (values: number[]) =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

function themeNames(stock: Pick<RoleStockInput, 'primaryTheme' | 'themes'>): string[] {
  return Array.from(new Set([stock.primaryTheme, ...stock.themes].filter(Boolean)))
}

function heightTier(boards: number, maxBoards: number): LadderHeightTier {
  const delta = Math.max(0, maxBoards - boards)
  if (boards === maxBoards || (boards >= 3 && delta <= 1)) return 'high'
  if (boards === 1 || (maxBoards >= 5 && delta >= 3)) return 'low'
  return 'middle'
}

function lifecycleOf(
  stock: RoleStockInput,
  histories: RoleHistoryDay[],
): LadderLifecycle {
  const appearedRecently = histories.some((day) => day.stocks.some((row) => row.code === stock.code))
  const appearedPrevious = histories.at(-1)?.stocks.some((row) => row.code === stock.code) ?? false
  if (appearedRecently && !appearedPrevious) return 'repair-relaunch'
  if (stock.onePrice) return 'acceleration'
  if ((stock.openCount ?? 0) > 0) return 'divergence'
  return 'consensus'
}

export function buildLadderRoleMap(args: {
  stocks: RoleStockInput[]
  histories?: RoleHistoryDay[]
  anchors?: RoleAnchorInput[]
}): LadderRoleMap {
  const stocks = args.stocks
  const histories = args.histories ?? []
  const maxBoards = Math.max(1, ...stocks.map((stock) => stock.consecutiveDays))
  const spaceLeaders = stocks.filter((stock) => stock.consecutiveDays === maxBoards)
  const spaceLeaderCodes = spaceLeaders.map((stock) => stock.code)
  const previous = histories.at(-1)
  const previousByTheme = new Map<string, string[]>()
  if (previous) {
    for (const theme of new Set(previous.stocks.map((stock) => stock.primaryTheme))) {
      const rows = previous.stocks.filter((stock) => stock.primaryTheme === theme)
      const high = Math.max(0, ...rows.map((stock) => stock.consecutiveDays))
      previousByTheme.set(theme, rows.filter((stock) => stock.consecutiveDays === high).map((stock) => stock.code))
    }
  }

  const profiles = stocks.map((stock): LadderRoleProfile => {
    const names = themeNames(stock)
    const themePeers = stocks.filter((other) =>
      themeNames(other).some((theme) => names.includes(theme)),
    )
    const themeMax = Math.max(1, ...themePeers.map((other) => other.consecutiveDays))
    const themeLeaders = themePeers.filter((other) => other.consecutiveDays === themeMax)
    const levelPeers = stocks
      .filter(
        (other) =>
          other.code !== stock.code && other.consecutiveDays === stock.consecutiveDays,
      )
      .map((other) => other.code)
    const followers = themePeers.filter(
      (other) =>
        other.code !== stock.code &&
        other.consecutiveDays <= stock.consecutiveDays &&
        (!stock.firstTime || !other.firstTime || other.firstTime >= stock.firstTime),
    )
    const stockHeightTier = heightTier(stock.consecutiveDays, maxBoards)
    const marketRole: MarketPositionRole =
      stock.consecutiveDays === maxBoards
        ? spaceLeaders.length === 1
          ? 'space-leader'
          : 'co-space-leader'
        : stockHeightTier === 'high'
          ? 'high-anchor'
          : 'normal'
    const themeRole: ThemePositionRole =
      stock.consecutiveDays === themeMax
        ? themeLeaders.length === 1
          ? 'theme-position-leader'
          : 'co-theme-position-leader'
        : followers.length >= 2
          ? 'core-assistant'
          : 'follower'
    const priorLeaders = previousByTheme.get(stock.primaryTheme) ?? []
    const currentLeaderCodes = themeLeaders.map((row) => row.code)
    const cardedCodes =
      themeRole === 'theme-position-leader' || themeRole === 'co-theme-position-leader'
        ? priorLeaders.filter((code) => !currentLeaderCodes.includes(code))
        : []
    const wasCardedBy =
      priorLeaders.includes(stock.code) && !currentLeaderCodes.includes(stock.code)
        ? currentLeaderCodes
        : []
    const leadingDays = histories
      .slice()
      .reverse()
      .findIndex(
        (day) =>
          !day.stocks.some(
            (row) =>
              row.code === stock.code &&
              (row.roleProfile?.marketRole === 'space-leader' ||
                row.roleProfile?.marketRole === 'co-space-leader' ||
                row.role === 'space-leader'),
          ),
      )
    const evidence = [
      `${stock.consecutiveDays}板，距空间高度${Math.max(0, maxBoards - stock.consecutiveDays)}个身位`,
      `${stock.primaryTheme}题材最高${themeMax}板`,
      levelPeers.length > 0 ? `同层竞争${levelPeers.length}只` : '同层无并列竞争',
    ]
    if (cardedCodes.length > 0) evidence.push(`卡位${cardedCodes.join('、')}`)
    return {
      code: stock.code,
      name: stock.name,
      primaryTheme: stock.primaryTheme,
      themes: stock.themes,
      boards: stock.consecutiveDays,
      marketRole,
      themeRole,
      heightTier: stockHeightTier,
      lifecycle: lifecycleOf(stock, histories),
      onePrice: stock.onePrice === true,
      positionDelta: Math.max(0, maxBoards - stock.consecutiveDays),
      peerCodes: levelPeers,
      leadingDays: leadingDays < 0 ? histories.length + 1 : Math.max(1, leadingDays),
      cardedCodes,
      wasCardedBy,
      followerCount: followers.length,
      confidence: clamp(65 + Math.min(histories.length, 5) * 5 + (stock.firstTime ? 10 : 0)),
      evidence,
    }
  })

  const currentCodes = new Set(stocks.map((stock) => stock.code))
  const brokenAnchors = (args.anchors ?? [])
    .filter((anchor) => anchor.active && !currentCodes.has(anchor.code))
    .map(
      (anchor): LadderRoleProfile => ({
        code: anchor.code,
        name: anchor.name,
        primaryTheme: anchor.themes[0] ?? '其他',
        themes: anchor.themes,
        boards: anchor.priorMaxBoards,
        marketRole: 'high-anchor',
        themeRole: 'follower',
        heightTier: 'high',
        lifecycle: 'broken-maintain',
        onePrice: anchor.onePrice === true,
        positionDelta: Math.max(0, maxBoards - anchor.priorMaxBoards),
        peerCodes: [],
        leadingDays: 0,
        cardedCodes: [],
        wasCardedBy: [],
        followerCount: 0,
        confidence: 70,
        evidence: [`近5日高位锚，历史最高${anchor.priorMaxBoards}板`],
      }),
    )
  return { maxBoards, spaceLeaderCodes, profiles, brokenAnchors }
}

export interface LadderEventFact {
  id: string
  publishedAt: string
  source: string
  sourceUrl: string
  title: string
  summary: string
  codes: string[]
  important: boolean
  official: boolean
}

function addCalendarDays(date: string, days: number): string {
  const value = new Date(date)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString()
}

function inferEventThemes(text: string, stocks: RoleStockInput[]): string[] {
  const knownThemes = Array.from(
    new Set(stocks.flatMap((stock) => themeNames(stock))),
  ).filter((theme) => theme !== '其他' && theme.length >= 2)
  const matched = knownThemes.filter((theme) => text.includes(theme))
  const keywordThemes: Array<[RegExp, string]> = [
    [/人工智能|AI|算力|芯片|半导体|机器人|软件|通信|电子|光模块|CPO/i, '科技'],
    [/消费|食品|饮料|零售|旅游|白酒|乳业|家电|服装/, '消费'],
    [/医药|医疗|生物|创新药|中药|制药/, '医药'],
    [/证券|银行|保险|金融/, '金融'],
    [/有色|煤炭|钢铁|化工|石油|稀土/, '周期'],
  ]
  for (const [pattern, theme] of keywordThemes) {
    if (pattern.test(text)) matched.push(theme)
  }
  return Array.from(new Set(matched))
}

export function classifyLadderRiskEvent(
  fact: LadderEventFact,
  stocks: RoleStockInput[],
): LadderRiskEvent | null {
  const text = `${fact.title} ${fact.summary}`.replace(/\s+/g, ' ')
  const stockMap = new Map(stocks.map((stock) => [stock.code, stock]))
  const codes = fact.codes.filter((code) => stockMap.has(code))
  const themes = Array.from(
    new Set([
      ...codes.flatMap((code) => themeNames(stockMap.get(code)!)),
      ...inferEventThemes(text, stocks),
    ]),
  )
  let category: LadderEventCategory = 'other'
  let action: LadderEventAction = 'informational'
  let direction: LadderEventDirection = 'neutral'
  let severity: 1 | 2 | 3 | 4 | 5 = fact.important ? 2 : 1
  const evidence: string[] = []

  if (/终止上市|退市整理|退市风险警示|实施\*?ST|暂停上市/.test(text)) {
    category = 'delisting-risk'
    action = 'hard-block'
    direction = 'negative'
    severity = 5
    evidence.push('命中退市或风险警示规则')
  } else if (
    /停牌/.test(text) &&
    !/不停牌|不申请停牌|无需停牌|无须停牌|复牌/.test(text)
  ) {
    category = 'trading-halt'
    action = 'hard-block'
    direction = 'negative'
    severity = 5
    evidence.push('命中停牌规则')
  } else if (/限制交易|暂停账户交易|账户.*限制/.test(text)) {
    category = 'regulatory-restriction'
    action = 'risk-cap'
    direction = 'negative'
    severity = 4
    evidence.push('限制对象为相关账户时不等同于股票停牌')
  } else if (/重点监控|严重异常波动|异常交易|监管措施|监管警示/.test(text)) {
    category = 'abnormal-monitoring'
    action = 'risk-cap'
    direction = 'negative'
    severity = 4
    evidence.push('命中重点监控或异常交易规则')
  } else if (/问询函|关注函|监管函|立案调查/.test(text)) {
    category = 'inquiry'
    action = 'risk-cap'
    direction = 'negative'
    severity = /立案调查/.test(text) ? 4 : 3
    evidence.push('命中问询或调查规则')
  } else if (/减持|拟减持|股份转让/.test(text)) {
    category = 'reduction'
    action = codes.length > 0 ? 'risk-cap' : 'informational'
    direction = 'negative'
    severity = 3
    evidence.push('命中减持或股份供给规则')
  } else if (/解禁|限售股上市流通/.test(text)) {
    category = 'unlock'
    action = codes.length > 0 ? 'risk-cap' : 'informational'
    direction = 'negative'
    severity = 3
    evidence.push('命中限售解禁规则')
  } else if (
    /产业政策|行业政策|发展规划|行动方案|指导意见|补贴|支持.*(?:行业|产业|发展)|禁止|限制.*(?:进口|出口|生产|销售|准入)/.test(
      text,
    )
  ) {
    category = 'policy'
    action = 'theme-adjust'
    direction = /禁止|限制|取消补贴|整治/.test(text) ? 'negative' : 'positive'
    severity = fact.important ? 4 : 3
    evidence.push('命中产业政策规则')
  } else if (/业绩预增|扭亏|净利润.*增长|业绩预亏|净利润.*下降|亏损/.test(text)) {
    category = 'earnings'
    direction = /预亏|下降|亏损/.test(text) ? 'negative' : 'positive'
    action =
      direction === 'negative' && codes.length > 0
        ? 'risk-cap'
        : 'informational'
    severity = 2
    evidence.push('命中业绩规则')
  } else if (codes.length === 0) {
    return null
  }

  if (action === 'hard-block' && codes.length === 0) {
    action = 'informational'
    severity = 2
    evidence.push('未关联到具体股票，不执行硬否决')
  }
  const scope: LadderEventScope =
    codes.length > 0 ? 'stock' : themes.length > 0 ? 'theme' : 'market'
  const confidence: LadderEventConfidence = fact.official
    ? 'official'
    : fact.important
      ? 'verified'
      : 'unverified'
  if (confidence === 'unverified' && action !== 'informational') {
    action = 'informational'
    evidence.push('来源未验证，仅展示不改变模型')
  }
  return {
    id: fact.id,
    publishedAt: fact.publishedAt,
    source: fact.source,
    sourceUrl: fact.sourceUrl,
    title: fact.title,
    summary: fact.summary,
    codes,
    themes,
    scope,
    category,
    direction,
    severity,
    confidence,
    action,
    effectiveUntil: addCalendarDays(fact.publishedAt, severity >= 4 ? 7 : 3),
    evidence,
  }
}

function flashFact(item: NewsFlashItem): LadderEventFact {
  return {
    id: item.id,
    publishedAt: item.time,
    source: `${item.source}-flash`,
    sourceUrl: item.url ?? '',
    title: item.title,
    summary: item.summary,
    codes: item.stocks.map((stock) => stock.code),
    important: item.important,
    official: false,
  }
}

function announcementPublishedAt(value: string): string {
  const trimmed = value.trim()
  const iso =
    /^\d{4}-\d{2}-\d{2}(?:[ T]00:00:00)?$/.test(trimmed)
      ? `${trimmed.slice(0, 10)}T23:59:59+08:00`
      : `${trimmed.replace(' ', 'T')}${/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed) ? '' : '+08:00'}`
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString()
}

async function fetchAnnouncements(asof: string): Promise<LadderEventFact[]> {
  const url =
    'https://np-anotice-stock.eastmoney.com/api/security/ann?' +
    new URLSearchParams({
      sr: '-1',
      page_size: '100',
      page_index: '1',
      ann_type: 'A',
      client_source: 'web',
      f_node: '0',
      s_node: '0',
      begin_time: asof,
      end_time: asof,
    }).toString()
  const response = await emFetch(url, { timeoutMs: 12_000 })
  if (!response.ok) throw new Error(`公告接口HTTP ${response.status}`)
  const raw = (await response.json()) as {
    data?: {
      list?: Array<{
        art_code?: string
        title?: string
        notice_date?: string
        codes?: Array<{ stock_code?: string }>
      }>
    }
  }
  return (raw.data?.list ?? [])
    .filter((row) => row.title && row.notice_date)
    .map((row) => ({
      id: `announcement-${row.art_code ?? createHash('sha1').update(row.title!).digest('hex')}`,
      publishedAt: announcementPublishedAt(row.notice_date!),
      source: 'eastmoney-announcement',
      sourceUrl: row.art_code
        ? `https://data.eastmoney.com/notices/detail/${row.codes?.[0]?.stock_code ?? ''}/${row.art_code}.html`
        : '',
      title: row.title!,
      summary: '',
      codes: (row.codes ?? []).map((code) => code.stock_code ?? '').filter(Boolean),
      important: true,
      official: true,
    }))
}

export async function fetchLadderEventGate(args: {
  asof: string
  stocks: RoleStockInput[]
  knownAt?: string
}): Promise<LadderEventGate> {
  const [flashResult, announcementResult] = await Promise.allSettled([
    fetchNewsFlash(),
    fetchAnnouncements(args.asof),
  ])
  const knownAtMs = args.knownAt ? Date.parse(args.knownAt) : Date.now()
  const facts: LadderEventFact[] = []
  const flashSources = {
    eastmoney: false,
    cls: false,
    sina: false,
  }
  if (flashResult.status === 'fulfilled') {
    Object.assign(flashSources, flashResult.value.sources)
    facts.push(
      ...flashResult.value.items
        .map(flashFact)
        .filter((fact) => Date.parse(fact.publishedAt) <= knownAtMs),
    )
  }
  if (announcementResult.status === 'fulfilled') {
    facts.push(
      ...announcementResult.value.filter(
        (fact) => Date.parse(fact.publishedAt) <= knownAtMs,
      ),
    )
  }
  const classified = facts
    .map((fact) => classifyLadderRiskEvent(fact, args.stocks))
    .filter((event): event is LadderRiskEvent => event !== null)
  const events = Array.from(
    new Map(
      classified.map((event) => {
        const contentKey = createHash('sha1')
          .update(
            `${event.title.replace(/\s+/g, '')}|${event.codes.slice().sort().join(',')}|${event.category}`,
          )
          .digest('hex')
        return [contentKey, event]
      }),
    ).values(),
  )
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 50)
  const hardBlockedCodes = Array.from(
    new Set(events.filter((event) => event.action === 'hard-block').flatMap((event) => event.codes)),
  )
  const riskCappedCodes = Array.from(
    new Set(events.filter((event) => event.action === 'risk-cap').flatMap((event) => event.codes)),
  ).filter((code) => !hardBlockedCodes.includes(code))
  const themeAdjustments: Record<string, number> = {}
  for (const event of events.filter((row) => row.action === 'theme-adjust')) {
    for (const theme of event.themes) {
      const delta = event.direction === 'positive' ? event.severity * 3 : -event.severity * 3
      themeAdjustments[theme] = clamp((themeAdjustments[theme] ?? 0) + delta, -20, 20)
    }
  }
  const severeEvents = events.filter(
    (event) =>
      event.severity >= 4 &&
      (event.action === 'hard-block' || event.action === 'risk-cap'),
  )
  return {
    generatedAt: new Date().toISOString(),
    coverage: r2(
      ((Number(flashSources.eastmoney) +
        Number(flashSources.cls) +
        Number(flashSources.sina) +
        Number(announcementResult.status === 'fulfilled')) /
        4) *
        100,
    ),
    sourceStatus: {
      eastmoneyFlash: flashSources.eastmoney,
      clsFlash: flashSources.cls,
      sinaFlash: flashSources.sina,
      announcement: announcementResult.status === 'fulfilled',
    },
    events,
    hardBlockedCodes,
    riskCappedCodes,
    themeAdjustments,
    marketRisk:
      severeEvents.length >= 2 ? 'severe' : severeEvents.length === 1 ? 'elevated' : 'normal',
    warnings: [
      ...(flashResult.status === 'rejected'
        ? ['三源快讯不可用']
        : Object.values(flashSources).some((available) => !available)
          ? ['部分实时快讯源不可用']
          : []),
      ...(announcementResult.status === 'rejected' ? ['公司公告源不可用'] : []),
    ],
  }
}

function confidence(valid: number): PromotionConfidence {
  return valid < 5 ? 'low' : valid < 20 ? 'medium' : 'high'
}

function estimate(
  rows: PromotionObservation[],
  priorMean: number,
  priorStrength: number,
): PromotionRateEstimate {
  const promoted = rows.filter((row) => row.promoted).length
  const valid = rows.length
  return {
    rawRate: valid > 0 ? r2((promoted / valid) * 100) : null,
    adjustedRate:
      valid > 0 || priorStrength > 0
        ? r2(((promoted + priorMean * priorStrength) / (valid + priorStrength)) * 100)
        : null,
    promoted,
    valid,
    confidence: confidence(valid),
  }
}

export function buildPromotionStatistics(
  observations: PromotionObservation[],
  priorStrength = 10,
): PromotionStatistics {
  const dates = Array.from(new Set(observations.map((row) => row.signalDate))).sort()
  const latestDates = (count: number) => new Set(dates.slice(-count))
  const rowsFor = (
    count: number,
    predicate?: (row: PromotionObservation) => boolean,
  ) => {
    const selected = latestDates(count)
    return observations.filter(
      (row) => selected.has(row.signalDate) && (!predicate || predicate(row)),
    )
  }
  const all60 = rowsFor(60)
  const baselinePrior = 0.35
  const globalPrior =
    (all60.filter((row) => row.promoted).length +
      baselinePrior * priorStrength) /
    (all60.length + priorStrength)
  const windowsFor = (
    predicate?: (row: PromotionObservation) => boolean,
  ): PromotionWindowStatistics => {
    const selected60 = rowsFor(60, predicate)
    const selectedPrior =
      selected60.length > 0
        ? (selected60.filter((row) => row.promoted).length +
            globalPrior * priorStrength) /
          (selected60.length + priorStrength)
        : globalPrior
    return {
      day1: estimate(rowsFor(1, predicate), selectedPrior, priorStrength),
      day5: estimate(rowsFor(5, predicate), selectedPrior, priorStrength),
      day20: estimate(rowsFor(20, predicate), selectedPrior, priorStrength),
      day60: estimate(selected60, globalPrior, priorStrength),
    }
  }
  const lanes = Array.from(new Set(observations.map((row) => row.lane))).sort()
  const marketCycles = Array.from(
    new Set(observations.map((row) => row.marketCycle).filter(Boolean)),
  ).sort()
  const roles = Array.from(
    new Set(observations.map((row) => row.marketRole).filter(Boolean)),
  ).sort()
  const themeStates = Array.from(
    new Set(observations.map((row) => row.themeState).filter(Boolean)),
  ).sort()
  return {
    generatedAt: new Date().toISOString(),
    priorStrength,
    overall: windowsFor(),
    byLane: Object.fromEntries(
      lanes.map((lane) => [lane, windowsFor((row) => row.lane === lane)]),
    ),
    byMarketCycle: Object.fromEntries(
      marketCycles.map((cycle) => [
        cycle,
        windowsFor((row) => row.marketCycle === cycle),
      ]),
    ),
    byRole: Object.fromEntries(
      roles.map((role) => [role, windowsFor((row) => row.marketRole === role)]),
    ),
    byThemeState: Object.fromEntries(
      themeStates.map((state) => [
        state,
        windowsFor((row) => row.themeState === state),
      ]),
    ),
    sampleDates: dates.slice(-60),
  }
}

function quoteGap(quote?: ScreenerLiveQuote): number | null {
  if (!quote || quote.prevClose <= 0) return null
  const price = quote.indicativePrice ?? quote.open ?? quote.price
  return price > 0 ? r2(((price - quote.prevClose) / quote.prevClose) * 100) : null
}

function quoteVwap(quote?: ScreenerLiveQuote): number | null {
  if (!quote || quote.amount <= 0 || quote.volume <= 0) return null
  return quote.amount / (quote.volume * 100)
}

function appetiteState(score: number, nuclearRate: number): RiskAppetiteState {
  if (score < 25 || nuclearRate >= 50) return 'panic'
  if (score < 45) return 'contraction'
  if (score < 70) return 'divergence'
  return 'expansion'
}

function appetiteScore(
  members: HighBoardMemberFeedback[],
  phase: 'auction' | 'open',
): { score: number; confidence: number; metrics: HighBoardRiskMetrics } {
  const quoted = members.filter((member) => member.gapPct != null || member.changePct != null)
  const gaps = quoted.map((member) => member.gapPct ?? member.changePct ?? 0)
  const positiveRate = quoted.length
    ? (quoted.filter((member) => (member.gapPct ?? member.changePct ?? 0) > 0).length /
        quoted.length) *
      100
    : null
  const nuclearRate = quoted.length
    ? (quoted.filter((member) => member.nuclear).length / quoted.length) * 100
    : null
  const processValues = quoted
    .map((member) => member.processScore)
    .filter((value): value is number => value != null)
  const vwapRows = quoted.filter((member) => member.aboveVwap != null)
  const vwapHoldRate = vwapRows.length
    ? (vwapRows.filter((member) => member.aboveVwap).length / vwapRows.length) * 100
    : null
  const waterfallRate = phase === 'open' && quoted.length
    ? (quoted.filter((member) => (member.changePct ?? 0) <= -5).length / quoted.length) * 100
    : null
  const resealRate =
    phase === 'open' && quoted.length
      ? (quoted.filter((member) => member.resealed).length / quoted.length) * 100
      : null
  const priorOnePriceRows = quoted.filter((member) => member.priorOnePrice)
  const retainedRows = priorOnePriceRows.filter(
    (member) => member.onePriceRetained != null,
  )
  const onePriceRetentionRate = retainedRows.length
    ? (retainedRows.filter((member) => member.onePriceRetained).length /
        retainedRows.length) *
      100
    : null
  const weightedGapPct = gaps.length ? mean(gaps) : null
  const components = [
    { value: positiveRate, weight: 0.2 },
    {
      value: weightedGapPct == null ? null : clamp(50 + weightedGapPct * 10),
      weight: 0.2,
    },
    { value: nuclearRate == null ? null : 100 - nuclearRate, weight: 0.2 },
    {
      value: processValues.length ? mean(processValues) : null,
      weight: 0.15,
    },
    { value: onePriceRetentionRate, weight: 0.1 },
    {
      value: phase === 'open' ? vwapHoldRate : null,
      weight: 0.1,
    },
    {
      value: phase === 'open' ? resealRate : null,
      weight: 0.05,
    },
  ].filter(
    (item): item is { value: number; weight: number } =>
      item.value != null && Number.isFinite(item.value),
  )
  const availableWeight = components.reduce((sum, item) => sum + item.weight, 0)
  const base =
    availableWeight > 0
      ? components.reduce((sum, item) => sum + item.value * item.weight, 0) /
        availableWeight
      : 50
  const sampleConfidence = quoted.length / (quoted.length + 5)
  const score = r2(50 + (base - 50) * sampleConfidence)
  return {
    score,
    confidence: r2(sampleConfidence * 100),
    metrics: {
      sampleSize: quoted.length,
      positiveRate: positiveRate == null ? null : r2(positiveRate),
      nuclearRate: nuclearRate == null ? null : r2(nuclearRate),
      onePriceRetentionRate:
        onePriceRetentionRate == null ? null : r2(onePriceRetentionRate),
      weightedGapPct: weightedGapPct == null ? null : r2(weightedGapPct),
      processStrength: processValues.length ? r2(mean(processValues)) : null,
      vwapHoldRate: vwapHoldRate == null ? null : r2(vwapHoldRate),
      waterfallRate: waterfallRate == null ? null : r2(waterfallRate),
      resealRate: resealRate == null ? null : r2(resealRate),
    },
  }
}

export function buildHighBoardRiskContext(args: {
  roleMap: LadderRoleMap
  auctionQuotes: Record<string, ScreenerLiveQuote>
  liveQuotes?: Record<string, ScreenerLiveQuote> | null
  processScores?: Record<string, number | null>
  capturedAt: string
  allProfiles?: LadderRoleProfile[]
}): HighBoardRiskContext {
  const phase: 'auction' | 'open' = args.liveQuotes ? 'open' : 'auction'
  const basket = [...args.roleMap.profiles, ...args.roleMap.brokenAnchors].filter(
    (profile) =>
      profile.marketRole !== 'normal' ||
      profile.heightTier === 'high' ||
      profile.boards >= 3,
  )
  const members = basket.map((profile): HighBoardMemberFeedback => {
    const auction = args.auctionQuotes[profile.code]
    const live = args.liveQuotes?.[profile.code]
    const gapPct = quoteGap(auction)
    const vwap = quoteVwap(live)
    const changePct = live?.changePct ?? auction?.changePct ?? null
    const retainedQuote = live ?? auction
    const onePriceRetained =
      profile.onePrice && retainedQuote
        ? (retainedQuote.changePct ?? quoteGap(retainedQuote) ?? 0) >= 9.5 &&
          (Math.abs(retainedQuote.high - retainedQuote.low) < 0.005 ||
            retainedQuote.unmatchedSide === 'buy')
        : profile.onePrice
          ? null
          : null
    return {
      code: profile.code,
      name: profile.name,
      theme: profile.primaryTheme,
      boards: profile.boards,
      marketRole: profile.marketRole,
      heightTier: profile.heightTier,
      gapPct,
      changePct,
      processScore: args.processScores?.[profile.code] ?? null,
      aboveVwap: live && vwap != null ? live.price >= vwap : null,
      priorOnePrice: profile.onePrice,
      onePriceRetained,
      resealed:
        !!live &&
        live.changePct >= 9.5 &&
        live.prevClose > 0 &&
        ((live.low - live.prevClose) / live.prevClose) * 100 < 9,
      nuclear: (gapPct ?? changePct ?? 0) <= -7,
    }
  })
  const global = appetiteScore(members, phase)
  const allProfiles = args.allProfiles ?? args.roleMap.profiles
  const themes = Array.from(new Set(members.map((member) => member.theme)))
    .map((theme): ThemeRiskAppetite => {
      const themeMembers = members.filter((member) => member.theme === theme)
      const scored = appetiteScore(themeMembers, phase)
      const lowProfiles = allProfiles.filter(
        (profile) => profile.primaryTheme === theme && profile.heightTier === 'low',
      )
      const lowPositive = lowProfiles.filter((profile) => {
        const quote = (args.liveQuotes ?? args.auctionQuotes)[profile.code]
        return (quote?.changePct ?? quoteGap(quote) ?? 0) >= 1
      }).length
      const highWeak = themeMembers.some(
        (member) => (member.gapPct ?? member.changePct ?? 0) < 0,
      )
      return {
        theme,
        score: scored.score,
        state: appetiteState(scored.score, scored.metrics.nuclearRate ?? 0),
        confidence: scored.confidence,
        sampleSize: scored.metrics.sampleSize,
        highLowSwitch: highWeak && lowPositive >= 2,
      }
    })
    .sort((a, b) => b.score - a.score)
  return {
    capturedAt: args.capturedAt,
    phase,
    score: global.score,
    state: appetiteState(global.score, global.metrics.nuclearRate ?? 0),
    confidence: global.confidence,
    metrics: global.metrics,
    members,
    themes,
    warnings: global.metrics.sampleSize < 3 ? ['高标篮子少于3只，风偏按低置信度收缩'] : [],
  }
}

export function buildEventReaction(args: {
  gate?: LadderEventGate | null
  quotes: Record<string, ScreenerLiveQuote>
}): LadderEventReaction {
  const affectedCodes = Array.from(
    new Set([
      ...(args.gate?.hardBlockedCodes ?? []),
      ...(args.gate?.riskCappedCodes ?? []),
    ]),
  )
  const rows = affectedCodes
    .map((code) => ({ code, quote: args.quotes[code] }))
    .filter((row): row is { code: string; quote: ScreenerLiveQuote } => !!row.quote)
  if (affectedCodes.length === 0 || rows.length === 0) {
    return {
      state: affectedCodes.length === 0 ? 'neutral' : 'unavailable',
      score: affectedCodes.length === 0 ? 50 : null,
      affectedCodes,
      positiveCodes: [],
      negativeCodes: [],
      evidence: affectedCodes.length === 0 ? ['无直接监管事件'] : ['受影响标的竞价行情缺失'],
    }
  }
  const positiveCodes = rows
    .filter((row) => (row.quote.changePct ?? quoteGap(row.quote) ?? 0) >= 1)
    .map((row) => row.code)
  const negativeCodes = rows
    .filter((row) => (row.quote.changePct ?? quoteGap(row.quote) ?? 0) <= -5)
    .map((row) => row.code)
  const score = r2(
    ((positiveCodes.length + (rows.length - positiveCodes.length - negativeCodes.length) * 0.5) /
      rows.length) *
      100,
  )
  return {
    state:
      negativeCodes.length / rows.length >= 0.5
        ? 'amplified'
        : positiveCodes.length / rows.length >= 0.5
          ? 'absorbed'
          : 'neutral',
    score,
    affectedCodes,
    positiveCodes,
    negativeCodes,
    evidence: [
      `监管关联${affectedCodes.length}只，正反馈${positiveCodes.length}只，负反馈${negativeCodes.length}只`,
    ],
  }
}

export function applyEventReactionToRiskContext(
  context: HighBoardRiskContext,
  gate?: LadderEventGate | null,
  reaction?: LadderEventReaction | null,
): HighBoardRiskContext {
  if (!gate || !reaction || reaction.state === 'unavailable') return context
  let delta = 0
  const warnings = [...context.warnings]
  if (reaction.state === 'amplified') {
    delta = gate.marketRisk === 'severe' ? -20 : -12
    warnings.push('监管压力与高标负反馈共振，风偏下调')
  } else if (reaction.state === 'absorbed') {
    delta = gate.marketRisk === 'severe' ? 5 : 8
    warnings.push('监管关联标的获得承接，仅减轻风险上限')
  }
  const score = r2(clamp(context.score + delta))
  return {
    ...context,
    score,
    state: appetiteState(score, context.metrics.nuclearRate ?? 0),
    warnings,
  }
}
