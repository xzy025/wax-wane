import type { ScreenerLiveQuote } from './screenerScan'
import type {
  AuctionThemeDirection,
  LadderAuctionContext,
  LadderStockAnalysis,
  NextDayCandidateConfirmation,
  NextDayRelayFeedback,
  NextDayRelayItem,
  NextDayRelayPopulationRow,
  NextDayRelayPlan,
  RelayFeedbackSource,
  RelayFeedbackStatus,
  RelayPlanStage,
  RelayRole,
} from './limitLadder'
import type { LadderSentimentQuantSnapshot } from './ladderSentimentQuant'
import { evaluateExecutionEligibility } from './executionEligibility'
import { buildRelayFeedbackEvidence } from './relayFeedbackEvidence'
import { resolveThemeLabel } from './themeTaxonomy'

/**
 * WP3.1 Fix 5: no duplicate parent-theme hardcoding here. Research-parent theme
 * resolution delegates to the versioned themeTaxonomy; provider/as-of are
 * threaded through so the mapping is replayable per signalDate.
 */
function relayResearchTheme(row: LadderStockAnalysis, asof: string): string {
  const candidates = [row.primaryTheme, ...row.themes]
  for (const candidate of candidates) {
    const mapping = resolveThemeLabel(candidate, 'ladder', asof)
    if (mapping.status === 'mapped' && mapping.canonicalName) return mapping.canonicalName
  }
  return row.primaryTheme
}

function relaySource(stage: RelayPlanStage): RelayFeedbackSource {
  if (stage === 'auction') return 'auction-process'
  if (stage === 'open') return 'open-confirmation'
  if (stage === 'settled') return 'settled-analysis'
  return 'unavailable'
}

function relayRelated(
  rows: LadderStockAnalysis[],
  relation: string,
  theme: string,
  quotes: Map<string, ScreenerLiveQuote>,
  tradeDate: string,
) {
  return rows
    .slice()
    .sort((a, b) => b.consecutiveDays - a.consecutiveDays || (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 6)
    .map((row) => {
      const quote = quotes.get(row.code)
      const current = quote?.tradeDate === tradeDate ? quote : null
      return {
        code: row.code,
        name: row.name,
        boards: row.consecutiveDays,
        theme,
        relation,
        changePct: current?.changePct ?? null,
        gapPct:
          current && current.prevClose
            ? ((current.open / current.prevClose) - 1) * 100
            : null,
        onePrice: row.onePrice,
        vwapPct: current && current.volume > 0 && current.amount > 0 ? current.amount / (current.volume * 100) : null,
        vwapHold: current && current.volume > 0 && current.amount > 0 ? current.price >= current.amount / (current.volume * 100) : null,
      }
    })
}

function relayFeedback(args: {
  stage: RelayPlanStage
  signalDate: string
  tradeDate: string
  status: RelayFeedbackStatus
  related: NextDayRelayFeedback['related']
  metrics?: NextDayRelayFeedback['metrics']
  evidence?: string[]
  warnings?: string[]
}): NextDayRelayFeedback {
  return {
    status: args.status,
    stage: args.stage,
    signalDate: args.signalDate,
    tradeDate: args.tradeDate,
    source: relaySource(args.stage),
    related: args.related,
    metrics: args.metrics ?? {},
    evidence: args.evidence ?? [],
    warnings: args.warnings ?? [],
  }
}

function relayEvidenceMetrics(evidence: ReturnType<typeof buildRelayFeedbackEvidence>) {
  return {
    directNumerator: evidence.direct.numerator,
    directDenominator: evidence.direct.denominator,
    directEffectiveN: evidence.direct.effectiveN,
    directPositiveRate: evidence.direct.positiveRate,
    directConfidence: evidence.direct.confidence,
    priorNumerator: evidence.prior.numerator,
    priorDenominator: evidence.prior.denominator,
    priorEffectiveN: evidence.prior.effectiveN,
    priorWindow: evidence.prior.priorWindow,
    priorPosterior: evidence.prior.posterior,
    priorAvailable: evidence.prior.available,
  } as const
}

type RelayBuilderArgs = {
  signalDate: string
  tradeDate: string
  stage: RelayPlanStage
  rows: LadderStockAnalysis[]
  formalRows?: LadderStockAnalysis[]
  quotes?: Map<string, ScreenerLiveQuote>
  auctionContext?: LadderAuctionContext | null
  confirmations?: Map<string, NextDayCandidateConfirmation>
  sentimentQuant?: LadderSentimentQuantSnapshot | null
}
function buildRelayFeedbacks(
  args: RelayBuilderArgs,
  rows: LadderStockAnalysis[],
  quotes: Map<string, ScreenerLiveQuote>,
  sourceWarnings: string[],
) {
  const currentQuote = (code: string): ScreenerLiveQuote | null => {
    const quote = quotes.get(code)
    return quote?.tradeDate === args.tradeDate ? quote : null
  }
  const quoteVwap = (quote: ScreenerLiveQuote | null): number | null =>
    quote && quote.volume > 0 && quote.amount > 0 ? quote.amount / (quote.volume * 100) : null
  const quoteVwapHold = (quote: ScreenerLiveQuote | null): boolean | null => {
    const vwap = quoteVwap(quote)
    return quote && vwap != null ? quote.price >= vwap : null
  }

  const themeFeedback = (row: LadderStockAnalysis): NextDayRelayFeedback => {
const researchTheme = relayResearchTheme(row, args.signalDate)
    const themeRows = rows.filter((item) => relayResearchTheme(item, args.signalDate) === researchTheme)
    const direction = args.auctionContext?.themes.find((item) =>
      item.theme === researchTheme ||
      item.theme === row.primaryTheme ||
      row.themes.includes(item.theme),
    )
    const current = themeRows.map((item) => currentQuote(item.code)).filter(Boolean) as ScreenerLiveQuote[]
    const directEvidence = buildRelayFeedbackEvidence({
      signalDate: args.signalDate,
      observations: current.map((quote) => ({ id: quote.code, positive: quote.changePct >= 0 })),
      sourceCoveragePct: themeRows.length ? current.length / themeRows.length * 100 : null,
    })
    const livePositiveRate = current.length
      ? current.filter((quote) => quote.changePct >= 0).length / current.length * 100
      : null
    const positiveRate = args.stage === 'auction'
      ? (direction?.positiveRate ?? livePositiveRate)
      : (livePositiveRate ?? direction?.positiveRate ?? null)
    const directionCoverage = direction?.coverage == null
      ? null
      : direction.coverage <= 1 ? direction.coverage * 100 : direction.coverage
    const coveragePct = directionCoverage ?? (themeRows.length ? current.length / themeRows.length * 100 : null)
    const directionCoreCode = (direction as (AuctionThemeDirection & { coreCode?: string }) | undefined)?.coreCode
    const core = (directionCoreCode ? themeRows.find((item) => item.code === directionCoreCode) : undefined) ??
      themeRows.slice().sort((a, b) => b.consecutiveDays - a.consecutiveDays || (b.score ?? 0) - (a.score ?? 0))[0]
    const coreQuote = core ? currentQuote(core.code) : null
    const coreVwapHold = quoteVwapHold(coreQuote)
    const assistantCount = args.stage === 'auction'
      ? (direction?.assistantCount ?? null)
      : current.filter((quote) => quote.code !== core?.code && quote.changePct >= 0).length
    const sampleEnough = current.length >= 5
    const coverageEnough = coveragePct != null && coveragePct >= 80
    const coreStrong = !!coreQuote && coreQuote.changePct >= 0 && coreVwapHold === true
    const assistantStrong = (assistantCount ?? 0) >= 1
    let status: RelayFeedbackStatus = 'unavailable'
    if (args.stage !== 'pending' && current.length > 0 && current.length < 5) {
      status = directEvidence.direct.status
    } else if (args.stage !== 'pending' && current.length > 0 && sampleEnough && coverageEnough && positiveRate != null) {
      if (positiveRate < 40 || (!!coreQuote && coreQuote.changePct < 0 && !assistantStrong)) {
        status = 'negative'
      } else if (positiveRate >= 70 && coreStrong && assistantStrong &&
        (!direction?.state || direction.state === 'leading' || direction.state === 'resonant')) {
        status = 'supportive'
      } else {
        status = 'mixed'
      }
    }
    return relayFeedback({
      stage: args.stage,
      signalDate: args.signalDate,
      tradeDate: args.tradeDate,
      status,
      related: relayRelated(themeRows, '同板块反馈', researchTheme, quotes, args.tradeDate),
      metrics: {
        theme: researchTheme,
        primaryTheme: row.primaryTheme,
        maxBoards: themeRows.reduce((max, item) => Math.max(max, item.consecutiveDays), 0),
        twoBoardCount: themeRows.filter((item) => item.consecutiveDays >= 2).length,
        firstBoardCount: themeRows.filter((item) => item.consecutiveDays === 1).length,
        positiveRate,
        sampleCount: current.length,
        themeDirectionScore: direction?.score ?? null,
        assistantCount,
        coreCode: core?.code ?? null,
        coreName: core?.name ?? null,
        coreChangePct: coreQuote?.changePct ?? null,
        coreVwapHold,
        coreOnePrice: direction?.coreOnePrice ?? null,
        coverage: direction?.coverage ?? (current.length ? current.length / Math.max(themeRows.length, 1) : null),
        coveragePct,
        ...relayEvidenceMetrics(directEvidence),
      },
      evidence: [
        '研究父主题：' + researchTheme + '，核心：' + row.name + '（' + row.consecutiveDays + '板）',
        ...(direction?.state ? ['竞价方向：' + direction.state] : []),
        '板块有效样本：' + current.length + '只，覆盖率：' + (coveragePct == null ? '--' : coveragePct.toFixed(1) + '%'),
        ...(themeRows.length > 1 ? ['板块关联标的' + themeRows.length + '只，存在低位扩散样本'] : ['板块暂未形成充分扩散']),
        ...directEvidence.direct.missingReasons,
        ...directEvidence.prior.missingReasons,
      ],
      warnings: sourceWarnings,
    })
  }

  const levelFeedback = (row: LadderStockAnalysis): NextDayRelayFeedback => {
    const lane = row.promotionLane ?? (row.consecutiveDays + '进' + (row.consecutiveDays + 1))
    const laneRows = rows.filter((item) =>
      (item.promotionLane ?? (item.consecutiveDays + '进' + (item.consecutiveDays + 1))) === lane,
    )
    const current = laneRows.map((item) => currentQuote(item.code)).filter(Boolean) as ScreenerLiveQuote[]
    const directEvidence = buildRelayFeedbackEvidence({
      signalDate: args.signalDate,
      observations: current.map((quote) => ({ id: quote.code, positive: quote.changePct >= 0 })),
      sourceCoveragePct: laneRows.length ? current.length / laneRows.length * 100 : null,
    })
    const positiveRate = current.length
      ? current.filter((quote) => quote.changePct >= 0).length / current.length * 100
      : null
    const ordered = laneRows.slice().sort(
      (a, b) =>
        (currentQuote(b.code)?.changePct ?? b.changePct) -
        (currentQuote(a.code)?.changePct ?? a.changePct),
    )
    const strongest = ordered[0]
    const strongestQuote = strongest ? currentQuote(strongest.code) : null
    const candidateQuote = currentQuote(row.code)
    const relativeRank = ordered.findIndex((item) => item.code === row.code) + 1
    const status: RelayFeedbackStatus =
      args.stage === 'pending'
        ? 'unavailable'
        : current.length < 5
          ? directEvidence.direct.status
          : current.length >= 5 && (laneRows.length === 0 || current.length / laneRows.length * 100 < 80)
            ? 'unavailable'
        : positiveRate != null && positiveRate >= 60
          ? 'supportive'
          : positiveRate != null && positiveRate >= 40
            ? 'mixed'
            : 'negative'
    return relayFeedback({
      stage: args.stage,
      signalDate: args.signalDate,
      tradeDate: args.tradeDate,
      status,
      related: relayRelated(laneRows, '同身位反馈', relayResearchTheme(row, args.signalDate), quotes, args.tradeDate),
      metrics: {
        lane,
        sampleCount: current.length,
        totalCount: laneRows.length,
        positiveRate,
        strongestCode: strongest?.code ?? null,
        strongestName: strongest?.name ?? null,
        candidateRelativeRank: relativeRank > 0 ? relativeRank : null,
        candidateChangePct: candidateQuote?.changePct ?? null,
        strongestChangePct: strongestQuote?.changePct ?? null,
        gapToStrongestPct:
          candidateQuote && strongestQuote
            ? candidateQuote.changePct - strongestQuote.changePct
            : null,
        ladderGap: laneRows.length <= 1,
        directCoveragePct: directEvidence.sourceCoveragePct,
        ...relayEvidenceMetrics(directEvidence),
      },
      evidence: [
        ...(strongest
          ? [
              '同身位最强：' + strongest.name,
              '候选相对强弱：' + (relativeRank > 0 ? '第' + relativeRank : '无当前数据'),
            ]
          : []),
        ...directEvidence.direct.missingReasons,
        ...directEvidence.prior.missingReasons,
      ],
      warnings: sourceWarnings,
    })
  }

  return { themeFeedback, levelFeedback }
}
function strictExecutionGateReasons(args: {
  stage: RelayPlanStage
  row: LadderStockAnalysis
  role: RelayRole
  tradeDate: string
  quotes: Map<string, ScreenerLiveQuote>
  confirmation?: NextDayCandidateConfirmation
  themeFeedback: NextDayRelayFeedback
  sameLevelFeedback: NextDayRelayFeedback
  sentimentQuant?: LadderSentimentQuantSnapshot | null
}): string[] {
  const quote = args.quotes.get(args.row.code)
  const currentQuote = quote?.tradeDate === args.tradeDate ? quote : null
  const confirmation = args.confirmation
  const sharedEligibility = evaluateExecutionEligibility({
    stage: args.stage,
    tradeDate: args.tradeDate,
    quote: currentQuote
      ? { tradeDate: currentQuote.tradeDate, volume: currentQuote.volume, amount: currentQuote.amount }
      : null,
    confirmationState: confirmation?.state ?? null,
    inaccessible: confirmation?.inaccessible ?? args.row.onePrice,
    marketGateState: confirmation?.marketGateState,
    themePermissionState: confirmation?.themePermission?.state,
    auctionSnapshotAvailable: args.stage !== 'pending' && confirmation?.auctionScore != null,
    openSnapshotAvailable:
      (args.stage === 'open' || args.stage === 'settled') && confirmation?.openScore != null,
    openingConfirmationGate: confirmation?.openingConfirmationGate,
    technicalAvailable: args.row.technical.available && args.row.technical.settled,
    riskBudgetAvailable: false,
    relayGateState: args.sentimentQuant?.gateState,
  })
  const reasons: string[] = [...sharedEligibility.reasons]
  const metricNumber = (feedback: NextDayRelayFeedback, key: string): number | null => {
    const value = feedback.metrics[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
  if (args.stage === 'pending') reasons.push('当前阶段尚未产生竞价/开盘快照')
  if (args.stage === 'auction') reasons.push('尚未完成09:35过程快照')
  if (args.sentimentQuant?.gateState === 'JOINT_CLIMAX') reasons.push('双高潮次日NO_NEW_RELAY，禁止形成新接力')
  if (args.sentimentQuant?.gateState === 'UNAVAILABLE') reasons.push('关键情绪数据缺失，接力闸门不可用')
  if (!currentQuote || !confirmation || confirmation.tradeDate !== args.tradeDate) {
    reasons.push('缺少目标交易日有效快照或确认记录')
  }
  if (args.role !== 'relay-candidate') reasons.push('当前定位不是可接力候选')
  if (args.row.onePrice) reasons.push('一字锚点不可达，不进入实战接力')
  if (!(args.row.technical?.available ?? false)) reasons.push('技术数据不可用')
  if (!confirmation) {
    reasons.push('缺少正式确认记录')
  } else {
    if (confirmation.inaccessible) reasons.push('不可达或存在硬风险否决')
    if (confirmation.openGapPct != null && confirmation.openGapPct > 8) reasons.push('开盘涨幅超过8%，触发风险门控')
    const qualified = args.stage === 'auction'
      ? confirmation.state === 'auction-qualified'
      : confirmation.state === 'confirmed'
    if (!qualified) reasons.push('原始确认状态未达到本阶段门槛')
    if (confirmation.marketGateState === 'frozen') reasons.push('市场闸门为frozen')
    if (confirmation.marketGateState === 'unavailable') reasons.push('市场闸门数据不可用')
    if (confirmation.marketGateState == null) reasons.push('缺少市场闸门状态')
    if (args.stage !== 'pending' && confirmation.auctionScore == null) reasons.push('缺少09:25竞价快照')
    if (args.stage === 'open' && confirmation.openingConfirmationGate !== 'passed' && confirmation.openingConfirmationGate !== 'not-required') {
      reasons.push('缺少09:35过程确认快照')
    }
    if (confirmation.themePermission?.state !== 'allowed') {
      reasons.push('题材许可为' + (confirmation.themePermission?.state ?? 'unavailable'))
    }
  }
  if (!currentQuote || currentQuote.volume <= 0 || currentQuote.amount <= 0) {
    reasons.push('候选VWAP不可用')
  } else {
    const vwap = currentQuote.amount / (currentQuote.volume * 100)
    if (currentQuote.price < vwap) reasons.push('候选价格弱于VWAP')
  }
  const themeSample = metricNumber(args.themeFeedback, 'sampleCount')
  const themeCoverage = metricNumber(args.themeFeedback, 'coveragePct')
  const themePositive = metricNumber(args.themeFeedback, 'positiveRate')
  const themeCoreVwap = args.themeFeedback.metrics.coreVwapHold
  const themeAssistants = metricNumber(args.themeFeedback, 'assistantCount')
  if (args.themeFeedback.status !== 'supportive') reasons.push('板块反馈为' + args.themeFeedback.status + '，需supportive')
  if (themeSample == null || themeSample < 5) reasons.push('板块有效样本不足5只')
  if (themeCoverage == null || themeCoverage < 80) reasons.push('板块覆盖率不足80%')
  if (themePositive == null || themePositive < 70) reasons.push('板块正反馈率不足70%')
  if (themeCoreVwap !== true) reasons.push('板块核心未站上VWAP')
  if (themeAssistants == null || themeAssistants < 1) reasons.push('板块缺少同步走强助攻')
  const laneSample = metricNumber(args.sameLevelFeedback, 'sampleCount')
  const lanePositive = metricNumber(args.sameLevelFeedback, 'positiveRate')
  const laneRank = metricNumber(args.sameLevelFeedback, 'candidateRelativeRank')
  const laneTotal = metricNumber(args.sameLevelFeedback, 'totalCount')
  if (args.sameLevelFeedback.status !== 'supportive') reasons.push('同身位反馈为' + args.sameLevelFeedback.status + '，需supportive')
  if (laneSample == null || laneSample < 5) reasons.push('同身位有效样本不足5只')
  if (lanePositive == null || lanePositive < 60) reasons.push('同身位正反馈率不足60%')
  if (laneRank == null || laneTotal == null || laneRank > Math.ceil(laneTotal / 2)) reasons.push('候选同身位排名未进入前50%')
  reasons.push('风险预算未配置，研究信号不产生交易许可')
  return Array.from(new Set(reasons))
}
export function buildNextDayRelayPlan(args: RelayBuilderArgs): NextDayRelayPlan {
  const formalCodes = new Set((args.formalRows ?? []).map((row) => row.code))
const parentThemes = new Set((args.formalRows ?? []).map((row) => relayResearchTheme(row, args.signalDate)))

  const rankedRows = args.rows
    .filter((row) =>
      formalCodes.has(row.code) ||
      parentThemes.has(relayResearchTheme(row, args.signalDate)) ||
      row.onePrice ||
      row.role === 'space-leader' ||
      row.role === 'theme-leader' ||
      row.consecutiveDays >= 2,
    )
    .sort((a, b) => b.consecutiveDays - a.consecutiveDays || (b.score ?? 0) - (a.score ?? 0))
  const rows = rankedRows.slice(0, 24)
  const quotes = args.stage === 'pending'
    ? new Map<string, ScreenerLiveQuote>()
    : (args.quotes ?? new Map<string, ScreenerLiveQuote>())
  const sourceWarnings = args.stage === 'pending'
    ? ['当前阶段尚未产生本交易日竞价/开盘快照，三类反馈均为 unavailable']
    : []
  const feedbacks = buildRelayFeedbacks(args, args.rows, quotes, sourceWarnings)

  const items = rows.map((row): NextDayRelayItem => {
    const researchTheme = relayResearchTheme(row, args.signalDate)
    const anchor = row.onePrice || row.role === 'space-leader'
    const medicineCore =
      researchTheme === '医药' &&
      (row.role === 'theme-leader' || row.primaryTheme === '疫苗概念')
    const role: RelayRole = anchor
      ? 'emotion-anchor'
      : formalCodes.has(row.code)
        ? 'relay-candidate'
        : medicineCore || row.role === 'theme-leader'
          ? 'theme-core-observer'
          : 'fallback-observer'
    const researchPriority =
      role === 'relay-candidate'
        ? (row.consecutiveDays >= 2 ? 10 : 20)
        : role === 'theme-core-observer'
          ? 30
          : role === 'fallback-observer'
            ? 60
            : 90
    const confirmation = args.confirmations?.get(row.code)
    const themeFeedback = feedbacks.themeFeedback(row)
    const sameLevelFeedback = feedbacks.levelFeedback(row)
    const executionGateReasons = strictExecutionGateReasons({
      stage: args.stage,
      row,
      role,
      tradeDate: args.tradeDate,
      quotes,
      confirmation,
      themeFeedback,
      sameLevelFeedback,
      sentimentQuant: args.sentimentQuant,
    })
    const executionEligible = executionGateReasons.length === 0
    const lane = row.promotionLane ?? (row.consecutiveDays + '进' + (row.consecutiveDays + 1))
    const researchReasons = [
      '原始状态：' + row.state + '，正式分数：' + (row.score == null ? '--' : row.score.toFixed(1)),
      '研究定位：' + role,
      '研究父主题：' + researchTheme,
      ...(row.primaryTheme !== researchTheme
        ? ['保留原始题材' + row.primaryTheme + '，研究层归入' + researchTheme]
        : []),
      ...(anchor ? ['一字/空间高标仅作为情绪或空间锚，不得直接接力'] : []),
    ]
    const confirmationConditions = [
      researchTheme + '板块出现核心与至少一只同题材标的同步增强',
      '同身位' + lane + '相对强度不落后',
    ]
    const invalidationReasons = [
      row.mainRisk,
      ...(themeFeedback.status === 'negative' ? [researchTheme + '板块反馈转弱'] : []),
      ...(sameLevelFeedback.status === 'negative' ? ['同身位多数走弱或出现卡位'] : []),
    ].filter(Boolean)
    const noChaseReasons = [
      ...(anchor ? ['一字高标只做情绪观察，缺少可执行换手'] : []),
      ...(args.stage === 'pending' ? ['竞价数据尚未生成，当前不能确认接力条件'] : []),
      ...(executionGateReasons.length ? executionGateReasons.slice(0, 5) : []),
      ...(executionEligible ? [] : ['研究层不等同于交易许可，需满足正式数据门控']),
    ]
    return {
      code: row.code,
      name: row.name,
      boards: row.consecutiveDays,
      promotionLane: lane,
      primaryTheme: row.primaryTheme,
      researchTheme,
      baseState: row.state,
      relayRole: role,
      researchPriority,
      executionEligible,
      executionGateReasons,
      researchReasons,
      confirmationConditions,
      invalidationReasons,
      noChaseReasons,
      themeFeedback,
      sameLevelFeedback,
    }
  }).sort(
    (a, b) =>
      a.researchPriority - b.researchPriority ||
      b.boards - a.boards ||
      a.code.localeCompare(b.code),
  )

  return {
    status: 'research-score',
    signalDate: args.signalDate,
    tradeDate: args.tradeDate,
    generatedAt: new Date().toISOString(),
    stage: args.stage,
    items,
    population: args.rows.map((row): NextDayRelayPopulationRow => ({
      code: row.code,
      name: row.name,
      promotionLane: row.promotionLane ?? (row.consecutiveDays + '进' + (row.consecutiveDays + 1)),
      fullLanePool: row.fullLanePool ?? true,
      hardEligible: row.hardEligible ?? row.state !== 'exclude',
      ranked: rankedRows.some((rankedRow) => rankedRow.code === row.code),
      quotaSelected: row.quotaSelected ?? formalCodes.has(row.code),
      confirmed: args.confirmations?.has(row.code)
        ? ['confirmed', 'auction-qualified'].includes(args.confirmations.get(row.code)?.state ?? '')
        : null,
      filled: null,
    })),
    warnings: Array.from(new Set([
      ...sourceWarnings,
      ...(args.auctionContext?.warnings ?? []),
    ])),
  }
}
