import { describe, expect, it } from 'vitest'
import { evaluateExecutionEligibility } from './executionEligibility'

describe('shared execution eligibility gate', () => {
  it('fails closed when either required intraday snapshot is missing', () => {
    const result = evaluateExecutionEligibility({
      stage: 'open',
      tradeDate: '2026-08-27',
      quote: { tradeDate: '2026-08-27', volume: 10_000, amount: 100_000 },
      confirmationState: 'confirmed',
      inaccessible: false,
      marketGateState: 'normal',
      themePermissionState: 'allowed',
      auctionSnapshotAvailable: false,
      openSnapshotAvailable: false,
      openingConfirmationGate: 'unavailable',
      technicalAvailable: true,
      riskBudgetAvailable: true,
    })
    expect(result.eligible).toBe(false)
    expect(result.reasons).toEqual(expect.arrayContaining(['缺少09:25竞价快照', '缺少09:35过程快照']))
  })

  it('only grants eligibility when every execution input is present', () => {
    const result = evaluateExecutionEligibility({
      stage: 'open',
      tradeDate: '2026-08-27',
      quote: { tradeDate: '2026-08-27', volume: 10_000, amount: 100_000 },
      confirmationState: 'confirmed',
      inaccessible: false,
      marketGateState: 'cautious',
      themePermissionState: 'allowed',
      auctionSnapshotAvailable: true,
      openSnapshotAvailable: true,
      openingConfirmationGate: 'passed',
      technicalAvailable: true,
      riskBudgetAvailable: true,
    })
    expect(result).toMatchObject({ eligible: true, reasons: [] })
  })
})
