import { useMemo, useState } from 'react'
import { CalendarDays, Copy, Check, TrendingUp, TrendingDown, BarChart2, AlertTriangle } from 'lucide-react'
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
    if (closedGroups.length === 0)
      return { score: 0, summary: '暂无闭环交易数据，无法计算纪律评分。' }

    const { score, penalties } = computeDisciplineScore(closedGroups, reviewNotes)

    const totalPnl = computeTotalPnl(closedGroups)
    const winners = closedGroups.filter((g) => g.pnl > 0).length
    const summaryParts: string[] = []

    summaryParts.push(
      `${closedGroups.length} 笔闭环交易，${winners} 盈 ${closedGroups.length - winners} 亏，` +
        `总盈亏 ${formatMoney(totalPnl, { withSign: true })}。`,
    )

    if (penalties.length > 0) {
      summaryParts.push('扣分项：' + penalties.join('；') + '。')
    } else {
      summaryParts.push('交易纪律良好，无明显扣分项。')
    }

    if (score >= 80) {
      summaryParts.push('整体纪律性较高，继续保持。')
    } else if (score >= 60) {
      summaryParts.push('有改进空间，建议重点纠正高频错误。')
    } else {
      summaryParts.push('纪律性偏低，建议暂停交易，系统复盘后再入场。')
    }

    return { score, summary: summaryParts.join('') }
  }, [closedGroups, reviewNotes])

  const [reportPeriod, setReportPeriod] = useState<'week' | 'month'>('month')
  const [copied, setCopied] = useState(false)

  const report = useMemo(() => {
    const { start, end } = getDateRange(reportPeriod)
    const periodGroups = closedGroups.filter((g) => g.closed && isInDateRange(g.closed, start, end))

    if (periodGroups.length === 0) {
      return { periodLabel: '', empty: true, text: '', markdown: '' }
    }

    const periodLabel =
      reportPeriod === 'week' ? `本周（${start} ~ ${end}）` : `本月（${start} ~ ${end}）`
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
    lines.push(`📊 ${periodLabel} 交易复盘报告`)
    lines.push('')
    lines.push(`■ 总览`)
    lines.push(
      `  闭环交易：${periodGroups.length} 笔（${winners.length} 盈 / ${losers.length} 亏）`,
    )
    lines.push(`  胜率：${winRate.toFixed(1)}%`)
    lines.push(`  总盈亏：${formatMoney(totalPnl, { withSign: true })}`)
    lines.push(`  总费用：${formatMoney(totalFees)}`)
    lines.push('')

    if (topWinners.length > 0) {
      lines.push(`■ 盈利 Top ${topWinners.length}`)
      topWinners.forEach((g, i) => {
        lines.push(
          `  ${i + 1}. ${g.name}（${g.code}）${formatMoney(g.pnl, { withSign: true })} / ${g.days}天`,
        )
      })
      lines.push('')
    }

    if (topLosers.length > 0 && topLosers.some((g) => g.pnl < 0)) {
      lines.push(`■ 亏损 Top ${Math.min(topLosers.filter((g) => g.pnl < 0).length, 3)}`)
      topLosers
        .filter((g) => g.pnl < 0)
        .forEach((g, i) => {
          lines.push(
            `  ${i + 1}. ${g.name}（${g.code}）${formatMoney(g.pnl, { withSign: true })} / ${g.days}天`,
          )
        })
      lines.push('')
    }

    if (topMistakes.length > 0) {
      lines.push(`■ 高频错误`)
      topMistakes.forEach(([key, count]) => {
        lines.push(`  · ${translateMap(t.mistakes, key)}：${count} 次`)
      })
      lines.push('')
    }

    lines.push(`■ 纪律评分：${disciplineScore.score} / 100`)

    const text = lines.join('\n')

    const mdLines: string[] = []
    mdLines.push(`# ${periodLabel} 交易复盘报告`)
    mdLines.push('')
    mdLines.push(`## 总览`)
    mdLines.push(`| 指标 | 数值 |`)
    mdLines.push(`|------|------|`)
    mdLines.push(`| 闭环交易 | ${periodGroups.length} 笔 |`)
    mdLines.push(`| 胜率 | ${winRate.toFixed(1)}% |`)
    mdLines.push(`| 总盈亏 | ${formatMoney(totalPnl, { withSign: true })} |`)
    mdLines.push(`| 总费用 | ${formatMoney(totalFees)} |`)
    mdLines.push('')

    if (topWinners.length > 0) {
      mdLines.push(`## 盈利 Top`)
      mdLines.push(`| 股票 | 盈亏 | 持仓 |`)
      mdLines.push(`|------|------|------|`)
      topWinners.forEach((g) => {
        mdLines.push(
          `| ${g.name}（${g.code}） | ${formatMoney(g.pnl, { withSign: true })} | ${g.days}天 |`,
        )
      })
      mdLines.push('')
    }

    if (topLosers.some((g) => g.pnl < 0)) {
      mdLines.push(`## 亏损 Top`)
      mdLines.push(`| 股票 | 盈亏 | 持仓 |`)
      mdLines.push(`|------|------|------|`)
      topLosers
        .filter((g) => g.pnl < 0)
        .forEach((g) => {
          mdLines.push(
            `| ${g.name}（${g.code}） | ${formatMoney(g.pnl, { withSign: true })} | ${g.days}天 |`,
          )
        })
      mdLines.push('')
    }

    if (topMistakes.length > 0) {
      mdLines.push(`## 高频错误`)
      topMistakes.forEach(([key, count]) => {
        mdLines.push(`- ${translateMap(t.mistakes, key)}：${count} 次`)
      })
      mdLines.push('')
    }

    mdLines.push(`**纪律评分：${disciplineScore.score} / 100**`)

    return { periodLabel, empty: false, text, markdown: mdLines.join('\n') }
  }, [reportPeriod, closedGroups, disciplineScore.score, t.mistakes])

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
            <h2>量化指标</h2>
            <p>基于闭环交易数据计算的专业量化指标</p>
          </div>
          <BarChart2 size={20} aria-hidden="true" />
        </div>
        {closedGroups.length > 0 ? (
          <div className="quant-metrics-grid">
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--green)' }}>
                <TrendingUp size={16} />
              </div>
              <div>
                <div className="quant-metric-label">夏普比率</div>
                <div className="quant-metric-value">{quantMetrics.sharpeRatio.toFixed(2)}</div>
                <div className="quant-metric-hint">
                  {quantMetrics.sharpeRatio > 1 ? '优秀' : quantMetrics.sharpeRatio > 0.5 ? '良好' : '偏低'}
                </div>
              </div>
            </div>
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--red)' }}>
                <AlertTriangle size={16} />
              </div>
              <div>
                <div className="quant-metric-label">最大回撤</div>
                <div className="quant-metric-value">{quantMetrics.maxDrawdownPercent.toFixed(1)}%</div>
                <div className="quant-metric-hint">
                  {quantMetrics.maxDrawdownPercent < 10 ? '控制良好' : quantMetrics.maxDrawdownPercent < 20 ? '中等风险' : '风险偏高'}
                </div>
              </div>
            </div>
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--purple)' }}>
                <TrendingDown size={16} />
              </div>
              <div>
                <div className="quant-metric-label">年化收益</div>
                <div className="quant-metric-value">{quantMetrics.annualizedReturn.toFixed(1)}%</div>
                <div className="quant-metric-hint">
                  {quantMetrics.annualizedReturn > 20 ? '高收益' : quantMetrics.annualizedReturn > 0 ? '正收益' : '负收益'}
                </div>
              </div>
            </div>
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--orange)' }}>
                <BarChart2 size={16} />
              </div>
              <div>
                <div className="quant-metric-label">盈亏比</div>
                <div className="quant-metric-value">{quantMetrics.payoffRatio.toFixed(2)}</div>
                <div className="quant-metric-hint">
                  {quantMetrics.payoffRatio > 2 ? '优秀' : quantMetrics.payoffRatio > 1 ? '良好' : '偏低'}
                </div>
              </div>
            </div>
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--green)' }}>
                <TrendingUp size={16} />
              </div>
              <div>
                <div className="quant-metric-label">盈利因子</div>
                <div className="quant-metric-value">
                  {quantMetrics.profitFactor === Infinity ? '∞' : quantMetrics.profitFactor.toFixed(2)}
                </div>
                <div className="quant-metric-hint">
                  {quantMetrics.profitFactor > 2 ? '优秀' : quantMetrics.profitFactor > 1 ? '盈利' : '亏损'}
                </div>
              </div>
            </div>
            <div className="quant-metric">
              <div className="quant-metric-icon" style={{ color: 'var(--purple)' }}>
                <TrendingUp size={16} />
              </div>
              <div>
                <div className="quant-metric-label">期望值</div>
                <div className="quant-metric-value">{formatMoney(quantMetrics.expectancy, { withSign: true })}</div>
                <div className="quant-metric-hint">
                  {quantMetrics.expectancy > 0 ? '正期望' : '负期望'}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p style={{ color: 'var(--muted)', padding: '16px 0' }}>
            暂无闭环交易数据，无法计算量化指标。
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
                  if (name === 'count') return [`${value} 次`, '出现次数']
                  return [formatMoney(value, { withSign: true }), '关联盈亏']
                }}
              />
              <Bar dataKey="count" fill="var(--orange)" radius={[0, 4, 4, 0]} />
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
          <CalendarDays size={20} aria-hidden="true" />
        </div>
        {closedGroups.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={holdingData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--muted)' }} />
              <YAxis tick={{ fontSize: 12, fill: 'var(--muted)' }} allowDecimals={false} />
              <Tooltip formatter={(value: number) => [`${value} 笔`, '交易数']} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {holdingData.map((_, index) => (
                  <Cell key={index} fill={index % 2 === 0 ? 'var(--orange)' : 'var(--purple)'} />
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
                周报
              </button>
              <button
                className={reportPeriod === 'month' ? 'filter-chip active' : 'filter-chip'}
                type="button"
                onClick={() => setReportPeriod('month')}
              >
                月报
              </button>
            </div>
            {!report.empty && (
              <button
                className="icon-button"
                type="button"
                title="复制报告"
                onClick={handleCopyReport}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            )}
          </div>
        </div>
        <div className="report-preview">
          {report.empty ? (
            <p>当前周期内暂无闭环交易数据。</p>
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
