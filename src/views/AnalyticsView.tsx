import { useMemo, useState } from 'react'
import { Calendar, Copy, Check, TrendUp, TrendDown, ChartBar, Warning } from 'phosphor-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { formatMoney, translateMap, getDateRange, isInDateRange } from '../utils'
import { fmt } from '../i18n'
import {
  computeWinRate,
  computePayoff,
  computeTotalFees,
  computeTotalPnl,
  computeDisciplineScore,
} from '../utils/metrics'
import { computeQuantMetrics } from '../utils/quantMetrics'
import { useAppState } from '../store'
import type { Translation } from '../types'

interface AnalyticsViewProps {
  t: Translation
}

export default function AnalyticsView({ t }: AnalyticsViewProps) {
  const { tradeGroups, reviewNotes } = useAppState()
  const closedGroups = tradeGroups.filter((g) => g.closed)

  // Quantitative metrics
  const quantMetrics = useMemo(() => computeQuantMetrics(tradeGroups), [tradeGroups])

  const mistakeData = useMemo(() => {
    const map = new Map<string, { count: number; pnl: number }>()
    for (const g of closedGroups) {
      for (const m of g.mistakes) {
        const entry = map.get(m) ?? { count: 0, pnl: 0 }
        entry.count++
        entry.pnl += g.pnl
        map.set(m, entry)
      }
    }
    return [...map.entries()]
      .map(([name, { count, pnl }]) => ({
        name: translateMap(t.mistakes, name),
        count,
        pnl: Math.round(pnl),
      }))
      .sort((a, b) => b.count - a.count)
  }, [closedGroups, t.mistakes])

  const holdingData = useMemo(() => {
    const buckets = [
      { label: t.periods[0], min: 1, max: 3, count: 0 },
      { label: t.periods[1], min: 4, max: 7, count: 0 },
      { label: t.periods[2], min: 8, max: 14, count: 0 },
      { label: t.periods[3], min: 15, max: Infinity, count: 0 },
    ]
    for (const g of closedGroups) {
      const bucket = buckets.find((b) => g.days >= b.min && g.days <= b.max)
      if (bucket) bucket.count++
    }
    return buckets
  }, [closedGroups, t.periods])

  const disciplineScore = useMemo(() => {
    if (closedGroups.length === 0) return { score: 0, summary: t.analytics.noScoreData }

    const { score, penalties } = computeDisciplineScore(closedGroups, reviewNotes)

    const totalPnl = computeTotalPnl(closedGroups)
    const winners = closedGroups.filter((g) => g.pnl > 0).length
    const summaryParts: string[] = []

    summaryParts.push(
      fmt(
        t.analytics.scoreOverview,
        closedGroups.length,
        winners,
        closedGroups.length - winners,
        formatMoney(totalPnl, { withSign: true }),
      ),
    )

    if (penalties.length > 0) {
      summaryParts.push(fmt(t.analytics.scorePenalties, penalties.join(t.analytics.penaltyJoin)))
    } else {
      summaryParts.push(t.analytics.scoreNoPenalty)
    }

    if (score >= 80) {
      summaryParts.push(t.analytics.scoreHigh)
    } else if (score >= 60) {
      summaryParts.push(t.analytics.scoreMid)
    } else {
      summaryParts.push(t.analytics.scoreLow)
    }

    return { score, summary: summaryParts.join('') }
  }, [closedGroups, reviewNotes, t.analytics])

  const [reportPeriod, setReportPeriod] = useState<'week' | 'month'>('month')
  const [copied, setCopied] = useState(false)

  const report = useMemo(() => {
    const { start, end } = getDateRange(reportPeriod)
    const periodGroups = closedGroups.filter((g) => g.closed && isInDateRange(g.closed, start, end))

    if (periodGroups.length === 0) {
      return { periodLabel: '', empty: true, text: '', markdown: '' }
    }

    const r = t.analytics.report
    const periodLabel =
      reportPeriod === 'week' ? fmt(r.weekLabel, start, end) : fmt(r.monthLabel, start, end)
    const totalPnl = computeTotalPnl(periodGroups)
    const totalFees = computeTotalFees(periodGroups)
    const winners = periodGroups.filter((g) => g.pnl > 0)
    const losers = periodGroups.filter((g) => g.pnl < 0)
    const winRate = computeWinRate(periodGroups)

    const topWinners = [...periodGroups].sort((a, b) => b.pnl - a.pnl).slice(0, 3)
    const topLosers = [...periodGroups].sort((a, b) => a.pnl - b.pnl).slice(0, 3)

    const mistakeMap = new Map<string, number>()
    for (const g of periodGroups) {
      for (const m of g.mistakes) {
        mistakeMap.set(m, (mistakeMap.get(m) ?? 0) + 1)
      }
    }
    const topMistakes = [...mistakeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

    const lines: string[] = []
    lines.push(`📊 ${fmt(r.title, periodLabel)}`)
    lines.push('')
    lines.push(`■ ${r.overview}`)
    lines.push(`  ${fmt(r.closedLine, periodGroups.length, winners.length, losers.length)}`)
    lines.push(`  ${fmt(r.winRateLine, winRate.toFixed(1))}`)
    lines.push(`  ${fmt(r.totalPnlLine, formatMoney(totalPnl, { withSign: true }))}`)
    lines.push(`  ${fmt(r.totalFeesLine, formatMoney(totalFees))}`)
    lines.push('')

    if (topWinners.length > 0) {
      lines.push(`■ ${r.topWinners} ${topWinners.length}`)
      topWinners.forEach((g, i) => {
        lines.push(
          `  ${i + 1}. ${fmt(r.stockLabel, g.name, g.code)}${formatMoney(g.pnl, { withSign: true })} / ${fmt(r.daysUnit, g.days)}`,
        )
      })
      lines.push('')
    }

    if (topLosers.length > 0 && topLosers.some((g) => g.pnl < 0)) {
      lines.push(`■ ${r.topLosers} ${Math.min(topLosers.filter((g) => g.pnl < 0).length, 3)}`)
      topLosers
        .filter((g) => g.pnl < 0)
        .forEach((g, i) => {
          lines.push(
            `  ${i + 1}. ${fmt(r.stockLabel, g.name, g.code)}${formatMoney(g.pnl, { withSign: true })} / ${fmt(r.daysUnit, g.days)}`,
          )
        })
      lines.push('')
    }

    if (topMistakes.length > 0) {
      lines.push(`■ ${r.mistakes}`)
      topMistakes.forEach(([key, count]) => {
        lines.push(`  · ${fmt(r.mistakeLine, translateMap(t.mistakes, key), count)}`)
      })
      lines.push('')
    }

    lines.push(`■ ${fmt(r.scoreLine, disciplineScore.score)}`)

    const text = lines.join('\n')

    const mdLines: string[] = []
    mdLines.push(`# ${fmt(r.title, periodLabel)}`)
    mdLines.push('')
    mdLines.push(`## ${r.overview}`)
    mdLines.push(`| ${r.colMetric} | ${r.colValue} |`)
    mdLines.push(`|------|------|`)
    mdLines.push(`| ${r.closedTrades} | ${fmt(r.tradesUnit, periodGroups.length)} |`)
    mdLines.push(`| ${r.winRate} | ${winRate.toFixed(1)}% |`)
    mdLines.push(`| ${r.totalPnl} | ${formatMoney(totalPnl, { withSign: true })} |`)
    mdLines.push(`| ${r.totalFees} | ${formatMoney(totalFees)} |`)
    mdLines.push('')

    if (topWinners.length > 0) {
      mdLines.push(`## ${r.topWinners}`)
      mdLines.push(`| ${r.colStock} | ${r.colPnl} | ${r.colHolding} |`)
      mdLines.push(`|------|------|------|`)
      topWinners.forEach((g) => {
        mdLines.push(
          `| ${fmt(r.stockLabel, g.name, g.code)} | ${formatMoney(g.pnl, { withSign: true })} | ${fmt(r.daysUnit, g.days)} |`,
        )
      })
      mdLines.push('')
    }

    if (topLosers.some((g) => g.pnl < 0)) {
      mdLines.push(`## ${r.topLosers}`)
      mdLines.push(`| ${r.colStock} | ${r.colPnl} | ${r.colHolding} |`)
      mdLines.push(`|------|------|------|`)
      topLosers
        .filter((g) => g.pnl < 0)
        .forEach((g) => {
          mdLines.push(
            `| ${fmt(r.stockLabel, g.name, g.code)} | ${formatMoney(g.pnl, { withSign: true })} | ${fmt(r.daysUnit, g.days)} |`,
          )
        })
      mdLines.push('')
    }

    if (topMistakes.length > 0) {
      mdLines.push(`## ${r.mistakes}`)
      topMistakes.forEach(([key, count]) => {
        mdLines.push(`- ${fmt(r.mistakeLine, translateMap(t.mistakes, key), count)}`)
      })
      mdLines.push('')
    }

    mdLines.push(`**${fmt(r.scoreLine, disciplineScore.score)}**`)

    return { periodLabel, empty: false, text, markdown: mdLines.join('\n') }
  }, [reportPeriod, closedGroups, disciplineScore.score, t.mistakes, t.analytics.report])

  function handleCopyReport() {
    if (report.markdown) {
      navigator.clipboard.writeText(report.markdown).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
    }
  }

  return (
    <div className="content-grid">
      {/* Quantitative Metrics */}
      <article className="panel wide">
        <div className="panel-title">
          <div>
            <h2>{t.analytics.quant.title}</h2>
            <p>{t.analytics.quant.desc}</p>
          </div>
          <ChartBar size={20} aria-hidden="true" />
        </div>
        {closedGroups.length > 0 ? (
          <div className="quant-metrics-grid">
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--green)' }}>
                <TrendUp size={16} />
              </div>
              <div>
                <div className="quant-metric-label">{t.analytics.quant.sharpe}</div>
                <div className="quant-metric-value">{quantMetrics.sharpeRatio.toFixed(2)}</div>
                <div className="quant-metric-hint">
                  {quantMetrics.sharpeRatio > 1
                    ? t.analytics.quant.gradeExcellent
                    : quantMetrics.sharpeRatio > 0.5
                      ? t.analytics.quant.gradeGood
                      : t.analytics.quant.gradeLow}
                </div>
              </div>
            </div>
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--red)' }}>
                <Warning size={16} />
              </div>
              <div>
                <div className="quant-metric-label">{t.analytics.quant.maxDrawdown}</div>
                <div className="quant-metric-value">{quantMetrics.maxDrawdownPercent.toFixed(1)}%</div>
                <div className="quant-metric-hint">
                  {quantMetrics.maxDrawdownPercent < 10
                    ? t.analytics.quant.ddGood
                    : quantMetrics.maxDrawdownPercent < 20
                      ? t.analytics.quant.ddMedium
                      : t.analytics.quant.ddHigh}
                </div>
              </div>
            </div>
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--cyan)' }}>
                <TrendDown size={16} />
              </div>
              <div>
                <div className="quant-metric-label">{t.analytics.quant.annualized}</div>
                <div className="quant-metric-value">{quantMetrics.annualizedReturn.toFixed(1)}%</div>
                <div className="quant-metric-hint">
                  {quantMetrics.annualizedReturn > 20
                    ? t.analytics.quant.annHigh
                    : quantMetrics.annualizedReturn > 0
                      ? t.analytics.quant.annPositive
                      : t.analytics.quant.annNegative}
                </div>
              </div>
            </div>
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--orange)' }}>
                <ChartBar size={16} />
              </div>
              <div>
                <div className="quant-metric-label">{t.analytics.quant.payoff}</div>
                <div className="quant-metric-value">{quantMetrics.payoffRatio.toFixed(2)}</div>
                <div className="quant-metric-hint">
                  {quantMetrics.payoffRatio > 2
                    ? t.analytics.quant.gradeExcellent
                    : quantMetrics.payoffRatio > 1
                      ? t.analytics.quant.gradeGood
                      : t.analytics.quant.gradeLow}
                </div>
              </div>
            </div>
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--green)' }}>
                <TrendUp size={16} />
              </div>
              <div>
                <div className="quant-metric-label">{t.analytics.quant.profitFactor}</div>
                <div className="quant-metric-value">
                  {quantMetrics.profitFactor === Infinity ? '∞' : quantMetrics.profitFactor.toFixed(2)}
                </div>
                <div className="quant-metric-hint">
                  {quantMetrics.profitFactor > 2
                    ? t.analytics.quant.gradeExcellent
                    : quantMetrics.profitFactor > 1
                      ? t.analytics.quant.pfProfit
                      : t.analytics.quant.pfLoss}
                </div>
              </div>
            </div>
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--cyan)' }}>
                <TrendUp size={16} />
              </div>
              <div>
                <div className="quant-metric-label">{t.analytics.quant.expectancy}</div>
                <div className="quant-metric-value">{formatMoney(quantMetrics.expectancy, { withSign: true })}</div>
                <div className="quant-metric-hint">
                  {quantMetrics.expectancy > 0
                    ? t.analytics.quant.expPositive
                    : t.analytics.quant.expNegative}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', padding: '16px 0' }}>
            {t.analytics.quant.noData}
          </p>
        )}
      </article>

      <article className="panel">
        <div className="panel-title">
          <div>
            <h2>{t.analytics.mistakeTitle}</h2>
            <p>{t.analytics.mistakeDesc}</p>
          </div>
        </div>
        {mistakeData.length > 0 ? (
          <ResponsiveContainer width="100%" height={Math.max(200, mistakeData.length * 48)}>
            <BarChart
              data={mistakeData}
              layout="vertical"
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis type="number" tick={{ fontSize: 12, fill: 'var(--muted)' }} />
              <YAxis
                type="category"
                dataKey="name"
                width={80}
                tick={{ fontSize: 12, fill: 'var(--muted)' }}
              />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'count')
                    return [fmt(t.analytics.chartTimes, value), t.analytics.chartTimesLabel]
                  return [formatMoney(value, { withSign: true }), t.analytics.chartLinkedPnl]
                }}
              />
              <Bar dataKey="count" fill="var(--blue)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="mistake-list">
            {mistakeData.map(({ name, count, pnl }) => (
              <div className="mistake-row" key={name}>
                <span>{name}</span>
                <div className="bar-track">
                  <div style={{ width: `${Math.min(count * 12, 100)}%` }} />
                </div>
                <strong>{count}</strong>
                <em>{formatMoney(pnl, { withSign: true })}</em>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="panel">
        <div className="panel-title">
          <div>
            <h2>{t.analytics.holdingTitle}</h2>
            <p>{t.analytics.holdingDesc}</p>
          </div>
          <Calendar size={20} aria-hidden="true" />
        </div>
        {closedGroups.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={holdingData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--muted)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--muted)' }} allowDecimals={false} />
              <Tooltip
                formatter={(value: number) => [
                  fmt(t.analytics.chartTrades, value),
                  t.analytics.chartTradesLabel,
                ]}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {holdingData.map((_, index) => (
                  <Cell key={index} fill={index % 2 === 0 ? 'var(--blue)' : 'var(--cyan)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="period-bars">
            {holdingData.map((b) => (
              <div className="period-bar" key={b.label}>
                <div style={{ height: '0%' }} />
                <span>{b.label}</span>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="panel wide">
        <div className="panel-title">
          <div>
            <h2>{t.analytics.summaryTitle}</h2>
            <p>{t.analytics.summaryDesc}</p>
          </div>
          <div className="report-actions">
            <div className="report-period-tabs">
              <button
                className={reportPeriod === 'week' ? 'filter-chip active' : 'filter-chip'}
                type="button"
                onClick={() => setReportPeriod('week')}
              >
                {t.analytics.weekly}
              </button>
              <button
                className={reportPeriod === 'month' ? 'filter-chip active' : 'filter-chip'}
                type="button"
                onClick={() => setReportPeriod('month')}
              >
                {t.analytics.monthly}
              </button>
            </div>
            {!report.empty && (
              <button
                className="icon-button"
                type="button"
                title={t.analytics.copyReport}
                onClick={handleCopyReport}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            )}
          </div>
        </div>
        <div className="report-preview">
          {report.empty ? (
            <p>{t.analytics.noPeriodData}</p>
          ) : (
            <>
              <pre className="report-text">{report.text}</pre>
              <div>
                <span>{t.analytics.scoreLabel}</span>
                <strong>{disciplineScore.score} / 100</strong>
              </div>
            </>
          )}
        </div>
      </article>
    </div>
  )
}
