export type HithinkStockDataset = 'anomaly' | 'valuation' | 'income' | 'balance' | 'cashflow'
type Row = Record<string, unknown>

export interface HithinkSchemaResult {
  ok: boolean
  reason?: string
}

function record(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stockCode(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}\.(SH|SZ|BJ)$/.test(value)
}

function validDate(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return parsed.toISOString().slice(0, 10) === value
}

function reportPeriod(row: Row): string | number | undefined {
  for (const field of ['report_period', 'report_period_ms', 'report_date', 'report_date_ms']) {
    const value = row[field]
    if (value !== undefined && value !== null) return typeof value === 'string' || typeof value === 'number' ? value : undefined
  }
  return undefined
}

function hasValuationValue(row: Row): boolean {
  return Object.keys(row).some((field) => field !== 'thscode')
}

/**
 * Validate only fields that are structural for this adapter. Values themselves
 * remain upstream values: null valuation metrics and negative ratios are valid.
 */
export function validateHithinkStockPayload(
  dataset: HithinkStockDataset,
  payload: unknown,
  expectedCode: string,
): HithinkSchemaResult {
  if (!record(payload) || !Array.isArray(payload.item)) return { ok: false, reason: 'missing-item-array' }
  const periods = new Set<string | number>()
  for (const row of payload.item) {
    if (!record(row) || !stockCode(row.thscode) || row.thscode !== expectedCode) return { ok: false, reason: 'invalid-thscode' }
    if (row.currency !== undefined && (typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency))) {
      return { ok: false, reason: 'invalid-currency' }
    }
    if (dataset === 'valuation' && !hasValuationValue(row)) return { ok: false, reason: 'missing-valuation-fields' }
    if (dataset === 'income' || dataset === 'balance' || dataset === 'cashflow') {
      const period = reportPeriod(row)
      if (period === undefined || !validDate(period)) return { ok: false, reason: 'invalid-report-period' }
      if (periods.has(period)) return { ok: false, reason: 'duplicate-report-period' }
      periods.add(period)
    }
  }
  return { ok: true }
}
