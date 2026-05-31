import { useMemo } from 'react'
import { Warning, CaretRight, CurrencyCircleDollar } from 'phosphor-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { formatMoney, getDateRange, isInDateRange } from '../utils'
import { computeWinRate, computePayoff, computeTotalFees, computeTotalPnl } from '../utils/metrics'
import { metricCards } from '../data/mock'
import { useAppState } from '../store'
import AlertItem from '../components/AlertItem'
import TradeGroupTable from '../components/TradeGroupTable'
import type { Translation } from '../types'

interface DashboardProps {
  t: Translation
  range?: string
}

export default function Dashboard({ t, range }: DashboardProps) {
  const { tradeGroups } = useAppState()

  const filteredGroups = tradeGroups.filter((g) => {
    if (!range) return true
    const { start, end } = getDateRange(range)
    return isInDateRange(g.opened, start, end)
  })

  const closedGroups = filteredGroups.filter((g) => g.closed)
  const totalPnl = computeTotalPnl(closedGroups)
  const winRate = computeWinRate(closedGroups)
  const payoff = computePayoff(closedGroups)
  const totalFees = computeTotalFees(filteredGroups)

  const equityCurveData = useMemo(() => {
    const sorted = [...closedGroups].sort((a, b) => (a.closed ?? '').localeCompare(b.closed ?? ''))
    return sorted.reduce<{ date: string | undefined; pnl: number; name: string }[]>((acc, g) => {
      const prev = acc.length > 0 ? acc[acc.length - 1].pnl : 0
      acc.push({ date: g.closed ?? undefined, pnl: Math.round((prev + g.pnl) * 100) / 100, name: g.name })
      return acc
    }, [])
  }, [closedGroups])

  const alerts = useMemo(() => {
    const result: { tone: 'danger' | 'warning' | 'info'; title: string; text: string }[] = []

    // 未平亏损 - open groups with negative PnL
    const openLosers = filteredGroups.filter((g) => !g.closed && g.pnl < 0)
    if (openLosers.length > 0) {
      const totalOpenLoss = openLosers.reduce((s, g) => s + g.pnl, 0)
      const longest = openLosers.reduce((a, b) => (a.days > b.days ? a : b))
      result.push({
        tone: 'danger',
        title: '未平亏损',
        text: `${openLosers.length} 笔持仓亏损 ${formatMoney(totalOpenLoss, { withSign: true })}，${longest.name} 已持有 ${longest.days} 天。`,
      })
    }

    // 止损拖延 - groups with 'Late stop loss' mistake
    const lateStopLoss = closedGroups.filter((g) => g.mistakes.includes('Late stop loss'))
    if (lateStopLoss.length > 0) {
      const loss = lateStopLoss.reduce((s, g) => s + g.pnl, 0)
      result.push({
        tone: 'warning',
        title: '止损拖延',
        text: `${lateStopLoss.length} 笔闭环交易涉及止损拖延，合计盈亏 ${formatMoney(loss, { withSign: true })}。`,
      })
    }

    // 费用拖累 - high fee ratio
    const totalGrossAmount = filteredGroups.reduce(
      (s, g) => s + Math.abs(g.pnl) + (g.totalFee ?? 0),
      0,
    )
    const feeRatio = totalGrossAmount > 0 ? (totalFees / totalGrossAmount) * 100 : 0
    if (feeRatio > 0.5) {
      result.push({
        tone: 'warning',
        title: '费用拖累',
        text: `费用占交易额比例 ${feeRatio.toFixed(2)}%，注意控制换手频率。`,
      })
    }

    // 连续亏损 - consecutive losing closed groups
    let maxConsecutiveLoss = 0
    let currentStreak = 0
    for (const g of closedGroups) {
      if (g.pnl < 0) {
        currentStreak++
        maxConsecutiveLoss = Math.max(maxConsecutiveLoss, currentStreak)
      } else {
        currentStreak = 0
      }
    }
    if (maxConsecutiveLoss >= 3) {
      result.push({
        tone: 'danger',
        title: '连续亏损',
        text: `出现连续 ${maxConsecutiveLoss} 笔亏损，建议暂停交易检查策略。`,
      })
    }

    // No data fallback
    if (result.length === 0 && filteredGroups.length > 0) {
      result.push({ tone: 'info', title: '暂无风控告警', text: '当前数据未发现明显风险信号。' })
    }

    return result
  }, [filteredGroups, closedGroups, totalFees])

  const computedMetrics = [
    {
      key: 'realizedPnl',
      value: formatMoney(totalPnl, { withSign: true }),
      positive: totalPnl > 0,
      tone: totalPnl >= 0 ? 'positive' : 'neutral',
    },
    {
      key: 'winRate',
      value: `${winRate.toFixed(1)}%`,
      tone: 'neutral',
    },
    {
      key: 'payoff',
      value: payoff.toFixed(2),
      tone: payoff >= 1 ? 'positive' : 'neutral',
    },
    {
      key: 'fees',
      value: formatMoney(totalFees),
      tone: 'warning',
    },
  ]

  return (
    <div className="view-stack">
      <section className="metric-grid">
        {computedMetrics.map((metric) => {
          const mockCard = metricCards.find((c) => c.key === metric.key)
          const Icon = mockCard?.icon ?? CurrencyCircleDollar
          const [label, delta] = t.metrics[metric.key]
          return (
            <article className={`metric-card ${metric.tone}`} key={metric.key}>
              <div>
                <span>{label}</span>
                <strong>{metric.positive ? `+${metric.value}` : metric.value}</strong>
                <small>{delta}</small>
              </div>
              <Icon size={24} aria-hidden="true" />
            </article>
          )
        })}
      </section>

      <section className="content-grid">
        <article className="panel wide">
          <div className="panel-title">
            <div>
              <h2>{t.dashboard.equityTitle}</h2>
              <p>{t.dashboard.equityDesc}</p>
            </div>
            <span className={`status-pill ${totalPnl >= 0 ? 'positive' : ''}`}>
              {formatMoney(totalPnl, { withSign: true })}
            </span>
          </div>
          <div className="chart-shell">
            {equityCurveData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart
                  data={equityCurveData}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--blue)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--blue)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--muted)' }} />
                  <YAxis
                    tick={{ fontSize: 12, fill: 'var(--muted)' }}
                    tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value: number) => [
                      formatMoney(value, { withSign: true }),
                      '累计盈亏',
                    ]}
                    labelFormatter={(label) => `日期: ${label}`}
                  />
                  <Area
                    type="monotone"
                    dataKey="pnl"
                    stroke="var(--blue)"
                    fill="url(#pnlGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div
                style={{
                  height: 220,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--muted)',
                }}
              >
                暂无闭环交易数据
              </div>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-title">
            <div>
              <h2>{t.dashboard.riskTitle}</h2>
              <p>{t.dashboard.riskDesc}</p>
            </div>
            <Warning size={20} aria-hidden="true" />
          </div>
          <div className="alert-list">
            {alerts.map((alert) => (
              <AlertItem
                key={alert.title}
                tone={alert.tone}
                title={alert.title}
                text={alert.text}
              />
            ))}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>{t.dashboard.recentTitle}</h2>
            <p>{t.dashboard.recentDesc}</p>
          </div>
          <button className="text-button" type="button">
            {t.dashboard.viewAll}
            <CaretRight size={16} aria-hidden="true" />
          </button>
        </div>
        <TradeGroupTable groups={filteredGroups} t={t} />
      </section>
    </div>
  )
}
