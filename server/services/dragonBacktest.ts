/**
 * Pure evaluator for the dragon-identity layer.
 *
 * The evaluator consumes a settled signal snapshot plus forward-only outcomes.
 * It intentionally does not fetch data or calculate a signal from future bars;
 * callers must build each sample using information available at `date`.
 */

export interface DragonBacktestSample {
  code: string
  date: string
  baseRank: number
  dragonScore: number
  hardGatePassed: boolean
  dimensions: {
    drive: number
    antiDrop: number
  }
  marketPhase?: 'ice' | 'repair' | 'climax' | 'ebb'
  lane?: string
  forward?: {
    available: boolean
    promoted: boolean
    openGapPct: number | null
    closeReturnPct: number | null
    day3ReturnPct: number | null
    maxFavorablePct: number | null
    maxAdversePct: number | null
  }
}

export interface DragonBacktestMetrics {
  samples: number
  forwardCoveragePct: number
  promotionRatePct: number
  avgOpenGapPct: number | null
  avgCloseReturnPct: number | null
  avgDay3ReturnPct: number | null
  avgMaxFavorablePct: number | null
  avgMaxAdversePct: number | null
}

export interface DragonBacktestReport {
  baseline: DragonBacktestMetrics
  drive: DragonBacktestMetrics
  antiDrop: DragonBacktestMetrics
  full: DragonBacktestMetrics
  hardGated: DragonBacktestMetrics
  byLane: Record<string, DragonBacktestMetrics>
  byMarketPhase: Record<string, DragonBacktestMetrics>
}

const r2 = (value: number) => Math.round(value * 100) / 100

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return valid.length ? r2(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null
}

export function summarizeDragonBacktest(samples: DragonBacktestSample[]): DragonBacktestMetrics {
  const forward = samples.filter((sample) => sample.forward?.available)
  return {
    samples: samples.length,
    forwardCoveragePct: samples.length ? r2((forward.length / samples.length) * 100) : 0,
    promotionRatePct: forward.length
      ? r2((forward.filter((sample) => sample.forward?.promoted).length / forward.length) * 100)
      : 0,
    avgOpenGapPct: average(forward.map((sample) => sample.forward?.openGapPct ?? null)),
    avgCloseReturnPct: average(forward.map((sample) => sample.forward?.closeReturnPct ?? null)),
    avgDay3ReturnPct: average(forward.map((sample) => sample.forward?.day3ReturnPct ?? null)),
    avgMaxFavorablePct: average(forward.map((sample) => sample.forward?.maxFavorablePct ?? null)),
    avgMaxAdversePct: average(forward.map((sample) => sample.forward?.maxAdversePct ?? null)),
  }
}

function groupMetrics(
  samples: DragonBacktestSample[],
  key: (sample: DragonBacktestSample) => string | undefined,
): Record<string, DragonBacktestMetrics> {
  const groups = new Map<string, DragonBacktestSample[]>()
  for (const sample of samples) {
    const group = key(sample) ?? 'unknown'
    groups.set(group, [...(groups.get(group) ?? []), sample])
  }
  return Object.fromEntries([...groups.entries()].map(([group, values]) => [group, summarizeDragonBacktest(values)]))
}

/** Compare the existing top-rank selection with incremental dragon filters. */
export function buildDragonBacktestReport(
  samples: DragonBacktestSample[],
  options: { topN?: number } = {},
): DragonBacktestReport {
  const topN = options.topN ?? 10
  const baseline = samples.filter((sample) => sample.baseRank > 0 && sample.baseRank <= topN)
  const drive = baseline.filter((sample) => sample.dimensions.drive >= 60)
  const antiDrop = baseline.filter((sample) => sample.dimensions.antiDrop >= 55)
  const full = baseline.filter((sample) => sample.dragonScore >= 60)
  const hardGated = baseline.filter((sample) => sample.hardGatePassed && sample.dragonScore >= 60)
  return {
    baseline: summarizeDragonBacktest(baseline),
    drive: summarizeDragonBacktest(drive),
    antiDrop: summarizeDragonBacktest(antiDrop),
    full: summarizeDragonBacktest(full),
    hardGated: summarizeDragonBacktest(hardGated),
    byLane: groupMetrics(full, (sample) => sample.lane),
    byMarketPhase: groupMetrics(full, (sample) => sample.marketPhase),
  }
}
