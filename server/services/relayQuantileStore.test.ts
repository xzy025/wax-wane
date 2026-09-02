import { describe, expect, it } from 'vitest'
import { buildRelayQuantileArtifact, causalRelayQuantileArtifact } from './relayQuantileStore'

describe('relay quantile artifacts', () => {
  it('uses only samples before trainEnd and rejects future artifacts', () => {
    const artifact = buildRelayQuantileArtifact({
      lane: 'B2', trainEnd: '2026-08-28', featureVersion: 'relay-path-features-v1',
      samples: [
        { lane: 'B2', signalDate: '2026-08-20', values: { themeStrength: 40 } },
        { lane: 'B2', signalDate: '2026-08-29', values: { themeStrength: 100 } },
        { lane: 'B3', signalDate: '2026-08-20', values: { themeStrength: 90 } },
      ],
    })
    expect(artifact.sampleCount).toBe(1)
    expect(artifact.quantiles.themeStrength?.q90).toBe(40)
    expect(causalRelayQuantileArtifact(artifact, { lane: 'B2', signalDate: '2026-08-29', featureVersion: 'relay-path-features-v1' })).toEqual(artifact)
    expect(causalRelayQuantileArtifact(artifact, { lane: 'B2', signalDate: '2026-08-20' })).toBeNull()
  })
})
