// 短线资金竞价行为特征(阶段 4,heuristic-v1)。
//
// 量化约束:
//   matchedAmount         = virtualPrice * virtualMatchedQty
//   signedUnmatchedAmount = buy ? virtualPrice*virtualUnmatchedQty
//                             : sell ? -(price*qty) : 0
//   effectiveBuySupport   = matchedAmount + max(signedUnmatchedAmount, 0)
//   effectiveSellSupply   = matchedAmount + max(-signedUnmatchedAmount, 0)
//   lockRetention         = effectiveBuySupport_{09:20} / preLockPeak
//   finalRetention        = effectiveBuySupport_{09:25} / preLockPeak
//   matchedConversion     = (matchedAmount_{09:25} - matchedAmount_{prelock}) / preLockPeak
//
// 同时生成相对 20 日平均成交额、相对流通市值、全市场百分位、题材内百分位、
// 虚拟价格相对昨收/涨停价位置、匹配量变化、未匹配方向变化、锁价前峰值 /
// 锁定价 / 终值。分母无效、检查点缺失或行情日期不一致时返回 null,不得用 0 代替。
//
// 默认研究标签均标记 `heuristic-v1`,禁止输出真实撤单量/撤单率/席位撤单归因。

export interface AuctionBehaviorConfig {
  /** probe-only:仅解释为「试盘支持未进入最终确认」,不得输出确认撤单语。 */
  PROBE_ONLY_PERCENTILE_MIN: number // 全市场前 Top5%= 百分位 >=95
  PROBE_ONLY_RETENTION_MAX: number // 最终保留率低于 20%
  PROBE_ONLY_RETRACE_PCT: number // 虚拟涨幅回落 >=2 个百分点;或由虚拟涨停回落
  /** locked-confirmed:可撤单阶段前 10%。 */
  LOCKED_CONFIRM_PERCENTILE_MIN: number
  LOCKED_CONFIRM_LOCK_RETENTION_MIN: number // 09:20 保留率 >=70%
  LOCKED_CONFIRM_FINAL_RETENTION_MIN: number // 09:25 保留率 >=60%
  /** absorbed-not-withdrawn:未匹配买盘下降但匹配量显著增长且价格稳定。 */
  ABSORBED_MATCHED_GROWTH_MIN: number // 匹配量相对锁价前增长倍数
  ABSORBED_PRICE_STABLE_PCT: number // 虚拟价格变动幅度上限
  /** late-reinforcement:09:20 后买方支持增强窗口。 */
  REINFORCE_SUPPORT_GROWTH_MIN: number // 09:20->09:25 effectiveBuySupport 增长率下限
  REINFORCE_PRICE_GROWTH_MIN: number // 虚拟价格抬升下限
}

export const AUCTION_BEHAVIOR_DEFAULTS: AuctionBehaviorConfig = {
  PROBE_ONLY_PERCENTILE_MIN: 95,
  PROBE_ONLY_RETENTION_MAX: 0.2,
  PROBE_ONLY_RETRACE_PCT: 2.0,
  LOCKED_CONFIRM_PERCENTILE_MIN: 90,
  LOCKED_CONFIRM_LOCK_RETENTION_MIN: 0.7,
  LOCKED_CONFIRM_FINAL_RETENTION_MIN: 0.6,
  ABSORBED_MATCHED_GROWTH_MIN: 1.5,
  ABSORBED_PRICE_STABLE_PCT: 1.0,
  REINFORCE_SUPPORT_GROWTH_MIN: 0.15,
  REINFORCE_PRICE_GROWTH_MIN: 0.5,
}

export type AuctionBehaviorLabel =
  | 'probe-only'
  | 'locked-confirmed'
  | 'absorbed-not-withdrawn'
  | 'late-reinforcement'
  | 'insufficient-data'

export type AuctionBehaviorCheckpoint =
  | 'auction-initial'
  | 'auction-probe'
  | 'auction-prelock'
  | 'auction-lock'
  | 'auction-locked-mid'
  | 'auction-prefinal'
  | 'auction-final'

export interface AuctionSupportPoint {
  checkpoint: AuctionBehaviorCheckpoint
  virtualPrice: number | null
  virtualMatchedQty: number | null
  virtualPriceReturnFromClose: number | null
  unmatchedSide?: 'buy' | 'sell' | 'balanced' | 'unknown' | null
  /** 带符号未匹配金额(元;买为正,卖为负)。 */
  signedUnmatchedAmount?: number | null
  warning?: string
}

export interface AuctionBehaviorSnapshot {
  symbol: string
  tradeDate: string
  matchDateVerified: boolean
  preLockPeakEffectiveBuySupport: number | null
  lockEffectiveBuySupport: number | null
  finalEffectiveBuySupport: number | null
  lockRetention: number | null
  finalRetention: number | null
  matchedAmountAtPrelock: number | null
  matchedAmountAtFinal: number | null
  matchedConversion: number | null
  finalVirtualPriceReturnFromClose: number | null
  preLockVirtualPriceReturnFromClose: number | null
  finalUnmatchedSide: 'buy' | 'sell' | 'balanced' | 'unknown' | null
  preLockUnmatchedSide: 'buy' | 'sell' | 'balanced' | 'unknown' | null
  points: AuctionSupportPoint[]
  labels: Array<{ label: AuctionBehaviorLabel; detail: string; evidence: string[] }>
  warnings: string[]
  heuristicVersion: 'heuristic-v1'
}

const CHECKPOINT_ORDER: readonly AuctionBehaviorCheckpoint[] = [
  'auction-initial',
  'auction-probe',
  'auction-prelock',
  'auction-lock',
  'auction-locked-mid',
  'auction-prefinal',
  'auction-final',
]

export function r2(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : Math.round(value * 100) / 100
}

function retracePct(from: number | null, to: number | null): number | null {
  if (from == null || to == null) return null
  return from - to
}

/** 是否「由虚拟涨停回落」。 */
function wasVirtualLimitUpAndWeakened(from: number | null, to: number | null): boolean {
  return (from ?? 0) >= 9.5 && (to ?? 0) < 9.5
}

/**
 * 分析单只股票的竞价支持路径。
 * points 缺检查点由调用方补齐 null 或在标签里记 insufficient-data。
 */
export function analyzeAuctionBehavior(args: {
  symbol: string
  tradeDate: string
  points: AuctionSupportPoint[]
  config?: Partial<AuctionBehaviorConfig>
  /** 全市场百分位 0-100;null=不可算(全市场分布缺失) */
  fullMarketPercentile?: number | null
  /** 题材内百分位 0-100;null=不可算 */
  themePercentile?: number | null
}): AuctionBehaviorSnapshot {
  const config: AuctionBehaviorConfig = { ...AUCTION_BEHAVIOR_DEFAULTS, ...args.config }
  const warnings: string[] = []
  if (args.fullMarketPercentile == null) {
    warnings.push('全市场百分位缺失，probe-only/locked-confirmed 抗拉阈值不参与')
  }
  if (args.themePercentile == null) {
    warnings.push('题材内百分位缺失，题材相对强弱不参与')
  }
  const points = [...args.points].sort(
    (a, b) => CHECKPOINT_ORDER.indexOf(a.checkpoint) - CHECKPOINT_ORDER.indexOf(b.checkpoint),
  )
  const matchDateVerified = !!args.tradeDate

  const enriched = points.map((raw) => {
    const matchedAmount =
      raw.virtualPrice != null && raw.virtualMatchedQty != null
        ? raw.virtualPrice * raw.virtualMatchedQty
        : null
    const signed = raw.signedUnmatchedAmount ?? 0
    return {
      point: raw,
      matchedAmount,
      effectiveBuySupport:
        matchedAmount != null ? matchedAmount + Math.max(signed, 0) : null,
      effectiveSellSupply:
        matchedAmount != null ? matchedAmount + Math.max(-signed, 0) : null,
    }
  })
  const byCheckpoint = new Map(enriched.map((row) => [row.point.checkpoint, row]))
  const preLockCandidates = enriched.filter((row) =>
    ['auction-initial', 'auction-probe', 'auction-prelock'].includes(row.point.checkpoint),
  )
  const preLockPeakEffectiveBuySupport = preLockCandidates.length
    ? Math.max(...preLockCandidates.map((row) => row.effectiveBuySupport ?? 0)) || null
    : null
  const lock = byCheckpoint.get('auction-lock')
  const final = byCheckpoint.get('auction-final')
  const prelock = byCheckpoint.get('auction-prelock')

  const lockEffectiveBuySupport = lock?.effectiveBuySupport ?? null
  const finalEffectiveBuySupport = final?.effectiveBuySupport ?? null

  const lockRetention =
    preLockPeakEffectiveBuySupport != null &&
    preLockPeakEffectiveBuySupport > 0 &&
    lockEffectiveBuySupport != null
      ? lockEffectiveBuySupport / preLockPeakEffectiveBuySupport
      : null
  const finalRetention =
    preLockPeakEffectiveBuySupport != null &&
    preLockPeakEffectiveBuySupport > 0 &&
    finalEffectiveBuySupport != null
      ? finalEffectiveBuySupport / preLockPeakEffectiveBuySupport
      : null
  const matchedConversion =
    preLockPeakEffectiveBuySupport != null &&
    preLockPeakEffectiveBuySupport > 0 &&
    final?.matchedAmount != null &&
    prelock?.matchedAmount != null
      ? (final.matchedAmount - prelock.matchedAmount) / preLockPeakEffectiveBuySupport
      : null

  const finalVirtualPriceReturnFromClose = final?.point.virtualPriceReturnFromClose ?? null
  const preLockVirtualPriceReturnFromClose = prelock?.point.virtualPriceReturnFromClose ?? null

  const evidence: Array<{ label: AuctionBehaviorLabel; detail: string; evidence: string[] }> = []

  const missingCritical =
    preLockPeakEffectiveBuySupport == null ||
    lockEffectiveBuySupport == null ||
    finalEffectiveBuySupport == null ||
    final?.point.virtualPrice == null ||
    final?.point.virtualMatchedQty == null

  if (missingCritical) {
    evidence.push({
      label: 'insufficient-data',
      detail: '关键竞价阶段缺失、字段语义未通过或行情日期不一致，未计算保留率',
      evidence: ['prelock/lock/final 支持度或终值缺失'],
    })
  }

  const percentile = args.fullMarketPercentile ?? 0
  const preLockPct = preLockVirtualPriceReturnFromClose
  const finalPct = finalVirtualPriceReturnFromClose

  // probe-only:可撤单阶段支持强度进入全市场前5%，最终保留率<20%，
  // 且虚拟涨幅回落>=2个百分点或由虚拟涨停回落。
  if (
    !missingCritical &&
    percentile >= config.PROBE_ONLY_PERCENTILE_MIN &&
    (finalRetention ?? 0) < config.PROBE_ONLY_RETENTION_MAX &&
    ((retracePct(preLockPct, finalPct) ?? 0) >= config.PROBE_ONLY_RETRACE_PCT ||
      wasVirtualLimitUpAndWeakened(preLockPct, finalPct))
  ) {
    evidence.push({
      label: 'probe-only',
      detail: '试盘支持未进入最终确认',
      evidence: [
        `全市场百分位 ${r2(percentile)}`,
        `最终保留率 ${r2(finalRetention)} < ${config.PROBE_ONLY_RETENTION_MAX}`,
        `虚拟涨幅 ${r2(preLockPct)}% → ${r2(finalPct)}%`,
      ],
    })
  }

  // locked-confirmed:可撤单阶段前10%、09:20 保留率>=70%、09:25 保留率>=60%、终值未明显走弱。
  if (
    !missingCritical &&
    percentile >= config.LOCKED_CONFIRM_PERCENTILE_MIN &&
    (lockRetention ?? 0) >= config.LOCKED_CONFIRM_LOCK_RETENTION_MIN &&
    (finalRetention ?? 0) >= config.LOCKED_CONFIRM_FINAL_RETENTION_MIN &&
    (finalRetention ?? 0) >= (lockRetention ?? 0) - 0.2
  ) {
    evidence.push({
      label: 'locked-confirmed',
      detail: '可撤单阶段进入前10%，09:20 后支持保留并确认',
      evidence: [
        `锁价保留率 ${r2(lockRetention)}`,
        `最终保留率 ${r2(finalRetention)}`,
        `匹配转化 ${r2(matchedConversion)}`,
      ],
    })
  }

  // absorbed-not-withdrawn:未匹配买单下降，但匹配量显著增长且虚拟价格稳定。
  const preLockMatch = prelock?.matchedAmount ?? null
  const finalMatch = final?.matchedAmount ?? null
  const matchedQtyGrowth =
    preLockMatch != null && preLockMatch > 0 && finalMatch != null
      ? finalMatch / preLockMatch
      : null
  const priceStable =
    final?.point.virtualPrice != null &&
    prelock?.point.virtualPrice != null &&
    Math.abs(final.point.virtualPrice - prelock.point.virtualPrice) /
      prelock.point.virtualPrice <=
      config.ABSORBED_PRICE_STABLE_PCT / 100
  if (
    !missingCritical &&
    matchedQtyGrowth != null &&
    matchedQtyGrowth >= config.ABSORBED_MATCHED_GROWTH_MIN &&
    priceStable &&
    (final?.point.signedUnmatchedAmount ?? 0) <= (prelock?.point.signedUnmatchedAmount ?? 0)
  ) {
    evidence.push({
      label: 'absorbed-not-withdrawn',
      detail: '未匹配买盘下降但撮合扩大且价格稳定，疑似卖压被吸收而非真实撤单',
      evidence: [
        `匹配量增长 ${r2(matchedQtyGrowth)}x`,
        `价格变动 ${r2(
          (((final?.point.virtualPrice ?? 0) - (prelock?.point.virtualPrice ?? 0)) /
            (prelock?.point.virtualPrice ?? 1)) *
            100
        )}%`,
      ],
    })
  }

  // late-reinforcement:09:20 后买方支持、虚拟价格同步增强。
  const supportGrowth =
    lockEffectiveBuySupport != null &&
    lockEffectiveBuySupport > 0 &&
    finalEffectiveBuySupport != null
      ? (finalEffectiveBuySupport - lockEffectiveBuySupport) / lockEffectiveBuySupport
      : null
  const priceGain =
    finalPct != null && lock?.point.virtualPriceReturnFromClose != null
      ? finalPct - lock.point.virtualPriceReturnFromClose
      : null
  if (
    !missingCritical &&
    (supportGrowth ?? 0) >= config.REINFORCE_SUPPORT_GROWTH_MIN &&
    (priceGain ?? 0) >= config.REINFORCE_PRICE_GROWTH_MIN
  ) {
    evidence.push({
      label: 'late-reinforcement',
      detail: '09:20 后买方支持与虚拟价格同步增强',
      evidence: [
        `支持增长 ${r2((supportGrowth ?? 0) * 100)}%`,
        `虚拟价格抬升 ${r2(priceGain)}pp`,
      ],
    })
  }

  if (!evidence.length) {
    evidence.push({
      label: 'insufficient-data',
      detail: '未匹配到上述任一研究标签，数据不足或特征未达标',
      evidence: [],
    })
  }

  const labelPriority: AuctionBehaviorLabel[] = [
    'insufficient-data',
    'probe-only',
    'locked-confirmed',
    'absorbed-not-withdrawn',
    'late-reinforcement',
  ]
  const sorted = [...evidence].sort(
    (a, b) => labelPriority.indexOf(a.label) - labelPriority.indexOf(b.label),
  )

  return {
    symbol: args.symbol,
    tradeDate: args.tradeDate,
    matchDateVerified,
    preLockPeakEffectiveBuySupport: r2(preLockPeakEffectiveBuySupport),
    lockEffectiveBuySupport: r2(lockEffectiveBuySupport),
    finalEffectiveBuySupport: r2(finalEffectiveBuySupport),
    lockRetention: r2(lockRetention),
    finalRetention: r2(finalRetention),
    matchedAmountAtPrelock: r2(prelock?.matchedAmount ?? null),
    matchedAmountAtFinal: r2(final?.matchedAmount ?? null),
    matchedConversion: r2(matchedConversion),
    finalVirtualPriceReturnFromClose: r2(finalVirtualPriceReturnFromClose),
    preLockVirtualPriceReturnFromClose: r2(preLockVirtualPriceReturnFromClose),
    finalUnmatchedSide: final?.point.unmatchedSide ?? null,
    preLockUnmatchedSide: prelock?.point.unmatchedSide ?? null,
    points: enriched.map((row) => ({ ...row.point })),
    labels: sorted.map((row) => ({ label: row.label, detail: row.detail, evidence: row.evidence })),
    warnings,
    heuristicVersion: 'heuristic-v1',
  }
}