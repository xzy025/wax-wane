import { getLastTradingDay } from '../utils/marketHistory'
import { useMarketData, type IndexQuote, type MarketData, type MarketResult } from './useMarketData'

export type USData = MarketData
export type USResult = MarketResult<USData>

export function useUSData(date: string = getLastTradingDay()): USResult {
  return useMarketData<USData>({ market: 'us' }, date)
}

export type { IndexQuote }
