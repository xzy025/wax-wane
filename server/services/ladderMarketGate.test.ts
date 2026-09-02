import { describe, expect, it } from 'vitest'
import type { IndexQuote } from './emQuotes'
import type { MacroIndicator } from './macro'
import {
  buildDomesticMarketSnapshot,
  buildMarketRepairContext,
  buildMarketRiskGate,
  buildPremarketRiskSnapshot,
  buildThemePermissions,
} from './ladderMarketGate'

function quote(code: string, name: string, changePct: number): IndexQuote {
  return {
    code,
    name,
    price: 100,
    changePct,
    changeAmt: changePct,
    volume: 1,
    turnover: 1,
    high: 101,
    low: 99,
    open: 100,
    prevClose: 100,
  }
}

function macro(
  id: string,
  value: number | null,
  previousClose: number | null,
  source: MacroIndicator['source'] = 'twelve-data',
): MacroIndicator {
  const unavailable = source === 'unavailable'
  return {
    id,
    value,
    previousClose,
    unit: '%',
    source,
    status: unavailable ? 'unavailable' : previousClose == null ? 'degraded' : 'full',
    providerAt: unavailable ? null : '2026-08-19T00:45:00.000Z',
    receivedAt: '2026-08-19T00:50:00.000Z',
    asOf: unavailable ? null : '2026-08-19',
    warnings: unavailable ? ['test unavailable'] : [],
    missingReasons: unavailable ? ['test unavailable'] : [],
  }
}

function riskOffPremarket() {
  return buildPremarketRiskSnapshot({
    signalDate: '2026-08-18',
    tradeDate: '2026-08-19',
    capturedAt: '2026-08-19T00:50:00.000Z',
    us: [
      quote('IXIC', '纳斯达克', -3.5),
      quote('SPX', '标普500', -2.6),
      quote('DJI', '道琼斯', -1.8),
    ],
    asia: [
      quote('N225', '日经225', -3.2),
      quote('KS11', '韩国KOSPI', -4.1),
    ],
    macro: [
      macro('us10y', 4.5, 4.28),
      { ...macro('vix', 30, 20), unit: '' },
    ],
    news: [],
    newsWindowStart: '2026-08-18T15:00:00+08:00',
    newsWindowEnd: '2026-08-19T09:15:00+08:00',
  })
}

describe('ladder market hierarchy gate', () => {
  it('treats an overnight panic as a premarket restriction, not a standalone freeze', () => {
    const premarket = riskOffPremarket()
    const gate = buildMarketRiskGate({
      signalDate: premarket.signalDate,
      tradeDate: premarket.tradeDate,
      phase: 'premarket',
      premarket,
      themes: ['芯片', '农业'],
    })

    expect(premarket.state).toBe('panic')
    expect(premarket.usRiskScore).toBeGreaterThan(80)
    expect(premarket.asiaRiskScore).toBe(100)
    expect(gate.state).toBe('restricted')
    expect(gate.domesticConfirmed).toBe(false)
    expect(
      gate.themePermissions.find((row) => row.theme === '芯片')?.state,
    ).toBe('conditional')
  })

  it('freezes confirmations only after A-share auction risk confirms the external shock', () => {
    const premarket = riskOffPremarket()
    const domestic = buildDomesticMarketSnapshot({
      capturedAt: '2026-08-19T01:25:00.000Z',
      indices: [
        quote('000001', '上证指数', -2.4),
        quote('399001', '深证成指', -3.6),
        quote('399006', '创业板指', -4.2),
      ],
      advance: 420,
      decline: 4_700,
      flat: 40,
      limitUp: 6,
      limitDown: 35,
      highBoardState: 'panic',
    })
    const gate = buildMarketRiskGate({
      signalDate: premarket.signalDate,
      tradeDate: premarket.tradeDate,
      phase: 'auction',
      premarket,
      domestic,
      themes: ['芯片', '农业'],
    })

    expect(gate.domesticConfirmed).toBe(true)
    expect(gate.state).toBe('frozen')
  })

  it('blocks high-beta themes while only allowing defensive themes with independent auction breadth', () => {
    const permissions = buildThemePermissions({
      gateState: 'restricted',
      externalState: 'panic',
      themes: ['芯片', '农业', '医药'],
      auctionThemes: [
        {
          theme: '农业',
          score: 78,
          state: 'leading',
          positiveRate: 80,
          assistantCount: 3,
        },
        {
          theme: '医药',
          score: 52,
          state: 'weak',
          positiveRate: 40,
          assistantCount: 1,
        },
      ],
    })
    const byTheme = new Map(permissions.map((row) => [row.theme, row]))

    expect(byTheme.get('芯片')?.state).toBe('blocked')
    expect(byTheme.get('芯片')?.environmentAdjustment).toBe(-8)
    expect(byTheme.get('农业')?.state).toBe('allowed')
    expect(byTheme.get('农业')?.environmentAdjustment).toBe(5)
    expect(byTheme.get('医药')?.state).toBe('conditional')
  })

  it('excludes unavailable macro values instead of treating them as evidence', () => {
    const snapshot = buildPremarketRiskSnapshot({
      signalDate: '2026-08-18',
      tradeDate: '2026-08-19',
      capturedAt: '2026-08-19T00:50:00.000Z',
      us: [quote('IXIC', '纳斯达克', -1)],
    asia: [],
    macro: [
        macro('us10y', null, null, 'unavailable'),
      ],
      news: [],
      newsWindowStart: '2026-08-18T15:00:00+08:00',
      newsWindowEnd: '2026-08-19T09:15:00+08:00',
    })

    expect(snapshot.macro).toEqual([])
    expect(snapshot.usRiskScore).toBe(45)
    expect(snapshot.asiaRiskScore).toBeNull()
    expect(snapshot.warnings.join('')).toContain('真实行情缺失')
  })

  it('returns an unavailable risk state when no external risk component is observed', () => {
    const snapshot = buildPremarketRiskSnapshot({
      signalDate: '2026-08-18',
      tradeDate: '2026-08-19',
      capturedAt: '2026-08-19T00:50:00.000Z',
      us: [],
      asia: [],
      macro: [],
      news: [],
      newsWindowStart: '2026-08-18T15:00:00+08:00',
      newsWindowEnd: '2026-08-19T09:15:00+08:00',
    })

    expect(snapshot.state).toBe('unavailable')
    expect(snapshot.riskScore).toBeNull()
    expect(snapshot.warnings.join('')).toContain('覆盖率')
  })

  it('distinguishes broad, weight-led and small-cap repair structures', () => {
    const domestic = (
      styleIndices: IndexQuote[],
      advance: number,
      decline: number,
      highBoardState: 'expansion' | 'divergence' | 'contraction' | 'panic',
    ) =>
      buildDomesticMarketSnapshot({
        capturedAt: '2026-08-20T01:25:00.000Z',
        indices: [
          quote('000001', '上证指数', 0.3),
          quote('399001', '深证成指', 0.2),
          quote('399006', '创业板指', 0.1),
        ],
        styleIndices,
        advance,
        decline,
        flat: 0,
        limitUp: 30,
        limitDown: 5,
        highBoardState,
      })

    const broad = buildMarketRepairContext({
      phase: 'auction',
      domestic: domestic(
        [
          quote('SSE50', '上证50', 0.5),
          quote('CSI300', '沪深300', 0.4),
          quote('CSI1000', '中证1000', 0.3),
          quote('CSI2000', '中证2000', 0.2),
        ],
        600,
        400,
        'expansion',
      ),
      largeCapAuctionAmountSharePct: 45,
      highBoardState: 'expansion',
    })
    const weightLed = buildMarketRepairContext({
      phase: 'auction',
      domestic: domestic(
        [
          quote('SSE50', '上证50', 0.5),
          quote('CSI300', '沪深300', -0.1),
          quote('CSI1000', '中证1000', -0.4),
          quote('CSI2000', '中证2000', -0.4),
        ],
        400,
        600,
        'contraction',
      ),
      largeCapAuctionAmountSharePct: 65,
      highBoardState: 'contraction',
    })
    const smallCap = buildMarketRepairContext({
      phase: 'auction',
      domestic: domestic(
        [
          quote('SSE50', '上证50', -0.1),
          quote('CSI300', '沪深300', 0),
          quote('CSI1000', '中证1000', 0.6),
          quote('CSI2000', '中证2000', 0.5),
        ],
        580,
        420,
        'expansion',
      ),
      largeCapAuctionAmountSharePct: 35,
      highBoardState: 'expansion',
    })

    expect(broad.state).toBe('broad-repair')
    expect(weightLed.state).toBe('weight-led-repair')
    expect(weightLed.largeCapChangePct).toBe(0.2)
    expect(smallCap.state).toBe('small-cap-repair')
  })

  it('keeps low-coverage repair evidence display-only and freezes the 9:25 result at 9:35', () => {
    const lowCoverageDomestic = buildDomesticMarketSnapshot({
      capturedAt: '2026-08-20T01:25:00.000Z',
      indices: [],
      styleIndices: [quote('SSE50', '上证50', 0.8)],
      advance: 400,
      decline: 600,
      flat: 0,
      limitUp: 0,
      limitDown: 0,
    })
    const lowCoverage = buildMarketRepairContext({
      phase: 'auction',
      domestic: lowCoverageDomestic,
    })
    const frozen = buildMarketRepairContext({
      phase: 'auction',
      domestic: buildDomesticMarketSnapshot({
        capturedAt: '2026-08-20T01:25:00.000Z',
        indices: [],
        styleIndices: [
          quote('SSE50', '上证50', 0.6),
          quote('CSI300', '沪深300', 0.5),
          quote('CSI1000', '中证1000', -0.2),
          quote('CSI2000', '中证2000', -0.3),
        ],
        advance: 400,
        decline: 600,
        flat: 0,
        limitUp: 20,
        limitDown: 8,
        highBoardState: 'contraction',
      }),
      largeCapAuctionAmountSharePct: 65,
      highBoardState: 'contraction',
    })
    const open = buildMarketRepairContext({
      phase: 'open',
      domestic: lowCoverageDomestic,
      frozenContext: frozen,
    })

    expect(lowCoverage.confidence).toBe(50)
    expect(lowCoverage.applicable).toBe(false)
    expect(lowCoverage.warnings.join('')).toContain('仅展示')
    expect(open).toEqual(frozen)
  })
})
