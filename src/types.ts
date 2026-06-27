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

export interface Translation {
  appSubtitle: string
  nav: Record<string, string>
  titles: Record<string, string>
  range: { label: string; week: string; month: string; quarter: string; year: string }
  language: { label: string; zh: string; en: string }
  rotation: {
    searchPlaceholder: string
    category: { label: string; industry: string; concept: string }
    longLabel: string
    shortLabel: string
    dayN: string
    refresh: string
    scanning: string
    loadFail: string
    empty: string
    boardsUnit: string
    recent: string
    up: string
    down: string
    shortUpShare: string
    legend: string
    lastUpdated: string
    quads: {
      hs: { tag: string; meaning: string }
      ls: { tag: string; meaning: string }
      hw: { tag: string; meaning: string }
      lw: { tag: string; meaning: string }
    }
    card: { long: string; today: string }
    drill: {
      title: string
      hint: string
      close: string
      loading: string
      loadFail: string
      empty: string
      breakout: string
      trigger: string
    }
  }
  themes: {
    heatTitle: string
    heatDesc: string
    compareTitle: string
    refresh: string
    loadFail: string
    noData: string
    upDown: string
    lastUpdated: string
    limitUp: string
    boardsSuffix: string
    divergence: string
    maxBoardStat: string
    sortAsc: string
    sortDesc: string
    overseasTitle: string
    markets: { US: string; JP: string; KR: string; HK: string; TW: string }
    cols: {
      name: string
      price: string
      change: string
      pe: string
      pb: string
      mcap: string
      d60: string
      ytd: string
      tag: string
    }
  }
  moneyflow: {
    title: string
    hint: string
    tradeDate: string
    datePick: string
    lastUpdated: string
    refresh: string
    loadFail: string
    noData: string
    stocksUnit: string
    summary: {
      inflowCount: string
      outflowCount: string
      totalInflow: string
      totalOutflow: string
    }
    filter: { all: string; inflow: string; outflow: string }
    periodLabel: string
    periods: { today: string; d3: string; d5: string }
    daysOnBoard: string
    daysSuffix: string
    conceptAll: string
    buyTitle: string
    sellTitle: string
    dealAmt: string
    reasonLabel: string
    buySeats: string
    sellSeats: string
    quote: string
  }
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
    alertOpenLoss: { title: string; text: string }
    alertLateStop: { title: string; text: string }
    alertFeeDrag: { title: string; text: string }
    alertLossStreak: { title: string; text: string }
    alertNone: { title: string; text: string }
    chartPnlLabel: string
    chartDateLabel: string
    noClosedTrades: string
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
    parseFailed: string
    unknownError: string
    parsedTitle: string
    parsedDesc: string
    confirmImport: string
    doneTitle: string
    doneCount: string
    doneWarnings: string
    importMore: string
    columnMappingTitle: string
    columnMappingDesc: string
    noColumnSelected: string
    required: string
    optional: string
    previewTitle: string
    validationWarnings: string
    moreWarnings: string
  }
  ledger: {
    title: string
    desc: string
    search: string
    filter: string
    headers: string[]
    side: Record<string, string>
    filterAll: string
    save: string
    cancel: string
    edit: string
    emptyNoData: string
    emptyNoMatch: string
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
    noScoreData: string
    scoreOverview: string
    scorePenalties: string
    penaltyJoin: string
    scoreNoPenalty: string
    scoreHigh: string
    scoreMid: string
    scoreLow: string
    report: {
      weekLabel: string
      monthLabel: string
      title: string
      overview: string
      closedLine: string
      winRateLine: string
      totalPnlLine: string
      totalFeesLine: string
      topWinners: string
      topLosers: string
      stockLabel: string
      daysUnit: string
      mistakes: string
      mistakeLine: string
      scoreLine: string
      colMetric: string
      colValue: string
      closedTrades: string
      winRate: string
      totalPnl: string
      totalFees: string
      tradesUnit: string
      colStock: string
      colPnl: string
      colHolding: string
    }
    quant: {
      title: string
      desc: string
      noData: string
      sharpe: string
      maxDrawdown: string
      annualized: string
      payoff: string
      profitFactor: string
      expectancy: string
      gradeExcellent: string
      gradeGood: string
      gradeLow: string
      ddGood: string
      ddMedium: string
      ddHigh: string
      annHigh: string
      annPositive: string
      annNegative: string
      pfProfit: string
      pfLoss: string
      expPositive: string
      expNegative: string
    }
    chartTimes: string
    chartTimesLabel: string
    chartLinkedPnl: string
    chartTrades: string
    chartTradesLabel: string
    weekly: string
    monthly: string
    copyReport: string
    noPeriodData: string
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
    prevHigh: string
    high52w: string
    highsHint: string
    atHigh: string
    gapToHigh: string
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
    addPlaceholder: string
    addStock: string
    removeStock: string
    lastUpdated: string
    loading: string
    error: string
    retry: string
    closed: string
  }
  us: {
    dji: string
    ixic: string
    spx: string
    addPlaceholder: string
    addStock: string
    removeStock: string
    lastUpdated: string
    loading: string
    error: string
    retry: string
    closed: string
  }
  sentiment: {
    title: string
    temperature: string
    limitUp: string
    limitDown: string
    breakRate: string
    riseFall: string
    yestLimitPerf: string
    cold: string
    cool: string
    warm: string
    hot: string
    overheated: string
    source: string
    lastUpdated: string
    loading: string
    error: string
    retry: string
  }
  holdings: {
    tabChat: string
    tabHoldings: string
    refresh: string
    refreshing: string
    add: string
    empty: string
    emptyHint: string
    shares: string
    cost: string
    price: string
    today: string
    unrealized: string
    marketValue: string
    stopLoss: string
    target: string
    volumeRatio: string
    deepDive: string
    collapse: string
    analyzing: string
    manual: string
    edit: string
    remove: string
    quoteError: string
    market: { closed: string; open: string; weekend: string; pre: string; before: string }
    actions: {
      hold: string
      add: string
      reduce: string
      takeProfit: string
      stopLoss: string
      sell: string
      watch: string
    }
    signalLabels: { bullish: string; bearish: string; neutral: string }
    summary: {
      title: string
      holdingsCount: string
      risk: string
      plan: string
      worst: string
      noRisk: string
      noPlan: string
      today: string
    }
    editor: {
      title: string
      editTitle: string
      code: string
      name: string
      quantity: string
      avgCost: string
      codePlaceholder: string
      namePlaceholder: string
      save: string
      cancel: string
      invalid: string
    }
  }
  screener: {
    title: string
    titlePullback: string
    desc: string
    scan: string
    scanning: string
    lastUpdated: string
    dataAsof: string
    cached: string
    loadFail: string
    empty: string
    universe: string
    scanned: string
    truncatedNote: string
    disclaimer: string
    tabs: { newHigh: string; pullback: string; highDiv: string; volBreak: string; fundRes: string; bhold: string; trendNew: string }
    groups: { breakout: string; trigger: string; watch: string; persistentHigh: string; pullback: string; highdiv: string; volbreak: string; fundres: string; bhold: string; trendnew: string }
    phNote: string
    hdDesc: string
    hdCard: {
      nh: string
      dry: string
      doji: string
      retrace: string
      plan: string
      buy: string
      stop: string
      target: string
      pos: string
      rr: string
      path: string
      ma5ok: string
      w2s: string
      wick: string
      consol: string
      turnover: string
      days: string
    }
    pbDesc: string
    pbCard: {
      priorHigh: string
      arcLow: string
      retrace: string
      daysSince: string
      recover: string
      leader: string
      arcUp: string
      cross: string
      volSpike: string
    }
    vbDesc: string
    vbCard: {
      hi: string
      burst: string
      avg: string
      buy: string
      target: string
      stop: string
      rr: string
      plan: string
      pos: string
      days: string
      ma5ok: string
    }
    frDesc: string
    frCard: {
      survey: string
      orgs: string
      vol: string
      mom: string
      gap: string
      buy: string
      target: string
      stop: string
      rr: string
      plan: string
      pos: string
      hold: string
      days: string
      ma5ok: string
      fundFlow: string
      inflow: string
      rank: string
      netBuy: string
      turnRank: string
      inRank: string
    }
    ta: { title: string; demand: string; supply: string; neutral: string; distribution: string }
    bhDesc: string
    bhCard: {
      pole: string
      consol: string
      trigger: string
      buy: string
      stop: string
      target: string
      rr: string
      plan: string
      pos: string
      days: string
      stepUp: string
      hold: string
    }
    tnDesc: string
    tnCard: {
      nh: string
      dist: string
      rs: string
      entry: string
      ma: string
      stop: string
      target: string
      rr: string
      plan: string
      buy: string
      pos: string
      times: string
    }
    crossTitle: string
    crossDesc: string
    crossEmpty: string
    regime: {
      attack: string
      caution: string
      retreat: string
      temp: string
      limitUp: string
      breakRate: string
      market: string
      strong: string
      neutral: string
      weak: string
      targetR: string
    }
    card: {
      price: string
      pivot: string
      entry: string
      add: string
      probe: string
      addMain: string
      entryTip: string
      probeTip: string
      stop: string
      target: string
      dist: string
      hi52: string
      score: string
      appearStreak: string
      appearStreakTip: string
      vol: string
      trend: string
      volDry: string
      atrContract: string
      breakoutVol: string
      lhb: string
      lhbInst: string
      lhbNet: string
      lhbHot: string
      lhbBoth: string
      lhbDays: string
      pivR: string
      pivS: string
      board: string
      quad: { hs: string; ls: string; hw: string; lw: string }
      bo: string
      tr: string
    }
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
