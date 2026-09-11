import { describe, expect, it } from 'vitest'
import {
  createDefaultMarketDataProviderRegistry,
  createMarketDataEnvelope,
  envelopeForTradingCalendar,
  envelopeForKplLadder,
  isMarketDataAllowedForPurpose,
  selectMarketDataEnvelope,
  selectMarketDataEnvelopeForPurpose,
} from './marketDataSource'

describe('market data envelope and provider registry', () => {
  it('distinguishes unavailable, empty, stale, and partial data', () => {
    expect(createMarketDataEnvelope({ datasetId: 'quote', provider: 'eastmoney', data: null }).status).toBe('unavailable')
    expect(createMarketDataEnvelope({ datasetId: 'quote', provider: 'eastmoney', data: [] }).status).toBe('empty')
    expect(createMarketDataEnvelope({
      datasetId: 'quote',
      provider: 'eastmoney',
      data: [{ code: '600001' }],
      asOf: '2026-08-27',
      expectedTradeDate: '2026-09-02',
    }).status).toBe('stale')
    expect(createMarketDataEnvelope({
      datasetId: 'quote',
      provider: 'eastmoney',
      data: [{ code: '600001' }],
      missingReasons: ['缺少成交额'],
    }).status).toBe('partial')
  })

  it('keeps component-level A-share gaps visible at the envelope level', () => {
    const envelope = createMarketDataEnvelope({
      datasetId: 'quote',
      provider: 'eastmoney',
      data: [{ code: '600001' }],
      coverage: 0.5,
      missingReasons: ['涨停池缺失'],
    })
    expect(envelope.status).toBe('partial')
    expect(envelope.coverage).toBe(0.5)
    expect(envelope.rawHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('uses a usable backup and retains attempted source order', () => {
    const selected = selectMarketDataEnvelope([
      createMarketDataEnvelope({ datasetId: 'ladder', provider: 'kaipanla', data: null, missingReasons: ['HTTP 503'] }),
      createMarketDataEnvelope({ datasetId: 'ladder', provider: 'quicktiny', data: [{ code: '600001' }] }),
    ])
    expect(selected?.source).toBe('quicktiny')
    expect(selected?.fallbackChain).toEqual(['kaipanla', 'quicktiny'])
    expect(selected?.data).toEqual([{ code: '600001' }])
  })

  it('uses only a quality-approved source for formal/scoring purposes', () => {
    const selected = selectMarketDataEnvelopeForPurpose([
      createMarketDataEnvelope({
        datasetId: 'quote',
        provider: 'eastmoney',
        data: [{ code: '600001' }],
        status: 'partial',
        asOf: '2026-09-02',
        providerAt: '2026-09-02T07:00:00.000Z',
        coverage: 0.5,
      }),
      createMarketDataEnvelope({
        datasetId: 'quote',
        provider: 'sina',
        data: [{ code: '600001' }],
        asOf: '2026-09-02',
        providerAt: '2026-09-02T07:00:01.000Z',
        receivedAt: '2026-09-02T07:00:02.000Z',
        coverage: 1,
      }),
    ], 'formal')
    expect(selected?.source).toBe('sina')
    expect(selected?.fallbackChain).toEqual(['eastmoney', 'sina'])
    expect(selectMarketDataEnvelopeForPurpose([
      createMarketDataEnvelope({
        datasetId: 'quote',
        provider: 'eastmoney',
        data: [{ code: '600001' }],
        asOf: '2026-09-02',
        providerAt: '2026-09-02T07:00:00.000Z',
        coverage: 0.5,
      }),
    ], 'formal')).toBeNull()
  })

  it('does not call an empty ladder successful and exposes stale date', () => {
    const empty = envelopeForKplLadder({
      date: '2026-09-02',
      stocks: [],
      complete: true,
      missingTiers: [],
    }, '2026-09-02')
    expect(empty.status).toBe('empty')

    const stale = envelopeForKplLadder({
      date: '2026-08-27',
      stocks: [{ code: '600001' } as never],
      complete: true,
      missingTiers: [],
    }, '2026-09-02')
    expect(stale.status).toBe('stale')
  })

  it('preserves an adapter-reported unavailable empty ladder', () => {
    const unavailable = envelopeForKplLadder({
      date: '2026-09-02',
      stocks: [],
      complete: true,
      missingTiers: [],
      source: 'quicktiny',
      dataStatus: 'unavailable',
    }, '2026-09-02')
    const degraded = envelopeForKplLadder({
      date: '2026-09-02',
      stocks: [{ code: '600001' } as never],
      complete: true,
      missingTiers: [],
      source: 'quicktiny',
      dataStatus: 'degraded',
    }, '2026-09-02')

    expect(unavailable.status).toBe('unavailable')
    expect(degraded.status).toBe('degraded')
  })

  it('describes current source capabilities without claiming fetch success', () => {
    const registry = createDefaultMarketDataProviderRegistry()
    expect(registry.resolve('kline', ['tencent'])?.id).toBe('tencent')
    expect(registry.list('calendar').map((provider) => provider.id)).toEqual(['trading-calendar-config'])
    expect(registry.resolve('quote', ['missing', 'sina'])?.id).toBe('sina')
  })

  it('does not turn unknown or research-only providers into scoring inputs', () => {
    const registry = createDefaultMarketDataProviderRegistry()
    expect(isMarketDataAllowedForPurpose(registry, 'eastmoney', 'quote', 'scoring')).toBe(true)
    expect(isMarketDataAllowedForPurpose(registry, 'eastmoney', 'quote', 'formal')).toBe(true)
    expect(isMarketDataAllowedForPurpose(registry, 'hithink-finance', 'research-valuation', 'scoring')).toBe(false)
    expect(isMarketDataAllowedForPurpose(registry, 'missing', 'quote', 'scoring')).toBe(false)
    expect(isMarketDataAllowedForPurpose(registry, 'eastmoney', 'quote', 'scoring', 'shadow')).toBe(false)
  })

  it('wraps the independent trading calendar without coupling it to ladder archives', () => {
    const envelope = envelopeForTradingCalendar(['2026-09-02', '2026-08-31'], 'exchange-calendar', '2026.09.01')
    expect(envelope).toMatchObject({
      datasetId: 'calendar',
      source: 'exchange-calendar',
      status: 'full',
      asOf: '2026-09-02',
      coverage: 1,
      data: ['2026-08-31', '2026-09-02'],
    })
    expect(envelope.rawHash).toMatch(/^[a-f0-9]{64}$/)
    expect(envelopeForTradingCalendar([], 'exchange-calendar').status).toBe('empty')
  })
})
