import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
}))

vi.mock('pg', () => ({
  default: {
    Pool: class MockPool {
      connect = mocks.connect
      query = mocks.query
    },
  },
}))

import { upsertScreenerSnapshot } from './pgDatabase'

const snapshot = JSON.stringify({ asof: '2099-12-30', closed: true, result: [] })

function setupCurrent(revisionRows: unknown[]) {
  const query = vi.fn()
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({}) // advisory lock
    .mockResolvedValueOnce({
      rows: [{
        result_json: snapshot,
        regime_phase: 'normal',
        universe: 1,
        scanned: 1,
        closed: true,
        created_at: '2099-12-30T08:00:00.000Z',
      }],
    })
    .mockResolvedValueOnce({ rows: revisionRows }) // revision history lookup
    .mockResolvedValue({})

  mocks.connect.mockResolvedValue({
    query,
    release: vi.fn(),
  })
}

afterEach(() => {
  mocks.connect.mockReset()
  mocks.query.mockReset()
})

describe('upsertScreenerSnapshot', () => {
  it('seeds revision one when an idempotent legacy projection has no history', async () => {
    setupCurrent([])
    const result = await upsertScreenerSnapshot({ asof: '2099-12-30', resultJson: snapshot })
    const connectedClient = await mocks.connect.mock.results[0].value
    const calls = connectedClient.query.mock.calls

    expect(result).toBe(true)
    expect(calls.some(([sql]: [string]) => sql.includes('INSERT INTO screener_snapshot_revisions'))).toBe(true)
  })

  it('does not create a duplicate revision when history already exists', async () => {
    setupCurrent([{ revision: 1 }])
    const result = await upsertScreenerSnapshot({ asof: '2099-12-30', resultJson: snapshot })
    const connectedClient = await mocks.connect.mock.results[0].value
    const calls = connectedClient.query.mock.calls

    expect(result).toBe(true)
    expect(calls.some(([sql]: [string]) => sql.includes('INSERT INTO screener_snapshot_revisions'))).toBe(false)
  })
})
