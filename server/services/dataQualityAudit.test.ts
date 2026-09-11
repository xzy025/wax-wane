import { describe, expect, it } from 'vitest'
import { auditLadderArchive, auditScreenerArchive } from './dataQualityAudit'

const quality = {
  passed: true,
  sources: ['eastmoney'],
  universeCoverage: 1,
  quoteCoverage: 1,
  historyCoverage: 1,
  crossSourceAgreement: 1,
  freshQuoteCoverage: 1,
  warnings: [],
}

const screener = (overrides: Record<string, unknown> = {}) => ({
  asof: '2026-09-10',
  marketDataAsOf: '2026-09-10',
  scanMode: 'close',
  signalState: 'confirmed',
  closed: true,
  dataQuality: quality,
  regime: {},
  breakout: [],
  trigger: [],
  pullback: [],
  ...overrides,
})

const ladder = (overrides: Record<string, unknown> = {}) => ({
  asof: '2026-09-10',
  archiveStage: 'enriched',
  formalSignalEligible: true,
  quality: {
    sourceDate: '2026-09-10',
    coreDataComplete: true,
    settled: true,
    sentimentStatus: 'full',
    limitFieldsComplete: true,
    klineTotal: 1,
    klineComplete: 1,
    receivedAt: '2026-09-10T07:10:00.000Z',
    adjustment: 'none',
    degraded: false,
    fundFlowComplete: true,
    providerAt: '2026-09-10T07:00:00.000Z',
  },
  stocks: [{ code: '000001' }],
  ...overrides,
})

describe('data quality audit', () => {
  it('blocks a screener archive with a stale or mismatched market date', () => {
    const result = auditScreenerArchive(screener({ marketDataAsOf: '2026-09-09' }), '2026-09-10.json', '2026-09-10')
    expect(result.status).toBe('block')
    expect(result.details).toContain('行情日期 2026-09-09 与快照日期 2026-09-10 不一致')
  })

  it('warns when a formal screener archive is valid but old', () => {
    const result = auditScreenerArchive(screener({ asof: '2026-09-01', marketDataAsOf: '2026-09-01' }), '2026-09-01.json', '2026-09-10')
    expect(result.status).toBe('warn')
    expect(result.metrics?.ageDays).toBe(9)
  })

  it('distinguishes a ladder core archive from an enriched formal signal', () => {
    const result = auditLadderArchive(ladder({ archiveStage: 'core-settled', formalSignalEligible: false }), 'analysis-limit-ladder-v6.json', '2026-09-10')
    expect(result.id).toBe('ladder-formal-signal')
    expect(result.status).toBe('warn')
    expect(result.details[0]).toContain('核心收盘事实')
  })

  it('passes an enriched ladder archive only when the formal evidence is complete', () => {
    const result = auditLadderArchive(ladder(), 'analysis-limit-ladder-v6-r2.json', '2026-09-10')
    expect(result).toMatchObject({ id: 'ladder-formal-signal', status: 'pass', asof: '2026-09-10' })
  })
})
