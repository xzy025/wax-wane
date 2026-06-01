const STORAGE_KEY = 'market-history'
const MAX_DAYS = 7

interface DayEntry {
  macro?: unknown
  ashare?: unknown
  hk?: unknown
  us?: unknown
  hotlist?: unknown
  timestamp: number
}

type HistoryMap = Record<string, DayEntry>

/** Options for saving a day entry; typed fields avoid `unknown` at the call site. */
export interface SaveDayOptions {
  macro?: unknown
  ashare?: unknown
  hk?: unknown
  us?: unknown
  hotlist?: unknown
}

let cachedToday: string | null = null
let cachedTodayTimestamp = 0

export function todayStr(): string {
  const now = Date.now()
  // Cache for 1 minute to avoid creating new Date objects on every call
  if (cachedToday && now - cachedTodayTimestamp < 60_000) {
    return cachedToday
  }
  const d = new Date()
  cachedToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  cachedTodayTimestamp = now
  return cachedToday
}

function readHistory(): HistoryMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as HistoryMap
  } catch {
    return {}
  }
}

function writeHistory(map: HistoryMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // quota exceeded, ignore
  }
}

function pruneOld(map: HistoryMap): HistoryMap {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - MAX_DAYS)
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
  const result: HistoryMap = {}
  for (const [key, val] of Object.entries(map)) {
    if (key >= cutoffStr) {
      result[key] = val
    }
  }
  return result
}

export function getDay(date: string): DayEntry | null {
  const map = readHistory()
  return map[date] ?? null
}

export function saveDay(date: string, partial: SaveDayOptions) {
  const map = readHistory()
  const existing = map[date] ?? { timestamp: Date.now() }
  map[date] = { ...existing, ...partial, timestamp: Date.now() }
  writeHistory(pruneOld(map))
}
