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

const INDEX_CONFIG: Record<string, { labelKey: keyof Translation['hk']; chartUrl: string }> = {
  HSI: { labelKey: 'hsi', chartUrl: 'https://quote.eastmoney.com/zsHSI.html' },
  HSTECH: { labelKey: 'hstech', chartUrl: 'https://quote.eastmoney.com/zsHSTECH.html' },
  HCINT: { labelKey: 'chinaInternet', chartUrl: 'https://quote.eastmoney.com/zsHCINT.html' },
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
            if (!config) return null
            return (
              <BannerStockCard
                key={idx.code}
                idx={idx}
                chartUrl={config.chartUrl}
                name={t.hk[config.labelKey]}
                isCustom={false}
              />
            )
          })}
          {data!.customStocks?.map((idx) => (
            <BannerStockCard
              key={idx.code}
              idx={idx}
              chartUrl={`https://quote.eastmoney.com/hk${idx.code}.html`}
              name={idx.name || idx.code}
              isCustom={true}
              onRemove={() => handleRemove(idx.code)}
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
        {hasData && (
          <div className="ashare-meta-add">
            <input
              type="text"
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              placeholder="港股代码"
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              maxLength={6}
            />
            <button onClick={handleAdd} title="添加个股">
              <Plus size={12} />
            </button>
          </div>
        )}
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
