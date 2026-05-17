import { formatMoney, translateMap } from '../utils'
import type { TradeGroup, Translation } from '../types'

interface TradeGroupTableProps {
  groups: TradeGroup[]
  t: Translation
}

export default function TradeGroupTable({ groups, t }: TradeGroupTableProps) {
  return (
    <div className="data-table trade-table">
      <div className="table-row table-head">
        {t.tradeTable.headers.map((header) => (
          <span key={header}>{header}</span>
        ))}
      </div>
      {groups.map((group) => (
        <div className="table-row" key={group.id}>
          <span>
            <strong>{translateMap(t.stocks, group.name)}</strong>
            <small>{group.code}</small>
          </span>
          <span>
            {group.opened} - {group.closed ?? t.reviews.open}
          </span>
          <span>{translateMap(t.strategies, group.strategy)}</span>
          <span>
            {group.days}
            {t.reviews.dayUnit}
          </span>
          <span className={group.pnl >= 0 ? 'positive-text' : 'negative-text'}>
            {formatMoney(group.pnl, { withSign: true })}
          </span>
          <span>{translateMap(t.statuses, group.status)}</span>
        </div>
      ))}
    </div>
  )
}
