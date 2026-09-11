import { describe, expect, it } from 'vitest'
import {
  evaluateFormalScreenerSnapshot,
  shouldReplaceCompatibleScreenerSnapshot,
  shouldReplaceScreenerSnapshot,
} from './snapshotPolicy'

const quality = {
  passed: true,
  universeCoverage: 1,
  quoteCoverage: 1,
  historyCoverage: 1,
  crossSourceAgreement: 1,
  freshQuoteCoverage: 1,
}

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  asof: '2026-09-10',
  marketDataAsOf: '2026-09-10',
  scanMode: 'close',
  signalState: 'confirmed',
  closed: true,
  dataQuality: quality,
  universe: 5000,
  scanned: 100,
  fetched: 100,
  ...overrides,
})

describe('formal screener snapshot policy', () => {
  it('fails closed for provisional, stale or degraded snapshots', () => {
    expect(evaluateFormalScreenerSnapshot(snapshot({ signalState: 'provisional' })).allowed).toBe(false)
    expect(evaluateFormalScreenerSnapshot(snapshot({ marketDataAsOf: '2026-09-09' })).allowed).toBe(false)
    expect(evaluateFormalScreenerSnapshot(snapshot({ marketDataDegraded: true })).allowed).toBe(false)
  })

  it('does not trust a forged passed flag when coverage is below the formal floor', () => {
    const decision = evaluateFormalScreenerSnapshot(snapshot({
      dataQuality: { ...quality, passed: true, quoteCoverage: 0.9 },
    }))
    expect(decision.allowed).toBe(false)
    expect(decision.reasons).toContain('quoteCoverage 90.0% < 98.0%')
  })

  it('rejects a lower-coverage same-day replacement', () => {
    expect(shouldReplaceScreenerSnapshot(snapshot({ fetched: 100 }), snapshot({ fetched: 99 }))).toBe(false)
    expect(shouldReplaceScreenerSnapshot(snapshot({ fetched: 99 }), snapshot({ fetched: 100 }))).toBe(true)
  })

  it('permits an initial valid formal snapshot', () => {
    expect(shouldReplaceScreenerSnapshot(null, snapshot())).toBe(true)
  })

  it('does not let a legacy backfill replace an existing formal snapshot', () => {
    expect(shouldReplaceCompatibleScreenerSnapshot(snapshot(), {
      asof: '2026-09-10',
      closed: true,
      fetched: 999,
    })).toBe(false)
    expect(shouldReplaceCompatibleScreenerSnapshot(null, {
      asof: '2026-09-10',
      closed: true,
    })).toBe(true)
  })
})
