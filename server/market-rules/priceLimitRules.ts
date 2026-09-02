import {
  defaultSecurityMaster,
  isRiskWarningActive,
  type SecurityMasterSnapshot,
} from './securityMaster'

export const MAIN_BOARD_RISK_WARNING_CHANGE_DATE = '2026-07-06'

export interface PriceLimitRuleResult {
  upperPct: number | null
  lowerPct: number | null
  upperPrice: number | null
  lowerPrice: number | null
  tickSize: number
  unrestricted: boolean
  suspended: boolean
  reasons: string[]
  ruleVersion: string
}

export interface PriceLimitInput {
  code: string
  asOfDate: string
  previousClose: number
  security?: Partial<SecurityMasterSnapshot> | null
  listedTradingDays?: number | null
}

export const PRICE_LIMIT_RULE_VERSION = 'cn-a-share-price-limit-rules-2026-07-06'

export function priceLimitRules(input: PriceLimitInput): PriceLimitRuleResult {
  const security = defaultSecurityMaster(input.code, input.asOfDate, input.security ?? {})
  const reasons: string[] = []
  if (!(input.previousClose > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate)) {
    return result(null, null, security.tickSize, true, false, ['昨收或生效日期无效'])
  }
  if (security.suspended) {
    return result(null, null, security.tickSize, false, true, ['证券停牌'])
  }
  if (security.board === 'unknown' || security.exchange === 'UNKNOWN') {
    return result(null, null, security.tickSize, true, false, ['证券交易所/板块未知'])
  }
  const noLimit = isNoLimitListingDay(security, input.asOfDate, input.listedTradingDays)
  if (noLimit) {
    return result(null, null, security.tickSize, true, false, ['上市初期无涨跌幅限制'])
  }
  let pct = security.board === 'beijing' ? 30 : security.board === 'chinext' || security.board === 'star' ? 20 : 10
  if (security.board === 'main' && isRiskWarningActive(security, input.asOfDate) && input.asOfDate < MAIN_BOARD_RISK_WARNING_CHANGE_DATE) pct = 5
  const upper = roundPrice(input.previousClose * (1 + pct / 100), security.tickSize)
  const lower = roundPrice(input.previousClose * (1 - pct / 100), security.tickSize)
  return result(pct, pct, security.tickSize, false, false, reasons, upper, lower)
}

function result(
  upperPct: number | null,
  lowerPct: number | null,
  tickSize: number,
  unrestricted: boolean,
  suspended: boolean,
  reasons: string[],
  upperPrice?: number,
  lowerPrice?: number,
): PriceLimitRuleResult {
  return {
    upperPct,
    lowerPct,
    upperPrice: upperPrice ?? null,
    lowerPrice: lowerPrice ?? null,
    tickSize,
    unrestricted,
    suspended,
    reasons,
    ruleVersion: PRICE_LIMIT_RULE_VERSION,
  }
}

function isNoLimitListingDay(security: SecurityMasterSnapshot, asOfDate: string, listedTradingDays: number | null | undefined): boolean {
  if (listedTradingDays != null) {
    if (security.board === 'beijing') return listedTradingDays <= 1
    return listedTradingDays <= 5
  }
  if (!security.listingDate) return false
  const elapsed = Math.floor((Date.parse(asOfDate) - Date.parse(security.listingDate)) / 86_400_000)
  return elapsed >= 0 && elapsed <= (security.board === 'beijing' ? 0 : 4)
}

export function roundPrice(value: number, tickSize = 0.01): number {
  if (!(value > 0) || !(tickSize > 0)) return value
  return Math.round((value + Number.EPSILON) / tickSize) * tickSize
}

export function priceLimitPrice(input: PriceLimitInput, direction: 'up' | 'down'): number | null {
  const rules = priceLimitRules(input)
  return direction === 'up' ? rules.upperPrice : rules.lowerPrice
}

export function isAtPriceLimit(price: number, limitPrice: number | null, tickSize = 0.01): boolean {
  void tickSize
  return limitPrice != null && Number.isFinite(price) && price === limitPrice
}
