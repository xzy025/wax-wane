import { useEffect, useRef } from 'react'
import { useAppState } from '../store'

const SYNC_DEBOUNCE_MS = 5000 // 5 seconds debounce

/**
 * Auto-sync trade data to RAG vector store.
 * Silently fails if database is not available.
 */
export function useRagSync() {
  const { tradeGroups, reviewNotes } = useAppState()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncRef = useRef<string>('')
  const dbAvailableRef = useRef<boolean | null>(null) // null = unknown

  useEffect(() => {
    // Skip if we already know DB is not available
    if (dbAvailableRef.current === false) return

    // Create a hash of current data to detect changes
    const dataHash = JSON.stringify({
      groups: tradeGroups.map((g) => ({ id: g.id, pnl: g.pnl, status: g.status })),
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
        const res = await fetch('/api/mcp/rag/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tradeGroups, reviewNotes, reset: true }),
        })

        if (res.ok) {
          const result = await res.json()
          dbAvailableRef.current = true
          console.log(`[RAG] Synced ${result.documentsAdded} documents, total: ${result.totalDocuments}`)
        } else {
          dbAvailableRef.current = false
        }
      } catch {
        dbAvailableRef.current = false
      }
    }, SYNC_DEBOUNCE_MS)

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [tradeGroups, reviewNotes])
}
