import {
  Activity,
  ArrowLeftRight,
  BarChart2,
  DollarSign,
  Flame,
  Landmark,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { useMacroData } from '../hooks/useMacroData'
import type { Translation } from '../types'

interface MacroBannerProps {
  t: Translation
  date?: string
}

const indicatorConfig: Record<
  string,
  { icon: typeof DollarSign; labelKey: keyof Translation['macro']; chartUrl: string }
> = {
  us10y: {
    icon: Landmark,
    labelKey: 'us10y',
    chartUrl: 'https://www.tradingview.com/chart/?symbol=TVC:US10Y',
  },
  us5y: {
    icon: Landmark,
    labelKey: 'us5y',
    chartUrl: 'https://www.tradingview.com/chart/?symbol=TVC:US05Y',
  },
  gold: {
    icon: DollarSign,
    labelKey: 'gold',
    chartUrl: 'https://www.tradingview.com/chart/?symbol=TVC:GOLD',
  },
  dxy: {
    icon: BarChart2,
    labelKey: 'dxy',
    chartUrl: 'https://www.tradingview.com/chart/?symbol=TVC:DXY',
  },
  usdcny: {
    icon: ArrowLeftRight,
    labelKey: 'usdcny',
    chartUrl: 'https://www.tradingview.com/chart/?symbol=FX_IDC:USDCNY',
  },
  crude: {
    icon: Flame,
    labelKey: 'crude',
    chartUrl: 'https://www.tradingview.com/chart/?symbol=NYMEX:CL1!',
  },
  vix: {
    icon: Activity,
    labelKey: 'vix',
    chartUrl: 'https://www.tradingview.com/chart/?symbol=TVC:VIX',
  },
}

function formatValue(value: number, unit: string, id: string): string {
  if (unit === '%') return `${value.toFixed(2)}%`
  if (unit === 'USD/oz') return `$${value.toFixed(0)}`
  if (unit === 'USD/桶') return `$${value.toFixed(2)}`
  if (id === 'usdcny') return value.toFixed(4)
  if (id === 'vix') return value.toFixed(1)
  if (id === 'dxy') return value.toFixed(2)
  return value.toFixed(2)
}

export default function MacroBanner({ t, date }: MacroBannerProps) {
  const { data, loading, error, lastUpdated, refresh } = useMacroData(date)
  const hasData = data.length > 0

  return (
    <>
      <div className="macro-banner">
        {!hasData && !loading ? (
          <div className="macro-banner-empty">
            <span>{t.macro.loading}</span>
            <button className="macro-refresh-btn" type="button" onClick={refresh}>
              <RefreshCw size={14} aria-hidden="true" />
              {t.macro.retry}
            </button>
          </div>
        ) : loading ? (
          [1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div className="macro-item" key={i}>
              <div className="macro-item-icon">
                <div className="macro-skeleton" style={{ width: 16, height: 16 }} />
              </div>
              <div>
                <div className="macro-skeleton" style={{ width: 60, marginBottom: 4 }} />
                <div className="macro-skeleton" style={{ width: 80 }} />
              </div>
            </div>
          ))
        ) : (
          data.map((item) => {
            const config = indicatorConfig[item.id]
            if (!config) return null
            const Icon = config.icon
            const change = item.value - item.previousClose
            const changePct = (change / item.previousClose) * 100
            const isUp = change >= 0
            const ChangeIcon = isUp ? TrendingUp : TrendingDown

            return (
              <a
                className="macro-item"
                key={item.id}
                href={config.chartUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div className="macro-item-icon">
                  <Icon size={16} aria-hidden="true" />
                </div>
                <div>
                  <div className="macro-item-label">{t.macro[config.labelKey]}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="macro-item-value">
                      {formatValue(item.value, item.unit, item.id)}
                    </span>
                    <span className={`macro-item-change ${isUp ? 'up' : 'down'}`}>
                      <ChangeIcon size={12} aria-hidden="true" />
                      {isUp ? '+' : ''}
                      {changePct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              </a>
            )
          })
        )}
        <div className="macro-banner-meta">
          {lastUpdated && (
            <span>
              {t.macro.lastUpdated} {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          {error && <span style={{ color: 'var(--red)' }}>{t.macro.error}</span>}
          <button
            className="icon-button"
            type="button"
            aria-label={t.macro.retry}
            title={t.macro.retry}
            onClick={refresh}
            disabled={loading}
            style={{ padding: 4 }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  )
}
