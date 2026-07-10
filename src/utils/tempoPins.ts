// 节奏表钉选(localStorage,仿 customStocks.ts):行 code = 'BKxxxx'(东财)或 'kpl:<id>'(开盘啦题材)。
const STORAGE_KEY = 'rotation-tempo-pins'

export function getTempoPins(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 增删钉选,回写并返回新列表。 */
export function toggleTempoPin(code: string): string[] {
  const pins = getTempoPins()
  const next = pins.includes(code) ? pins.filter((c) => c !== code) : [...pins, code]
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* quota exceeded, ignore */
  }
  return next
}
