import { ArrowClockwise, Fire, ShieldStar } from 'phosphor-react'
import { useHotList, type HotStock, type DragonTigerStock } from '../hooks/useHotList'
import type { Translation } from '../types'

interface HotListBannerProps {
  t: Translation
  date?: string
}

function formatAmt(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(0)}万`
  return n.toFixed(0)
}

function StockRow({ stock, source }: { stock: HotStock; source: 'em' | 'ths' | 'tgb' }) {
  const isUp = stock.changePct !== null && stock.changePct >= 0
  const isDown = stock.changePct !== null && stock.changePct < 0
  const market = stock.code.startsWith('6') ? 'sh' : 'sz'
  const url = `https://quote.eastmoney.com/${market}${stock.code}.html`

  return (
    <a className="hotlist-row" href={url} target="_blank" rel="noopener noreferrer">
      <span className={`hotlist-rank ${stock.rank <= 3 ? 'top3' : ''}`}>{stock.rank}</span>
      <span className="hotlist-code">{stock.code}</span>
      <span className="hotlist-name">{stock.name}</span>
      {stock.changePct !== null && (
        <span className={`hotlist-change ${isUp ? 'up' : isDown ? 'down' : ''}`}>
          {isUp ? '+' : ''}{stock.changePct.toFixed(2)}%
        </span>
      )}
      {source === 'ths' && stock.tags.length > 0 && (
        <span className="hotlist-tags">
          {stock.tags.map((tag) => (
            <span key={tag} className="hotlist-tag">{tag}</span>
          ))}
        </span>
      )}
      {source === 'ths' && stock.popularityTag && (
        <span className="hotlist-popularity">{stock.popularityTag}</span>
      )}
      {source === 'tgb' && stock.popularityTag && (
        <span className="hotlist-popularity">{stock.popularityTag}</span>
      )}
    </a>
  )
}

function DragonTigerRow({ stock }: { stock: DragonTigerStock }) {
  const isUp = stock.changePct >= 0
  const market = stock.code.startsWith('6') ? 'sh' : 'sz'
  const url = `https://quote.eastmoney.com/${market}${stock.code}.html`

  return (
    <a className="hotlist-row" href={url} target="_blank" rel="noopener noreferrer">
      <span className="hotlist-code">{stock.code}</span>
      <span className="hotlist-name">{stock.name}</span>
      <span className={`hotlist-change ${isUp ? 'up' : 'down'}`}>
        {isUp ? '+' : ''}{stock.changePct.toFixed(2)}%
      </span>
      <span className={`hotlist-net ${stock.netAmt >= 0 ? 'up' : 'down'}`}>
        {stock.netAmt >= 0 ? '+' : ''}{formatAmt(stock.netAmt)}
      </span>
      <span className="hotlist-explain">{stock.explain}</span>
    </a>
  )
}

export default function HotListBanner({ t, date }: HotListBannerProps) {
  const { data, loading, error, lastUpdated, refresh } = useHotList(date)
  const hasData = !!data && (
    data.eastmoney.length > 0 || data.ths.length > 0 ||
    data.dragonTiger.length > 0
  )

  return (
    <div className="hotlist-section">
      <div className="hotlist-header">
        <div className="hotlist-title">
          <Fire size={16} weight="fill" style={{ color: 'var(--orange)' }} />
          <span>热门榜单</span>
        </div>
        <div className="hotlist-meta">
          {lastUpdated && <span>{lastUpdated.toLocaleTimeString()}</span>}
          <button className="macro-refresh-btn" type="button" onClick={refresh} disabled={loading}>
            <ArrowClockwise size={12} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !hasData ? (
        <div className="hotlist-loading">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="macro-skeleton" style={{ height: 32, marginBottom: 4 }} />
          ))}
        </div>
      ) : hasData ? (
        <div className="hotlist-grid-4">
          {/* 东方财富 */}
          <div className="hotlist-panel">
            <div className="hotlist-panel-title">
              <Fire size={14} weight="fill" style={{ color: 'var(--orange)' }} />
              东方财富 热搜榜
            </div>
            <div className="hotlist-list">
              {data!.eastmoney.map((stock) => (
                <StockRow key={`em-${stock.code}`} stock={stock} source="em" />
              ))}
            </div>
          </div>

          {/* 同花顺 */}
          <div className="hotlist-panel">
            <div className="hotlist-panel-title">
              <Fire size={14} weight="fill" style={{ color: 'var(--red)' }} />
              同花顺 热榜
            </div>
            <div className="hotlist-list">
              {data!.ths.map((stock) => (
                <StockRow key={`ths-${stock.code}`} stock={stock} source="ths" />
              ))}
            </div>
          </div>

          {/* 龙虎榜 */}
          <div className="hotlist-panel">
            <div className="hotlist-panel-title">
              <ShieldStar size={14} weight="fill" style={{ color: 'var(--blue)' }} />
              龙虎榜
            </div>
            <div className="hotlist-list">
              <div className="hotlist-row hotlist-header-row">
                <span className="hotlist-code">代码</span>
                <span className="hotlist-name">名称</span>
                <span className="hotlist-change">涨跌</span>
                <span className="hotlist-net">净买入</span>
                <span className="hotlist-explain">席位</span>
              </div>
              {(data!.dragonTiger ?? []).map((stock) => (
                <DragonTigerRow key={`dt-${stock.code}`} stock={stock} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="ashare-empty">
          <span style={{ color: error ? 'var(--red)' : 'var(--muted)' }}>
            {error || '暂无数据'}
          </span>
        </div>
      )}
    </div>
  )
}
