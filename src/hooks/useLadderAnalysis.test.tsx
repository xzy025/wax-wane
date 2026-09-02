import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuctionBriefs, useFirstBoardScan, useLadderAnalysis } from './useLadderAnalysis'

describe('useAuctionBriefs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads by signal date and immediately reloads when the refresh key changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        signalDate: '2026-08-18',
        tradeDate: '2026-08-19',
        ruleVersion: 'limit-ladder-v4',
        notification: { provider: 'serverchan', enabled: true, configured: true },
        briefs: [],
        deliveries: [],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender, unmount } = renderHook(
      ({ refreshKey }) => useAuctionBriefs('2026-08-18', true, refreshKey),
      { initialProps: { refreshKey: 0 } },
    )

    await waitFor(() => expect(result.current.data?.tradeDate).toBe('2026-08-19'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/ladder/auction-brief?signalDate=2026-08-18',
    )

    rerender({ refreshKey: 1 })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    unmount()
  })

  it('requests the first-board scan for the selected trade date', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ tradeDate: '2026-08-27' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender, unmount } = renderHook(
      ({ tradeDate, refreshKey }) => useFirstBoardScan(tradeDate, true, refreshKey),
      { initialProps: { tradeDate: '2026-08-27', refreshKey: 0 } },
    )

    await waitFor(() => expect(result.current.data?.tradeDate).toBe('2026-08-27'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/ladder/first-board-scan?tradeDate=2026-08-27')

    rerender({ tradeDate: '2026-08-26', refreshKey: 0 })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/ladder/first-board-scan?tradeDate=2026-08-26')
    unmount()
  })
})

describe('useLadderAnalysis', () => {
  afterEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('clears the previous archive when the selected date has no data', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ asof: '2026-08-27', archived: false }),
      })
      .mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: '未找到2026-09-01的连板天梯归档' }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ date }) => useLadderAnalysis(date),
      { initialProps: { date: '2026-08-27' } },
    )

    await waitFor(() => expect(result.current.data?.asof).toBe('2026-08-27'))
    rerender({ date: '2026-09-01' })

    await waitFor(() => expect(result.current.error).toContain('未找到2026-09-01'))
    expect(result.current.data).toBeNull()
  })
})
