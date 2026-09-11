import { describe, expect, it } from 'vitest'
import { isBeijingStockCode, sinaMarketSymbol, isSinaStockAtLimit } from './ashare'

describe('Sina exact price-limit membership', () => {
  it('excludes the 2026-09-09 奥士康 near-limit close, accepting only its true upper tick', () => {
    const stock = { code: '002913', name: '奥士康', settlement: '64.770', trade: '71.200' }
    expect(isSinaStockAtLimit(stock, 'up')).toBe(false)
    expect(isSinaStockAtLimit({ ...stock, trade: '71.250' }, 'up')).toBe(true)
  })
  it('handles tick rounding below 9.9 percent and exact down limits', () => {
    const stock = { code: '600001', name: '测试', settlement: '1.03', trade: '1.13' }
    expect(isSinaStockAtLimit(stock, 'up')).toBe(true)
    expect(isSinaStockAtLimit({ ...stock, trade: '0.93' }, 'down')).toBe(true)
    expect(isSinaStockAtLimit({ ...stock, trade: '0.94' }, 'down')).toBe(false)
  })
  it('uses 20/30 percent boards and rejects missing settlement or unrestricted new names', () => {
    const stock = { code: '300001', name: '测试', settlement: '10', trade: '12' }
    expect(isSinaStockAtLimit(stock, 'up')).toBe(true)
    expect(isSinaStockAtLimit({ ...stock, code: '920001', trade: '13' }, 'up')).toBe(true)
    expect(isSinaStockAtLimit({ ...stock, settlement: undefined }, 'up')).toBe(false)
    expect(isSinaStockAtLimit({ ...stock, name: 'N测试' }, 'up')).toBe(false)
  })
})

describe('A-share market symbol routing', () => {
  it('routes Beijing Stock Exchange codes to bj for both fallback providers', () => {
    for (const code of ['430047', '830799', '870976', '920725']) {
      expect(isBeijingStockCode(code)).toBe(true)
      expect(sinaMarketSymbol(code)).toBe(`bj${code}`)
    }
  })

  it('keeps Shanghai and Shenzhen symbols unchanged', () => {
    expect(sinaMarketSymbol('600000')).toBe('sh600000')
    expect(sinaMarketSymbol('000001')).toBe('sz000001')
    expect(sinaMarketSymbol('300001')).toBe('sz300001')
  })
})
