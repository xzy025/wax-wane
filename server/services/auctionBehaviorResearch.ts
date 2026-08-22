// 竞价行为研究聚合:把 L1 录制事件(重放器)规整为逐股、逐检查点的支持路径,
// 调用 heuristic-v1 行为引擎生成研究标签。只读、不落盘;无数据返回 unavailable。
//
// 公开源/回放固定 shadow,行为标签统一为 research 展示,不进入候选升级或自动决策。

import { readAuctionReplayDay } from './auctionL1Replay'
import type { AuctionL1Snapshot } from './auctionL1'
import {
  analyzeAuctionBehavior,
  type AuctionBehaviorCheckpoint,
  type AuctionBehaviorConfig,
  type AuctionBehaviorSnapshot,
  type AuctionSupportPoint,
} from './auctionBehavior'
import type { CrossMarketPhase } from './crossMarketMapping'

const CHECKPOINT_BY_PHASE: Record<CrossMarketPhase, AuctionBehaviorCheckpoint[]> = {
  premarket: [],
  auction: [
    'auction-initial',
    'auction-probe',
    'auction-prelock',
    'auction-lock',
    'auction-locked-mid',
    'auction-prefinal',
    'auction-final',
  ],
  open: ['auction-final'],
}

export interface AuctionBehaviorResearch {
  tradeDate: string
  phase: CrossMarketPhase
  snapshotCount: number
  coverage: number
  behaviors: AuctionBehaviorSnapshot[]
  labels: Record<string, number>
  warnings: string[]
}

/**
 * 从某交易日 L1 录制事件构建竞价行为研究结果。
 * 只对同一交易日同标的聚合;缺少关键检查点的标的返回 insufficient-data。
 */
export function buildAuctionBehaviorResearch(args: {
  tradeDate: string
  phase: CrossMarketPhase
  config?: Partial<AuctionBehaviorConfig>
}): AuctionBehaviorResearch {
  const checkpoints = CHECKPOINT_BY_PHASE[args.phase]
  if (!checkpoints.length) {
    return {
      tradeDate: args.tradeDate,
      phase: args.phase,
      snapshotCount: 0,
      coverage: 0,
      behaviors: [],
      labels: {},
      warnings: [`${args.phase} 阶段不产生竞价行为研究`],
    }
  }
  const day = readAuctionReplayDay(args.tradeDate)
  if (!day) {
    return {
      tradeDate: args.tradeDate,
      phase: args.phase,
      snapshotCount: 0,
      coverage: 0,
      behaviors: [],
      labels: {},
      warnings: [`交易日 ${args.tradeDate} 无 L1 竞价录制事件`],
    }
  }
  const bySymbol = new Map<
    string,
    Map<AuctionBehaviorCheckpoint, AuctionL1Snapshot>
  >()
  for (const event of day.events) {
    const snapshot = event.snapshot
    if (snapshot.tradeDate !== args.tradeDate) continue
    const phaseSet = bySymbol.get(snapshot.symbol) ?? new Map<AuctionBehaviorCheckpoint, AuctionL1Snapshot>()
    const checkpoint = checkpointForProviderTimestamp(snapshot)
    if (checkpoint) phaseSet.set(checkpoint, snapshot)
    bySymbol.set(snapshot.symbol, phaseSet)
  }

  const behaviors: AuctionBehaviorSnapshot[] = []
  for (const [symbol, phaseSet] of bySymbol) {
    const points: AuctionSupportPoint[] = []
    let missingKey = false
    for (const checkpoint of checkpoints) {
      const snapshot = phaseSet.get(checkpoint)
      if (snapshot) {
        points.push(auctionPointFromSnapshot(snapshot, checkpoint))
      } else {
        // 关键检查点缺失:记缺失,保留率不计算。
        missingKey = missingKey ||
          (checkpoint === 'auction-prelock' ||
            checkpoint === 'auction-lock' ||
            checkpoint === 'auction-final')
      }
    }
    behaviors.push(
      analyzeAuctionBehavior({
        symbol,
        tradeDate: args.tradeDate,
        points,
        config: args.config,
      }),
    )
    void missingKey
  }

  const labels: Record<string, number> = {}
  for (const behavior of behaviors) {
    for (const label of behavior.labels) {
      labels[label.label] = (labels[label.label] ?? 0) + 1
    }
  }
  const warnings = [
    ...(day.warnings ?? []),
    '竞价行为基于公开源 L1 录制事件，sourceTier=shadow，仅作研究展示',
  ]
  return {
    tradeDate: args.tradeDate,
    phase: args.phase,
    snapshotCount: behaviors.length,
    coverage: behaviors.length,
    behaviors,
    labels,
    warnings,
  }
}

function checkpointForProviderTimestamp(snapshot: AuctionL1Snapshot): AuctionBehaviorCheckpoint | null {
  const time = snapshot.providerTimestamp ?? ''
  if (time.startsWith('09:15')) return 'auction-initial'
  if (time.startsWith('09:17')) return 'auction-probe'
  if (time.startsWith('09:19')) return 'auction-prelock'
  if (time.startsWith('09:20')) return 'auction-lock'
  if (time.startsWith('09:22')) return 'auction-locked-mid'
  if (time.startsWith('09:24')) return 'auction-prefinal'
  if (time.startsWith('09:25')) return 'auction-final'
  return null
}

function auctionPointFromSnapshot(
  snapshot: AuctionL1Snapshot,
  checkpoint: AuctionBehaviorCheckpoint,
): AuctionSupportPoint {
  return {
    checkpoint,
    virtualPrice: snapshot.virtualPrice,
    virtualMatchedQty: snapshot.virtualMatchedQty,
    virtualPriceReturnFromClose:
      snapshot.virtualPrice != null &&
      snapshot.previousClose != null &&
      snapshot.previousClose > 0
        ? ((snapshot.virtualPrice - snapshot.previousClose) / snapshot.previousClose) * 100
        : null,
    unmatchedSide: snapshot.virtualUnmatchedSide ?? 'unknown',
    signedUnmatchedAmount:
      snapshot.virtualPrice != null && snapshot.virtualUnmatchedQty != null
        ? snapshot.virtualUnmatchedSide === 'buy'
          ? snapshot.virtualPrice * snapshot.virtualUnmatchedQty
          : snapshot.virtualUnmatchedSide === 'sell'
            ? -snapshot.virtualPrice * snapshot.virtualUnmatchedQty
            : 0
        : null,
  }
}