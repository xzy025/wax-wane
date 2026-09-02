// 盘前工作台聚合(阶段 5):把调度检查点、日韩状态、竞价行为研究合并为一个
// 只读工作台载荷,供 LadderView 时间轴与分层展示。不触发抓取、不写盘。

import { todayShanghai } from '../lib/time'
import {
  listCheckpointStatuses,
  nextCheckpointAt,
  CHECKPOINT_SCHEDULE,
} from './schedulerCheckpoints'
import { readAsiaMarketState } from './asiaMarketCapture'
import type { AsiaCheckpoint, AsiaMarketSnapshot } from './asiaMarketState'
import { buildAuctionBehaviorResearch } from './auctionBehaviorResearch'
import type { AuctionBehaviorResearch } from './auctionBehaviorResearch'

export interface PremarketWorkbenchPayload {
  tradeDate: string
  generatedAt: string
  scheduler: {
    nextWindow: { checkpoint: string; atSecondsOfDay: number } | null
    checkpoints: typeof CHECKPOINT_SCHEDULE
    lastRuns: ReturnType<typeof listCheckpointStatuses>
  }
  asia: Partial<Record<AsiaCheckpoint, AsiaMarketSnapshot | null>>
  auction: AuctionBehaviorResearch
}

const ASIA_CHECKPOINTS: AsiaCheckpoint[] = [
  'asia-open',
  'asia-0830',
  'asia-0900',
  'pre-auction',
]

export function buildPremarketWorkbench(): PremarketWorkbenchPayload {
  const tradeDate = todayShanghai()
  const generatedAt = new Date().toISOString()
  const lastRuns = listCheckpointStatuses(tradeDate)
  const next = nextCheckpointAt(Date.now())
  const asia = Object.fromEntries(
    ASIA_CHECKPOINTS.map((checkpoint) => [
      checkpoint,
      readAsiaMarketState(tradeDate, checkpoint),
    ]),
  ) as Partial<Record<AsiaCheckpoint, AsiaMarketSnapshot | null>>
  const auction = buildAuctionBehaviorResearch({
    tradeDate,
    phase: 'auction',
  })
  return {
    tradeDate,
    generatedAt,
    scheduler: {
      nextWindow: next ? { checkpoint: next.checkpoint, atSecondsOfDay: next.atSec } : null,
      checkpoints: CHECKPOINT_SCHEDULE,
      lastRuns,
    },
    asia,
    auction,
  }
}