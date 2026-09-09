export type ArchiveKind = 'screener' | 'structure' | 'tempo' | 'review' | 'forward' | 'ladder'
type RecordValue = Record<string, unknown>
const object = (value: unknown): RecordValue => value && typeof value === 'object' ? value as RecordValue : {}
const nonempty = (value: unknown): boolean => Array.isArray(value) && value.length > 0

export function validSettlementArchive(input: unknown, date: string, kind: ArchiveKind): boolean {
  if (!['screener', 'structure', 'tempo', 'review', 'forward', 'ladder'].includes(kind)) return false
  const timestamp = Date.parse(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return false
  const value = object(input)
  if (value.asof !== date) return false
  const quality = object(value.quality)
  if (kind === 'screener') return object(value.dataQuality).passed === true && value.closed === true &&
    value.signalState === 'confirmed' && value.marketDataAsOf === date && value.marketDataDegraded !== true
  if (kind === 'structure') return Number(value.boardTotal) > 0 && value.dataAsOf === date && value.qualityPassed === true
  if (kind === 'tempo') {
    const benchmark = object(value.benchmark)
    return Array.isArray(value.dates) && value.dates.at(-1) === date &&
      value.dates.every((day, index) => typeof day === 'string' && day <= date && (index === 0 || day > (value.dates as string[])[index - 1])) &&
      Array.isArray(benchmark.cells) && object(benchmark.cells.at(-1)).date === date &&
      nonempty(value.rows) && (value.rows as unknown[]).every((row) => {
        const cells = object(row).cells
        return Array.isArray(cells) && object(cells.at(-1)).date === date &&
          cells.every((cell) => typeof object(cell).date === 'string' && String(object(cell).date) <= date)
      })
  }
  if (kind === 'review') return nonempty(object(value.ashare).indices) && value.marketDataAsOf === date
  if (kind === 'forward') return Number.isInteger(object(value.overall).n) && Number(object(value.overall).n) >= 0 &&
    Number.isInteger(value.snapshotCount) && Number(value.snapshotCount) >= 0 && Array.isArray(value.strategies) &&
    value.strategies.every((strategy) => Array.isArray(object(strategy).picks) && (object(strategy).picks as unknown[]).every((pick) => {
      const p = object(pick)
      return typeof p.asof === 'string' && p.asof <= date &&
        (p.exitDate === '' || (typeof p.exitDate === 'string' && p.exitDate <= date))
    }))
  return nonempty(value.stocks) && quality.sourceDate === date && quality.coreDataComplete === true &&
    quality.settled === true && quality.sentimentStatus === 'full' && quality.limitFieldsComplete === true &&
    Number(quality.klineTotal) > 0 && quality.klineComplete === quality.klineTotal &&
    typeof quality.receivedAt === 'string' && typeof quality.adjustment === 'string' && quality.adjustment !== 'unknown' &&
    ((value.archiveStage === 'core-settled' && value.formalSignalEligible === false) ||
      (value.archiveStage === 'enriched' && value.formalSignalEligible === true && quality.degraded === false && quality.fundFlowComplete === true && !!quality.providerAt))
}
