import { describe, it, expect, beforeEach } from 'vitest'
import {
  DEFAULT_STOCKS,
  getCustomStocks,
  addCustomStock,
  removeCustomStock,
  normalizeStockCode,
} from './customStocks'

describe('customStocks', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('defaults', () => {
    it('returns the default lists on first run', () => {
      expect(getCustomStocks('us')).toEqual(DEFAULT_STOCKS.us)
      expect(getCustomStocks('hk')).toEqual(DEFAULT_STOCKS.hk)
    })

    it('keeps the stored list once the user has edited it', () => {
      addCustomStock('us', 'TSLA')
      expect(getCustomStocks('us')).toEqual([...DEFAULT_STOCKS.us, 'TSLA'])
    })

    it('does not resurrect defaults after the user empties the list', () => {
      for (const code of DEFAULT_STOCKS.us) removeCustomStock('us', code)
      expect(getCustomStocks('us')).toEqual([])
    })

    it('falls back to defaults for a market missing from storage', () => {
      localStorage.setItem('custom-stocks', JSON.stringify({ us: ['TSLA'] }))
      expect(getCustomStocks('us')).toEqual(['TSLA'])
      expect(getCustomStocks('hk')).toEqual(DEFAULT_STOCKS.hk)
    })

    it('falls back to defaults on corrupted storage', () => {
      localStorage.setItem('custom-stocks', 'not json')
      expect(getCustomStocks('hk')).toEqual(DEFAULT_STOCKS.hk)
    })
  })

  describe('normalizeStockCode', () => {
    it('zero-pads short numeric HK codes to 5 digits', () => {
      expect(normalizeStockCode('hk', '700')).toBe('00700')
      expect(normalizeStockCode('hk', '9988')).toBe('09988')
    })

    it('leaves 6-digit A-share codes untouched on the HK market', () => {
      expect(normalizeStockCode('hk', '300476')).toBe('300476')
    })

    it('uppercases US tickers without padding', () => {
      expect(normalizeStockCode('us', 'nvda')).toBe('NVDA')
    })
  })

  describe('add/remove', () => {
    it('normalizes when adding HK codes', () => {
      addCustomStock('hk', '1810')
      expect(getCustomStocks('hk')).toContain('01810')
    })

    it('rejects duplicates and empty input', () => {
      expect(addCustomStock('us', 'NVDA')).toBe(false) // already in defaults
      expect(addCustomStock('us', '  ')).toBe(false)
      expect(addCustomStock('us', 'tsla')).toBe(true)
      expect(addCustomStock('us', 'TSLA')).toBe(false)
    })

    it('removes a single code', () => {
      removeCustomStock('hk', '00700')
      expect(getCustomStocks('hk')).toEqual(
        DEFAULT_STOCKS.hk.filter((c) => c !== '00700'),
      )
    })
  })
})
