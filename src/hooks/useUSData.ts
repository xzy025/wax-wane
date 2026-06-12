import { getLastTradingDay } from '../utils/marketHistory'
import { useMarketData, type IndexQuote, type MarketData, type MarketResult } from './useMarketData'

export type USData = MarketData
export type USResult = MarketResult<USData>

function getMockData(): USData {
  return {
    indices: [
      { code: 'DJI', name: '道琼斯', price: 42350.25, changePct: 0.45, changeAmt: 190.12, volume: 0, turnover: 0, high: 42400.0, low: 42100.0, open: 42200.0, prevClose: 42160.13 },
      { code: 'IXIC', name: '纳斯达克', price: 19250.8, changePct: 0.82, changeAmt: 156.45, volume: 0, turnover: 0, high: 19300.0, low: 19100.0, open: 19150.0, prevClose: 19094.35 },
      { code: 'SPX', name: '标普500', price: 5870.6, changePct: 0.61, changeAmt: 35.42, volume: 0, turnover: 0, high: 5890.0, low: 5830.0, open: 5840.0, prevClose: 5835.18 },
    ],
    customStocks: [],
  }
}

export function useUSData(date: string = getLastTradingDay()): USResult {
  return useMarketData<USData>({ market: 'us', getMock: getMockData }, date)
}

export type { IndexQuote }
