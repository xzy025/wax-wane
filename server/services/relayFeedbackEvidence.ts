export type RelaySmallNSignal = 'supportive' | 'mixed' | 'negative' | 'unavailable'

export interface RelayFeedbackObservation {
  id: string
  positive: boolean | null
}

export interface RelayFeedbackPriorInput {
  signalDate: string
  numerator: number | null
  denominator: number | null
  effectiveN: number | null
  priorWindow: string | null
  posterior: number | null
}

export interface RelayDirectFeedbackEvidence {
  numerator: number | null
  denominator: number | null
  effectiveN: number | null
  positiveRate: number | null
  confidence: 'high' | 'medium' | 'low' | 'unavailable'
  status: RelaySmallNSignal
  missingReasons: string[]
}

export interface RelayPriorFeedbackEvidence {
  numerator: number | null
  denominator: number | null
  effectiveN: number | null
  priorWindow: string | null
  posterior: number | null
  available: boolean
  missingReasons: string[]
}

export interface RelayFeedbackEvidence {
  direct: RelayDirectFeedbackEvidence
  prior: RelayPriorFeedbackEvidence
  evidenceN: number
  sourceCoveragePct: number | null
  missingReasons: string[]
}

export interface RelayFeedbackEvidenceInput {
  signalDate: string
  observations: readonly RelayFeedbackObservation[]
  sourceCoveragePct?: number | null
  prior?: RelayFeedbackPriorInput | null
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10
}

function directStatus(positiveRate: number): RelaySmallNSignal {
  if (positiveRate < 40) return 'negative'
  if (positiveRate >= 70) return 'supportive'
  return 'mixed'
}

function validPrior(
  signalDate: string,
  prior: RelayFeedbackPriorInput | null | undefined,
): { value: RelayFeedbackPriorInput | null; reason: string | null } {
  if (!prior) return { value: null, reason: '严格截止日前没有可用历史先验' }
  if (prior.signalDate >= signalDate) return { value: null, reason: '历史先验日期不得晚于信号日' }
  if (prior.denominator == null || prior.denominator <= 0 || prior.effectiveN == null || prior.effectiveN < 0) {
    return { value: null, reason: '历史先验分母或有效样本无效' }
  }
  return { value: prior, reason: null }
}

/**
 * Preserve direct evidence for n=1..4. This is descriptive research evidence;
 * callers must keep their separate sample-size/execution gates in place.
 */
export function buildRelayFeedbackEvidence(
  input: RelayFeedbackEvidenceInput,
): RelayFeedbackEvidence {
  const observations = input.observations.filter((item) => item.positive !== null)
  const evidenceN = observations.length
  const positiveCount = observations.filter((item) => item.positive === true).length
  const sourceCoveragePct = input.sourceCoveragePct ?? null
  const missingReasons: string[] = []
  let status: RelaySmallNSignal = 'unavailable'
  let positiveRate: number | null = null
  let confidence: RelayDirectFeedbackEvidence['confidence'] = 'unavailable'

  if (evidenceN === 0) {
    missingReasons.push('没有可用的直接反馈样本')
  } else if (evidenceN === 1) {
    // A one-stock anchor has a direction, but it is not a group rate.
    status = positiveCount === 1 ? 'supportive' : 'negative'
    confidence = 'low'
    missingReasons.push('仅1只单锚样本，不计算群体正反馈率')
  } else {
    positiveRate = roundPct((positiveCount / evidenceN) * 100)
    status = directStatus(positiveRate)
    confidence = evidenceN >= 5 && (sourceCoveragePct ?? 0) >= 80 ? 'medium' : 'low'
    if (evidenceN < 5) missingReasons.push(`直接样本仅${evidenceN}只，方向仅作低置信研究证据`)
    if (evidenceN >= 5 && (sourceCoveragePct == null || sourceCoveragePct < 80)) {
      status = 'unavailable'
      confidence = 'unavailable'
      missingReasons.push('直接样本来源覆盖率不足80%或缺失')
    }
  }

  const priorResult = validPrior(input.signalDate, input.prior)
  const prior = priorResult.value
    ? {
        numerator: priorResult.value.numerator,
        denominator: priorResult.value.denominator,
        effectiveN: priorResult.value.effectiveN,
        priorWindow: priorResult.value.priorWindow,
        posterior: priorResult.value.posterior,
        available: true,
        missingReasons: [],
      }
    : {
        numerator: null,
        denominator: null,
        effectiveN: null,
        priorWindow: null,
        posterior: null,
        available: false,
        missingReasons: [priorResult.reason ?? '历史先验不可用'],
      }

  return {
    direct: {
      numerator: evidenceN > 0 ? positiveCount : null,
      denominator: evidenceN > 0 ? evidenceN : null,
      effectiveN: evidenceN > 0 ? evidenceN : null,
      positiveRate,
      confidence,
      status,
      missingReasons,
    },
    prior,
    evidenceN,
    sourceCoveragePct,
    missingReasons: [...missingReasons, ...prior.missingReasons],
  }
}
