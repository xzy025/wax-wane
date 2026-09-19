import React, { useMemo, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  ChartBar,
  BookOpen,
  File,
  Globe,
  ChartLineUp,
  ChartPieSlice,
  UploadSimple,
  TrendUp,
  SquaresFour,
  Trophy,
  Crosshair,
  ArrowsClockwise,
  Robot,
  Newspaper,
  Stack,
} from 'phosphor-react'
import { zh, en } from './i18n'
import { StoreProvider, useAppState } from './store'
import { AgentProvider } from './agent/agentStore'
import { useRagSync } from './hooks/useRagSync'
import { useGraphSync } from './hooks/useGraphSync'
import SegmentedControl from './components/SegmentedControl'
import { getLastTradingDay } from './components/MarketDatePicker'
import ErrorBoundary from './components/ErrorBoundary'
import { clearAllDays } from './utils/marketHistory'
import Dashboard from './views/Dashboard'
import ImportView from './views/ImportView'
import LedgerView from './views/LedgerView'
import ReviewView from './views/ReviewView'
import AnalyticsView from './views/AnalyticsView'
import AgentView from './views/AgentView'
import ThemesView from './views/ThemesView'
import MoneyFlowView from './views/MoneyFlowView'
import { strategyView } from './strategy-ui'

// 选股器 / 板块轮动视图属私有战法层，通过挂载点按需加载（未安装时回退占位）。
const ScreenerView = strategyView('ScreenerView')
const RotationView = strategyView('RotationView')
import IntelView from './views/IntelView'
import LadderView from './views/LadderView'
import MarketView from './views/MarketView'
import { Suspense } from 'react'
import type { Translation } from './types'

const navItems = [
  { id: 'market', icon: TrendUp, path: '/market', section: 'research' },
  { id: 'intel', icon: Newspaper, path: '/intel', section: 'research' },
  { id: 'themes', icon: SquaresFour, path: '/themes', section: 'research' },
  { id: 'moneyflow', icon: Trophy, path: '/moneyflow', section: 'research' },
  { id: 'rotation', icon: ArrowsClockwise, path: '/rotation', section: 'research' },
  { id: 'ladder', icon: Stack, path: '/ladder', section: 'research' },
  { id: 'screener', icon: Crosshair, path: '/screener', section: 'research' },
  { id: 'dashboard', icon: ChartBar, path: '/dashboard', section: 'journal' },
  { id: 'import', icon: UploadSimple, path: '/import', section: 'journal' },
  { id: 'ledger', icon: File, path: '/ledger', section: 'journal' },
  { id: 'reviews', icon: BookOpen, path: '/reviews', section: 'journal' },
  { id: 'analytics', icon: ChartPieSlice, path: '/analytics', section: 'journal' },
  { id: 'agent', icon: Robot, path: '/agent', section: 'assistant' },
]

const navSections = [
  { id: 'research', zh: '研究', en: 'Research' },
  { id: 'journal', zh: '交易记录', en: 'Journal' },
  { id: 'assistant', zh: '辅助工具', en: 'Tools' },
] as const

const translations: Record<string, Translation> = { zh, en }

function AppLayout() {
  const [language, setLanguage] = useState('zh')
  const [range, setRange] = useState('month')
  const [selectedDate, setSelectedDate] = useState(getLastTradingDay())
  const [refreshKey, setRefreshKey] = useState(0)
  const location = useLocation()
  const t = translations[language]
  const { tradeGroups } = useAppState()
  const [selectedGroupId, setSelectedGroupId] = useState(tradeGroups[0]?.id ?? '')

  // Auto-sync RAG when trade data changes
  useRagSync()

  // Auto-sync GraphRAG when trade data changes
  useGraphSync()

  const activeView = useMemo(() => {
    const path = location.pathname.replace('/', '')
    return navItems.find((item) => item.id === path)?.id ?? 'dashboard'
  }, [location.pathname])

  const selectedGroup = useMemo(
    () => tradeGroups.find((group) => group.id === selectedGroupId) ?? tradeGroups[0],
    [selectedGroupId, tradeGroups],
  )

  return (
    <main className="app-shell" lang={language === 'zh' ? 'zh-CN' : 'en'}>
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark">
            <ChartLineUp size={22} aria-hidden="true" />
          </div>
          <div>
            <strong>Wax Wane</strong>
            <span>{t.appSubtitle}</span>
          </div>
        </div>

        <nav className="nav-sections" aria-label="Primary navigation">
          {navSections.map((section) => (
            <div className="nav-section" key={section.id}>
              <span className="nav-section-label">{language === 'zh' ? section.zh : section.en}</span>
              <div className="nav-list">
                {navItems.filter((item) => item.section === section.id).map((item) => {
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.id}
                      to={item.path}
                      className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                    >
                      <Icon size={18} aria-hidden="true" />
                      {t.nav[item.id]}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-card">
          <span>{t.sidebar.costLabel}</span>
          <strong>{t.sidebar.costMode}</strong>
          <small>{t.sidebar.costHint}</small>
        </div>
      </aside>

      <section className={`workspace ${activeView === 'agent' ? 'workspace-agent' : ''}`}>
        {activeView !== 'agent' && (
          <header className="topbar">
            <div>
              <p className="eyebrow">{t.appSubtitle}</p>
              <h1>{t.titles[activeView]}</h1>
            </div>
            <div className="topbar-actions">
              {activeView === 'dashboard' && (
                <SegmentedControl
                  label={t.range.label}
                  value={range}
                  options={['week', 'month', 'quarter', 'year']}
                  labels={t.range}
                  onChange={setRange}
                />
              )}
              <SegmentedControl
                label={t.language.label}
                value={language}
                options={['zh', 'en']}
                labels={t.language}
                onChange={(v) => setLanguage(v as 'zh' | 'en')}
                icon={<Globe size={17} aria-hidden="true" />}
              />
            </div>
          </header>
        )}

        <ErrorBoundary>
          <Routes>
          <Route
            path="/market"
            element={
              <MarketView
                t={t}
                language={language as 'zh' | 'en'}
                selectedDate={selectedDate}
                onSelectDate={setSelectedDate}
                onRefresh={async () => {
                  // Drop local cache + all server caches, then remount the data modules.
                  clearAllDays()
                  try {
                    await fetch('/api/refresh', { method: 'POST' })
                  } catch {
                    // Server may be down; modules expose their own error state.
                  }
                  setRefreshKey((k) => k + 1)
                }}
                refreshKey={refreshKey}
              />
            }
          />
          <Route path="/intel" element={<IntelView t={t} />} />
          <Route path="/themes" element={<ThemesView t={t} language={language as 'zh' | 'en'} />} />
          <Route path="/moneyflow" element={<MoneyFlowView t={t} language={language as 'zh' | 'en'} />} />
          <Route path="/rotation" element={<Suspense fallback={null}><RotationView t={t} language={language as 'zh' | 'en'} /></Suspense>} />
          <Route path="/ladder" element={<LadderView t={t} language={language as 'zh' | 'en'} />} />
          <Route path="/screener" element={<Suspense fallback={null}><ScreenerView t={t} language={language as 'zh' | 'en'} /></Suspense>} />
          <Route path="/dashboard" element={<Dashboard t={t} range={range} />} />
          <Route path="/import" element={<ImportView t={t} />} />
          <Route path="/ledger" element={<LedgerView t={t} range={range} />} />
          <Route
            path="/reviews"
            element={
              <ReviewView
                t={t}
                selectedGroup={selectedGroup}
                selectedGroupId={selectedGroupId}
                onSelectGroup={setSelectedGroupId}
                language={language as 'zh' | 'en'}
              />
            }
          />
          <Route path="/analytics" element={<AnalyticsView t={t} />} />
          <Route path="/agent" element={<AgentView t={t} language={language as 'zh' | 'en'} />} />
          <Route path="*" element={<Navigate to="/market" replace />} />
          </Routes>
        </ErrorBoundary>
      </section>
    </main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <StoreProvider>
        <AgentProvider>
          <AppLayout />
        </AgentProvider>
      </StoreProvider>
    </BrowserRouter>
  )
}
