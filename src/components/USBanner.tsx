import {
  ArrowClockwise,
  TrendUp,
  TrendDown,
} from 'phosphor-react'
import { useUSData } from '../hooks/useUSData'
import type { Translation } from '../types'

interface USBannerProps {
  t: Translation
  date?: string
}

const STOCK_CONFIG: Record<string, { labelKey: keyof Translation['us']; chartUrl: string }> = {
  NVDA: { labelKey: 'nvda', chartUrl: 'https://quote.eastmoney.com/usNVDA.html' },
  LITE: { labelKey: 'lite', chartUrl: 'https://quote.eastmoney.com/usLITE.html' },
  AMD: { labelKey: 'amd', chartUrl: 'https://quote.eastmoney.com/usAMD.html' },
  TSM: { labelKey: 'tsm', chartUrl: 'https://quote.eastmoney.com/usTSM.html' },
}

export default function USBanner({ t, date }: USBannerProps) {
  const { data, loading, error, lastUpdated, refresh } = useUSData(date)
  const hasData = !!data && data.indices.length > 0

  return (
    <div className="ashare-banner">
      {loading && !hasData ? (
        [1, 2, 3, 4].map((i) => (
          <div className="ashare-index" key={i}>
            <div className="macro-skeleton" style={{ width: 60, marginBottom: 4 }} />
            <div className="macro-skeleton" style={{ width: 80 }} />
          </div>
        ))
      ) : hasData ? (
        data!.indices.map((idx) => {
          const config = STOCK_CONFIG[idx.code]
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
              <div className="ashare-index-name">{t.us[config.labelKey]}</div>
              <div className={`ashare-index-price ${isUp ? 'up' : 'down'}`}>
                ${idx.price.toFixed(2)}
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
            {error ? t.us.error : t.us.loading}
          </span>
          <button className="macro-refresh-btn" type="button" onClick={refresh}>
            <ArrowClockwise size={14} aria-hidden="true" />
            {t.us.retry}
          </button>
        </div>
      )}

      <div className="ashare-meta">
        {lastUpdated && (
          <span>
            {t.us.lastUpdated} {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        {error && hasData && <span style={{ color: 'var(--red)' }}>{t.us.error}</span>}
      </div>
    </div>
  )
}
