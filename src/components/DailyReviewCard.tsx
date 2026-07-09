import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CaretDown, CaretUp } from 'phosphor-react'
import { useDailyReview, type ReviewQuote, type ReviewBoardChip } from '../hooks/useDailyReview'
import type { Translation } from '../types'

/** A-share convention: red = up, green = down.(同 RotationView 私有实现) */
function colorClass(n: number | null | undefined): string {
  if (n == null || n === 0) return ''
  return n > 0 ? 'positive-text' : 'negative-text'
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}
/** 涨停池 fbt(HHMMSS 数字串,如 '93500') → HH:MM;空/0 → '--:--'。 */
function fmtFbt(fbt: string): string {
  const s = fbt.padStart(6, '0')
  return !fbt || fbt === '0' ? '--:--' : `${s.slice(0, 2)}:${s.slice(2, 4)}`
}

function QuoteChip({ q }: { q: ReviewQuote }) {
  return (
    <span className="rot-review-chip">
      {q.name} <b className={`mono ${colorClass(q.changePct)}`}>{fmtPct(q.changePct)}</b>
    </span>
  )
}

function BoardChips({ label, boards }: { label: string; boards: ReviewBoardChip[] }) {
  if (boards.length === 0) return null
  return (
    <span className="rot-review-boards">
      <span className="rot-review-boards-label">{label}</span>
      {boards.map((b) => (
        <span key={b.name} className="rot-review-chip">
          {b.name} <b className={`mono ${colorClass(b.shortChg)}`}>{fmtPct(b.shortChg)}</b>
        </span>
      ))}
    </span>
  )
}

const CAL_COLLAPSED = 5 // 日历默认显示条数
const NEWS_COLLAPSED = 3 // 消息面默认显示条数

/** 每日复盘综述:外围(日经/KOSPI/美股/恒指)→ 消息面(RSS+龙虎榜)→ 宏观日历 →
 *  A股三大指数 → 板块轮动,数据区规则拼装 + 盘后 LLM 叙事段(缺失时优雅降级)。 */
export default function DailyReviewCard({ t }: { t: Translation }) {
  const rv = t.rotation.review
  const st = t.rotation.structure
  const rq = t.rotation.quads
  const { data, loading, error } = useDailyReview()
  const [mdOpen, setMdOpen] = useState(false)
  const [calOpen, setCalOpen] = useState(false)
  const [newsOpen, setNewsOpen] = useState(false)
  if (loading && !data) return null
  if (error && !data) return <div className="alert-item danger">{rv.loadFail}</div>
  if (!data) return null

  const rb = data.reboundDay
  const globalQuotes = [...data.overnight, ...data.asia]
  const buys = data.dragonTiger.filter((x) => x.netAmt > 0)
  const sells = data.dragonTiger.filter((x) => x.netAmt <= 0)
  const calRows = calOpen ? data.calendar : data.calendar.slice(0, CAL_COLLAPSED)
  const newsRows = newsOpen ? data.news : data.news.slice(0, NEWS_COLLAPSED)
  const calSrcLabel = { jin10: rv.calJin10, builtin: rv.calBuiltin, mixed: rv.calMixed }[data.calendarSource]
  const fmtNet = (v: number) => `${v >= 0 ? '+' : ''}${(v / 1e8).toFixed(1)}亿`

  return (
    <div className="rot-review">
      <div className="rot-structure-head">
        <span className="rot-structure-title">
          {rv.title} · {data.asof}
          {data.fromCache && <span className="rot-review-badge">{rv.cached}</span>}
        </span>
        <span className="themes-updated">
          {st.generatedAt} {new Date(data.generatedAt).toLocaleString()}
        </span>
      </div>

      {data.narrative ? (
        <div className="rot-review-narrative">
          <div className="rot-review-tone">
            <span>{data.narrative.tone || rv.title}</span>
            <button type="button" className="rot-review-toggle" onClick={() => setMdOpen(!mdOpen)}>
              {mdOpen ? rv.collapse : rv.expand}
              {mdOpen ? <CaretUp size={12} /> : <CaretDown size={12} />}
            </button>
          </div>
          {mdOpen && (
            <div className="ai-markdown rot-review-md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.narrative.markdown}</ReactMarkdown>
            </div>
          )}
        </div>
      ) : (
        <div className="rot-review-nonarrative">{rv.noNarrative}</div>
      )}

      {rb?.detected && rb.signal && (
        <div className="rot-review-sec">
          <div className="rot-review-sec-head">
            <span className="rot-drill-grouptag">
              🚀 {rv.rbTag} · {rb.signal.date}
            </span>
            <span className="rot-review-badge">{rv.rbNote}</span>
          </div>
          <div className="rot-review-chips">
            <span className="rot-review-chip">
              {rv.rbDownDays} <b className="mono">{rb.signal.downDays}</b>
              {rv.rbDays} <b className={`mono ${colorClass(rb.signal.downCumPct)}`}>{fmtPct(rb.signal.downCumPct)}</b>
            </span>
            <span className="rot-review-chip">
              {rv.rbRebound} <b className={`mono ${colorClass(rb.signal.chgPct)}`}>{fmtPct(rb.signal.chgPct)}</b>
            </span>
            <span className="rot-review-chip">
              {rv.rbVolX} <b className="mono">{rb.signal.volRatio.toFixed(2)}×</b>
            </span>
            {rb.secondaryChgPct != null && (
              <span className="rot-review-chip">
                创业板指 <b className={`mono ${colorClass(rb.secondaryChgPct)}`}>{fmtPct(rb.secondaryChgPct)}</b>
              </span>
            )}
            {rb.brokerage && (
              <span className="rot-review-chip">
                {rb.brokerage.name}{' '}
                <b className={`mono ${colorClass(rb.brokerage.todayChg)}`}>{fmtPct(rb.brokerage.todayChg)}</b>
                {rb.brokerage.topMovers.slice(0, 3).map((m) => (
                  <span key={m.code} className="rot-review-newstag">
                    {m.name} {fmtPct(m.changePct)}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="rot-review-chips">
            <span className="rot-review-boards-label">{rv.rbPioneers}</span>
            {rb.pioneers.length === 0 && <span className="rot-review-newstag">{rv.rbNoPioneers}</span>}
            {rb.pioneers.map((p) => (
              <span key={p.code} className="rot-review-chip">
                {rb.fbtAvailable && <span className="mono">{fmtFbt(p.firstTime)}</span>} {p.name}
                {p.consecutiveDays > 0 && (
                  <b className="mono positive-text">
                    {' '}
                    {p.consecutiveDays}
                    {rv.rbBoardsUnit}
                  </b>
                )}
                {p.openCount > 0 && (
                  <span className="mono">
                    {' '}
                    {rv.rbOpensUnit}
                    {p.openCount}
                  </span>
                )}
                {p.industry && <span className="rot-review-newstag">{p.industry}</span>}
              </span>
            ))}
          </div>
          {rb.pioneers.length > 0 && !rb.fbtAvailable && <div className="rot-review-nonarrative">{rv.rbNoFbt}</div>}
          {rb.resilient.length > 0 && (
            <div className="rot-review-chips">
              <span className="rot-review-boards-label">{rv.rbResilient}</span>
              {rb.resilient.map((s) => (
                <span key={s.code} className="rot-review-chip">
                  {s.name} <b className={`mono ${colorClass(s.changePct)}`}>{fmtPct(s.changePct)}</b>
                  <span className="mono"> {s.volRatio.toFixed(1)}×</span>
                  <span className="rot-review-newstag">
                    {rv.rbCumRel} +{s.cumRelPct}pp · {rv.rbCounterDays} {s.counterTrendDays}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {globalQuotes.length > 0 && (
        <div className="rot-review-sec">
          <span className="rot-drill-grouptag">{rv.secGlobal}</span>
          <div className="rot-review-chips">
            {globalQuotes.map((q) => (
              <QuoteChip key={q.code} q={q} />
            ))}
          </div>
        </div>
      )}

      {(data.news.length > 0 || data.dragonTiger.length > 0) && (
        <div className="rot-review-sec">
          <span className="rot-drill-grouptag">{rv.secNews}</span>
          {newsRows.map((n, i) => (
            <div key={`${n.title}-${i}`} className="rot-review-news">
              <span className="rot-review-newstag">{n.source}</span>
              {/* RSS link 未经服务端校验,只放行 http(s),防 javascript: 注入 */}
              {/^https?:\/\//i.test(n.link) ? (
                <a href={n.link} target="_blank" rel="noreferrer">
                  {n.title}
                </a>
              ) : (
                <span>{n.title}</span>
              )}
            </div>
          ))}
          {data.news.length > NEWS_COLLAPSED && (
            <button type="button" className="rot-review-toggle" onClick={() => setNewsOpen(!newsOpen)}>
              {newsOpen ? rv.collapse : `${rv.more}(${data.news.length - NEWS_COLLAPSED})`}
              {newsOpen ? <CaretUp size={12} /> : <CaretDown size={12} />}
            </button>
          )}
          {data.dragonTiger.length > 0 && (
            <div className="rot-review-chips">
              {buys.length > 0 && <span className="rot-review-boards-label">{rv.dragonBuy}</span>}
              {buys.map((x) => (
                <span key={x.code} className="rot-review-chip">
                  {x.name} <b className="mono positive-text">{fmtNet(x.netAmt)}</b>
                </span>
              ))}
              {sells.length > 0 && <span className="rot-review-boards-label">{rv.dragonSell}</span>}
              {sells.map((x) => (
                <span key={x.code} className="rot-review-chip">
                  {x.name} <b className="mono negative-text">{fmtNet(x.netAmt)}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {data.calendar.length > 0 && (
        <div className="rot-review-sec">
          <div className="rot-review-sec-head">
            <span className="rot-drill-grouptag">{rv.secCalendar}</span>
            <span className="rot-review-badge" title={data.calendarSource !== 'jin10' ? rv.approxTip : undefined}>
              {calSrcLabel}
            </span>
          </div>
          {calRows.map((e, i) => (
            <div key={`${e.date}-${e.name}-${i}`} className="rot-review-cal-row">
              <span className="mono rot-review-cal-date">
                {e.approx && rv.approx}
                {e.date.slice(5)}
                {e.time ? ` ${e.time}` : ''}
              </span>
              <span className="rot-review-newstag">{e.country}</span>
              <span className="rot-review-cal-name">{e.name}</span>
              <span className="rot-review-cal-star">{'★'.repeat(Math.max(1, Math.min(3, e.star)))}</span>
              {(e.previous || e.consensus) && (
                <span className="mono rot-review-cal-vals">
                  {e.previous && `${rv.prev} ${e.previous}`}
                  {e.previous && e.consensus && ' · '}
                  {e.consensus && `${rv.cons} ${e.consensus}`}
                </span>
              )}
            </div>
          ))}
          {data.calendar.length > CAL_COLLAPSED && (
            <button type="button" className="rot-review-toggle" onClick={() => setCalOpen(!calOpen)}>
              {calOpen ? rv.collapse : `${rv.more}(${data.calendar.length - CAL_COLLAPSED})`}
              {calOpen ? <CaretUp size={12} /> : <CaretDown size={12} />}
            </button>
          )}
        </div>
      )}

      {(data.ashare || data.structure) && (
        <div className="rot-review-sec">
          <span className="rot-drill-grouptag">{rv.secMarket}</span>
          {data.ashare && (
            <div className="rot-review-chips">
              {data.ashare.indices.map((q) => (
                <QuoteChip key={q.code} q={q} />
              ))}
              {/* 0 = 上游不可用哨兵(ashare.ts),不渲染成「0.00万亿」 */}
              {data.ashare.totalTurnover > 0 && (
                <span className="rot-review-chip">
                  {rv.turnover} <b className="mono">{(data.ashare.totalTurnover / 1e12).toFixed(2)}万亿</b>
                </span>
              )}
              <span className="rot-review-chip">
                {st.limitUp} <b className="mono positive-text">{data.ashare.limitUp}</b> / {st.limitDown}{' '}
                <b className="mono negative-text">{data.ashare.limitDown}</b>
              </span>
              <span className="rot-review-chip">
                {st.advance} <b className="mono positive-text">{data.ashare.advance}</b> / {st.decline}{' '}
                <b className="mono negative-text">{data.ashare.decline}</b>
              </span>
            </div>
          )}
          {data.structure && data.structure.hsCount + data.structure.lsCount + data.structure.hwCount + data.structure.lwCount > 0 && (
            <>
              <div className="rot-review-chips">
                <span className="rot-pill rot-pill--hs">
                  {rq.hs.tag} {data.structure.hsCount}
                </span>
                <span className="rot-pill rot-pill--ls">
                  {rq.ls.tag} {data.structure.lsCount}
                </span>
                <span className="rot-pill rot-pill--hw">
                  {rq.hw.tag} {data.structure.hwCount}
                </span>
                <span className="rot-pill rot-pill--lw">
                  {rq.lw.tag} {data.structure.lwCount}
                </span>
                <span className="rot-review-chip">
                  {t.rotation.shortUpShare} <b className="mono">{data.structure.shortUpPct}%</b>
                </span>
              </div>
              <div className="rot-review-chips">
                <BoardChips label={st.topHs} boards={data.structure.topHs} />
                <BoardChips label={st.topLs} boards={data.structure.topLs} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
