import { SINA_HEADERS } from '../lib/emHeaders'
import { marketPhaseForClockTime } from './auctionL1'
import type { ScreenerLiveQuote } from './screenerScan'

const CHUNK_SIZE = 80
const CONCURRENCY = 3

function createGbkDecoder() {
  return new TextDecoder('gbk')
}
let gbkDecoder: ReturnType<typeof createGbkDecoder> | undefined
function decodeGbk(buf: ArrayBuffer): string {
  gbkDecoder ??= createGbkDecoder()
  return gbkDecoder.decode(buf)
}

function symbol(code: string): string {
  if (code.startsWith('6')) return `sh${code}`
  if (/^[489]/.test(code)) return `bj${code}`
  return `sz${code}`
}

function isoDate(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 8) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

function isoTime(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 6) return ''
  return `${digits.slice(-6, -4)}:${digits.slice(-4, -2)}:${digits.slice(-2)}`
}

function n(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 集合竞价 Level-1 字段解码(阶段感知)。
 *
 * 旧错误语义把 bid1-ask1 金额差当未匹配量,已废弃。集合竞价期间:
 *   - 买一/卖一价 = 虚拟参考价(两者应一致);
 *   - 买一/卖一量 = 虚拟匹配量(两者应一致);
 *   - 买二量或卖二量 = 虚拟未匹配量及方向。
 * 连续竞价阶段盘口字段语义不同,不计算未匹配量,并把旧语义派生字段标记
 * legacy-unverified。免费公开源固定 sourceTier=shadow。
 */
function auctionBook(input: {
  price: number
  open: number
  amount: number
  quoteTime: string
  bid1Price?: number
  bid1Volume?: number
  ask1Price?: number
  ask1Volume?: number
  bid2Volume?: number
  ask2Volume?: number
}): Partial<ScreenerLiveQuote> {
  const marketPhase = marketPhaseForClockTime(input.quoteTime)
  const bid1Price = input.bid1Price && input.bid1Price > 0 ? input.bid1Price : null
  const bid1Volume = input.bid1Volume && input.bid1Volume > 0 ? input.bid1Volume : null
  const ask1Price = input.ask1Price && input.ask1Price > 0 ? input.ask1Price : null
  const ask1Volume = input.ask1Volume && input.ask1Volume > 0 ? input.ask1Volume : null
  const bid2Volume = input.bid2Volume && input.bid2Volume > 0 ? input.bid2Volume : null
  const ask2Volume = input.ask2Volume && input.ask2Volume > 0 ? input.ask2Volume : null

  const base: Partial<ScreenerLiveQuote> = {
    bid1Price,
    bid1Volume,
    ask1Price,
    ask1Volume,
    marketPhase,
    sourceTier: 'shadow',
  }

  // 连续竞价阶段(或无法确认阶段):不拼接集合竞价语义,旧字段标记 legacy-unverified。
  if (marketPhase === 'continuous' || marketPhase == null) {
    return {
      ...base,
      indicativePrice: input.price > 0 ? input.price : input.open > 0 ? input.open : null,
      matchedAmount: input.amount > 0 ? input.amount : null,
      unmatchedSide: null,
      unmatchedAmount: null,
      legacyUnverified: ['unmatchedSide', 'unmatchedAmount'],
    }
  }

  const virtualPrice =
    bid1Price != null && ask1Price != null && bid1Price === ask1Price ? bid1Price : null

  // 虚拟匹配量:买一量与卖一量一致时成立;不一致取较小者(上级解码器会告警)。
  let matchedAmount: number | null = null
  if (bid1Volume != null || ask1Volume != null) {
    const matchedQty =
      bid1Volume != null && ask1Volume != null && bid1Volume === ask1Volume
        ? bid1Volume
        : bid1Volume != null && ask1Volume != null
          ? Math.min(bid1Volume, ask1Volume)
          : (bid1Volume ?? ask1Volume)
    matchedAmount = virtualPrice != null && matchedQty != null ? virtualPrice * matchedQty : null
  }

  // 虚拟未匹配量:买二量/卖二量;两者均有量时语义不明,不取值。
  let unmatchedSide: ScreenerLiveQuote['unmatchedSide'] = null
  let unmatchedAmount: number | null = null
  if (bid2Volume != null && ask2Volume == null) {
    unmatchedSide = 'buy'
    unmatchedAmount = virtualPrice != null ? virtualPrice * bid2Volume : null
  } else if (ask2Volume != null && bid2Volume == null) {
    unmatchedSide = 'sell'
    unmatchedAmount = virtualPrice != null ? virtualPrice * ask2Volume : null
  } else if (bid2Volume != null && ask2Volume != null) {
    // 两者均有量:语义不明,保持 null 不取值。
  } else {
    unmatchedSide = 'balanced'
    unmatchedAmount = 0
  }
  return {
    ...base,
    indicativePrice:
      virtualPrice != null
        ? virtualPrice
        : input.price > 0
          ? input.price
          : input.open > 0
            ? input.open
            : null,
    matchedAmount,
    unmatchedSide,
    unmatchedAmount,
  }
}

export function parseSinaBatchQuotes(text: string, capturedAt = new Date().toISOString()): ScreenerLiveQuote[] {
  const out: ScreenerLiveQuote[] = []
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/hq_str_(?:sh|sz|bj)(\d{6})="([^"]*)"/)
    if (!match) continue
    const parts = match[2].split(',')
    if (parts.length < 32) continue
    const price = n(parts[3])
    const prevClose = n(parts[2])
    const tradeDate = /^\d{4}-\d{2}-\d{2}$/.test(parts[30] ?? '') ? parts[30] : isoDate(parts[30] ?? '')
    const quoteTime = /^\d{2}:\d{2}:\d{2}$/.test(parts[31] ?? '') ? parts[31] : isoTime(parts[31] ?? '')
    const open = n(parts[1])
    const amount = n(parts[9])
    out.push({
      code: match[1], name: parts[0] ?? '', tradeDate, quoteTime, capturedAt, source: 'sina',
      price, prevClose, open, high: n(parts[4]), low: n(parts[5]),
      volume: n(parts[8]) / 100, amount,
      changePct: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
      ...auctionBook({
        price,
        open,
        amount,
        quoteTime,
        bid1Volume: n(parts[10]),
        bid1Price: n(parts[11]),
        bid2Volume: n(parts[12]),
        ask1Volume: n(parts[20]),
        ask1Price: n(parts[21]),
        ask2Volume: n(parts[22]),
      }),
    })
  }
  return out
}

export function parseTencentBatchQuotes(text: string, capturedAt = new Date().toISOString()): ScreenerLiveQuote[] {
  const out: ScreenerLiveQuote[] = []
  for (const line of text.split(';')) {
    const match = line.match(/v_(?:sh|sz|bj)(\d{6})="([^"]*)"/)
    if (!match) continue
    const parts = match[2].split('~')
    if (parts.length < 35) continue
    const rawTime = parts[30] ?? ''
    const price = n(parts[3])
    const prevClose = n(parts[4])
    const open = n(parts[5])
    const amount = n(parts[37]) * 10_000
    const quoteTime = isoTime(rawTime)
    out.push({
      code: match[1], name: parts[1] ?? '', tradeDate: isoDate(rawTime), quoteTime, capturedAt, source: 'tencent',
      price, prevClose, open, high: n(parts[33]), low: n(parts[34]),
      volume: n(parts[6]), amount,
      changePct: n(parts[32]) || (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0),
      turnoverRate: n(parts[38]),
      ...auctionBook({ price, open, amount, quoteTime }),
    })
  }
  return out
}

async function mapChunks<T>(codes: string[], worker: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const chunks: string[][] = []
  for (let i = 0; i < codes.length; i += CHUNK_SIZE) chunks.push(codes.slice(i, i + CHUNK_SIZE))
  const results: T[] = []
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
    while (cursor < chunks.length) {
      const index = cursor++
      try { results.push(...await worker(chunks[index])) } catch { /* caller handles missing rows */ }
    }
  }))
  return results
}

export function fetchSinaBatchQuotes(codes: string[]): Promise<ScreenerLiveQuote[]> {
  return mapChunks(codes, async (chunk) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6_000)
    try {
      const res = await fetch(`https://hq.sinajs.cn/list=${chunk.map(symbol).join(',')}`, {
        headers: { ...SINA_HEADERS, Referer: 'https://finance.sina.com.cn/' }, signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Sina quote HTTP ${res.status}`)
      return parseSinaBatchQuotes(decodeGbk(await res.arrayBuffer()))
    } finally {
      clearTimeout(timeout)
    }
  })
}

export function fetchTencentBatchQuotes(codes: string[]): Promise<ScreenerLiveQuote[]> {
  return mapChunks(codes, async (chunk) => {
    const res = await fetch(`https://qt.gtimg.cn/q=${chunk.map(symbol).join(',')}`, {
      headers: { ...SINA_HEADERS, Referer: 'https://gu.qq.com/' }, signal: AbortSignal.timeout(6_000),
    })
    if (!res.ok) throw new Error(`Tencent quote HTTP ${res.status}`)
    return parseTencentBatchQuotes(decodeGbk(await res.arrayBuffer()))
  })
}
