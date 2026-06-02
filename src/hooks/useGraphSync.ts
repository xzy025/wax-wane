import { useEffect, useRef } from 'react'
import { useAppState } from '../store'

const SYNC_DEBOUNCE_MS = 8000 // 8 seconds debounce (longer than RAG sync)

/**
 * Auto-sync trade data to the graph database.
 * Triggers when tradeGroups or reviewNotes change.
 */
export function useGraphSync() {
  const { tradeGroups, reviewNotes } = useAppState()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncRef = useRef<string>('')

  useEffect(() => {
    // Create a hash of current data to detect changes
    const dataHash = JSON.stringify({
      groups: tradeGroups.map((g) => ({
        id: g.id,
        code: g.code,
        pnl: g.pnl,
        status: g.status,
        mistakes: g.mistakes,
        strategy: g.strategy,
      })),
      notes: Object.keys(reviewNotes),
    })

    // Skip if data hasn't changed
    if (dataHash === lastSyncRef.current) return

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Debounce sync
    timeoutRef.current = setTimeout(async () => {
      lastSyncRef.current = dataHash

      try {
        const res = await fetch('/api/mcp/graph/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tradeGroups, reviewNotes }),
        })

        if (res.ok) {
          const result = await res.json()
          console.log(
            `[GraphRAG] Synced: ${result.nodesCreated} nodes, ${result.edgesCreated} edges`,
          )
        }
      } catch (err) {
        console.warn('[GraphRAG] Sync failed:', err)
      }
    }, SYNC_DEBOUNCE_MS)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [tradeGroups, reviewNotes])
}
