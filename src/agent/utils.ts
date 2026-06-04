/**
 * Extract a 6-digit stock code from a user message.
 * Returns the first match or empty string if none found.
 */
export function extractStockCode(message: string): string {
  const match = message.match(/\b(\d{6})\b/)
  return match ? match[1] : ''
}

/**
 * Extract a stock name from a user message by matching against known stock names.
 * Returns the matched name or empty string if none found.
 */
export function extractStockName(message: string, names: string[]): string {
  for (const name of names) {
    if (message.includes(name)) return name
  }
  return ''
}
