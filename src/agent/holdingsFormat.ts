/**
 * Display helpers for the holdings-review board. A-share convention: gains are
 * red (`positive-text`), losses green (`negative-text`) — matches src/styles.css.
 */
export function fmtNum(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return Math.round(n).toLocaleString('zh-CN')
}

export function fmtSigned(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return (n > 0 ? '+' : '') + Math.round(n).toLocaleString('zh-CN')
}

export function fmtPrice(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toFixed(2)
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return (n > 0 ? '+' : '') + n.toFixed(2) + '%'
}

/** CSS class for a P&L value, following the A-share red-up / green-down rule. */
export function pnlClass(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n) || n === 0) return ''
  return n > 0 ? 'positive-text' : 'negative-text'
}
