import { Sparkles, X } from 'lucide-react'
import { useAgentState, useAgentDispatch } from '../agentStore'

interface AgentFabProps {
  label?: string
}

export function AgentFab({ label }: AgentFabProps) {
  const state = useAgentState()
  const dispatch = useAgentDispatch()

  return (
    <button
      className={`ai-fab ${state.isOpen ? 'ai-fab-active' : ''}`}
      type="button"
      onClick={() => dispatch({ type: 'TOGGLE_PANEL' })}
      title={label ?? 'AI Assistant'}
    >
      {state.isOpen ? <X size={22} /> : <Sparkles size={22} />}
    </button>
  )
}
