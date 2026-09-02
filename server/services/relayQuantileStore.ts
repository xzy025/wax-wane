import { createHash } from 'node:crypto'

export const RELAY_QUANTILE_ARTIFACT_VERSION = 'relay-quantiles-v1'

export type RelayQuantileFeature = 'openGapPct' | 'preSealAmountRatio' | 'firstTouchMinutes' | 'reopenCount' | 'themeStrength'
export type RelayQuantileBand = { q10: number; q25: number; q75: number; q90: number }

export interface RelayQuantileSample {
  signalDate: string
  lane: string
  values: Partial<Record<RelayQuantileFeature, number | null>>
}

export interface RelayQuantileArtifact {
  artifactVersion: typeof RELAY_QUANTILE_ARTIFACT_VERSION
  featureVersion: string
  lane: string
  trainEnd: string
  sampleCount: number
  quantiles: Partial<Record<RelayQuantileFeature, RelayQuantileBand>>
  sourceHash: string
}

function quantile(values: number[], probability: number): number {
  const index = (values.length - 1) * probability
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return values[lower]
  return values[lower] + (values[upper] - values[lower]) * (index - lower)
}

export function buildRelayQuantileArtifact(args: {
  samples: readonly RelayQuantileSample[]
  lane: string
  trainEnd: string
  featureVersion: string
}): RelayQuantileArtifact {
  const usable = args.samples.filter((sample) => sample.lane === args.lane && sample.signalDate < args.trainEnd)
  const quantiles: Partial<Record<RelayQuantileFeature, RelayQuantileBand>> = {}
  const features: RelayQuantileFeature[] = ['openGapPct', 'preSealAmountRatio', 'firstTouchMinutes', 'reopenCount', 'themeStrength']
  for (const feature of features) {
    const values = usable
      .map((sample) => sample.values[feature])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      .sort((a, b) => a - b)
    if (values.length) {
      quantiles[feature] = {
        q10: quantile(values, 0.1),
        q25: quantile(values, 0.25),
        q75: quantile(values, 0.75),
        q90: quantile(values, 0.9),
      }
    }
  }
  return {
    artifactVersion: RELAY_QUANTILE_ARTIFACT_VERSION,
    featureVersion: args.featureVersion,
    lane: args.lane,
    trainEnd: args.trainEnd,
    sampleCount: usable.length,
    quantiles,
    sourceHash: createHash('sha256').update(JSON.stringify({
      version: RELAY_QUANTILE_ARTIFACT_VERSION,
      lane: args.lane,
      trainEnd: args.trainEnd,
      featureVersion: args.featureVersion,
      samples: usable,
    })).digest('hex'),
  }
}

export function causalRelayQuantileArtifact(
  artifact: RelayQuantileArtifact | null | undefined,
  args: { lane: string; signalDate: string; featureVersion?: string },
): RelayQuantileArtifact | null {
  if (!artifact || artifact.lane !== args.lane || artifact.trainEnd >= args.signalDate) return null
  if (args.featureVersion != null && artifact.featureVersion !== args.featureVersion) return null
  return artifact
}

