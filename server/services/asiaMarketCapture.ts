// 日韩状态向量采集与归档(阶段 3)。
//
// 检查点触发时抓取日韩四指数(N225/TOPX/KS11/KQ11),构建 AsiaMarketSnapshot,
// 并把派生结果写成独立 JSON(经临时文件原子替换)。原始事件按检查点只保留
// 检查点前已到达的数据;空数据 / 陈旧行情显式转 unavailable / degraded。

import { existsSync, mkdirSync, renameSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { fetchIndexQuotes, type IndexQuote, type IndexSpec } from './emQuotes'
import {
  buildAsiaMarketSnapshot,
  type AsiaCheckpoint,
  type AsiaMarket,
  type AsiaMarketSnapshot,
} from './asiaMarketState'

export const ASIA_MARKET_STATE_VERSION = 'asia-market-state-v1'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function asiaMarketStateRoot(): string {
  return process.env.ASIA_MARKET_STATE_ROOT ??
    join(__dirname, '..', '..', 'docs', 'asia-market', 'state')
}

export const ASIA_INDEX_SPECS: IndexSpec[] = [
  { secid: '100.N225', code: 'N225' },
  { secid: '100.TOPX', code: 'TOPX' },
  { secid: '100.KS11', code: 'KS11' },
  { secid: '100.KQ11', code: 'KQ11' },
]

export const ASIA_MARKET_BY_SYMBOL: Record<string, AsiaMarket> = {
  N225: 'JP',
  TOPX: 'JP',
  KS11: 'KR',
  KQ11: 'KR',
}

function asiaStatePath(tradeDate: string, checkpoint: AsiaCheckpoint): string {
  return join(asiaMarketStateRoot(), tradeDate, `${checkpoint}.json`)
}

function safeDate(tradeDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(tradeDate)
}

export function writeAsiaMarketState(snapshot: AsiaMarketSnapshot): AsiaMarketSnapshot {
  if (!safeDate(snapshot.tradeDate)) throw new Error('tradeDate 必须是 YYYY-MM-DD')
  const target = asiaStatePath(snapshot.tradeDate, snapshot.checkpoint)
  mkdirSync(dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(snapshot, null, 2), 'utf8')
  renameSync(temp, target)
  return snapshot
}

export function readAsiaMarketState(
  tradeDate: string,
  checkpoint: AsiaCheckpoint,
): AsiaMarketSnapshot | null {
  const path = asiaStatePath(tradeDate, checkpoint)
  if (!safeDate(tradeDate) || !existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AsiaMarketSnapshot
  } catch {
    return null
  }
}

function indexToBar(_quote: IndexQuote): { time: string; price: number }[] {
  // EastMoney 单点快照不带盘中分时条;本批次保存实时点位,分时条留待分钟行情源接入。
  return []
}

/**
 * 抓取日韩指数并构建对应检查点的状态向量。
 * 返回空数据时 quality=unavailable,带说明。
 */
export async function captureAsiaMarketState(args: {
  tradeDate: string
  checkpoint: AsiaCheckpoint
  requireQuotes?: boolean
}): Promise<AsiaMarketSnapshot> {
  const receivedAt = new Date().toISOString()
  const provider = 'eastmoney-asia'
  const providerTimestamp = new Date(receivedAt).toISOString()
  let quotes: IndexQuote[] = []
  const warnings: string[] = []
  try {
    quotes = await fetchIndexQuotes(ASIA_INDEX_SPECS)
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : '日韩指数抓取失败')
  }
  if (!asyncWarningsFromQuotes(quotes, warnings)) {
    // no-op
  }
  if (args.requireQuotes && !quotes.length) {
    return {
      tradeDate: args.tradeDate,
      checkpoint: args.checkpoint,
      provider,
      providerTimestamp,
      receivedAt,
      instruments: [],
      quality: 'unavailable',
      warnings: [...warnings, '日韩行情未配置，无法构建状态向量'],
    }
  }
  const instruments = quotes.map((quote) => ({
    symbol: quote.code,
    market: ASIA_MARKET_BY_SYMBOL[quote.code] ?? ('JP' as AsiaMarket),
    previousClose: quote.prevClose > 0 ? quote.prevClose : null,
    price: quote.price > 0 ? quote.price : null,
    bar: indexToBar(quote),
  }))
  const snapshot = buildAsiaMarketSnapshot({
    tradeDate: args.tradeDate,
    checkpoint: args.checkpoint,
    provider,
    providerTimestamp,
    receivedAt,
    instruments,
    checkpointMinute: null,
  })
  return { ...snapshot, warnings: [...new Set([...warnings, ...snapshot.warnings])] }
}

function asyncWarningsFromQuotes(quotes: IndexQuote[], warnings: string[]): boolean {
  if (!quotes.length) warnings.push('日韩指数行情缺失')
  return quotes.length > 0
}