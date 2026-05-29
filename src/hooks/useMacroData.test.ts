import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useMacroData } from './useMacroData'

// Mock fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock marketHistory utils
vi.mock('../utils/marketHistory', () => ({
  todayStr: () => '2026-05-29',
  getDay: vi.fn(() => null),
  saveDay: vi.fn(),
}))

describe('useMacroData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches data from backend on mount', async () => {
    const mockData = [
      { id: 'us10y', value: 4.38, previousClose: 4.35, unit: '%' },
      { id: 'gold', value: 3285, previousClose: 3268, unit: 'USD/oz' },
    ]

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    })

    const { result } = renderHook(() => useMacroData())

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.data).toEqual(mockData)
    expect(result.current.error).toBeNull()
    expect(mockFetch).toHaveBeenCalledWith('/api/mcp/macro/indicators')
  })

  it('handles fetch error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    })

    const { result } = renderHook(() => useMacroData())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('Macro API: 500')
    expect(result.current.data).toEqual([])
  })

  it('refresh function fetches data again', async () => {
    const mockData = [{ id: 'us10y', value: 4.38, previousClose: 4.35, unit: '%' }]

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockData,
    })

    const { result } = renderHook(() => useMacroData())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    // Call refresh
    await result.current.refresh()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })
})
