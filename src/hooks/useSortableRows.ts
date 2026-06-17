import { useMemo, useState } from 'react'

export type SortDir = 'asc' | 'desc'

/** Accessor returns the sortable numeric value for a row, or null when absent. */
export type Accessors<T, K extends string> = Record<K, (row: T) => number | null>

export interface SortState<K extends string> {
  key: K
  dir: SortDir
}

export interface SortableResult<T, K extends string> {
  sorted: T[]
  sortKey: K
  sortDir: SortDir
  /** Same key → flip direction; new key → start descending (strongest first). */
  toggle: (key: K) => void
}

/**
 * Lightweight column-sort over a small in-memory list.
 *
 * Null policy (load-bearing): null values always sink to the bottom in BOTH
 * directions — the null checks run before the asc/desc branch, so nulls are not
 * treated as ±∞. Array.prototype.sort is stable in modern engines, so ties
 * (including the null block) preserve the incoming order.
 */
export function useSortableRows<T, K extends string>(
  rows: T[],
  accessors: Accessors<T, K>,
  initial: SortState<K>,
): SortableResult<T, K> {
  const [sort, setSort] = useState<SortState<K>>(initial)

  const toggle = (key: K) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))

  const sorted = useMemo(() => {
    const accessor = accessors[sort.key]
    return [...rows].sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return sort.dir === 'asc' ? av - bv : bv - av
    })
    // accessors is a stable literal from the caller; depend on rows + sort only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort])

  return { sorted, sortKey: sort.key, sortDir: sort.dir, toggle }
}
