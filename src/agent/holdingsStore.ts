import { useCallback, useState } from 'react'
import type { ManualHolding } from '../engine/holdings'

/**
 * localStorage-backed CRUD for the manual holdings override layer. Kept
 * decoupled from the core trade store (src/store/index.tsx) — same pattern as
 * `llm-config` / `selected-trading-patterns` in ChatPanel. See [[holdings]].
 */
const KEY = 'manual-holdings'

function load(): ManualHolding[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as ManualHolding[]
    }
  } catch {
    /* ignore */
  }
  return []
}

function save(list: ManualHolding[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

export function useManualHoldings() {
  const [manualHoldings, setList] = useState<ManualHolding[]>(load)

  const mutate = useCallback((fn: (prev: ManualHolding[]) => ManualHolding[]) => {
    setList((prev) => {
      const next = fn(prev)
      save(next)
      return next
    })
  }, [])

  /** Insert or replace the entry for a code (clears any prior `hidden` flag). */
  const addOrUpdate = useCallback(
    (h: ManualHolding) => {
      mutate((prev) => [...prev.filter((m) => m.code !== h.code), { ...h, hidden: false }])
    },
    [mutate],
  )

  /** Drop a manual entry entirely (an auto holding of the same code reappears). */
  const remove = useCallback(
    (code: string) => {
      mutate((prev) => prev.filter((m) => m.code !== code))
    },
    [mutate],
  )

  /** Hide an auto-derived holding by writing a `hidden` marker for its code. */
  const hide = useCallback(
    (code: string, name: string) => {
      mutate((prev) => [
        ...prev.filter((m) => m.code !== code),
        { code, name, quantity: 0, avgCost: 0, hidden: true },
      ])
    },
    [mutate],
  )

  return { manualHoldings, addOrUpdate, remove, hide }
}
