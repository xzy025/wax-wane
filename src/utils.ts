export function formatMoney(value: number, options: { withSign?: boolean } = {}): string {
  const absolute = Math.abs(value).toLocaleString('zh-CN')
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${options.withSign ? sign : ''}¥${absolute}`
}

export function translateMap(map: Record<string, string>, key: string): string {
  return map[key] ?? key
}

export function getDateRange(range: string): { start: string; end: string } {
  const now = new Date()
  const end = formatDate(now)
  let start: Date

  switch (range) {
    case 'week':
      start = new Date(now)
      start.setDate(start.getDate() - 7)
      break
    case 'quarter':
      start = new Date(now)
      start.setMonth(start.getMonth() - 3)
      break
    case 'month':
    default:
      start = new Date(now)
      start.setMonth(start.getMonth() - 1)
      break
  }

  return { start: formatDate(start), end }
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isInDateRange(dateStr: string, start: string, end: string): boolean {
  return dateStr >= start && dateStr <= end
}
