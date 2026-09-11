export interface ScreenerSnapshotQuality {
  passed: boolean
  universeCoverage: number
  quoteCoverage: number
  historyCoverage: number
  crossSourceAgreement: number
  freshQuoteCoverage: number
}

export interface FormalScreenerSnapshot {
  asof: string
  marketDataAsOf?: string
  marketDataDegraded?: boolean
  scanMode?: string
  signalState?: string
  closed?: boolean
  dataQuality?: ScreenerSnapshotQuality
  universe?: number
  scanned?: number
  fetched?: number
}

export interface SnapshotCommitDecision {
  allowed: boolean
  reasons: string[]
}

export function evaluateFormalScreenerSnapshot(
  snapshot: FormalScreenerSnapshot,
): SnapshotCommitDecision {
  const reasons: string[] = []
  if (snapshot.scanMode !== 'close') reasons.push('只允许盘后 close 快照')
  if (snapshot.signalState !== 'confirmed') reasons.push('信号状态不是 confirmed')
  if (snapshot.closed !== true) reasons.push('快照未标记为 closed')
  if (snapshot.marketDataDegraded) reasons.push('行情数据已降级')
  if (!snapshot.marketDataAsOf) reasons.push('缺少行情 asOf')
  if (snapshot.marketDataAsOf && snapshot.marketDataAsOf !== snapshot.asof) {
    reasons.push(`行情日期 ${snapshot.marketDataAsOf} 与快照日期 ${snapshot.asof} 不一致`)
  }
  if (!snapshot.dataQuality) {
    reasons.push('缺少 dataQuality')
  } else {
    if (!snapshot.dataQuality.passed) reasons.push('dataQuality.passed=false')
    const ratios: Array<[string, number, number]> = [
      ['universeCoverage', snapshot.dataQuality.universeCoverage, 0.97],
      ['quoteCoverage', snapshot.dataQuality.quoteCoverage, 0.98],
      ['historyCoverage', snapshot.dataQuality.historyCoverage, 0.95],
      ['crossSourceAgreement', snapshot.dataQuality.crossSourceAgreement, 0.95],
      ['freshQuoteCoverage', snapshot.dataQuality.freshQuoteCoverage, 0.98],
    ]
    for (const [name, value, minimum] of ratios) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        reasons.push(`${name} 非法`)
      } else if (value < minimum) {
        reasons.push(`${name} ${(value * 100).toFixed(1)}% < ${(minimum * 100).toFixed(1)}%`)
      }
    }
  }
  if (snapshot.universe != null && snapshot.universe <= 0) reasons.push('股票池为空')
  if (snapshot.scanned != null && snapshot.scanned < 0) reasons.push('扫描数量非法')
  if (snapshot.fetched != null && snapshot.fetched < 0) reasons.push('K线取数数量非法')
  return { allowed: reasons.length === 0, reasons }
}

/**
 * Compare two snapshots for the same trading date. This is deliberately
 * monotonic: a later write may enrich or equal the current evidence, but may
 * never reduce settled state or fetched coverage.
 */
export function shouldReplaceScreenerSnapshot(
  previous: FormalScreenerSnapshot | null,
  next: FormalScreenerSnapshot,
): boolean {
  if (!evaluateFormalScreenerSnapshot(next).allowed) return false
  if (!previous || previous.asof !== next.asof) return true
  if (next.closed !== previous.closed) return next.closed === true
  if (next.marketDataDegraded && !previous.marketDataDegraded) return false
  if (previous.marketDataAsOf && next.marketDataAsOf && next.marketDataAsOf < previous.marketDataAsOf) return false
  if (previous.fetched != null && next.fetched != null && next.fetched < previous.fetched) return false
  if (previous.dataQuality?.passed && !next.dataQuality?.passed) return false
  return true
}

/**
 * Compatibility comparator for the legacy backfill job. Legacy rows may be
 * imported once, but they can never replace an already formal row and they
 * still obey the same-day monotonic coverage rule.
 */
export function shouldReplaceCompatibleScreenerSnapshot(
  previous: FormalScreenerSnapshot | null,
  next: FormalScreenerSnapshot,
): boolean {
  const previousLooksFormal = Boolean(
    previous?.scanMode || previous?.signalState || previous?.dataQuality || previous?.marketDataAsOf,
  )
  const nextLooksFormal = Boolean(
    next.scanMode || next.signalState || next.dataQuality || next.marketDataAsOf,
  )
  if (nextLooksFormal && !evaluateFormalScreenerSnapshot(next).allowed) return false
  if (previousLooksFormal && !nextLooksFormal) return false
  if (!previous || previous.asof !== next.asof) return true
  if (next.closed !== previous.closed) return next.closed === true
  if (next.marketDataDegraded && !previous.marketDataDegraded) return false
  if (previous.marketDataAsOf && next.marketDataAsOf && next.marketDataAsOf < previous.marketDataAsOf) return false
  if (previous.fetched != null && next.fetched != null && next.fetched < previous.fetched) return false
  return true
}
