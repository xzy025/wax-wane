import React, { useMemo, useState } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  BarChart3,
  BookOpenText,
  FileSpreadsheet,
  Languages,
  LineChart,
  PieChart,
  Settings2,
  Upload,
} from 'lucide-react'
import { zh, en } from './i18n'
import { StoreProvider, useAppState } from './store'
import { AgentProvider } from './agent/agentStore'
import { useRagSync } from './hooks/useRagSync'
import SegmentedControl from './components/SegmentedControl'
import MacroBanner from './components/MacroBanner'
import AShareBanner from './components/AShareBanner'
import MarketDatePicker from './components/MarketDatePicker'
import ErrorBoundary from './components/ErrorBoundary'
import { todayStr } from './utils/marketHistory'
import Dashboard from './views/Dashboard'
import ImportView from './views/ImportView'
import LedgerView from './views/LedgerView'
import ReviewView from './views/ReviewView'
import AnalyticsView from './views/AnalyticsView'
import type { Translation } from './types'

const navItems = [
  { id: 'dashboard', icon: BarChart3, path: '/dashboard' },
  { id: 'import', icon: Upload, path: '/import' },
  { id: 'ledger', icon: FileSpreadsheet, path: '/ledger' },
  { id: 'reviews', icon: BookOpenText, path: '/reviews' },
  { id: 'analytics', icon: PieChart, path: '/analytics' },
]

const translations: Record<string, Translation> = { zh, en }

function AppLayout() {
  const [language, setLanguage] = useState('zh')
  const [range, setRange] = useState('month')
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const location = useLocation()
  const t = translations[language]
  const { tradeGroups } = useAppState()
  const [selectedGroupId, setSelectedGroupId] = useState(tradeGroups[0]?.id ?? '')

  // Auto-sync RAG when trade data changes
  useRagSync()

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
            <LineChart size={22} aria-hidden="true" />
          </div>
          <div>
            <strong>TradeReview</strong>
            <span>{t.appSubtitle}</span>
          </div>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => {
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
        </nav>

        <div className="sidebar-card">
          <span>{t.sidebar.costLabel}</span>
          <strong>{t.sidebar.costMode}</strong>
          <small>{t.sidebar.costHint}</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{t.appSubtitle}</p>
            <h1>{t.titles[activeView]}</h1>
          </div>
          <div className="topbar-actions">
            <SegmentedControl
              label={t.range.label}
              value={range}
              options={['week', 'month', 'quarter']}
              labels={t.range}
              onChange={setRange}
            />
            <SegmentedControl
              label={t.language.label}
              value={language}
              options={['zh', 'en']}
              labels={t.language}
              onChange={(v) => setLanguage(v as 'zh' | 'en')}
              icon={<Languages size={17} aria-hidden="true" />}
            />
            <button
              className="icon-button"
              type="button"
              aria-label={t.settings}
              title={t.settings}
            >
              <Settings2 size={19} aria-hidden="true" />
            </button>
          </div>
        </header>

        <MarketDatePicker selectedDate={selectedDate} onSelect={setSelectedDate} t={t} />
        <ErrorBoundary>
          <MacroBanner t={t} date={selectedDate} />
          <AShareBanner t={t} date={selectedDate} />
        </ErrorBoundary>

        <ErrorBoundary>
          <Routes>
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
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
