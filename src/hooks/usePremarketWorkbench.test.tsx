import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isUsCashSession, usePremarketWorkbench } from './usePremarketWorkbench'

function responseFor(tradeDate: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      tradeDate,
      generatedAt: tradeDate + 'T01:00:00.000Z',
      scheduler: { nextWindow: null, checkpoints: [], lastRuns: {} },
      asia: {},
      auction: {
        tradeDate,
        phase: 'auction',
        snapshotCount: 0,
        behaviors: [],
        labels: {},
        warnings: [],
      },
    }),
  } as Response
}

describe('usePremarketWorkbench', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('aborts the old request and ignores its late response after refresh', async () => {
    const deferred: Array<{
      signal: AbortSignal
      resolve: (response: Response) => void
    }> = []
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve) => {
      deferred.push({ signal: init?.signal as AbortSignal, resolve })
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ refreshKey }) => usePremarketWorkbench(true, refreshKey),
      { initialProps: { refreshKey: 0 } },
    )
    await waitFor(() => expect(deferred).toHaveLength(1))

    rerender({ refreshKey: 1 })
    await waitFor(() => expect(deferred).toHaveLength(2))
    expect(deferred[0].signal.aborted).toBe(true)

    deferred[1].resolve(responseFor('2026-08-25'))
    await waitFor(() => expect(result.current.data?.tradeDate).toBe('2026-08-25'))

    deferred[0].resolve(responseFor('2026-08-24'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(result.current.data?.tradeDate).toBe('2026-08-25')
  })

  it('uses New York cash-session hours for the live US refresh exception', () => {
    expect(isUsCashSession(new Date('2026-08-10T13:30:00.000Z'))).toBe(true)
    expect(isUsCashSession(new Date('2026-08-10T20:00:00.000Z'))).toBe(false)
    expect(isUsCashSession(new Date('2026-08-08T15:00:00.000Z'))).toBe(false)
  })
})

