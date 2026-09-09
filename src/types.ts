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
    category: { label: string; theme: string; industry: string; concept: string }
    source: { label: string; all: string; direct: string; reconstructed: string }
    quality: {
      direct: string
      reconstructed: string
      coverage: string
      degraded: string
      source: string
      date: string
      sectors: string
      volumeProgress: string
    }
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
    shortOutperformShare: string
    legend: string
    legendQuickTiny: string
    lastUpdated: string
    quads: {
      hs: { tag: string; meaning: string }
      ls: { tag: string; meaning: string }
      hw: { tag: string; meaning: string }
      lw: { tag: string; meaning: string }
    }
    card: { long: string; today: string; position: string; volume: string; stocks: string }
    outperform: string
    underperform: string
    drill: {
      title: string
      hint: string
      close: string
      loading: string
      loadFail: string
      empty: string
      breakout: string
      trigger: string
      topMovers: string
      strategyHits: string
      allMembers: string
      hideMembers: string
    }
    structure: {
      title: string
      limitUp: string
      limitDown: string
      advance: string
      decline: string
      breakRate: string
      topHs: string
      topLs: string
      generatedAt: string
      loadFail: string
    }
    review: {
      title: string
      secGlobal: string
      secNews: string
      secCalendar: string
      secMarket: string
      expand: string
      collapse: string
      more: string
      dragonBuy: string
      dragonSell: string
      calJin10: string
      calBuiltin: string
      calMixed: string
      approx: string
      approxTip: string
      prev: string
      cons: string
      turnover: string
      cached: string
      noNarrative: string
      loadFail: string
      rbTag: string
      rbNote: string
      rbDownDays: string
      rbDays: string
      rbRebound: string
      rbVolX: string
      rbPioneers: string
      rbNoFbt: string
      rbNoPioneers: string
      rbResilient: string
      rbCumRel: string
      rbCounterDays: string
      rbBoardsUnit: string
      rbOpensUnit: string
    }
    tempo: {
      title: string
      cellLaunch: string
      cellAdjust: string
      qAboveIndex: string
      qVolUp: string
      qVolDown: string
      qResilient: string
      nSoloStrong: string
      nSplit: string
      nInflow: string
      pin: string
      unpin: string
      srcIndustry: string
      srcConcept: string
      srcTheme: string
      badgeArchive: string
      badgeRecon: string
      reconTip: string
      empty: string
      loadFail: string
      legend: string
      sourceDisclosure: string
      sourceEastmoney: string
      sourceState: {
        em: string
        kpl: string
        live: string
        recon: string
        down: string
        off: string
      }
      rhythm: {
        title: string
        benchmark: string
        active: string
        strongToday: string
        breadth: {
          expansion: string
          rotation: string
          contraction: string
        }
        groups: {
          first: { title: string; hint: string }
          second: { title: string; hint: string }
          core: { title: string; hint: string }
          mature: { title: string; hint: string }
          reset: { title: string; hint: string }
        }
        stages: {
          launch1: string
          reflow1: string
          day2: string
          day3: string
          late: string
          divergence: string
          reset: string
          adjust: string
        }
        guideTitle: string
        flow: string
        order: string
        caveat: string
        boardLinkTitle: string
      }
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
  intel: {
    tabFlash: string
    tabResearch: string
    flash: {
      desc: string
      refresh: string
      loadFail: string
      empty: string
      important: string
      lastUpdated: string
      autoNote: string
      sourceDown: string
    }
    research: {
      desc: string
      refresh: string
      loadFail: string
      empty: string
      dirHint: string
      dateLabel: string
      digestTitle: string
      digestPending: string
      hotIndustries: string
      keyStocks: string
      consensus: string
      reportCount: string
      pending: string
      extractFailed: string
      analyzing: string
      llmDown: string
      rating: string
      targetPrice: string
      industry: string
      brokerage: string
      thesis: string
      catalysts: string
      risks: string
      expand: string
      collapse: string
      truncatedNote: string
      analyzedAt: string
      feishuSyncing: string
      feishuSynced: string
      feishuJustNow: string
      feishuMinAgo: string
      feishuError: string
    }
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
  ladder: {
    single: string
    list: string
    refresh: string
    import: string
    date: string
    allThemes: string
    firstBoard: string
    firstSealShort: string
    boards: string
    empty: string
    loading: string
    loadFail: string
    archiveUnavailable: string
    archiveUnavailableHint: string
    importOk: string
    importFail: string
    limitUp: string
    limitDown: string
    breakRate: string
    promotionRate: string
    maxBoards: string
    source: string
    quality: string
    degraded: string
    archived: string
    firstBoardScan: {
      title: string
      subtitle: string
      statuses: Record<'live' | 'closed' | 'unavailable', string>
      window: string
      minutes: string
      scanCount: string
      newCount: string
      lastScan: string
      stExcluded: string
      firstSeal: string
      turnover: string
      amount: string
      price: string
      empty: string
      closedEmpty: string
      unavailableEmpty: string
    }
    v2: {
      lanes: string
      research: string
      dominantLane: string
      dominant: string
      supply: string
      historyRate: string
      themeCoverage: string
      sealStability: string
      candidates: string
      candidateScope: string
      candidateEmpty: string
      stage: string
      stages: Record<'pending' | 'auction' | 'open' | 'settled', string>
      nextStates: Record<
        'pending' | 'auction-qualified' | 'confirmed' | 'waiting' | 'blocked' | 'rejected',
        string
      >
      auctionSnapshotMissing: string
      lane: string
      promotionScore: string
      tradabilityScore: string
      dragonIdentity: string
      baseScore: string
      auctionScore: string
      openScore: string
      liveScore: string
      turnover: string
      legacyEvidence: string
      promotionEvidence: string
      tradabilityEvidence: string
      factorLane: string
      factorPopularity: string
      factorAccessibility: string
      factorTurnoverCapacity: string
      factorLiquidity: string
      factorStructure: string
      factorReopen: string
      floatCap: string
      amountFloatRatio: string
      effectiveTurnover: string
      amountPercentile: string
      popularity: string
      followers: string
      auctionDirection: string
      processSamples: string
      coverage: string
      marketStyle: string
      unavailable: string
      topFiveConcentration: string
      weightedShare: string
      confidence: string
      dataSources: string
      themeAuctionRank: string
      directionState: string
      score: string
      positiveRate: string
      weightedGap: string
      coreAssist: string
      assists: string
      topAuctionAmount: string
      auctionStates: Record<
        'leading' | 'resonant' | 'isolated-one-price' | 'weak' | 'unavailable',
        string
      >
      outcomeReview: string
      formalPromotionRate: string
      waitOpenRate: string
      population: string
      outcomeState: string
      tradable: string
      openClose: string
      populations: Record<'formal' | 'wait-open', string>
      outcomeStates: Record<'promoted' | 'failed' | 'unresolved', string>
      yes: string
      no: string
      auctionBriefs: string
      auctionBriefSchedule: string
      briefPhases: Record<'auction-final' | 'open-confirmation', string>
      deliveryStates: Record<'pending' | 'sent' | 'failed' | 'disabled' | 'not-configured', string>
      strength: string
      direction: string
      generationMode: string
      generationModes: Record<'rules' | 'rules-ai-polished', string>
      briefDetails: string
      briefPending: string
    }
    v4: {
      roleMap: string
      roleMapSubtitle: string
      heightTiers: Record<'high' | 'middle' | 'low', string>
      marketRoles: Record<'space-leader' | 'co-space-leader' | 'high-anchor' | 'normal', string>
      themeRoles: Record<
        'theme-position-leader' | 'co-theme-position-leader' | 'core-assistant' | 'follower',
        string
      >
      lifecycles: Record<
        'acceleration' | 'consensus' | 'divergence' | 'broken-maintain' | 'repair-relaunch' | 'ebb',
        string
      >
      positionDelta: string
      followers: string
      riskRadar: string
      riskRadarSubtitle: string
      marketRisk: string
      marketRiskStates: Record<'normal' | 'elevated' | 'severe', string>
      eventActions: Record<'hard-block' | 'risk-cap' | 'theme-adjust' | 'informational', string>
      noRiskEvents: string
      highBoardRisk: string
      highBoardSubtitle: string
      appetiteStates: Record<'expansion' | 'divergence' | 'contraction' | 'panic', string>
      nuclearRate: string
      onePriceRetention: string
      vwapHold: string
      resealRate: string
      highLowSwitch: string
      eventReaction: string
      reactionStates: Record<'absorbed' | 'neutral' | 'amplified' | 'unavailable', string>
      rawRate: string
      adjustedRate: string
      sample: string
      confidenceLevels: Record<'low' | 'medium' | 'high', string>
    }
    v5: {
      marketGate: string
      marketGateSubtitle: string
      gateStates: Record<'normal' | 'cautious' | 'restricted' | 'frozen', string>
      externalRisk: string
      domesticRisk: string
      domesticConfirmed: string
      notConfirmed: string
      overnightContext: string
      asiaContext: string
      macroContext: string
      themePermissions: string
      permissionStates: Record<'allowed' | 'conditional' | 'blocked', string>
      riskClasses: Record<'high-beta' | 'defensive' | 'cyclical' | 'neutral', string>
      independent: string
      environmentAdjustment: string
      decisionScore: string
      noSnapshot: string
    }
    v6: {
      repairStructure: string
      repairSubtitle: string
      repairStates: Record<
        | 'unconfirmed'
        | 'broad-repair'
        | 'weight-led-repair'
        | 'small-cap-repair'
        | 'mixed'
        | 'risk-continuation',
        string
      >
      largeCap: string
      smallCap: string
      sizeSpread: string
      advanceRate: string
      largeCapAmountShare: string
      confidence: string
      displayOnly: string
      sizeBucket: string
      sizeBuckets: Record<'small' | 'mid' | 'large' | 'unknown', string>
      liquidityStyleAdjustment: string
    }
    v7?: {
      expectation: string
      expectationSubtitle: string
      sequence: string
      sequenceDataQuality: string
      qingshan: string
      primaryPath: string
      probabilities: string
      confidence: string
      expectedOpen: string
      expectedTouch: string
      expectedReopen: string
      allowed: string
      prohibited: string
      match: string
      matchStatuses: Record<'met' | 'partial' | 'violated' | 'unavailable', string>
      sentimentQuant: string
      sentimentSubtitle: string
      emotionScore: string
      marketScore: string
      combinedScore: string
      relayWeight: string
      gate: string
      gateStates: Record<'NORMAL' | 'HOT' | 'JOINT_CLIMAX' | 'UNAVAILABLE', string>
      crowding: string
      unavailable: string
      noNewRelay: string
      researchOnly: string
    }
    badges: {
      margin: string
      chiNext: string
      onePrice: string
      tBoard: string
    }
    filters: {
      state: string
      board: string
      height: string
      all: string
      main: string
      twenty: string
    }
    states: Record<'candidate' | 'waiting' | 'observe' | 'exclude', string>
    phases: Record<'ice' | 'repair' | 'climax' | 'ebb' | 'unavailable', string>
    roles: Record<
      'space-leader' | 'theme-leader' | 'first-pioneer' | 'mid-ladder' | 'follower',
      string
    >
    shapes: Record<
      | 'low-platform-breakout'
      | 'platform-breakout'
      | 'trend-platform'
      | 'low-oversold-reversal'
      | 'event-reversal'
      | 'high-new-high'
      | 'non-platform-breakout'
      | 'insufficient',
      string
    >
    table: {
      rank: string
      stock: string
      state: string
      role: string
      theme: string
      shape: string
      volume: string
      position: string
      firstSeal: string
      opens: string
      trigger: string
      risk: string
    }
    detail: {
      title: string
      close: string
      score: string
      market: string
      theme: string
      ladder: string
      technical: string
      fundFlow: string
      seal: string
      trigger: string
      invalidation: string
      evidence: string
      warnings: string
      penalty: string
      amountRatio: string
      range20: string
      position120: string
      episodeReturn: string
      onset: string
      limitReason: string
      kaipanlaSource: string
      reasonLoading: string
      reasonUnavailable: string
      marketRole: string
      hotReason: string
    }
  }
  agent: {
    title: string
    description: string
    featureReview: string
    featureAnalysis: string
    featureTheory: string
    featureSearch: string
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
    ta: {
      score: string
      bias: { demand: string; supply: string; neutral: string }
      distribution: string
      distributionNew: string
      trendTemplate: string
      todayVol: string
      dist52: string
      relStrength: string
      counterTrend: string
      atrStop: string
      deltaVs: string
      maLost: string
      maRegain: string
      live: string
      settled: string
      narrativeTitle: string
      history: string
      latest: string
      bench: { hs300: string; chinext: string; star50: string }
      noArchive: string
      nzi: {
        title: string
        dayN: string
        windowTag: string
        grade: string
        cont: string
        target: string
        holdRisk: string
        roleStrength: {
          F: { strong: string; sym: string; weak: string; plain: string }
          H: { strong: string; sym: string; weak: string; plain: string }
        }
      }
    }
  }
  screener: {
    title: string
    titlePullback: string
    desc: string
    scan: string
    scanTip: string
    intradayScan: string
    intradayScanTip: string
    intradayScanUnavailable: string
    intradayScanning: string
    closeScan: string
    closeScanTip: string
    closeScanUnavailable: string
    closeScanning: string
    intradayProvisional: string
    closeConfirmed: string
    provisionalBadge: string
    quoteAsOf: string
    qualitySources: string
    quoteCoverage: string
    historyCoverage: string
    crossAgreement: string
    retainedSnapshot: string
    dailySaved: string
    dailySaveFail: string
    dailySaveStageScan: string
    dailySaveStageForward: string
    dailySaveStageStructure: string
    dailySaveStageReview: string
    scanning: string
    lastUpdated: string
    dataAsof: string
    scanAsof: string
    scannedAt: string
    marketDataLagged: string
    marketDataCoverage: string
    cached: string
    degraded: string
    staleScanning: string
    staleHint: string
    generatedAt: string
    loadFail: string
    empty: string
    universe: string
    scanned: string
    truncatedNote: string
    disclaimer: string
    tabs: {
      newHigh: string
      pullback: string
      highDiv: string
      volBreak: string
      bigBreak: string
      fundRes: string
      bhold: string
      trendNew: string
      trendWatch: string
      accum: string
      accumNew: string
      accumPileStall: string
      accumContinuous: string
      accumOther: string
      resilience: string
      instAccum: string
      orgSurvey: string
      track: string
    }
    groups: {
      breakout: string
      breakoutCont: string
      trigger: string
      watch: string
      persistentHigh: string
      pullback: string
      highdiv: string
      volbreak: string
      bigbreak: string
      bigbreakWatch: string
      fundres: string
      bhold: string
      bholdWatch: string
      trendnew: string
      trendwatch: string
      accum: string
      resilience: string
      instAccum: string
      orgSurvey: string
    }
    phNote: string
    resilienceDesc: string
    resilienceCard: {
      benchmark: string
      relative: string
      vwap: string
      closeLocation: string
      mainInflow: string
      fundingAdjustment: string
      volumeRatio: string
      turnover: string
      lhb: string
      research: string
    }
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
      hsBadge: string
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
    bbDesc: string
    bbCard: {
      resistance: string
      breakPct: string
      attempts: string
      span: string
      volume: string
      volumeConfirmation: string
      volumeLevel: { weak: string; effective: string; strong: string }
      historyVolume: string
      floorRise: string
      closeStrength: string
      entry: string
      stop: string
      target: string
      rr: string
      plan: string
      times: string
      days: string
      recordVolume: string
      limitUp: string
      locked: string
      noMa: string
      watchState: string
      nearBand: string
      insideBand: string
      watchVolume: string
      bullish: string
      rising: string
      startDate: string
      watchNote: string
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
    frBoard: {
      title: string
      disclaimer: string
      backtestNote: string
      empty: string
      colRank: string
      colName: string
      colPrice: string
      colChange: string
      colNetInflow: string
      colTurnRank: string
      colInRank: string
      colOrgs: string
      colLhb: string
    }
    ta: { title: string; demand: string; supply: string; neutral: string; distribution: string }
    bhDesc: string
    bhCard: {
      pole: string
      consol: string
      trigger: string
      planBreak: string
      buy: string
      stop: string
      target: string
      rr: string
      plan: string
      pos: string
      days: string
      stepUp: string
      hold: string
      watchNote: string
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
    twDesc: string
    twCard: {
      nh: string
      dist: string
      ma5hold: string
      ext: string
      rs: string
      days: string
      monitorNote: string
    }
    acDesc: string
    acCard: {
      vol: string
      volumeState: string
      newVolume: string
      continuous: string
      volumePileStall: string
      demandDominant: string
      flat: string
      flatOk: string
      consol: string
      trigger: string
      pos: string
      days: string
      monitorNote: string
      stairNote: string
      box: string
      stair: string
      bullish: string
      rising: string
      locked: string
      holderDown: string
      holderUp: string
      holderTip: string
    }
    iaDesc: string
    iaCard: {
      flow5: string
      flow10: string
      flow30: string
      persistence: string
      position: string
      rs20: string
      survey: string
      confirmed: string
      watch: string
      confirm: string
      stop: string
      target: string
      days: string
      orgs: string
      disclaimer: string
      empty: string
      refresh: string
    }
    osDesc: string
    osBoard: {
      title: string
      disclaimer: string
      empty: string
      colRank: string
      colName: string
      colPrice: string
      colChange: string
      colOrgs: string
      colSurveyDays: string
      colNetInflow: string
      colLatest: string
    }
    crossTitle: string
    crossDesc: string
    crossEmpty: string
    regime: {
      attack: string
      caution: string
      retreat: string
      unavailable: string
      temp: string
      limitUp: string
      breakRate: string
      market: string
      strong: string
      neutral: string
      weak: string
      targetR: string
      marketChg: string
    }
    card: {
      price: string
      pivot: string
      entry: string
      add: string
      confirmAt: string
      confirmTip: string
      triggerNote: string
      instConfirmed: string
      entryTip: string
      stop: string
      target: string
      dist: string
      hi52: string
      score: string
      appearStreak: string
      appearStreakTip: string
      liftBan: string
      liftBanTip: string
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
      relStr: string
      relStrChinext: string
      relStrStar: string
      counterTrend: string
    }
    track: {
      desc: string
      signalRange: string
      snapshots: string
      snapshotsUnit: string
      hold: string
      holdUnit: string
      tracked: string
      trackedUnit: string
      generatedAt: string
      refresh: string
      refreshing: string
      empty: string
      loadFail: string
      overall: string
      colStrategy: string
      colLiveExpR: string
      colBtExpR: string
      colDelta: string
      colLivePF: string
      colWin: string
      colHold: string
      colCounts: string
      colFloatR: string
      pending: string
      staleShort: string
      skippedShort: string
      status: { closed: string; open: string; pending: string; skipped: string }
      reason: {
        target: string
        'target-gap': string
        stop: string
        'stop-gap': string
        time: string
        trail: string
        open: string
        pending: string
        stale: string
        skipped: string
      }
      pickSignal: string
      pickExit: string
      held: string
      heldUnit: string
      expand: string
      collapse: string
      na: string
      methodNote: string
      matured: string
      prematureNote: string
      confidence: { low: string; medium: string }
      segments: {
        title: string
        regimeTitle: string
        taBias: string
        lhb: string
        board: string
        scoreTier: string
        regimePhase: string
        marketTrend: string
        taBiasLabel: { demand: string; supply: string; neutral: string }
        lhbLabel: { inst: string; none: string }
        scoreTierLabel: { high: string; mid: string; low: string }
        regimePhaseLabel: { attack: string; caution: string; retreat: string }
        marketTrendLabel: { strong: string; neutral: string; weak: string }
      }
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
