import { useState } from 'react'
import {
  Activity,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  ChartBar,
  ArrowClockwise,
  TrendUp,
  TrendDown,
  Gauge,
  Thermometer,
  Fire,
  CaretDown,
  CaretUp,
} from 'phosphor-react'
import { useAShareData, calcProfitabilityScore } from '../hooks/useAShareData'
import { useSentiment } from '../hooks/useSentiment'
import { useHighs, type HighStock } from '../hooks/useHighs'
import type { Translation } from '../types'

interface AShareBannerProps {
  t: Translation
  date?: string
}

const INDEX_CONFIG: Record<string, { labelKey: keyof Translation['ashare']; chartUrl: string }> = {
  '000001': { labelKey: 'shIndex', chartUrl: 'https://quote.eastmoney.com/zs000001.html' },
  '399001': { labelKey: 'szIndex', chartUrl: 'https://quote.eastmoney.com/zs399001.html' },
  '399006': { labelKey: 'chiNext', chartUrl: 'https://quote.eastmoney.com/zs399006.html' },
  '000688': { labelKey: 'star50', chartUrl: 'https://quote.eastmoney.com/zs000688.html' },
  '899050': { labelKey: 'bse50', chartUrl: 'https://quote.eastmoney.com/zs899050.html' },
}

function formatPrice(price: number): string {
  return price.toFixed(2)
}

function formatVolume(vol: number): string {
  if (vol >= 1e8) return `${(vol / 1e8).toFixed(0)}亿`
  if (vol >= 1e4) return `${(vol / 1e4).toFixed(0)}万`
  return vol.toString()
}

function getProfitabilityLabel(t: Translation, score: number): string {
  if (score >= 70) return t.ashare.profitabilityGood
  if (score >= 40) return t.ashare.profitabilityOk
  return t.ashare.profitabilityBad
}

function getProfitabilityClass(score: number): string {
  if (score >= 70) return 'good'
  if (score >= 40) return 'ok'
  return 'bad'
}

/** Expandable list of stocks near/above a reference high (shared by both items). */
function HighList({ stocks, t }: { stocks: HighStock[]; t: Translation }) {
  return (
    <div className="ashare-expand-list">
      {stocks.map((s) => {
        const isUp = s.changePct >= 0
        const market = s.code.startsWith('6') ? 'sh' : 'sz'
        const broke = s.gapPct <= 0
        return (
          <a
            key={s.code}
            className="ashare-newhigh-item"
            href={`https://quote.eastmoney.com/${market}${s.code}.html`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="ashare-newhigh-code">{s.code}</span>
            <span className="ashare-newhigh-name">{s.name}</span>
            <span className="ashare-newhigh-price">{s.price.toFixed(2)}</span>
            <span className="ashare-newhigh-gap" style={broke ? { color: 'var(--red)', fontWeight: 700 } : undefined}>
              {broke ? t.ashare.atHigh : `${t.ashare.gapToHigh} ${s.gapPct.toFixed(2)}%`}
            </span>
            <span className={`ashare-newhigh-change ${isUp ? 'up' : 'down'}`}>
              {isUp ? '+' : ''}
              {s.changePct.toFixed(2)}%
            </span>
          </a>
        )
      })}
    </div>
  )
}

/** Map a 0-100 sentiment temperature to a color + i18n label. */
function tempStyle(temp: number, s: Translation['sentiment']): { color: string; label: string } {
  if (temp < 20) return { color: 'var(--temp-cold)', label: s.cold }
  if (temp < 40) return { color: 'var(--temp-cool)', label: s.cool }
  if (temp < 60) return { color: 'var(--temp-warm)', label: s.warm }
  if (temp < 80) return { color: 'var(--temp-hot)', label: s.hot }
  return { color: 'var(--temp-overheated)', label: s.overheated }
}

export default function AShareBanner({ t, date }: AShareBannerProps) {
  const { data, loading, error, lastUpdated, refresh } = useAShareData(date)
  const { data: sentiment, refresh: refreshSentiment } = useSentiment(date)
  const { data: highs, refresh: refreshHighs } = useHighs(date)
  const hasData = !!data
  const [prevHighExpanded, setPrevHighExpanded] = useState(false)
  const [high52wExpanded, setHigh52wExpanded] = useState(false)

  // One refresh button drives A-share quotes, sentiment, and highs (each cheap
  // call hits its own endpoint; the heavy highs scan stays off /api/ashare).
  const handleRefresh = () => {
    refresh()
    refreshSentiment()
    refreshHighs()
  }

  const score = data
    ? calcProfitabilityScore(data.limitUpCount, data.limitDownCount, data.advance, data.decline)
    : 0
  const adRatio = data && data.decline > 0 ? (data.advance / data.decline).toFixed(2) : '--'

  return (
    <>
      <div className="ashare-banner">
        {/* Meta bar - top */}
        <div className="ashare-meta">
          <button
            className="macro-refresh-btn"
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            aria-label={t.ashare.retry}
            title={t.ashare.retry}
          >
            <ArrowClockwise size={14} aria-hidden="true" />
          </button>
          {lastUpdated && (
            <span>
              {t.ashare.lastUpdated} {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          {error && hasData && <span style={{ color: 'var(--red)' }}>{t.ashare.error}</span>}
        </div>
        {/* Index cards */}
        {loading && !hasData ? (
          [1, 2, 3].map((i) => (
            <div className="ashare-index" key={i}>
              <div className="macro-skeleton" style={{ width: 60, marginBottom: 4 }} />
              <div className="macro-skeleton" style={{ width: 80 }} />
            </div>
          ))
        ) : hasData ? (
          data.indices.map((idx) => {
            const config = INDEX_CONFIG[idx.code]
            if (!config) return null
            const isUp = idx.changePct >= 0
            const ChangeIcon = isUp ? TrendUp : TrendDown

            return (
              <a
                className="ashare-index"
                key={idx.code}
                href={config.chartUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="ashare-index-name">{t.ashare[config.labelKey]}</div>
                <div className={`ashare-index-price ${isUp ? 'up' : 'down'}`}>{formatPrice(idx.price)}</div>
                <div className={`ashare-index-change ${isUp ? 'up' : 'down'}`}>
                  <ChangeIcon size={12} aria-hidden="true" />
                  {isUp ? '+' : ''}
                  {idx.changePct.toFixed(2)}%
                </div>
                <div className="ashare-index-vol">{formatVolume(idx.turnover)}</div>
              </a>
            )
          })
        ) : (
          <div className="ashare-empty">
            <span style={{ color: error ? 'var(--red)' : 'var(--muted)' }}>
              {error ? t.ashare.error : t.ashare.loading}
            </span>
            <button className="macro-refresh-btn" type="button" onClick={handleRefresh}>
              <ArrowClockwise size={14} aria-hidden="true" />
              {t.ashare.retry}
            </button>
          </div>
        )}

        {/* Sentiment divider */}
        {hasData && <div className="ashare-divider" />}

        {/* Sentiment indicators */}
        {hasData && (
          <>
            <div className="ashare-stat">
              <ArrowUp size={14} aria-hidden="true" className="ashare-stat-icon up" />
              <div>
                <div className="ashare-stat-label">{t.ashare.limitUp}</div>
                <div className="ashare-stat-value up">{data.limitUpCount}</div>
              </div>
            </div>

            <div className="ashare-stat">
              <ArrowDown size={14} aria-hidden="true" className="ashare-stat-icon down" />
              <div>
                <div className="ashare-stat-label">{t.ashare.limitDown}</div>
                <div className="ashare-stat-value down">{data.limitDownCount}</div>
              </div>
            </div>

            <div className="ashare-stat">
              <ChartBar size={14} aria-hidden="true" className="ashare-stat-icon" />
              <div>
                <div className="ashare-stat-label">
                  {t.ashare.advance}/{t.ashare.decline}
                </div>
                <div className="ashare-stat-value">
                  <span className="up">{data.advance}</span>/<span className="down">{data.decline}</span>
                </div>
              </div>
            </div>

            <div className="ashare-stat">
              <Activity size={14} aria-hidden="true" className="ashare-stat-icon" />
              <div>
                <div className="ashare-stat-label">{t.ashare.adRatio}</div>
                <div className="ashare-stat-value">{adRatio}</div>
              </div>
            </div>

            <div className="ashare-stat">
              <ArrowUpRight size={14} aria-hidden="true" className="ashare-stat-icon up" />
              <div>
                <div className="ashare-stat-label">{t.ashare.promotionRate}</div>
                <div className="ashare-stat-value">
                  {data.promotedCount}/{data.promotionTotal}{' '}
                  <span style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                    {data.promotionRate}%
                  </span>
                </div>
              </div>
            </div>

            <div
              className={`ashare-stat ${prevHighExpanded ? 'ashare-stat-expanded' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setPrevHighExpanded((v) => !v)}
              role="button"
              tabIndex={0}
              title={t.ashare.highsHint}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setPrevHighExpanded((v) => !v)
              }}
            >
              <TrendUp size={14} aria-hidden="true" className="ashare-stat-icon up" />
              <div>
                <div className="ashare-stat-label">{t.ashare.prevHigh}</div>
                <div className="ashare-stat-value">
                  {highs?.prevHigh.count ?? 0}
                  {(highs?.prevHigh.stocks.length ?? 0) > 0 &&
                    (prevHighExpanded ? (
                      <CaretUp size={12} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                    ) : (
                      <CaretDown size={12} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                    ))}
                </div>
              </div>
            </div>

            <div
              className={`ashare-stat ${high52wExpanded ? 'ashare-stat-expanded' : ''}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setHigh52wExpanded((v) => !v)}
              role="button"
              tabIndex={0}
              title={t.ashare.highsHint}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setHigh52wExpanded((v) => !v)
              }}
            >
              <TrendUp size={14} aria-hidden="true" className="ashare-stat-icon" />
              <div>
                <div className="ashare-stat-label">{t.ashare.high52w}</div>
                <div className="ashare-stat-value">
                  {highs?.high52w.count ?? 0}
                  {(highs?.high52w.stocks.length ?? 0) > 0 &&
                    (high52wExpanded ? (
                      <CaretUp size={12} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                    ) : (
                      <CaretDown size={12} style={{ marginLeft: 4, verticalAlign: 'middle' }} />
                    ))}
                </div>
              </div>
            </div>

            <div className={`ashare-score ${getProfitabilityClass(score)}`}>
              <Gauge size={14} aria-hidden="true" />
              <div>
                <div className="ashare-stat-label">{t.ashare.profitability}</div>
                <div className="ashare-score-value">
                  {score}
                  <span className="ashare-score-unit">/100</span>
                </div>
                <div className="ashare-score-label">{getProfitabilityLabel(t, score)}</div>
              </div>
            </div>

            {/* Merged sentiment metrics (开盘啦): only the items A-share banner lacked. */}
            {sentiment && (
              <>
                <div className="ashare-stat">
                  <Fire size={14} aria-hidden="true" className="ashare-stat-icon up" />
                  <div>
                    <div className="ashare-stat-label">{t.sentiment.yestLimitPerf}</div>
                    <div className={`ashare-stat-value ${sentiment.yestLimitPerf >= 0 ? 'up' : 'down'}`}>
                      {sentiment.yestLimitPerf >= 0 ? '+' : ''}
                      {sentiment.yestLimitPerf.toFixed(2)}%
                    </div>
                  </div>
                </div>

                {(() => {
                  const { color, label } = tempStyle(sentiment.temperature, t.sentiment)
                  return (
                    <div className="ashare-stat" title={t.sentiment.source}>
                      <Thermometer size={14} aria-hidden="true" className="ashare-stat-icon" style={{ color }} />
                      <div>
                        <div className="ashare-stat-label">{t.sentiment.temperature}</div>
                        <div className="ashare-stat-value" style={{ color }}>
                          {sentiment.temperature}
                          <span style={{ marginLeft: 4, fontSize: '0.78rem' }}>{label}</span>
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </>
            )}

            {/* Volume History */}
            <div className="ashare-divider" />
            <div className="ashare-volume-section">
              <div className="ashare-stat-label" style={{ marginBottom: 4 }}>
                {t.ashare.totalVolume}
                {data.totalTurnover != null && data.totalTurnover > 0 && (
                  <span style={{ marginLeft: 6, fontWeight: 600, color: 'var(--text)' }}>
                    {(data.totalTurnover / 1e12).toFixed(2)} 万亿
                  </span>
                )}
              </div>
              <div className="ashare-volume-bars">
                {(data.volumeHistory ?? []).map((v, i) => {
                  const prevVol = i > 0 ? data.volumeHistory![i - 1].turnover : v.turnover
                  const isUp = v.turnover >= prevVol
                  const isToday = i === (data.volumeHistory?.length ?? 0) - 1
                  const volInYi = (v.turnover / 1e12).toFixed(1)
                  return (
                    <div key={`${v.date}-${i}`} className="ashare-volume-bar-wrapper">
                      <div className="ashare-volume-bar-area">
                        <div
                          className="ashare-volume-bar"
                          style={{
                            background: isToday ? (isUp ? 'var(--red)' : 'var(--green)') : (isUp ? 'rgba(var(--red-rgb),0.35)' : 'rgba(var(--green-rgb),0.35)'),
                          }}
                        />
                      </div>
                      <div className="ashare-volume-value" style={{ color: isUp ? 'var(--red)' : 'var(--green)' }}>
                        {volInYi}
                      </div>
                      <div className="ashare-volume-date">{v.date}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )}

        {/* Prior-swing-high candidate list (最高点) */}
        {hasData && prevHighExpanded && (highs?.prevHigh.stocks.length ?? 0) > 0 && (
          <HighList stocks={highs?.prevHigh.stocks ?? []} t={t} />
        )}

        {/* 52-week-high candidate list (次高点) */}
        {hasData && high52wExpanded && (highs?.high52w.stocks.length ?? 0) > 0 && (
          <HighList stocks={highs?.high52w.stocks ?? []} t={t} />
        )}
      </div>
    </>
  )
}
