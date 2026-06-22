/**
 * A-share market-session detection, shared by the holdings-review board so the
 * UI can frame the report as a post-close (盘后) review. Mirrors the
 * trading-day logic embedded in src/agent/prompts.ts getTradingDayInfo(),
 * extracted here as a pure, testable helper.
 */
export type MarketPhase = 'weekend' | 'preMarket' | 'open' | 'afterMarket' | 'beforeOpen'

export interface MarketStatus {
  phase: MarketPhase
  /** True once the cash session has closed on a weekday (after 15:00). */
  isAfterMarket: boolean
  isWeekend: boolean
  todayStr: string
  lastTradingDayStr: string
}

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function lastTradingDay(d: Date): Date {
  const result = new Date(d)
  while (result.getDay() === 0 || result.getDay() === 6) {
    result.setDate(result.getDate() - 1)
  }
  return result
}

export function getMarketStatus(now: Date = new Date()): MarketStatus {
  const dayOfWeek = now.getDay()
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const timeMinutes = now.getHours() * 60 + now.getMinutes()

  // A-share cash session: 9:30-11:30 and 13:00-15:00
  const isMarketOpen =
    !isWeekend &&
    ((timeMinutes >= 570 && timeMinutes <= 690) || (timeMinutes >= 780 && timeMinutes <= 900))
  const isPreMarket = !isWeekend && timeMinutes >= 555 && timeMinutes < 570 // 9:15-9:30
  const isAfterMarket = !isWeekend && timeMinutes > 900 // 15:00+

  let phase: MarketPhase
  if (isWeekend) phase = 'weekend'
  else if (isPreMarket) phase = 'preMarket'
  else if (isMarketOpen) phase = 'open'
  else if (isAfterMarket) phase = 'afterMarket'
  else phase = 'beforeOpen'

  return {
    phase,
    isAfterMarket,
    isWeekend,
    todayStr: fmt(now),
    lastTradingDayStr: fmt(lastTradingDay(now)),
  }
}
