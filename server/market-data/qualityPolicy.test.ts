import { describe, expect, it } from 'vitest'
import { createMarketDataEnvelope } from './marketDataSource'
import {
  assertMarketDataQuality,
  evaluateMarketDataQuality,
  MarketDataQualityError,
} from './qualityPolicy'

const envelope = (overrides: Record<string, unknown> = {}) => createMarketDataEnvelope({
  datasetId: 'quote',
  provider: 'eastmoney',
  data: [{ code: '600001', price: 10 }],
  asOf: '2026-09-10',
  providerAt: '2026-09-10T07:00:00.000Z',
  receivedAt: '2026-09-10T07:00:02.000Z',
  coverage: 1,
  ...overrides,
})

describe('market data quality policy', () => {
  it('allows degraded data for display but rejects it for formal use', () => {
    const degraded = envelope({ status: 'degraded', missingReasons: ['字段缺失'] })
    expect(evaluateMarketDataQuality(degraded, 'display').allowed).toBe(true)
    expect(evaluateMarketDataQuality(degraded, 'formal')).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining(['状态 degraded 不满足 formal 用途要求']),
    })
  })

  it('requires provenance, as-of and coverage for formal data', () => {
    const incomplete = envelope({ providerAt: null, asOf: null, coverage: 0.9 })
    const decision = evaluateMarketDataQuality(incomplete, 'formal')
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toEqual(expect.arrayContaining(['缺少 providerAt', '缺少 asOf']))
    expect(decision.reasons.some((reason) => reason.includes('覆盖率'))).toBe(true)
  })

  it('rejects a provider timestamp that is later than local receipt', () => {
    const decision = evaluateMarketDataQuality(envelope({
      providerAt: '2026-09-10T07:00:03.000Z',
      receivedAt: '2026-09-10T07:00:02.000Z',
    }), 'formal')
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('providerAt 晚于 receivedAt')
  })

  it('keeps shadow and research-only sources out of formal use', () => {
    const decision = evaluateMarketDataQuality(envelope(), 'formal', 'shadow')
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('来源层级 shadow 不允许进入 formal')
    const research = createMarketDataEnvelope({
      datasetId: 'research-anomaly',
      provider: 'eastmoney',
      data: [{ code: '600001' }],
      asOf: '2026-09-10',
      providerAt: '2026-09-10T07:00:00.000Z',
      coverage: 1,
    })
    expect(evaluateMarketDataQuality(research, 'formal').allowed).toBe(false)
  })

  it('throws a typed error when callers explicitly assert the gate', () => {
    expect(() => assertMarketDataQuality(envelope({ status: 'stale' }), 'formal')).toThrow(MarketDataQualityError)
  })
})
