import type { DataStatus } from './dataQuality'
import type {
  MarketDataEnvelope,
  MarketDataPurpose,
  MarketDatasetId,
} from './marketDataSource'

export type MarketDataUse = MarketDataPurpose | 'formal'
export type MarketDataSourceTier = 'research-only' | 'shadow' | 'production'

export interface MarketDataQualityPolicy {
  readonly datasetId: MarketDatasetId
  readonly use: MarketDataUse
  readonly allowedStatuses: readonly DataStatus[]
  readonly minCoverage: number
  readonly requireProviderAt: boolean
  readonly requireAsOf: boolean
  readonly allowStale: boolean
  readonly rejectNonProductionSource: boolean
}

export interface MarketDataQualityDecision {
  readonly allowed: boolean
  readonly reasons: string[]
  readonly policy: MarketDataQualityPolicy
}

const STRICT_USES: readonly MarketDataUse[] = ['scoring', 'formal']

const MIN_COVERAGE: Record<MarketDatasetId, number> = {
  quote: 0.98,
  kline: 0.95,
  ladder: 1,
  'limit-pool': 0.98,
  flow: 0.95,
  board: 0.95,
  calendar: 1,
  'research-anomaly': 0,
  'research-valuation': 0,
  'research-financials': 0,
  'research-hotlist': 0,
  'research-boards': 0,
  'research-constituents': 0,
  'research-limit-pool': 0,
}

function isStrictUse(use: MarketDataUse): boolean {
  return STRICT_USES.includes(use)
}

function allowedStatuses(use: MarketDataUse): readonly DataStatus[] {
  if (use === 'display') return ['full', 'partial', 'degraded', 'stale']
  if (use === 'research') return ['full', 'partial', 'degraded', 'stale']
  return ['full']
}

export function marketDataQualityPolicy(
  datasetId: MarketDatasetId,
  use: MarketDataUse,
): MarketDataQualityPolicy {
  const strict = isStrictUse(use)
  return {
    datasetId,
    use,
    allowedStatuses: allowedStatuses(use),
    minCoverage: strict ? MIN_COVERAGE[datasetId] : 0,
    requireProviderAt: strict,
    requireAsOf: strict,
    allowStale: !strict,
    rejectNonProductionSource: strict,
  }
}

export function evaluateMarketDataQuality<T>(
  envelope: MarketDataEnvelope<T>,
  use: MarketDataUse,
  sourceTier?: MarketDataSourceTier,
): MarketDataQualityDecision {
  const policy = marketDataQualityPolicy(envelope.datasetId, use)
  const reasons: string[] = []

  if (envelope.data == null) reasons.push('数据为空')
  if (!policy.allowedStatuses.includes(envelope.status)) {
    reasons.push(`状态 ${envelope.status} 不满足 ${use} 用途要求`)
  }
  if (!policy.allowStale && (envelope.stale || envelope.status === 'stale')) {
    reasons.push('数据已过期')
  }
  if (policy.requireProviderAt && !envelope.providerAt) reasons.push('缺少 providerAt')
  if (policy.requireProviderAt && envelope.providerAt && envelope.receivedAt) {
    const providerMs = Date.parse(envelope.providerAt)
    const receivedMs = Date.parse(envelope.receivedAt)
    if (!Number.isFinite(providerMs) || !Number.isFinite(receivedMs)) {
      reasons.push('providerAt 或 receivedAt 时间格式无效')
    } else if (providerMs > receivedMs) {
      reasons.push('providerAt 晚于 receivedAt')
    }
  }
  if (policy.requireAsOf && !envelope.asOf) reasons.push('缺少 asOf')
  if (policy.rejectNonProductionSource && envelope.source === 'unknown') reasons.push('来源未知')
  if (policy.rejectNonProductionSource && envelope.datasetId.startsWith('research-')) {
    reasons.push(`研究数据集 ${envelope.datasetId} 不允许进入 ${use}`)
  }
  if (policy.minCoverage > 0 && (envelope.coverage == null || envelope.coverage < policy.minCoverage)) {
    reasons.push(`覆盖率 ${(envelope.coverage == null ? 0 : envelope.coverage * 100).toFixed(1)}% < ${(policy.minCoverage * 100).toFixed(1)}%`)
  }
  if (policy.rejectNonProductionSource && (sourceTier === 'research-only' || sourceTier === 'shadow')) {
    reasons.push(`来源层级 ${sourceTier} 不允许进入 ${use}`)
  }

  return { allowed: reasons.length === 0, reasons, policy }
}

export class MarketDataQualityError extends Error {
  readonly decision: MarketDataQualityDecision

  constructor(decision: MarketDataQualityDecision) {
    super(`数据质量闸门拒绝 ${decision.policy.datasetId}/${decision.policy.use}: ${decision.reasons.join('；')}`)
    this.name = 'MarketDataQualityError'
    this.decision = decision
  }
}

export function assertMarketDataQuality<T>(
  envelope: MarketDataEnvelope<T>,
  use: MarketDataUse,
  sourceTier?: MarketDataSourceTier,
): MarketDataQualityDecision {
  const decision = evaluateMarketDataQuality(envelope, use, sourceTier)
  if (!decision.allowed) throw new MarketDataQualityError(decision)
  return decision
}
