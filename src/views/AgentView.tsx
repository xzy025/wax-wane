import { ChatPanel } from '../agent/components/ChatPanel'
import type { Translation } from '../types'

interface AgentViewProps {
  t: Translation
  language: 'zh' | 'en'
}

export default function AgentView({ t, language }: AgentViewProps) {
  return (
    <div className="agent-view">
      <div className="agent-view-header">
        <div className="agent-view-info">
          <h2>{t.agent.title}</h2>
          <p>{t.agent.description}</p>
        </div>
        <div className="agent-view-features">
          <span className="agent-feature">📊 {t.agent.featureReview}</span>
          <span className="agent-feature">📈 {t.agent.featureAnalysis}</span>
          <span className="agent-feature">🧠 {t.agent.featureTheory}</span>
          <span className="agent-feature">🔍 {t.agent.featureSearch}</span>
        </div>
      </div>
      <div className="agent-view-chat">
        <ChatPanel t={t} language={language} />
      </div>
    </div>
  )
}
