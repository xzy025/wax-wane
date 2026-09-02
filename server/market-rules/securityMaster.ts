export type SecurityExchange = 'SSE' | 'SZSE' | 'BSE' | 'UNKNOWN'
export type SecurityBoard = 'main' | 'chinext' | 'star' | 'beijing' | 'unknown'

export interface SecurityMasterSnapshot {
  code: string
  exchange: SecurityExchange
  board: SecurityBoard
  listingDate: string | null
  riskWarning: boolean
  riskWarningEffectiveFrom?: string | null
  riskWarningEffectiveTo?: string | null
  suspended: boolean
  tickSize: number
  asOfDate: string
  source: string
  providerAt?: string | null
}

export function exchangeFromSecurityCode(code: string): SecurityExchange {
  if (/^(600|601|603|605|688|689)/.test(code)) return 'SSE'
  if (/^(000|001|002|003|300|301)/.test(code)) return 'SZSE'
  if (/^(4|8|92)/.test(code)) return 'BSE'
  return 'UNKNOWN'
}

export function boardFromSecurityCode(code: string): SecurityBoard {
  if (/^(688|689)/.test(code)) return 'star'
  if (/^(300|301)/.test(code)) return 'chinext'
  if (/^(4|8|92)/.test(code)) return 'beijing'
  if (/^(600|601|603|605|000|001|002|003)/.test(code)) return 'main'
  return 'unknown'
}

export function defaultSecurityMaster(code: string, asOfDate: string, overrides: Partial<SecurityMasterSnapshot> = {}): SecurityMasterSnapshot {
  return {
    code,
    exchange: exchangeFromSecurityCode(code),
    board: boardFromSecurityCode(code),
    listingDate: null,
    riskWarning: false,
    riskWarningEffectiveFrom: null,
    riskWarningEffectiveTo: null,
    suspended: false,
    tickSize: 0.01,
    asOfDate,
    source: 'code-derived-default',
    providerAt: null,
    ...overrides,
  }
}

export function isRiskWarningActive(security: SecurityMasterSnapshot, asOfDate: string): boolean {
  if (!security.riskWarning) return false
  if (security.riskWarningEffectiveFrom && asOfDate < security.riskWarningEffectiveFrom) return false
  if (security.riskWarningEffectiveTo && asOfDate >= security.riskWarningEffectiveTo) return false
  return true
}
