import { useState } from 'react'
import { ArrowClockwise, Plus } from 'phosphor-react'
import { useHKData } from '../hooks/useHKData'
import { addCustomStock, removeCustomStock } from '../utils/customStocks'
import BannerStockCard from './BannerStockCard'
import type { Translation } from '../types'

interface HKBannerProps {
  t: Translation
  date?: string
}

// EastMoney quote-page URLs. HK indices live under /gb/zs{SYMBOL}.html; HK stocks
// under /hk/{code}.html (the bare hk{code}.html / zs{SYMBOL}.html forms 404).
// 中概互联 has no EM HK-index page, so it links to the A-share 中概互联网ETF (513050).
const INDEX_CONFIG: Record<string, { labelKey: keyof Translation['hk']; chartUrl: string }> = {
  HSI: { labelKey: 'hsi', chartUrl: 'https://quote.eastmoney.com/gb/zsHSI.html' },
  HSTECH: { labelKey: 'hstech', chartUrl: 'https://quote.eastmoney.com/gb/zsHSTECH.html' },
  HCINT: { labelKey: 'chinaInternet', chartUrl: 'https://quote.eastmoney.com/sh513050.html' },
}

// The custom list mixes HK (5-digit) and A-share (6-digit) codes.
function customChartUrl(code: string): string {
  if (/^\d{6}$/.test(code)) {
    return `https://quote.eastmoney.com/${code.startsWith('6') ? 'sh' : 'sz'}${code}.html`
  }
  return `https://quote.eastmoney.com/hk/${code}.html`
}

export default function HKBanner({ t, date }: HKBannerProps) {
  const { data, loading, error, lastUpdated, refresh, refreshCustom } = useHKData(date)
  const hasData = !!data && data.indices.length > 0
  const [addCode, setAddCode] = useState('')

  const handleAdd = () => {
    const code = addCode.trim()
    if (!code) return
    if (addCustomStock('hk', code)) {
      setAddCode('')
      refreshCustom()
    }
  }

  const handleRemove = (code: string) => {
    removeCustomStock('hk', code)
    refreshCustom()
  }

  return (
    <div className="hk-banner">
      {loading && !hasData ? (
        [1, 2, 3].map((i) => (
          <div className="ashare-index" key={i}>
            <div className="macro-skeleton" style={{ width: 60, marginBottom: 4 }} />
            <div className="macro-skeleton" style={{ width: 80 }} />
          </div>
        ))
      ) : hasData ? (
        <>
          {data!.indices.map((idx) => {
            const config = INDEX_CONFIG[idx.code]
            // Stale cached days may carry codes outside today's config; still render them.
            return (
              <BannerStockCard
                key={idx.code}
                idx={idx}
                chartUrl={config?.chartUrl ?? customChartUrl(idx.code)}
                name={config ? t.hk[config.labelKey] : idx.name || idx.code}
                isCustom={false}
              />
            )
          })}
          {data!.customStocks?.map((idx) => (
            <BannerStockCard
              key={idx.code}
              idx={idx}
              chartUrl={customChartUrl(idx.code)}
              name={idx.name || idx.code}
              isCustom={true}
              onRemove={() => handleRemove(idx.code)}
              removeTitle={t.hk.removeStock}
            />
          ))}
        </>
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
        {hasData && (
          <div className="ashare-meta-add">
            <input
              type="text"
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              placeholder={t.hk.addPlaceholder}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              maxLength={6}
            />
            <button onClick={handleAdd} title={t.hk.addStock}>
              <Plus size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
