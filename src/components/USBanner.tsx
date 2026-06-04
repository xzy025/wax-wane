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

const INDEX_CONFIG: Record<string, { labelKey: keyof Translation['us']; chartUrl: string }> = {
  DJI: { labelKey: 'dji', chartUrl: 'https://quote.eastmoney.com/zsDJI.html' },
  IXIC: { labelKey: 'ixic', chartUrl: 'https://quote.eastmoney.com/zsIXIC.html' },
  NVDA: { labelKey: 'nvda', chartUrl: 'https://quote.eastmoney.com/usNVDA.html' },
  LITE: { labelKey: 'lite', chartUrl: 'https://quote.eastmoney.com/usLITE.html' },
  TSM: { labelKey: 'tsm', chartUrl: 'https://quote.eastmoney.com/usTSM.html' },
}

const FIXED_CODES = new Set(['DJI', 'IXIC'])

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
            if (!config) return null
            const isIndex = FIXED_CODES.has(idx.code)
            return (
              <BannerStockCard
                key={idx.code}
                idx={idx}
                chartUrl={config.chartUrl}
                name={t.us[config.labelKey]}
                isCustom={false}
                showDollar={!isIndex}
              />
            )
          })}
          {data!.customStocks?.map((idx) => (
            <BannerStockCard
              key={idx.code}
              idx={idx}
              chartUrl={`https://quote.eastmoney.com/us${idx.code}.html`}
              name={idx.name || idx.code}
              isCustom={true}
              showDollar={true}
              onRemove={() => handleRemove(idx.code)}
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
        {hasData && (
          <div className="ashare-meta-add">
            <input
              type="text"
              value={addCode}
              onChange={(e) => setAddCode(e.target.value)}
              placeholder="美股代码"
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
            {t.us.lastUpdated} {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        {error && hasData && <span style={{ color: 'var(--red)' }}>{t.us.error}</span>}
      </div>
    </div>
  )
}
