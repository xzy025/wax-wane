import { getLastTradingDay } from '../utils/marketHistory'
import { useMarketData, type IndexQuote, type MarketData, type MarketResult } from './useMarketData'

export type HKData = MarketData
export type HKResult = MarketResult<HKData>

export function useHKData(date: string = getLastTradingDay()): HKResult {
  return useMarketData<HKData>({ market: 'hk' }, date)
}

export type { IndexQuote }
