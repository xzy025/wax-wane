/** Known behavioral mistake tags used across the application. */
export type MistakeTag =
  | 'Early profit taking'
  | 'No plan'
  | 'Late stop loss'
  | 'Oversized position'
  | 'Chasing high'

/** Review status for a closed trade group. */
export type TradeStatus = 'Reviewed' | 'Follow up' | 'Not reviewed'

/** Trading strategy tags. */
export type TradeStrategy = '' | 'Pullback' | 'Index beta' | 'Breakout' | 'Reversal'

/**
 * A trade group represents one complete stock-level trading cycle
 * (from first buy to full close, or an ongoing open position).
 *
 * @example
 * ```ts
 * const group: TradeGroup = {
 *   id: 'tg-001', code: '300750', name: 'CATL',
 *   opened: '2026-03-04', closed: '2026-03-18',
 *   pnl: 8460, returnRate: 9.4, days: 14, totalFee: 324.6,
 *   strategy: 'Pullback', mistakes: ['Early profit taking'],
 *   status: 'Reviewed',
 * }
 * ```
 */
export interface TradeGroup {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly opened: string
  readonly closed: string | null
  readonly pnl: number
  readonly returnRate: number
  readonly days: number
  readonly totalFee: number
  strategy: TradeStrategy
  mistakes: readonly MistakeTag[]
  status: TradeStatus
}

/** Keys for the four metric cards displayed on the dashboard. */
export type MetricKey = 'realizedPnl' | 'winRate' | 'payoff' | 'fees'

export interface MetricCard {
  readonly key: MetricKey
  readonly value: string
  readonly positive?: boolean
  readonly tone: 'positive' | 'neutral' | 'warning'
  readonly icon: React.ComponentType<Record<string, unknown>>
}

/**
 * A single row in the trade ledger table.
 * Indices: 0=date, 1=code, 2=name, 3=side, 4=qty, 5=price, 6=amount, 7=fees
 */
export type LedgerRow = readonly [
  date: string,
  code: string,
  name: string,
  side: string,
  qty: string,
  price: string,
  amount: string,
  fees: string,
]

/**
 * A mistake statistic entry: [mistake tag, occurrence count, total PnL impact].
 */
export type MistakeStat = readonly [tag: string, count: number, pnl: number]

export interface Translation {
  appSubtitle: string
  nav: Record<string, string>
  titles: Record<string, string>
  range: { label: string; week: string; month: string; quarter: string; year: string }
  language: { label: string; zh: string; en: string }
  settings: string
  sidebar: { costLabel: string; costMode: string; costHint: string }
  metrics: Record<string, string[]>
  dashboard: {
    equityTitle: string
    equityDesc: string
    riskTitle: string
    riskDesc: string
    recentTitle: string
    recentDesc: string
    viewAll: string
    alerts: string[][]
  }
  import: {
    uploadTitle: string
    uploadDesc: string
    selectFile: string
    pipelineTitle: string
    pipelineDesc: string
    steps: string[][]
    mappingTitle: string
    mappingDesc: string
    mappingRows: string[][]
  }
  ledger: {
    title: string
    desc: string
    search: string
    filter: string
    headers: string[]
    side: Record<string, string>
  }
  reviews: {
    groupTitle: string
    groupDesc: string
    open: string
    dayUnit: string
    buyReason: string
    sellReason: string
    executionReview: string
    lesson: string
    noMistake: string
    placeholders: { buy: string; sell: string; execution: string; lesson: string }
  }
  analytics: {
    mistakeTitle: string
    mistakeDesc: string
    holdingTitle: string
    holdingDesc: string
    summaryTitle: string
    summaryDesc: string
    summaryText: string
    scoreLabel: string
  }
  tradeTable: { headers: string[] }
  chartLabels: string[]
  periods: string[]
  strategies: Record<string, string>
  mistakes: Record<string, string>
  statuses: Record<string, string>
  stocks: Record<string, string>
  ai: {
    chatTitle: string
    chatPlaceholder: string
    inputPlaceholder: string
    send: string
    clearChat: string
    thinking: string
    error: string
  }
  macro: {
    us10y: string
    us5y: string
    gold: string
    dxy: string
    usdcny: string
    crude: string
    vix: string
    lastUpdated: string
    loading: string
    error: string
    retry: string
    noApiKey: string
    apiKeyLabel: string
    apiKeyPlaceholder: string
    dataSource: string
  }
  datePicker: {
    today: string
    yesterday: string
  }
  ashare: {
    shIndex: string
    szIndex: string
    chiNext: string
    star50: string
    bse50: string
    limitUp: string
    limitDown: string
    advance: string
    decline: string
    adRatio: string
    profitability: string
    profitabilityGood: string
    profitabilityOk: string
    profitabilityBad: string
    promotionRate: string
    newHigh: string
    nearHigh: string
    totalVolume: string
    lastUpdated: string
    loading: string
    error: string
    retry: string
  }
  hk: {
    hsi: string
    hstech: string
    chinaInternet: string
    lastUpdated: string
    loading: string
    error: string
    retry: string
    closed: string
  }
  us: {
    dji: string
    ixic: string
    nvda: string
    lite: string
    amd: string
    tsm: string
    lastUpdated: string
    loading: string
    error: string
    retry: string
    closed: string
  }
}

export interface ReviewNote {
  readonly buyReason: string
  readonly sellReason: string
  readonly executionReview: string
  readonly lesson: string
}

export interface ParsedTrade {
  readonly tradeDate: string
  readonly stockCode: string
  readonly stockName: string
  readonly side: 'buy' | 'sell'
  readonly quantity: number
  readonly price: number
  readonly grossAmount: number
  readonly commission: number
  readonly stampTax: number
  readonly transferFee: number
  readonly otherFee: number
  readonly netAmount: number
  readonly raw: Readonly<Record<string, string>>
  readonly validationStatus?: 'valid' | 'warning' | 'error'
  readonly validationMessage?: string
}

export interface PositionSnapshot {
  readonly stockCode: string
  readonly stockName: string
  readonly quantity: number
  readonly avgCost: number
  readonly costBasis: number
  readonly realizedPnl: number
  readonly totalFees: number
}
