export type ExecutionStage = 'pending' | 'auction' | 'open' | 'settled'

export interface SharedExecutionEligibilityInput {
  stage: ExecutionStage
  tradeDate: string
  quote?: { tradeDate: string; volume: number; amount: number } | null
  confirmationState: string | null
  inaccessible: boolean
  marketGateState: string | null | undefined
  themePermissionState: string | null | undefined
  auctionSnapshotAvailable: boolean
  openSnapshotAvailable: boolean
  openingConfirmationGate?: 'not-required' | 'passed' | 'blocked' | 'unavailable'
  technicalAvailable?: boolean
  riskBudgetAvailable?: boolean
  relayGateState?: 'NORMAL' | 'HOT' | 'JOINT_CLIMAX' | 'UNAVAILABLE'
}

export interface SharedExecutionEligibility {
  eligible: boolean
  reasons: string[]
  evaluatedAt: string
}

/** One fail-closed gate used by confirmations and the relay output. */
export function evaluateExecutionEligibility(
  input: SharedExecutionEligibilityInput,
  evaluatedAt = new Date().toISOString(),
): SharedExecutionEligibility {
  const reasons: string[] = []
  if (input.stage !== 'open' && input.stage !== 'settled') reasons.push('尚未完成09:35过程快照')
  if (!input.auctionSnapshotAvailable) reasons.push('缺少09:25竞价快照')
  if ((input.stage === 'open' || input.stage === 'settled') && !input.openSnapshotAvailable) reasons.push('缺少09:35过程快照')
  if (!input.quote || input.quote.tradeDate !== input.tradeDate) reasons.push('目标交易日行情缺失或过期')
  if (input.confirmationState !== 'confirmed') reasons.push('研究确认状态未达到confirmed')
  if (input.marketGateState == null) reasons.push('缺少市场闸门')
  else if (input.marketGateState !== 'normal' && input.marketGateState !== 'cautious') reasons.push(`市场闸门${input.marketGateState}，禁止执行`)
  if (input.themePermissionState !== 'allowed') reasons.push(`题材许可为${input.themePermissionState ?? 'unavailable'}`)
  if (
    (input.stage === 'open' || input.stage === 'settled') &&
    input.openingConfirmationGate !== 'passed' &&
    input.openingConfirmationGate !== 'not-required'
  ) reasons.push('09:35开盘确认未通过')
  if (input.inaccessible) reasons.push('候选不可达或一字封板')
  if (!input.quote || input.quote.volume <= 0 || input.quote.amount <= 0) reasons.push('缺少可成交量/成交额')
  if (input.technicalAvailable === false) reasons.push('技术数据不可用')
  if (input.riskBudgetAvailable !== true) reasons.push('风险预算未配置，研究信号不产生交易许可')
  if (input.relayGateState === 'JOINT_CLIMAX') reasons.push('双高潮次日NO_NEW_RELAY，禁止形成新接力')
  if (input.relayGateState === 'UNAVAILABLE') reasons.push('关键情绪数据缺失，接力闸门不可用')
  return { eligible: reasons.length === 0, reasons: [...new Set(reasons)], evaluatedAt }
}
