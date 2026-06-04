import { todayStr } from '../utils/marketHistory'
import { useMarketData, type IndexQuote, type MarketData, type MarketResult } from './useMarketData'

export type USData = MarketData
export type USResult = MarketResult<USData>

function getMockData(): USData {
  return {
    indices: [
      { code: 'DJI', name: '道琼斯', price: 42350.25, changePct: 0.45, changeAmt: 190.12, volume: 0, turnover: 0, high: 42400.0, low: 42100.0, open: 42200.0, prevClose: 42160.13 },
      { code: 'IXIC', name: '纳斯达克', price: 19250.8, changePct: 0.82, changeAmt: 156.45, volume: 0, turnover: 0, high: 19300.0, low: 19100.0, open: 19150.0, prevClose: 19094.35 },
      { code: 'NVDA', name: '英伟达', price: 125.38, changePct: 3.21, changeAmt: 3.9, volume: 45678901234, turnover: 5678901234567, high: 126.5, low: 122.0, open: 122.5, prevClose: 121.48 },
      { code: 'LITE', name: 'Lumentum', price: 38.65, changePct: -1.52, changeAmt: -0.6, volume: 2345678901, turnover: 98765432100, high: 39.8, low: 38.2, open: 39.5, prevClose: 39.25 },
      { code: 'TSM', name: '台积电', price: 178.92, changePct: 0.85, changeAmt: 1.5, volume: 12345678901, turnover: 2345678901234, high: 179.5, low: 177.0, open: 177.5, prevClose: 177.42 },
    ],
    customStocks: [],
  }
}

export function useUSData(date: string = todayStr()): USResult {
  return useMarketData<USData>({ market: 'us', getMock: getMockData }, date)
}

export type { IndexQuote }
