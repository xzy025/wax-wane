import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readAsiaMarketState, writeAsiaMarketState } from './asiaMarketCapture'
import type { AsiaMarketSnapshot } from './asiaMarketState'

const snapshot = (over: Partial<AsiaMarketSnapshot> = {}): AsiaMarketSnapshot => ({
  tradeDate: '2026-08-21',
  checkpoint: 'asia-open',
  provider: 'eastmoney-asia',
  providerTimestamp: '2026-08-21T00:00:05.000Z',
  receivedAt: '2026-08-21T00:00:05.000Z',
  instruments: [],
  quality: 'full',
  warnings: [],
  ...over,
})

describe('asia market state capture archive', () => {
  const tempRoots: string[] = []

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      try {
        rmSync(root, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
    delete process.env.ASIA_MARKET_STATE_ROOT
  })

  const withTempRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'asia-market-state-'))
    tempRoots.push(root)
    process.env.ASIA_MARKET_STATE_ROOT = root
    return root
  }

  it('writes and reads a per-checkpoint derived state atomically', () => {
    const root = withTempRoot()
    const state = snapshot({ checkpoint: 'asia-open' })
    writeAsiaMarketState(state)
    expect(readAsiaMarketState('2026-08-21', 'asia-open')).toMatchObject(state)
    expect(readAsiaMarketState('2026-08-21', 'asia-0900')).toBeNull()
    expect(existsSync(join(root, '2026-08-21', 'asia-open.json'))).toBe(true)
  })

  it('rejects unsafe trade dates', () => {
    withTempRoot()
    expect(() => writeAsiaMarketState(snapshot({ tradeDate: 'bad/date' }))).toThrow()
    expect(readAsiaMarketState('bad/date', 'asia-open')).toBeNull()
  })

  it('keeps per-checkpoint files independent', () => {
    withTempRoot()
    writeAsiaMarketState(snapshot({ checkpoint: 'asia-0830' }))
    writeAsiaMarketState(snapshot({ checkpoint: 'asia-0900' }))
    expect(readAsiaMarketState('2026-08-21', 'asia-0830')?.checkpoint).toBe('asia-0830')
    expect(readAsiaMarketState('2026-08-21', 'asia-0900')?.checkpoint).toBe('asia-0900')
  })
})