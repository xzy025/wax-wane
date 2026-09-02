import { describe, expect, it } from 'vitest'
import {
  createComponentQuality,
  createSourceDiagnostic,
  envelopeStatus,
  unavailableComponent,
} from './dataQuality'

describe('market-data dataQuality', () => {
  it('keeps unavailable diagnostics distinct from observed numeric zeroes', () => {
    const quality = unavailableComponent('limitDown', 'eastmoney', 'HTTP 503', {
      asOf: '2026-09-01',
      warnings: ['HTTP 503', 'HTTP 503'],
    })

    expect(quality).toMatchObject({
      component: 'limitDown',
      source: 'eastmoney',
      status: 'unavailable',
      asOf: '2026-09-01',
      missingReasons: ['HTTP 503'],
      warnings: ['HTTP 503'],
    })
  })

  it('normalizes diagnostics and derives an aggregate status', () => {
    const full = createSourceDiagnostic({ source: 'eastmoney', status: 'full' })
    const degraded = createComponentQuality('volume', {
      source: 'sina',
      status: 'degraded',
      derived: true,
      warnings: ['turnover derived'],
    })

    expect(full.stale).toBe(false)
    expect(degraded.derived).toBe(true)
    expect(envelopeStatus([full, degraded])).toBe('degraded')
    expect(envelopeStatus([])).toBe('unavailable')
  })
})
