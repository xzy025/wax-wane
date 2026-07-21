import { Warning, TrendUp, TrendDown } from 'phosphor-react'
import type { HoldingTAItem, MAKey } from '../holdingsTA'
import { MA_KEYS } from '../holdingsTA'
import type { Translation } from '../../types'
import { fmtPrice } from '../holdingsFormat'

interface Props {
  ta?: HoldingTAItem
  t: Translation
}

const MA_LABEL: Record<MAKey, string> = { ma5: 'MA5', ma10: 'MA10', ma20: 'MA20', ma60: 'MA60', ma250: 'MA250' }

/** 服务端深度 TA 区块(受控纯展示):三法合成/均线矩阵/量价档位/较昨 delta。缺数据整块不渲染。 */
export function HoldingTaSection({ ta, t }: Props) {
  if (!ta || ta.error) return null
  const h = t.holdings.ta
  const score = Math.round(ta.combo.score01 * 100)
  const d = ta.delta ?? null
  const dScore = d ? Math.round(d.score01 * 100) : 0

  const lost = new Set(d?.maCrossings.filter((c) => c.startsWith('lost:')).map((c) => c.slice(5)) ?? [])
  const regained = new Set(d?.maCrossings.filter((c) => c.startsWith('regain:')).map((c) => c.slice(7)) ?? [])

  const deltaParts: string[] = []
  if (d) {
    if (dScore !== 0) deltaParts.push(`${h.score}${dScore > 0 ? '+' : ''}${dScore}`)
    if (d.wyckoffChanged) deltaParts.push(`${d.wyckoffChanged.from}→${d.wyckoffChanged.to}`)
    else if (d.biasChanged) deltaParts.push(`${h.bias[d.biasChanged.from]}→${h.bias[d.biasChanged.to]}`)
    const lostLabels = [...lost].map((k) => MA_LABEL[k as MAKey]).join('/')
    const regainLabels = [...regained].map((k) => MA_LABEL[k as MAKey]).join('/')
    if (lostLabels) deltaParts.push(`${h.maLost}${lostLabels}`)
    if (regainLabels) deltaParts.push(`${h.maRegain}${regainLabels}`)
    if (d.relStrengthDelta !== null && d.relStrengthDelta !== 0) {
      deltaParts.push(`RS${d.relStrengthDelta > 0 ? '+' : ''}${d.relStrengthDelta}pp`)
    }
  }

  return (
    <div className="hr-ta">
      <div className="hr-ta-row">
        <span className="hr-ta-chip hr-ta-phase">{ta.combo.wyckoffPhase}</span>
        <span className={`hr-ta-chip hr-ta-bias--${ta.combo.bias}`}>{h.bias[ta.combo.bias]}</span>
        {ta.combo.distribution && (
          <span className="hr-ta-chip hr-ta-dist">
            <Warning size={11} weight="fill" /> {h.distribution}
          </span>
        )}
        <span className="hr-ta-score hr-mono">
          {h.score} <strong>{score}</strong>
          {d !== null && dScore !== 0 && (
            <small className={dScore > 0 ? 'positive-text' : 'negative-text'}>
              {dScore > 0 ? <TrendUp size={10} /> : <TrendDown size={10} />}
              {dScore > 0 ? '+' : ''}
              {dScore}
            </small>
          )}
        </span>
      </div>

      <div className="hr-ta-row hr-ta-mas">
        {MA_KEYS.map((k) => {
          const na = !(ta.ma[k] > 0)
          const cls = na ? 'na' : ta.aboveMa[k] ? 'on' : 'off'
          const cross = lost.has(k) ? ' hr-ta-ma--lost' : regained.has(k) ? ' hr-ta-ma--regain' : ''
          return (
            <span key={k} className={`hr-ta-ma hr-ta-ma--${cls}${cross}`} title={na ? '—' : fmtPrice(ta.ma[k])}>
              {MA_LABEL[k]}
            </span>
          )
        })}
        <span className="hr-ta-tt">
          {h.trendTemplate}{' '}
          <strong className={ta.trendTemplateOk === null ? '' : ta.trendTemplateOk ? 'positive-text' : 'negative-text'}>
            {ta.trendTemplateOk === null ? '—' : ta.trendTemplateOk ? '✓' : '✗'}
          </strong>
        </span>
      </div>

      <div className="hr-ta-row hr-ta-levels">
        <span className="hr-level">
          {t.holdings.volumeRatio} <strong>{ta.volRatio.toFixed(2)}</strong>
        </span>
        <span className="hr-level">
          {h.todayVol} <strong>{ta.breakoutVolRatio.toFixed(2)}×</strong>
        </span>
        <span className="hr-level">
          {h.dist52} <strong>{ta.dist52Pct <= 0 ? '✓' : `-${ta.dist52Pct.toFixed(1)}%`}</strong>
        </span>
        {typeof ta.relStrength === 'number' && (
          <span className="hr-level">
            {h.relStrength}{' '}
            <strong className={ta.relStrength >= 0 ? 'positive-text' : 'negative-text'}>
              {ta.relStrength >= 0 ? '+' : ''}
              {ta.relStrength.toFixed(2)}pp
            </strong>
            {ta.counterTrend && <span className="hr-ta-chip hr-ta-counter">🔴{h.counterTrend}</span>}
          </span>
        )}
        <span className="hr-level">
          {h.atrStop} <strong className="negative-text">{fmtPrice(ta.atrStop)}</strong>
        </span>
        <span className="hr-level hr-mono">
          S1 <strong>{fmtPrice(ta.pivots.s1)}</strong> / R1 <strong>{fmtPrice(ta.pivots.r1)}</strong>
        </span>
      </div>

      {d && ta.delta?.distributionNew && (
        <div className="hr-ta-alert">
          <Warning size={12} weight="fill" /> {h.distributionNew}
        </div>
      )}
      {d && deltaParts.length > 0 && (
        <div className="hr-ta-delta">
          {h.deltaVs} {d.prevDate.slice(5)}: {deltaParts.join(' · ')}
        </div>
      )}
    </div>
  )
}
