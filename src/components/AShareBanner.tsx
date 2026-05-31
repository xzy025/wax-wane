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
  CaretDown,
  CaretUp,
} from 'phosphor-react'
import { useAShareData, calcProfitabilityScore } from '../hooks/useAShareData'
import type { Translation } from '../types'

interface AShareBannerProps {
  t: Translation
  date?: string
}

const INDEX_CONFIG: Record<string, { labelKey: keyof Translation['ashare']; chartUrl: string }> = {
  '000001': { labelKey: 'shIndex', chartUrl: 'https://quote.eastmoney.com/zs000001.html' },
  '399001': { labelKey: 'szIndex', chartUrl: 'https://quote.eastmoney.com/zs399001.html' },
  '399006': { labelKey: 'chiNext', chartUrl: 'https://quote.eastmoney.com/zs399006.html' },
}

function formatPrice(price: number, code: string): string {
  if (code === '000001') return price.toFixed(2)
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

export default function AShareBanner({ t, date }: AShareBannerProps) {
  const { data, loading, error, lastUpdated, refresh } = useAShareData(date)
  const hasData = !!data
  const [newHighExpanded, setNewHighExpanded] = useState(false)

  const score = data
    ? calcProfitabilityScore(data.limitUpCount, data.limitDownCount, data.advance, data.decline)
    : 0
  const adRatio = data && data.decline > 0 ? (data.advance / data.decline).toFixed(2) : '--'

  return (
    <>
      <div className="ashare-banner">
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
                <div className="ashare-index-price">{formatPrice(idx.price, idx.code)}</div>
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
            <span>{t.ashare.loading}</span>
            <button className="macro-refresh-btn" type="button" onClick={refresh}>
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
                  {data.advance}/{data.decline}
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
              className="ashare-stat"
              style={{ cursor: 'pointer' }}
              onClick={() => setNewHighExpanded((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setNewHighExpanded((v) => !v)
              }}
            >
              <TrendUp size={14} aria-hidden="true" className="ashare-stat-icon up" />
              <div>
                <div className="ashare-stat-label">{t.ashare.newHigh}</div>
                <div className="ashare-stat-value">
                  {data.newHighCount}
                  {(data.newHighStocks?.length ?? 0) > 0 &&
                    (newHighExpanded ? (
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
          </>
        )}

        {/* Meta bar */}
        <div className="ashare-meta">
          {lastUpdated && (
            <span>
              {t.ashare.lastUpdated} {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          {error && <span style={{ color: 'var(--red)' }}>{t.ashare.error}</span>}
          <button
            className="icon-button"
            type="button"
            aria-label={t.ashare.retry}
            title={t.ashare.retry}
            onClick={refresh}
            disabled={loading}
            style={{ padding: 4 }}
          >
            <ArrowClockwise size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* New High stock list */}
      {hasData && newHighExpanded && (data.newHighStocks?.length ?? 0) > 0 && (
        <div className="ashare-newhigh-list">
          {(data.newHighStocks ?? []).map((s) => {
            const isUp = s.changePct >= 0
            const market = s.code.startsWith('6') ? 'sh' : 'sz'
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
                <span className={`ashare-newhigh-change ${isUp ? 'up' : 'down'}`}>
                  {isUp ? '+' : ''}
                  {s.changePct.toFixed(2)}%
                </span>
              </a>
            )
          })}
        </div>
      )}
    </>
  )
}
