import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  useAuctionBriefs,
  useFirstBoardScan,
  useHithinkAnomaly,
  useLadderAnalysis,
} from './useLadderAnalysis'

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
    vi.useRealTimers()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  function delayedAnalysis(delayMs: number, date = '2026-09-09') {
    return (_url: string, init?: RequestInit) => new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer)
        reject(new DOMException('signal is aborted without reason', 'AbortError'))
      }
      const timer = setTimeout(() => {
        init?.signal?.removeEventListener('abort', abort)
        resolve({
          ok: true, status: 200,
          json: async () => ({ asof: date, archived: false }),
        })
      }, delayMs)
      init?.signal?.addEventListener('abort', abort, { once: true })
    })
  }

  it('waits for a cold analysis that takes more than two minutes without retrying', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(delayedAnalysis(180_000))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLadderAnalysis('2026-09-09'))

    await act(async () => { await vi.advanceTimersByTimeAsync(120_001) })
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(59_999) })
    expect(result.current.data?.asof).toBe('2026-09-09')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps existing data while a refresh takes more than two minutes', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockImplementationOnce(delayedAnalysis(0))
      .mockImplementationOnce(delayedAnalysis(180_000))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLadderAnalysis('2026-09-09'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const originalData = result.current.data
    let refresh: Promise<boolean>
    act(() => { refresh = result.current.refresh() })

    await act(async () => { await vi.advanceTimersByTimeAsync(120_001) })
    expect(result.current.data).toBe(originalData)
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999)
      expect(await refresh).toBe(true)
    })
    expect(result.current.data?.asof).toBe('2026-09-09')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('reports the actual deadline without retrying (refresh=%s)', async (refresh) => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
    if (refresh) fetchMock.mockImplementationOnce(delayedAnalysis(0))
    fetchMock.mockImplementation(delayedAnalysis(900_001))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLadderAnalysis('2026-09-09'))
    let refreshResult: Promise<boolean> | undefined
    if (refresh) {
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      act(() => { refreshResult = result.current.refresh() })
    }
    const originalData = result.current.data
    await act(async () => { await vi.advanceTimersByTimeAsync(899_999) })
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      if (refreshResult) expect(await refreshResult).toBe(false)
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('连板天梯分析等待超时（15 分钟），请稍后手动刷新')
    expect(result.current.data).toBe(originalData)
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(fetchMock).toHaveBeenCalledTimes(refresh ? 2 : 1)
  })

  it('ignores a slow response from the previous selected date', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockImplementationOnce(delayedAnalysis(180_000, '2026-09-08'))
      .mockImplementationOnce(delayedAnalysis(0, '2026-09-09'))
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(({ date }) => useLadderAnalysis(date), {
      initialProps: { date: '2026-09-08' },
    })
    rerender({ date: '2026-09-09' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.data?.asof).toBe('2026-09-09')

    await act(async () => { await vi.advanceTimersByTimeAsync(180_000) })
    expect(result.current.data?.asof).toBe('2026-09-09')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('revalidates a stored archive so server revisions become visible', async () => {
    localStorage.setItem('limit-ladder-snapshot-v6:2026-09-08', JSON.stringify({
      asof: '2026-09-08', archived: true, quality: { fundFlowComplete: true }, revision: 1,
    }))
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ asof: '2026-09-08', archived: true, quality: { fundFlowComplete: true }, revision: 2 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLadderAnalysis('2026-09-08'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(localStorage.getItem('limit-ladder-snapshot-v6:2026-09-08')!).revision).toBe(2)
  })

  it('refreshes the selected date explicitly and preserves data on repair failure', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ asof: '2026-09-08', archived: false }),
    }).mockResolvedValueOnce({
      ok: false, status: 409, json: async () => ({ error: '归档补全窗口已关闭' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLadderAnalysis('2026-09-08'))
    await waitFor(() => expect(result.current.data?.asof).toBe('2026-09-08'))
    await act(async () => { expect(await result.current.refresh()).toBe(false) })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/ladder/analysis/refresh')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ date: '2026-09-08' }) })
    expect(result.current.error).toBe('归档补全窗口已关闭')
    expect(result.current.data?.asof).toBe('2026-09-08')
    expect(fetchMock).toHaveBeenCalledTimes(2)
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

describe('useHithinkAnomaly', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the latest research-only anomaly reason for the selected A-share', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        datasets: [
          {
            dataset: 'anomaly',
            data: {
              item: [
                {
                  stock_name: '测试股份',
                  tag_name: '异动',
                  analysis_content: '同花顺当日异动原因。',
                  keyword_list: '机器人，减速器',
                },
              ],
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useHithinkAnomaly('600001'))

    await waitFor(() => expect(result.current.detail?.content).toBe('同花顺当日异动原因。'))
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/research/hithink/stock?thscode=600001.SH')
    expect(result.current.detail?.keywords).toEqual(['机器人', '减速器'])
  })
})
