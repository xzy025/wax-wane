import { useState } from 'react'
import { Wrench, CaretDown, CaretRight, CircleNotch } from 'phosphor-react'
import type { ToolCallInfo } from '../types'

interface ToolCallCardProps {
  toolCall: ToolCallInfo
}

const TOOL_LABELS: Record<string, string> = {
  queryTradeHistory: '查询交易记录',
  getTradeGroupDetail: '获取交易组详情',
  calculateMetrics: '计算指标',
  findPatternTrades: '查找交易模式',
  getRiskAlerts: '获取风险警报',
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const label = TOOL_LABELS[toolCall.toolName] ?? toolCall.toolName

  return (
    <div className="ai-tool-card">
      <button className="ai-tool-card-header" type="button" onClick={() => setExpanded(!expanded)}>
        {toolCall.status === 'running' ? (
          <CircleNotch size={14} className="ai-spin" />
        ) : (
          <Wrench size={14} />
        )}
        <span>{label}</span>
        {expanded ? <CaretDown size={14} /> : <CaretRight size={14} />}
      </button>
      {expanded && toolCall.result !== undefined && (
        <pre className="ai-tool-card-result">{JSON.stringify(toolCall.result, null, 2)}</pre>
      )}
    </div>
  )
}
