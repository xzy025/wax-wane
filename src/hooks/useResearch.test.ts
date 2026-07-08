// 回归:superseded 请求的失败必须被 seq guard 丢弃(与 useNewsFlash 同款竞态)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResearch } from './useResearch'

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

const researchData = (tag: string) => ({
  date: '2026-07-07',
  llmConfigured: false,
  analyzing: false,
  reports: [],
  digest: null,
  generatedAt: tag,
})

describe('useResearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockFetch.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('首拉成功,无未完成分析时不挂收敛轮询', async () => {
    let getCount = 0
    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith('/api/refresh')) return Promise.resolve({ ok: true })
      getCount++
      return Promise.resolve({ ok: true, json: async () => researchData(`tick-${getCount}`) })
    })

    const { result } = renderHook(() => useResearch())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.data?.generatedAt).toBe('tick-1')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(getCount).toBe(1) // analyzing=false 且无 pending → 不轮询
  })

  it('挂起的首拉被手动刷新超越后,其超时失败不覆盖刷新拉回的数据(竞态回归)', async () => {
    let getCount = 0
    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).startsWith('/api/refresh')) return Promise.resolve({ ok: true })
      getCount++
      if (getCount === 1)
        // 首拉:挂起直到 fetchWithTimeout 的 20s abort
        return new Promise((_, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        })
      return Promise.resolve({ ok: true, json: async () => researchData('from-refresh') })
    })

    // t=0 挂载,首拉挂起
    const { result } = renderHook(() => useResearch())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.data).toBeNull()

    // t=1s:点刷新 → 成功,数据上屏,首拉已过期
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.data?.generatedAt).toBe('from-refresh')
    expect(result.current.error).toBeNull()

    // t=20s:首拉 abort → 过期失败被丢弃,error 不许出现
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(result.current.data?.generatedAt).toBe('from-refresh')
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})
