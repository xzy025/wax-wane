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
  Robot,
} from 'phosphor-react'
import { zh, en } from './i18n'
import { StoreProvider, useAppState } from './store'
import { AgentProvider } from './agent/agentStore'
import { useRagSync } from './hooks/useRagSync'
import { useGraphSync } from './hooks/useGraphSync'
import SegmentedControl from './components/SegmentedControl'
import MacroBanner from './components/MacroBanner'
import AShareBanner from './components/AShareBanner'
import HKBanner from './components/HKBanner'
import USBanner from './components/USBanner'
import HotListBanner from './components/HotListBanner'
import MarketDatePicker, { getLastTradingDay } from './components/MarketDatePicker'
import ErrorBoundary from './components/ErrorBoundary'
import { todayStr, clearDay, clearAllDays } from './utils/marketHistory'
import Dashboard from './views/Dashboard'
import ImportView from './views/ImportView'
import LedgerView from './views/LedgerView'
import ReviewView from './views/ReviewView'
import AnalyticsView from './views/AnalyticsView'
import AgentView from './views/AgentView'
import ThemesView from './views/ThemesView'
import MoneyFlowView from './views/MoneyFlowView'
import type { Translation } from './types'

const navItems = [
  { id: 'market', icon: TrendUp, path: '/market' },
  { id: 'themes', icon: SquaresFour, path: '/themes' },
  { id: 'moneyflow', icon: Trophy, path: '/moneyflow' },
  { id: 'dashboard', icon: ChartBar, path: '/dashboard' },
  { id: 'import', icon: UploadSimple, path: '/import' },
  { id: 'ledger', icon: File, path: '/ledger' },
  { id: 'reviews', icon: BookOpen, path: '/reviews' },
  { id: 'analytics', icon: ChartPieSlice, path: '/analytics' },
  { id: 'agent', icon: Robot, path: '/agent' },
]

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

        {activeView === 'market' && (
          <>
            <MarketDatePicker
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
              onRefresh={async () => {
                // Drop local cache + all server caches, then remount the banners
                // (via refreshKey) so each re-fetches fresh — no full page reload.
                clearAllDays()
                try {
                  await fetch('/api/refresh', { method: 'POST' })
                } catch {
                  // Server may be down; components will handle fetch errors
                }
                setRefreshKey((k) => k + 1)
              }}
              t={t}
            />
            <ErrorBoundary key={refreshKey}>
              <MacroBanner key={`macro-${refreshKey}`} t={t} date={selectedDate} />
              <AShareBanner key={`ashare-${refreshKey}`} t={t} date={selectedDate} />
              <HKBanner key={`hk-${refreshKey}`} t={t} date={selectedDate} />
              <USBanner key={`us-${refreshKey}`} t={t} date={selectedDate} />
              <HotListBanner key={`hot-${refreshKey}`} t={t} date={selectedDate} />
            </ErrorBoundary>
          </>
        )}

        <ErrorBoundary>
          <Routes>
          <Route path="/market" element={<div />} />
          <Route path="/themes" element={<ThemesView t={t} language={language as 'zh' | 'en'} />} />
          <Route path="/moneyflow" element={<MoneyFlowView t={t} language={language as 'zh' | 'en'} />} />
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
