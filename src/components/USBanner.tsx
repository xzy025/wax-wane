import { useState } from 'react'
import { ArrowClockwise, Plus } from 'phosphor-react'
import { useUSData } from '../hooks/useUSData'
import { addCustomStock, removeCustomStock } from '../utils/customStocks'
import BannerStockCard from './BannerStockCard'
import type { Translation } from '../types'

interface USBannerProps {
  t: Translation
  date?: string
}

// Fixed indices only — stocks live in the user-editable custom list.
// EastMoney US index pages use special symbols (us/DJIA, us/NDAQ, gb/zsSPX).
const INDEX_CONFIG: Record<string, { labelKey: keyof Translation['us']; chartUrl: string }> = {
  DJI: { labelKey: 'dji', chartUrl: 'https://quote.eastmoney.com/us/DJIA.html' },
  IXIC: { labelKey: 'ixic', chartUrl: 'https://quote.eastmoney.com/us/NDAQ.html' },
  SPX: { labelKey: 'spx', chartUrl: 'https://quote.eastmoney.com/gb/zsSPX.html' },
}

export default function USBanner({ t, date }: USBannerProps) {
  const { data, loading, error, lastUpdated, refresh, refreshCustom } = useUSData(date)
  const hasData = !!data && data.indices.length > 0
  const [addCode, setAddCode] = useState('')

  const handleAdd = () => {
    const code = addCode.trim().toUpperCase()
    if (!code) return
    if (addCustomStock('us', code)) {
      setAddCode('')
      refreshCustom()
    }
  }

  const handleRemove = (code: string) => {
    removeCustomStock('us', code)
    refreshCustom()
  }

  return (
    <div className="us-banner">
      {loading && !hasData ? (
        [1, 2, 3, 4, 5].map((i) => (
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
                chartUrl={config?.chartUrl ?? `https://quote.eastmoney.com/us/${idx.code}.html`}
                name={config ? t.us[config.labelKey] : idx.name || idx.code}
                isCustom={false}
                showDollar={!config}
              />
            )
          })}
          {data!.customStocks?.map((idx) => (
            <BannerStockCard
              key={idx.code}
              idx={idx}
              chartUrl={`https://quote.eastmoney.com/us/${idx.code}.html`}
              name={idx.name || idx.code}
              isCustom={true}
              showDollar={true}
              onRemove={() => handleRemove(idx.code)}
              removeTitle={t.us.removeStock}
            />
          ))}
        </>
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
        {hasData && (
          <div className="ashare-meta-add">
            <input
              type="text"
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              placeholder={t.us.addPlaceholder}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              maxLength={6}
            />
            <button onClick={handleAdd} title={t.us.addStock}>
              <Plus size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
