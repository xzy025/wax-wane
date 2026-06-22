import { useState } from 'react'
import { ChatCircleDots, Wallet } from 'phosphor-react'
import { ChatPanel } from '../agent/components/ChatPanel'
import { HoldingsReviewPanel } from '../agent/components/HoldingsReviewPanel'
import type { Translation } from '../types'

interface AgentViewProps {
  t: Translation
  language: 'zh' | 'en'
}

type AgentTab = 'chat' | 'holdings'

export default function AgentView({ t, language }: AgentViewProps) {
  const [tab, setTab] = useState<AgentTab>('chat')

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

      <div className="agent-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat'}
          className={`agent-tab ${tab === 'chat' ? 'agent-tab-active' : ''}`}
          onClick={() => setTab('chat')}
        >
          <ChatCircleDots size={16} />
          {t.holdings.tabChat}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'holdings'}
          className={`agent-tab ${tab === 'holdings' ? 'agent-tab-active' : ''}`}
          onClick={() => setTab('holdings')}
        >
          <Wallet size={16} />
          {t.holdings.tabHoldings}
        </button>
      </div>

      <div className="agent-view-chat">
        {tab === 'chat' ? (
          <ChatPanel t={t} language={language} />
        ) : (
          <HoldingsReviewPanel t={t} language={language} />
        )}
      </div>
    </div>
  )
}
