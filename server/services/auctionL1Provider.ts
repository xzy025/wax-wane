// 竞价 Level-1 供应商适配器。
//
//   - ShadowPublicProvider:封装现有公开源(Sina/腾讯),只做字段对照与 shadow 研究展示,
//     完成实盘对照前不得升级为正式来源;
//   - AuthorizedL1Provider:正式接口占位,供应商和凭证确定后接通;未配置凭证时
//     正式竞价状态为 unavailable。
//
// 公开源即使字段形态吻合也只能形成研究展示,不能进入正式候选升级或历史基线。

import {
  decodeAuctionLevel1,
  type AuctionExchange,
  type AuctionL1Snapshot,
  type AuctionMarketDataProvider,
  type AuctionProviderTier,
  type ProviderHealth,
} from './auctionL1'
import {
  fetchSinaBatchQuotes,
  fetchTencentBatchQuotes,
} from './screenerLiveQuotes'
import type { ScreenerLiveQuote } from './screenerDataContract'

export function exchangeFromCode(code: string): AuctionExchange {
  if (code.startsWith('4') || code.startsWith('8')) return 'BSE'
  if (code.startsWith('6')) return 'SSE'
  return 'SZSE'
}

/** 把 SINA/腾讯等公开源行情行映射为 AuctionL1Snapshot(Sina 有 5 档盘口)。 */
export function shadowQuoteToAuctionL1(
  quote: ScreenerLiveQuote,
  opts: {
    marketPhase: 'auction-cancellable' | 'auction-locked' | 'continuous'
    provider: string
    receivedAt?: string
    previousClose?: number | null
    limitUpPrice?: number | null
    limitDownPrice?: number | null
  },
): AuctionL1Snapshot {
  const bid1 = [quote.bid1Price ?? null]
  const bidQty = [quote.bid1Volume ?? null]
  const ask1 = [quote.ask1Price ?? null]
  const askQty = [quote.ask1Volume ?? null]
  return decodeAuctionLevel1({
    tradeDate: quote.tradeDate,
    symbol: quote.code,
    exchange: exchangeFromCode(quote.code),
    provider: opts.provider,
    providerTimestamp: quote.quoteTime,
    receivedAt: opts.receivedAt ?? quote.capturedAt,
    previousClose: opts.previousClose ?? quote.prevClose,
    limitUpPrice: opts.limitUpPrice,
    limitDownPrice: opts.limitDownPrice,
    marketPhase: opts.marketPhase,
    rawBidPrices: bid1,
    rawBidQty: bidQty,
    rawAskPrices: ask1,
    rawAskQty: askQty,
    sourceTier: 'shadow',
  })
}

/**
 * Shadow 公开源适配器。连接日常抓取 Sina/腾讯,并把快照广播给订阅者;
 * sourceTier 固定为 shadow,不进入正式候选升级或历史基线。
 */
export class ShadowPublicProvider implements AuctionMarketDataProvider {
  private connected = false
  private symbols: string[] = []
  private handlers = new Set<(snapshot: AuctionL1Snapshot) => void>()
  private lastReceivedAt: string | null = null
  private lastQuoteCount = 0
  private warnings: string[] = []
  private marketPhase: 'auction-cancellable' | 'auction-locked' | 'continuous'
  private useSina: boolean
  private useTencent: boolean

  constructor(opts: {
    marketPhase: 'auction-cancellable' | 'auction-locked' | 'continuous'
    useSina?: boolean
    useTencent?: boolean
  }) {
    this.marketPhase = opts.marketPhase
    this.useSina = opts.useSina ?? true
    this.useTencent = opts.useTencent ?? true
  }

  async connect(): Promise<void> {
    this.connected = true
  }

  async subscribeUniverse(symbols: string[]): Promise<void> {
    this.symbols = symbols
  }

  onSnapshot(handler: (snapshot: AuctionL1Snapshot) => void): void {
    this.handlers.add(handler)
  }

  /** 抓取一次当前快照并广播全部(公开源仅作 shadow 研究展示)。 */
  async pollOnce(): Promise<number> {
    if (!this.symbols.length) {
      this.warnings = ['订阅池为空，跳过公开源抓取']
      return 0
    }
    const providers: string[] = []
    if (this.useSina) providers.push('sina')
    if (this.useTencent) providers.push('tencent')
    const receivedAt = new Date().toISOString()
    let broadcast = 0
    for (const provider of providers) {
      const fetchFn = provider === 'sina' ? fetchSinaBatchQuotes : fetchTencentBatchQuotes
      try {
        const quotes = await fetchFn(this.symbols)
        for (const quote of quotes) {
          if (!quote.tradeDate) continue
          const snapshot = shadowQuoteToAuctionL1(quote, {
            marketPhase: this.marketPhase,
            provider,
            receivedAt,
          })
          for (const handler of this.handlers) handler(snapshot)
          broadcast++
        }
        this.lastReceivedAt = receivedAt
        this.lastQuoteCount += quotes.length
      } catch {
        this.warnings.push(`${provider} 公开源抓取失败，已跳过`)
      }
    }
    return broadcast
  }

  getHealth(): ProviderHealth {
    return {
      connected: this.connected,
      lastEventAt: this.lastReceivedAt,
      providerTimestamp: this.lastReceivedAt,
      stale: !this.lastReceivedAt,
      quality: this.lastQuoteCount > 0 ? 'full' : 'unavailable',
      warnings: [
        ...this.warnings,
        '公开源 Shadow 字段仅作研究展示，不进入正式候选升级或历史基线',
      ],
    }
  }

  async disconnect(): Promise<void> {
    for (const handler of this.handlers) this.handlers.delete(handler)
    this.connected = false
  }
}

/** 正式适配器占位:未配置凭证时 connect() 失败,健康状态 unavailable。 */
export class AuthorizedL1Provider implements AuctionMarketDataProvider {
  private connected = false
  private handlers = new Set<(snapshot: AuctionL1Snapshot) => void>()
  private _health: ProviderHealth = {
    connected: false,
    lastEventAt: null,
    providerTimestamp: null,
    stale: true,
    quality: 'unavailable',
    warnings: ['未配置授权 Level-1 凭证，正式竞价路径不可用'],
  }

  async connect(): Promise<void> {
    throw new Error('未配置授权 Level-1 供应商凭证；正式竞价路径 unavailable')
  }

  async subscribeUniverse(_symbols: string[]): Promise<void> {
    return
  }

  onSnapshot(handler: (snapshot: AuctionL1Snapshot) => void): void {
    this.handlers.add(handler)
  }

  getHealth(): ProviderHealth {
    return { ...this._health, connected: this.connected }
  }

  async disconnect(): Promise<void> {
    for (const handler of this.handlers) this.handlers.delete(handler)
    this.connected = false
  }
}

export interface AuctionProviderSelection {
  tier: AuctionProviderTier
  provider: AuctionMarketDataProvider
}

/** 选择当前可用的竞价 provider:未配置授权凭证时固定 shadow。 */
export function selectAuctionProvider(
  authorized?: AuctionMarketDataProvider,
  shadow?: AuctionMarketDataProvider,
): AuctionProviderSelection {
  const hasAuthorized = !!authorized
  if (hasAuthorized && process.env.AUCTION_L1_AUTHORIZED_ENABLED === 'true') {
    return { tier: 'authorized', provider: authorized as AuctionMarketDataProvider }
  }
  const resolvedShadow = shadow ?? new ShadowPublicProvider({ marketPhase: 'auction-locked' })
  void hasAuthorized
  return { tier: 'shadow', provider: resolvedShadow }
}