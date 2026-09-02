import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLadderArchiveDates } from './useLadderAnalysis'

describe('useLadderArchiveDates', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads only the dates returned by the ladder archive endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ dates: ['2026-08-27', '2026-08-28', 'invalid'] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useLadderArchiveDates())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/ladder/archive-dates?limit=30',
      expect.objectContaining({ cache: 'no-store' }),
    )
    expect(result.current.dates).toEqual(new Set(['2026-08-27', '2026-08-28']))
  })
})
