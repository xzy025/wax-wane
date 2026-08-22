// 竞价 Level-1 录制文件回放器。
//
// 目标:开发、回放和自动测试不依赖实时行情。原始事件按交易日记为不可变
// jsonl.gz 文件;派生结果使用独立 JSON。全部通过临时文件加原子替换归档,
// 失败不得覆盖 last-good。
//
// 公开源即使字段形态吻合也只作 shadow 研究展示;正式路径待授权源凭证确定后
// 新增 AuthorizedL1Provider。录制根可用 AUCTION_L1_REPLAY_ROOT 注入以便测试。
//
// 每行是一条 `AuctionL1ReplayEvent`(原始快照事件,含 provider timestamp / receivedAt)。
// ReplayAuctionProvider 读取某交易日全部事件,按事件顺序推向 onSnapshot 处理器。

import { createGzip, createGunzip, gunzipSync } from 'zlib'
import { existsSync, mkdirSync, renameSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  type AuctionL1Snapshot,
  type AuctionMarketDataProvider,
  type AuctionProviderTier,
  type ProviderHealth,
} from './auctionL1'

export const AUCTION_L1_REPLAY_VERSION = 'auction-l1-replay-v1'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** 录制根:默认 docs/auction-l1/raw,可用 AUCTION_L1_REPLAY_ROOT 注入以便测试。 */
export function auctionL1ReplayRoot(): string {
  return resolve(
    process.env.AUCTION_L1_REPLAY_ROOT ??
      join(__dirname, '..', '..', 'docs', 'auction-l1', 'raw'),
  )
}

/** 每行事件 = 一条全网/单标的竞价快照(供写入录制文件的原始结构)。 */
export interface AuctionL1ReplayEvent {
  version: 'auction-l1-replay-v1'
  tradeDate: string
  ts: number
  snapshot: AuctionL1Snapshot
}

/** 一个交易日的录制文件读回结果。 */
export interface AuctionL1ReplayDay {
  tradeDate: string
  events: AuctionL1ReplayEvent[]
  warnings: string[]
}

export function replayDayPath(tradeDate: string): string {
  return join(auctionL1ReplayRoot(), `${tradeDate}.jsonl.gz`)
}

function assertSafeDate(tradeDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    throw new Error(`tradeDate 必须是 YYYY-MM-DD，收到 ${tradeDate}`)
  }
}

async function gzip(input: string): Promise<Buffer> {
  const gunziper = createGzip()
  const chunks: Buffer[] = []
  const goto = new Promise<void>((resolvePromise, reject) => {
    gunziper.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    gunziper.on('error', reject)
    gunziper.on('end', () => resolvePromise())
  })
  gunziper.write(input)
  gunziper.end()
  await goto
  return Buffer.concat(chunks)
}

async function gunzip(input: Buffer): Promise<Buffer> {
  const gunzipStream = createGunzip()
  const chunks: Buffer[] = []
  const done = new Promise<void>((resolvePromise, reject) => {
    gunzipStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
    gunzipStream.on('error', reject)
    gunzipStream.on('end', () => resolvePromise())
  })
  gunzipStream.write(input)
  gunzipStream.end()
  await done
  return Buffer.concat(chunks)
}

/**
 * 追加一组竞价快照到当日录制文件(jsonl.gz)。幂等:同一天/标/源/时间/接收时间的
 * 事件不重复;文件通过临时文件加原子替换写入,失败不改动原文件。
 */
export async function appendAuctionReplayEvents(
  tradeDate: string,
  snapshots: AuctionL1Snapshot[],
): Promise<number> {
  assertSafeDate(tradeDate)
  if (!snapshots.length) return 0
  const root = auctionL1ReplayRoot()
  mkdirSync(root, { recursive: true })
  const target = replayDayPath(tradeDate)
  const prior = readAuctionReplayDay(tradeDate)
  const existing = prior?.events ?? []
  const seen = new Set(existing.map((event) => eventKey(event)))
  const now = Date.now()
  const added: AuctionL1ReplayEvent[] = snapshots
    .filter((snapshot) => {
      const key = eventKeyFromSnapshot(snapshot)
      return !seen.has(key)
    })
    .map((snapshot) => ({
      version: AUCTION_L1_REPLAY_VERSION,
      tradeDate,
      ts: now,
      snapshot,
    }))
  if (!added.length) return 0
  const events = [...existing, ...added].sort(
    (a, b) => a.snapshot.providerTimestamp.localeCompare(b.snapshot.providerTimestamp) || a.snapshot.symbol.localeCompare(b.snapshot.symbol),
  )
  const payload = events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  const temp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  writeFileSync(temp, await gzip(payload))
  renameSync(temp, target)
  return added.length
}

function eventKey(event: AuctionL1ReplayEvent): string {
  return eventKeyFromSnapshot(event.snapshot)
}

function eventKeyFromSnapshot(snapshot: AuctionL1Snapshot): string {
  return `${snapshot.tradeDate}:${snapshot.symbol}:${snapshot.provider}:${snapshot.providerTimestamp}:${snapshot.receivedAt}`
}

/** 读取一个交易日的录制事件(不存在返回 null)。 */
export function readAuctionReplayDay(tradeDate: string): AuctionL1ReplayDay | null {
  assertSafeDate(tradeDate)
  const path = replayDayPath(tradeDate)
  if (!existsSync(path)) return null
  const warnings: string[] = []
  const events: AuctionL1ReplayEvent[] = []
  try {
    const data = gunzipSyncSafe(readFileSync(path))
    for (const line of data.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as AuctionL1ReplayEvent
        if (parsed.tradeDate !== tradeDate) {
          warnings.push(`录制文件含其他交易日的行(${parsed.tradeDate})，已跳过`)
          continue
        }
        if (parsed.version !== AUCTION_L1_REPLAY_VERSION) {
          warnings.push(
            `录制行版本(${parsed.version})与当前(${AUCTION_L1_REPLAY_VERSION})不符，已跳过`,
          )
          continue
        }
        events.push(parsed)
      } catch {
        warnings.push('录制文件存在无法解析的行，已跳过')
      }
    }
  } catch {
    warnings.push('录制文件压缩读取失败')
  }
  return { tradeDate, events, warnings }
}

function gunzipSyncSafe(input: Buffer): Buffer {
  try {
    return gunzipSync(input)
  } catch {
    return input
  }
}

/** 供应商无关的回放适配器:从录制文件读取某交易日全部快照。 */
export class ReplayAuctionProvider implements AuctionMarketDataProvider {
  private connected = false
  private symbols: string[] = []
  private handlers = new Set<(snapshot: AuctionL1Snapshot) => void>()
  private lastProviderTimestamp: string | null = null
  private lastReceivedAt: string | null = null
  private warnings: string[] = []

  async connect(): Promise<void> {
    this.connected = true
  }

  async subscribeUniverse(symbols: string[]): Promise<void> {
    this.symbols = symbols
  }

  onSnapshot(handler: (snapshot: AuctionL1Snapshot) => void): void {
    this.handlers.add(handler)
  }

  /** 播放一个交易日已录制的竞价快照;返回播出的快照数。 */
  async replay(tradeDate: string): Promise<number> {
    const day = readAuctionReplayDay(tradeDate)
    if (!day) {
      this.warnings = [`交易日 ${tradeDate} 无竞价录制文件`]
      this.lastProviderTimestamp = null
      this.lastReceivedAt = null
      return 0
    }
    this.warnings = [...day.warnings]
    let count = 0
    for (const event of day.events) {
      if (this.symbols.length && !this.symbols.includes(event.snapshot.symbol)) continue
      this.lastProviderTimestamp = event.snapshot.providerTimestamp
      this.lastReceivedAt = event.snapshot.receivedAt
      for (const handler of this.handlers) handler(event.snapshot)
      count++
    }
    return count
  }

  getHealth(): ProviderHealth {
    return {
      connected: this.connected,
      lastEventAt: this.lastReceivedAt,
      providerTimestamp: this.lastProviderTimestamp,
      stale: !this.lastReceivedAt,
      quality: this.lastReceivedAt ? 'full' : 'unavailable',
      warnings: [...this.warnings],
    }
  }

  async disconnect(): Promise<void> {
    for (const handler of this.handlers) this.handlers.delete(handler)
    this.connected = false
  }
}

export const REPLAY_PROVIDER_TIER: AuctionProviderTier = 'replay'