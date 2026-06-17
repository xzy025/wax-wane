import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSortableRows, type Accessors } from './useSortableRows'

interface Row {
  id: string
  v: number | null
  w: number | null
}

const ACC: Accessors<Row, 'v' | 'w'> = {
  v: (r) => r.v,
  w: (r) => r.w,
}

const ids = (rows: Row[]) => rows.map((r) => r.id)

describe('useSortableRows', () => {
  it('applies the initial sort on mount', () => {
    const rows: Row[] = [
      { id: 'a', v: 2, w: 0 },
      { id: 'b', v: 5, w: 0 },
      { id: 'c', v: 1, w: 0 },
    ]
    const { result } = renderHook(() => useSortableRows(rows, ACC, { key: 'v', dir: 'desc' }))
    expect(result.current.sortKey).toBe('v')
    expect(result.current.sortDir).toBe('desc')
    expect(ids(result.current.sorted)).toEqual(['b', 'a', 'c'])
  })

  it('toggling the active key flips direction', () => {
    const rows: Row[] = [
      { id: 'a', v: 2, w: 0 },
      { id: 'b', v: 5, w: 0 },
      { id: 'c', v: 1, w: 0 },
    ]
    const { result } = renderHook(() => useSortableRows(rows, ACC, { key: 'v', dir: 'desc' }))
    act(() => result.current.toggle('v'))
    expect(result.current.sortDir).toBe('asc')
    expect(ids(result.current.sorted)).toEqual(['c', 'a', 'b'])
  })

  it('toggling a new key starts descending (strongest first)', () => {
    const rows: Row[] = [
      { id: 'a', v: 2, w: 9 },
      { id: 'b', v: 5, w: 3 },
      { id: 'c', v: 1, w: 7 },
    ]
    // Pin K to the full key union: inference would otherwise narrow K to 'v' from
    // the initial-state literal, and toggle('w') below would not type-check.
    const { result } = renderHook(() => useSortableRows<Row, 'v' | 'w'>(rows, ACC, { key: 'v', dir: 'asc' }))
    act(() => result.current.toggle('w'))
    expect(result.current.sortKey).toBe('w')
    expect(result.current.sortDir).toBe('desc')
    expect(ids(result.current.sorted)).toEqual(['a', 'c', 'b'])
  })

  it('sinks nulls to the bottom in BOTH directions', () => {
    const rows: Row[] = [
      { id: 'a', v: 3, w: 0 },
      { id: 'b', v: null, w: 0 },
      { id: 'c', v: 1, w: 0 },
      { id: 'd', v: null, w: 0 },
    ]
    const { result } = renderHook(() => useSortableRows(rows, ACC, { key: 'v', dir: 'desc' }))
    // desc: 3, 1, then nulls
    expect(ids(result.current.sorted)).toEqual(['a', 'c', 'b', 'd'])
    act(() => result.current.toggle('v')) // → asc
    // asc: 1, 3, then nulls (NOT treated as -∞)
    expect(ids(result.current.sorted)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('preserves input order for ties (stable sort)', () => {
    const rows: Row[] = [
      { id: 'a', v: 5, w: 0 },
      { id: 'b', v: 5, w: 0 },
      { id: 'c', v: 5, w: 0 },
    ]
    const { result } = renderHook(() => useSortableRows(rows, ACC, { key: 'v', dir: 'desc' }))
    expect(ids(result.current.sorted)).toEqual(['a', 'b', 'c'])
  })
})
