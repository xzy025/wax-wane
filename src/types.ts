export interface TradeGroup {
  id: string
  code: string
  name: string
  opened: string
  closed: string | null
  pnl: number
  returnRate: number
  days: number
  totalFee: number
  strategy: string
  mistakes: string[]
  status: string
}

export interface MetricCard {
  key: string
  value: string
  positive?: boolean
  tone: 'positive' | 'neutral' | 'warning'
  icon: React.ComponentType<{ size?: number; 'aria-hidden'?: string }>
}

export type LedgerRow = [string, string, string, string, string, string, string, string]

export type MistakeStat = [string, number, number]

export interface Translation {
  appSubtitle: string
  nav: Record<string, string>
  titles: Record<string, string>
  range: { label: string; week: string; month: string; quarter: string }
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
}

export interface ReviewNote {
  buyReason: string
  sellReason: string
  executionReview: string
  lesson: string
}

export interface ParsedTrade {
  tradeDate: string
  stockCode: string
  stockName: string
  side: 'buy' | 'sell'
  quantity: number
  price: number
  grossAmount: number
  commission: number
  stampTax: number
  transferFee: number
  otherFee: number
  netAmount: number
  raw: Record<string, string>
  validationStatus?: 'valid' | 'warning' | 'error'
  validationMessage?: string
}

export interface PositionSnapshot {
  stockCode: string
  stockName: string
  quantity: number
  avgCost: number
  costBasis: number
  realizedPnl: number
  totalFees: number
}
