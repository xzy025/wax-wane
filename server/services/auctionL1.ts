// 集合竞价 Level-1 统一语义层。
//
// 上交所/深交所 Level-1 接口在集合竞价(09:15–09:25)期间的字段语义与连续竞价不同:
//   - 买一价/卖一价 = 虚拟参考价;
//   - 买一量/卖一量 = 虚拟匹配量;
//   - 买二量或卖二量 = 虚拟未匹配量及方向;
//   - 09:25 后进入连续竞价,盘口字段语义切换,不得把集合竞价字段与连续竞价字段直接拼接。
//
// 本模块只负责语义解码与契约;数据来源由 provider 决定(Sina/腾讯降级为 shadow,
// 公开源即使字段形态吻合也只作研究展示,不进入正式候选升级或历史基线)。

/** 交易所。 */
export type AuctionExchange = 'SSE' | 'SZSE' | 'BSE'

/**
 * 市场阶段。集合竞价 09:15–09:20 可撤单、09:20–09:25 不可撤单,
 * 09:30 后进入连续竞价。
 */
export type AuctionMarketPhase = 'auction-cancellable' | 'auction-locked' | 'continuous'

/** 数据质量。 */
export type AuctionQuality = 'full' | 'degraded' | 'unavailable'

/** 虚拟未匹配方向。 */
export type AuctionUnmatchedSide = 'buy' | 'sell' | 'balanced' | 'unknown'

/** 数据来源信任等级:授权=正式、shadow=公开源研究展示、replay=录制回放。 */
export type AuctionProviderTier = 'authorized' | 'shadow' | 'replay'

/**
 * 校验字段语义的背景标记。上游若用旧的错误语义(bid1-ask1 金额差当未匹配量)
 * 产出了字段,必须标记 `legacy-unverified`,不得进入正式评分或历史基线。
 */
export const AUCTION_LEGACY_UNVERIFIED = 'legacy-unverified'

/** 供应商无关的竞价快照契约(阶段 1 契约)。 */
export interface AuctionL1Snapshot {
  tradeDate: string
  symbol: string
  exchange: AuctionExchange
  provider: string
  providerTimestamp: string
  receivedAt: string
  sequence?: string
  previousClose: number | null
  limitUpPrice: number | null
  limitDownPrice: number | null
  /** 虚拟参考价。仅集合竞价阶段可解出;连续竞价语义或数据缺失时为 null。 */
  virtualPrice: number | null
  /** 虚拟匹配量(股)。 */
  virtualMatchedQty: number | null
  /** 虚拟未匹配量(股)。 */
  virtualUnmatchedQty: number | null
  virtualUnmatchedSide: AuctionUnmatchedSide
  rawBidPrices: Array<number | null>
  rawBidQty: Array<number | null>
  rawAskPrices: Array<number | null>
  rawAskQty: Array<number | null>
  marketPhase: AuctionMarketPhase
  quality: AuctionQuality
  warnings: string[]
  sourceTier: AuctionProviderTier
  /** 由旧错误语义派生、尚未验证的字段名列表。 */
  legacyUnverified?: string[]
}

/** Provider 健康状态。 */
export interface ProviderHealth {
  connected: boolean
  lastEventAt: string | null
  providerTimestamp: string | null
  stale: boolean
  quality: AuctionQuality
  warnings: string[]
}

/** 供应商无关的适配器契约(阶段 1 契约)。 */
export interface AuctionMarketDataProvider {
  connect(): Promise<void>
  subscribeUniverse(symbols: string[]): Promise<void>
  onSnapshot(handler: (snapshot: AuctionL1Snapshot) => void): void
  getHealth(): ProviderHealth
  disconnect(): Promise<void>
}

function minutesOf(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

/** UTC 毫秒 → Asia/Shanghai 时钟(固定 UTC+8,无夏令时)。 */
function shanghaiDateAt(ms: number): { date: Date; minutes: number } {
  const date = new Date(ms + 8 * 3_600_000)
  return { date, minutes: minutesOf(date) }
}

/**
 * 按上海时钟分钟判定市场阶段。
 * 09:15–09:20(含 09:15 整点)= auction-cancellable;
 * 09:20–09:25(不含 09:25 整点)= auction-locked;
 * 09:30–11:30 与 13:00–15:00 = continuous;
 * 其余时段返回 null(非竞价快照窗口)。
 */
export function marketPhaseForShanghaiClock(
  nowMs = Date.now(),
  minutes?: number,
): AuctionMarketPhase | null {
  const value = minutes ?? shanghaiDateAt(nowMs).minutes
  if (value >= 9 * 60 + 15 && value < 9 * 60 + 20) return 'auction-cancellable'
  if (value >= 9 * 60 + 20 && value < 9 * 60 + 25) return 'auction-locked'
  if (value >= 9 * 60 + 30 && value <= 11 * 60 + 30) return 'continuous'
  if (value >= 13 * 60 && value <= 15 * 60) return 'continuous'
  return null
}

/** 从 provider 时间戳的 HH:MM 部分解析阶段(供纯测试/回放)。 */
export function marketPhaseForClockTime(clockTime: string): AuctionMarketPhase | null {
  const match = clockTime.match(/^(\d{2}):(\d{2})/)
  if (!match) return null
  return marketPhaseForShanghaiClock(0, Number(match[1]) * 60 + Number(match[2]))
}

function positiveOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null
}

function nearlyEqual(a: number | null, b: number | null, tolerance = 1e-9): boolean {
  return a != null && b != null && a > 0 && b > 0 && Math.abs(a - b) <= tolerance
}

/**
 * 解码集合竞价 Level-1 虚拟盘口。
 *
 * 集合竞价阶段:
 *   - 买一价与卖一价一致时共同构成虚拟参考价;两者不一致且均为正时视为语义异常,
 *     返回 null 并告警(不猜测哪一个是对的);
 *   - 买一量/卖一量表示虚拟匹配量,两个口径应一致,取较小者并告警;
 *   - 买二量或卖二量表示虚拟未匹配量及方向:仅买二有量=买盘未匹配,
 *     仅卖二有量=卖盘未匹配,两者均有量=语义不明,返回 unknown;
 *    两者均为 0= balanced。
 *
 * 连续竞价阶段不计算虚拟字段,全部返回 null 并告警——盘口字段语义已切换,
 * 不得把集合竞价字段与连续竞价字段直接拼接。
 */
export function decodeAuctionLevel1(args: {
  tradeDate: string
  symbol: string
  exchange: AuctionExchange
  provider: string
  providerTimestamp: string
  receivedAt: string
  sequence?: string
  previousClose?: number | null
  limitUpPrice?: number | null
  limitDownPrice?: number | null
  marketPhase: AuctionMarketPhase
  rawBidPrices: Array<number | null>
  rawBidQty: Array<number | null>
  rawAskPrices: Array<number | null>
  rawAskQty: Array<number | null>
  sourceTier?: AuctionProviderTier
  warning?: string
}): AuctionL1Snapshot {
  const warnings: string[] = []
  if (args.warning) warnings.push(args.warning)

  const bid1Price = positiveOrNull(args.rawBidPrices[0])
  const bid1Qty = positiveOrNull(args.rawBidQty[0])
  const ask1Price = positiveOrNull(args.rawAskPrices[0])
  const ask1Qty = positiveOrNull(args.rawAskQty[0])
  const bid2Qty = positiveOrNull(args.rawBidQty[1])
  const ask2Qty = positiveOrNull(args.rawAskQty[1])

  let virtualPrice: number | null = null
  let virtualMatchedQty: number | null = null
  let virtualUnmatchedQty: number | null = null
  let virtualUnmatchedSide: AuctionUnmatchedSide = 'unknown'

  if (args.marketPhase === 'continuous') {
    warnings.push(
      '连续竞价阶段盘口字段语义与集合竞价不同，未计算虚拟参考价/匹配量/未匹配量',
    )
  } else {
    // 虚拟参考价:买一卖一价一致时成立。
    if (bid1Price != null && ask1Price != null) {
      if (nearlyEqual(bid1Price, ask1Price, 1e-6)) {
        virtualPrice = bid1Price
      } else {
        warnings.push(
          `集合竞价买一价(${bid1Price})与卖一价(${ask1Price})不一致，虚拟参考价不可确认`,
        )
      }
    } else if (bid1Price != null || ask1Price != null) {
      virtualPrice = bid1Price ?? ask1Price
      warnings.push('集合竞价只有单边档位，虚拟参考价仅按可见单边推断，字段未经验证')
    } else {
      warnings.push('集合竞价买/卖一档位均缺失，虚拟参考价不可用')
    }

    // 虚拟匹配量:买一卖一量一致时成立。
    if (bid1Qty != null && ask1Qty != null) {
      if (bid1Qty === ask1Qty) {
        virtualMatchedQty = bid1Qty
      } else {
        virtualMatchedQty = Math.min(bid1Qty, ask1Qty)
        warnings.push(
          `集合竞价买一量(${bid1Qty})与卖一量(${ask1Qty})不一致，取较小值作为虚拟匹配量`,
        )
      }
    } else if (bid1Qty != null || ask1Qty != null) {
      virtualMatchedQty = bid1Qty ?? ask1Qty
      warnings.push('集合竞价只有单边匹配量，取可见单边，字段未经验证')
    } else {
      warnings.push('集合竞价买/卖一匹配量均缺失，虚拟匹配量不可用')
    }

    // 虚拟未匹配量及方向:买二量或卖二量。
    const hasBid2 = bid2Qty != null && bid2Qty > 0
    const hasAsk2 = ask2Qty != null && ask2Qty > 0
    if (hasBid2 && !hasAsk2) {
      virtualUnmatchedSide = 'buy'
      virtualUnmatchedQty = bid2Qty
    } else if (hasAsk2 && !hasBid2) {
      virtualUnmatchedSide = 'sell'
      virtualUnmatchedQty = ask2Qty
    } else if (hasBid2 && hasAsk2) {
      virtualUnmatchedSide = 'unknown'
      warnings.push('集合竞价买二量卖二量同时非空，未匹配方向无法确认')
    } else {
      virtualUnmatchedSide = 'balanced'
      virtualUnmatchedQty = 0
    }
  }

  const missingRequired =
    virtualPrice == null || virtualMatchedQty == null
  return {
    tradeDate: args.tradeDate,
    symbol: args.symbol,
    exchange: args.exchange,
    provider: args.provider,
    providerTimestamp: args.providerTimestamp,
    receivedAt: args.receivedAt,
    sequence: args.sequence,
    previousClose: args.previousClose ?? null,
    limitUpPrice: args.limitUpPrice ?? null,
    limitDownPrice: args.limitDownPrice ?? null,
    virtualPrice,
    virtualMatchedQty,
    virtualUnmatchedQty,
    virtualUnmatchedSide,
    rawBidPrices: args.rawBidPrices,
    rawBidQty: args.rawBidQty,
    rawAskPrices: args.rawAskPrices,
    rawAskQty: args.rawAskQty,
    marketPhase: args.marketPhase,
    quality: missingRequired ? 'degraded' : warnings.length ? 'degraded' : 'full',
    warnings,
    sourceTier: args.sourceTier ?? 'shadow',
  }
}

/**
 * 标记由旧错误语义派生的字段为 legacy-unverified。
 * 旧语义:把 bid1-ask1 金额差当作未匹配量;本标记用于隔离历史/降级字段,
 * 不删除、不覆盖、不重新解释档案。
 */
export function markLegacyUnverified(snapshot: AuctionL1Snapshot, fields: string[]): AuctionL1Snapshot {
  return {
    ...snapshot,
    legacyUnverified: Array.from(new Set([...(snapshot.legacyUnverified ?? []), ...fields])),
    quality: snapshot.quality === 'full' ? 'degraded' : snapshot.quality,
    warnings: [
      ...snapshot.warnings,
      `字段 ${fields.join('、')} 由旧错误语义派生，标记为 ${AUCTION_LEGACY_UNVERIFIED}`,
    ],
  }
}