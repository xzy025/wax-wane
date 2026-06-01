import {
  ArrowClockwise,
  TrendUp,
  TrendDown,
} from 'phosphor-react'
import { useHKData } from '../hooks/useHKData'
import type { Translation } from '../types'

interface HKBannerProps {
  t: Translation
  date?: string
}

const INDEX_CONFIG: Record<string, { labelKey: keyof Translation['hk']; chartUrl: string }> = {
  HSI: { labelKey: 'hsi', chartUrl: 'https://quote.eastmoney.com/zsHSI.html' },
  HSTECH: { labelKey: 'hstech', chartUrl: 'https://quote.eastmoney.com/zsHSTECH.html' },
  HCINT: { labelKey: 'chinaInternet', chartUrl: 'https://quote.eastmoney.com/zsHCINT.html' },
}

export default function HKBanner({ t, date }: HKBannerProps) {
  const { data, loading, error, lastUpdated, refresh } = useHKData(date)
  const hasData = !!data && data.indices.length > 0

  return (
    <div className="ashare-banner">
      {loading && !hasData ? (
        [1, 2, 3].map((i) => (
          <div className="ashare-index" key={i}>
            <div className="macro-skeleton" style={{ width: 60, marginBottom: 4 }} />
            <div className="macro-skeleton" style={{ width: 80 }} />
          </div>
        ))
      ) : hasData ? (
        data!.indices.map((idx) => {
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
              <div className="ashare-index-name">{t.hk[config.labelKey]}</div>
              <div className={`ashare-index-price ${isUp ? 'up' : 'down'}`}>
                {idx.price.toFixed(2)}
              </div>
              <div className={`ashare-index-change ${isUp ? 'up' : 'down'}`}>
                <ChangeIcon size={12} aria-hidden="true" />
                {isUp ? '+' : ''}
                {idx.changePct.toFixed(2)}%
              </div>
            </a>
          )
        })
      ) : (
        <div className="ashare-empty">
          <span style={{ color: error ? 'var(--red)' : 'var(--muted)' }}>
            {error ? t.hk.error : t.hk.loading}
          </span>
          <button className="macro-refresh-btn" type="button" onClick={refresh}>
            <ArrowClockwise size={14} aria-hidden="true" />
            {t.hk.retry}
          </button>
        </div>
      )}

      <div className="ashare-meta">
        {lastUpdated && (
          <span>
            {t.hk.lastUpdated} {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        {error && hasData && <span style={{ color: 'var(--red)' }}>{t.hk.error}</span>}
      </div>
    </div>
  )
}
