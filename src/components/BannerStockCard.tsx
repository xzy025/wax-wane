import { TrendUp, TrendDown, X } from 'phosphor-react'

export interface BannerStockCardProps {
  idx: { code: string; price: number; changePct: number }
  chartUrl: string
  name: string
  isCustom: boolean
  /** Prefix the price with "$" (used by US banner). */
  showDollar?: boolean
  onRemove?: () => void
}

/**
 * Index/stock card shared by the HK and US banners. Previously duplicated
 * (~95% identical) as a private `StockCard` in each banner.
 */
export default function BannerStockCard({
  idx,
  chartUrl,
  name,
  isCustom,
  showDollar,
  onRemove,
}: BannerStockCardProps) {
  const isUp = idx.changePct >= 0
  const ChangeIcon = isUp ? TrendUp : TrendDown

  return (
    <a
      className={`ashare-index ${isCustom ? 'ashare-index-custom' : ''}`}
      href={chartUrl}
      target="_blank"
      rel="noopener noreferrer"
    >
      {isCustom && onRemove && (
        <button
          className="ashare-index-remove"
          onClick={(e) => {
            e.preventDefault()
            onRemove()
          }}
          title="删除"
        >
          <X size={10} />
        </button>
      )}
      <div className="ashare-index-name">{name}</div>
      <div className={`ashare-index-price ${isUp ? 'up' : 'down'}`}>
        {showDollar ? `$${idx.price.toFixed(2)}` : idx.price.toFixed(2)}
      </div>
      <div className={`ashare-index-change ${isUp ? 'up' : 'down'}`}>
        <ChangeIcon size={12} aria-hidden="true" />
        {isUp ? '+' : ''}
        {idx.changePct.toFixed(2)}%
      </div>
    </a>
  )
}
