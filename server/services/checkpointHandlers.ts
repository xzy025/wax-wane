// 检查点采集句柄:把精确检查点接到既有/渐进的采集流程。
//
// 阶段边界:
//   - premarket 阶段:封装隔夜/日韩/竞价前外部环境,日韩状态向量在第 3 批升级;
//   - auction 阶段:采集候选池公开源快照,写入 L1 录制原始事件(jsonl.gz),派生检查点在后面批次;
//   - open 阶段:采集 A 股盘口同刻;
//   - settled 阶段:复用既有结算层。
//
// 不伪造成功:捕获不到数据时 sourceStatus=unavailable 并带说明;公开源固定 shadow。

import { fetchIndexQuotes, type IndexQuote, type IndexSpec } from './emQuotes'
import {
  fetchSinaBatchQuotes,
  fetchTencentBatchQuotes,
} from './screenerLiveQuotes'
import type { ScreenerLiveQuote } from './screenerScan'
import { exchangeFromCode } from './auctionL1Provider'
import type { AuctionL1Snapshot } from './auctionL1'
import { decodeAuctionLevel1 } from './auctionL1'
import { appendAuctionReplayEvents } from './auctionL1Replay'
import type { CheckpointHandlers, SchedulerCheckpoint, SchedulerSourceStatus } from './schedulerCheckpoints'
import { checkpointSpec } from './schedulerCheckpoints'

const ASIA_INDEX_SPECS: IndexSpec[] = [
  { secid: '100.N225', code: 'N225' },
  { secid: '100.KS11', code: 'KS11' },
  { secid: '100.TOPX', code: 'TOPX' },
  { secid: '100.KQ11', code: 'KQ11' },
]

interface AuctionCandidateUniverse {
  codes: string[]
  source: string
}

/** 竞价候选池:优先使用日韩/竞价相关的高关注标的(缺实时池时为空)。 */
export function resolveAuctionUniverse(
  candidates?: AuctionCandidateUniverse,
): AuctionCandidateUniverse {
  if (candidates && candidates.codes.length) return candidates
  return { codes: [], source: 'empty-plan' }
}

const ASIA_CHECKPOINTS = new Set<SchedulerCheckpoint>([
  'asia-open',
  'asia-0830',
  'asia-0900',
])

const AUCTION_CHECKPOINTS = new Set<SchedulerCheckpoint>([
  'auction-initial',
  'auction-probe',
  'auction-prelock',
  'auction-lock',
  'auction-locked-mid',
  'auction-prefinal',
  'auction-final',
])

const OPEN_CHECKPOINTS = new Set<SchedulerCheckpoint>([
  'open-initial',
  'open-confirm',
])

const EXTERNAL_CHECKPOINTS = new Set<SchedulerCheckpoint>([
  'overnight-context',
  'pre-auction',
])

function phaseTimestamp(checkpoint: SchedulerCheckpoint): string {
  const spec = checkpointSpec(checkpoint)
  const hh = String(Math.floor(spec.atSec / 3600)).padStart(2, '0')
  const mm = String(Math.floor((spec.atSec % 3600) / 60)).padStart(2, '0')
  return `${hh}:${mm}:00`
}

async function captureAsiaQuotes(): Promise<{
  quotes: IndexQuote[]
  provider: string
  capturedAt: string
  warnings: string[]
}> {
  const capturedAt = new Date().toISOString()
  try {
    const quotes = await fetchIndexQuotes(ASIA_INDEX_SPECS)
    if (!quotes.length) {
      return { quotes: [], provider: 'eastmoney-asia', capturedAt, warnings: ['日韩指数行情缺失'] }
    }
    const warnings: string[] = []
    if (quotes.length < 2) warnings.push('日韩指数覆盖不足')
    return { quotes, provider: 'eastmoney-asia', capturedAt, warnings }
  } catch (error) {
    return {
      quotes: [],
      provider: 'eastmoney-asia',
      capturedAt,
      warnings: [error instanceof Error ? error.message : '日韩行情抓取失败'],
    }
  }
}

function sourceStatusForQuotes(
  quotes: Array<IndexQuote | ScreenerLiveQuote>,
  expected: number,
): SchedulerSourceStatus {
  if (!quotes.length) return 'unavailable'
  if (quotes.length < expected) return 'degraded'
  return 'full'
}

/** 竞价快照 → 录制原始事件(Batch 1 回放器),重复 tick 幂等去重。 */
async function recordAuctionSnapshots(
  tradeDate: string,
  quotes: ScreenerLiveQuote[],
  checkpoint: SchedulerCheckpoint,
): Promise<{ recorded: number; snapshots: AuctionL1Snapshot[] }> {
  const marketPhase =
    checkpoint === 'auction-initial' ||
    checkpoint === 'auction-probe' ||
    checkpoint === 'auction-prelock'
      ? 'auction-cancellable'
      : 'auction-locked'
  const receivedAt = new Date().toISOString()
  const snapshots: AuctionL1Snapshot[] = quotes
    .filter((quote) => quote.tradeDate === tradeDate)
    .map((quote) =>
      decodeAuctionLevel1({
        tradeDate,
        symbol: quote.code,
        exchange: exchangeFromCode(quote.code),
        provider: quote.source,
        providerTimestamp: quote.quoteTime,
        receivedAt,
        previousClose: quote.prevClose,
        marketPhase,
        rawBidPrices: [quote.bid1Price ?? null],
        rawBidQty: [quote.bid1Volume ?? null],
        rawAskPrices: [quote.ask1Price ?? null],
        rawAskQty: [quote.ask1Volume ?? null],
        sourceTier: 'shadow',
      }),
    )
  const recorded = await appendAuctionReplayEvents(tradeDate, snapshots)
  return { recorded, snapshots }
}

async function captureAuctionQuotes(
  tradeDate: string,
  checkpoint: SchedulerCheckpoint,
  universe: string[],
): Promise<{
  quotes: ScreenerLiveQuote[]
  sourceStatus: SchedulerSourceStatus
  provider: string
  providerTimestamp: string | null
  dataAsOf: string
  warnings: string[]
}> {
  const dataAsOf = new Date().toISOString()
  if (!universe.length) {
    return {
      quotes: [],
      sourceStatus: 'unavailable',
      provider: 'shadow-public',
      providerTimestamp: null,
      dataAsOf,
      warnings: ['竞价候选池为空，未采集公开源快照'],
    }
  }
  const [sinaResult, tencentResult] = await Promise.allSettled([
    fetchSinaBatchQuotes(universe),
    fetchTencentBatchQuotes(universe),
  ])
  const sina = sinaResult.status === 'fulfilled' ? sinaResult.value : []
  const tencent = tencentResult.status === 'fulfilled' ? tencentResult.value : []
  const merged = new Map<string, ScreenerLiveQuote>()
  for (const quote of sina) merged.set(quote.code, quote)
  for (const quote of tencent) merged.set(quote.code, quote)
  const quotes = Array.from(merged.values())
  const warnings: string[] = []
  if (!quotes.length) warnings.push('公开源竞价行情全部失败')
  if (!sina.length) warnings.push('Sina 竞价行情缺失')
  if (!tencent.length) warnings.push('腾讯竞价行情缺失')
  const sourceStatus = sourceStatusForQuotes(quotes, universe.length)
  return {
    quotes,
    sourceStatus,
    provider: 'shadow-public',
    providerTimestamp: quotes[0]?.quoteTime ?? null,
    dataAsOf,
    warnings,
  }
}

const OPEN_UNIVERSE_CODES = ['600000', '000001', '399001', '000300']

/**
 * 默认检查点句柄:未覆盖的特殊检查点在后续批次补全,本批返回空结果 + unavailable。
 */
export const defaultCheckpointHandlers: CheckpointHandlers = async (checkpoint, tradeDate) => {
  const spec = checkpointSpec(checkpoint)

  if (ASIA_CHECKPOINTS.has(checkpoint)) {
    const quoteResult = await captureAsiaQuotes()
    return {
      status:
        quoteResult.quotes.length >= 2
          ? 'success'
          : quoteResult.quotes.length
            ? 'degraded'
            : 'failed',
      sourceStatus: quoteResult.quotes.length >= 2 ? 'full' : quoteResult.quotes.length ? 'degraded' : 'unavailable',
      provider: quoteResult.provider,
      providerTimestamp: phaseTimestamp(checkpoint),
      dataAsOf: quoteResult.capturedAt,
      warnings: [
        ...quoteResult.warnings,
        '日韩量化状态向量将在后续批次接入，当前仅保存基础指数行情',
      ],
    }
  }

  if (EXTERNAL_CHECKPOINTS.has(checkpoint)) {
    return {
      status: 'degraded',
      sourceStatus: 'unavailable',
      provider: 'external-pending',
      providerTimestamp: phaseTimestamp(checkpoint),
      dataAsOf: new Date().toISOString(),
      warnings: [
        '隔夜环境固化将在跨市场批次接入；本检查点已按时触发，未伪造外部环境',
      ],
    }
  }

  if (AUCTION_CHECKPOINTS.has(checkpoint)) {
    const universe = resolveAuctionUniverse()
    const capture = await captureAuctionQuotes(tradeDate, checkpoint, universe.codes)
    if (capture.quotes.length) {
      await recordAuctionSnapshots(tradeDate, capture.quotes, checkpoint)
    }
    return {
      status:
        capture.sourceStatus === 'full'
          ? 'success'
          : capture.sourceStatus === 'degraded'
            ? 'degraded'
            : 'failed',
      sourceStatus: capture.sourceStatus,
      provider: capture.provider,
      providerTimestamp: capture.providerTimestamp,
      dataAsOf: capture.dataAsOf,
      warnings: [
        ...capture.warnings,
        `${spec.label}检查点准时触发；公开源固定 shadow，不进入正式候选升级`,
      ],
    }
  }

  if (OPEN_CHECKPOINTS.has(checkpoint)) {
    const univ = OPEN_UNIVERSE_CODES
    const capture = await captureAuctionQuotes(tradeDate, checkpoint, univ)
    return {
      status:
        capture.sourceStatus === 'full'
          ? 'success'
          : capture.sourceStatus === 'degraded'
            ? 'degraded'
            : 'failed',
      sourceStatus: capture.sourceStatus,
      provider: capture.provider,
      providerTimestamp: capture.providerTimestamp,
      dataAsOf: capture.dataAsOf,
      warnings: [
        ...capture.warnings,
        `${spec.label}检查点采用固定指数池作为过渡采集，正式开盘承接在后续批次接入`,
      ],
    }
  }

  return {
    status: 'degraded',
    sourceStatus: 'unavailable',
    provider: 'pending',
    providerTimestamp: phaseTimestamp(checkpoint),
    dataAsOf: new Date().toISOString(),
    warnings: [`${checkpoint} 检查点已登记，派生数据将在后续批次接入`],
  }
}