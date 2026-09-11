import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { validateDailyOutputs } from './dailyOutputValidation'

const target = '2026-09-10'
const tabKeys = ['breakout', 'trigger', 'watch', 'pullback', 'highdiv', 'volbreak', 'fundres', 'bhold', 'bholdWatch', 'trendnew', 'trendwatch', 'accum', 'bigbreak', 'bigbreakWatch', 'huishou', 'yuncong']
let root = ''

function writeJson(file: string, value: unknown) {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, JSON.stringify(value), 'utf8')
}

function seed() {
  const screener: Record<string, unknown> = {
    asof: target, marketDataAsOf: target, marketDataDegraded: false, scanMode: 'close', signalState: 'confirmed', closed: true,
    regime: {}, universe: 10, scanned: 10, fetched: 10,
    dataQuality: { passed: true, sources: ['eastmoney', 'sina'], universeCoverage: .99, quoteCoverage: .99, historyCoverage: .99, crossSourceAgreement: .99, freshQuoteCoverage: .99, warnings: [] },
  }
  for (const key of tabKeys) screener[key] = []
  writeJson(join(root, 'docs', 'screener', `${target}.json`), screener)
  for (const name of ['structure', 'tempo', 'review', 'forward']) writeJson(join(root, 'docs', 'screener', `${name}-${target}.json`), { asof: target })
  writeJson(join(root, 'docs', 'ladder', '2026', '09', '10', 'analysis-limit-ladder-v6.json'), { asof: target, archived: true, archiveStage: 'core-settled', formalSignalEligible: false })
}

afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = '' })

describe('validateDailyOutputs', () => {
  it('validates the formal screener and every daily output family', () => {
    root = mkdtempSync(join(tmpdir(), 'daily-output-validation-'))
    seed()
    const report = validateDailyOutputs(root, target)
    expect(report.ok).toBe(true)
    expect(report.screener.tabCounts).toMatchObject({ breakout: 0, huishou: 0, yuncong: 0 })
    expect(report.ladder.archiveStage).toBe('core-settled')
  })

  it('rejects a snapshot with a missing tab and target-date mismatch', () => {
    root = mkdtempSync(join(tmpdir(), 'daily-output-validation-'))
    seed()
    writeJson(join(root, 'docs', 'screener', `${target}.json`), { asof: target, regime: {}, breakout: [], trigger: [], pullback: [], dataQuality: {} })
    writeJson(join(root, 'docs', 'screener', `tempo-${target}.json`), { asof: '2026-09-09' })
    const report = validateDailyOutputs(root, target)
    expect(report.ok).toBe(false)
    expect(report.screener.reasons.join(';')).toContain('缺失')
    expect(report.files.find((file) => file.file.includes('tempo'))?.ok).toBe(false)
  })

  it('can require a completed research-only Huishou run', () => {
    root = mkdtempSync(join(tmpdir(), 'daily-output-validation-'))
    seed()
    const report = validateDailyOutputs(root, target, { requireHuishou: true })
    expect(report.ok).toBe(false)
    expect(report.huishou.reasons.join(';')).toContain('挥手研究归档')
  })

  it('requires the persisted post-close Huishou review summary to match the run', () => {
    root = mkdtempSync(join(tmpdir(), 'daily-output-validation-'))
    seed()
    const runId = '3f2c3631-5067-4f43-8476-462ecf3341bc'
    writeJson(join(root, 'docs', 'research', 'huishou-screen', runId, 'run.json'), {
      runId, target, status: 'completed', researchOnly: true, eligibleAsTradeGate: false,
      updatedAt: '2026-09-10T15:30:00.000Z', processed: 10, universeCount: 10, candidateStocks: 1, notComparable: 1,
    })
    const withoutSummary = validateDailyOutputs(root, target, { requireHuishou: true })
    expect(withoutSummary.ok).toBe(false)
    expect(withoutSummary.huishou.reasons.join(';')).toContain('摘要')
    writeJson(join(root, 'docs', 'research', 'strategy-review-data', target, 'huishou-daily-review.json'), {
      target, runId, status: 'completed', researchOnly: true, eligibleAsTradeGate: false,
    })
    expect(validateDailyOutputs(root, target, { requireHuishou: true }).ok).toBe(true)
  })

  it('can require a separately refreshed auxiliary-page report', () => {
    root = mkdtempSync(join(tmpdir(), 'daily-output-validation-'))
    seed()
    const withoutAuxiliary = validateDailyOutputs(root, target, { requireAuxiliary: true })
    expect(withoutAuxiliary.ok).toBe(false)
    writeJson(join(root, 'docs', 'screener', `auxiliary-${target}.json`), {
      target,
      endpoints: { fundResonance: { ok: true }, orgSurvey: { ok: true }, institutionAccum: { ok: true } },
    })
    expect(validateDailyOutputs(root, target, { requireAuxiliary: true }).ok).toBe(true)
  })
})
