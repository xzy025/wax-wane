import { describe, expect, it } from 'vitest'
import { isBeijingStockCode, sinaMarketSymbol } from './ashare'

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
