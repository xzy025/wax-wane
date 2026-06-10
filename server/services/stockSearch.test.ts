import { describe, it, expect } from 'vitest'
import { pickBestStockMatch } from './stockSearch'

describe('pickBestStockMatch', () => {
  it('picks the A-share row by explicit Classify flag', () => {
    const rows = [
      { Code: '300750', Name: '宁德时代', Classify: 'AStock', SecurityTypeName: '深A' },
      { Code: '000001', Name: '上证指数', Classify: 'Index', SecurityTypeName: '指数' },
    ]
    expect(pickBestStockMatch(rows)).toEqual({ code: '300750', name: '宁德时代' })
  })

  it('skips indices / funds / HK / US, picks the A-share', () => {
    const rows = [
      { Code: '513050', Name: '中概互联ETF', Classify: 'Fund', SecurityTypeName: 'ETF' },
      { Code: '600519', Name: '贵州茅台', Classify: 'AStock', SecurityTypeName: '沪A' },
    ]
    expect(pickBestStockMatch(rows)).toEqual({ code: '600519', name: '贵州茅台' })
  })

  it('falls back to first non-excluded 6-digit code when Classify is absent', () => {
    const rows = [
      { Code: '000300', Name: '沪深300', SecurityTypeName: '指数' },
      { Code: '000858', Name: '五粮液', SecurityTypeName: '深A' },
    ]
    expect(pickBestStockMatch(rows)).toEqual({ code: '000858', name: '五粮液' })
  })

  it('returns null when there is no valid A-share match', () => {
    expect(pickBestStockMatch([{ Code: 'AAPL', Name: '苹果', Classify: 'USStock' }])).toBeNull()
    expect(pickBestStockMatch([])).toBeNull()
    expect(pickBestStockMatch(null)).toBeNull()
    expect(pickBestStockMatch(undefined)).toBeNull()
  })

  it('ignores malformed (non-6-digit) codes', () => {
    const rows = [
      { Code: '12345', Name: '坏数据', Classify: 'AStock' },
      { Code: '002594', Name: '比亚迪', Classify: 'AStock', SecurityTypeName: '深A' },
    ]
    expect(pickBestStockMatch(rows)).toEqual({ code: '002594', name: '比亚迪' })
  })
})
