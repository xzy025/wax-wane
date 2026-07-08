import { useState } from 'react'
import type { Translation } from '../types'
import NewsFlashPanel from './NewsFlashPanel'
import ResearchPanel from './ResearchPanel'

/** 消息面:7x24 实时快讯 + 每日研报 LLM 看板,双子 tab(同 ScreenerView 范式)。 */
export default function IntelView({ t }: { t: Translation }) {
  const [tab, setTab] = useState<'flash' | 'research'>('flash')
  return (
    <section className="view-stack">
      <div>
        <div className="seg-group">
          <button className={`seg-btn${tab === 'flash' ? ' active' : ''}`} onClick={() => setTab('flash')}>
            {t.intel.tabFlash}
          </button>
          <button className={`seg-btn${tab === 'research' ? ' active' : ''}`} onClick={() => setTab('research')}>
            {t.intel.tabResearch}
          </button>
        </div>
      </div>
      {tab === 'flash' && <NewsFlashPanel t={t} />}
      {tab === 'research' && <ResearchPanel t={t} />}
    </section>
  )
}
