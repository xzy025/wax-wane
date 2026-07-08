import { useState } from 'react'
import { ArrowClockwise, Lightning } from 'phosphor-react'
import { useNewsFlash, type NewsFlashItem } from '../hooks/useNewsFlash'
import type { Translation } from '../types'

const SUMMARY_COLLAPSED = 92 // 摘要折叠长度(字),点击展开全文

/** 来源短标(专名,不进 i18n;逐行 tag 与失联徽标共用)。 */
const SOURCE_LABEL: Record<NewsFlashItem['source'], string> = { eastmoney: '东财', sina: '新浪' }

function FlashRow({ it, t }: { it: NewsFlashItem; t: Translation }) {
  const [open, setOpen] = useState(false)
  const long = it.summary.length > SUMMARY_COLLAPSED
  const summary = open || !long ? it.summary : `${it.summary.slice(0, SUMMARY_COLLAPSED)}…`
  return (
    <div className="intel-flash-row">
      <div className="rot-review-news">
        <span className="mono intel-flash-time">{it.time.slice(11, 16)}</span>
        <span className="rot-review-newstag">{SOURCE_LABEL[it.source]}</span>
        {it.important && <span className="sc-chip hot">{t.intel.flash.important}</span>}
        {/* url 未经服务端校验,只放行 http(s),防 javascript: 注入(同 DailyReviewCard) */}
        {it.url && /^https?:\/\//i.test(it.url) ? (
          <a href={it.url} target="_blank" rel="noreferrer" className={it.important ? 'positive-text' : ''}>
            {it.title}
          </a>
        ) : (
          <span className={it.important ? 'positive-text' : ''}>{it.title}</span>
        )}
      </div>
      {it.summary && (
        <div
          className="intel-flash-summary"
          onClick={() => long && setOpen(!open)}
          title={long && !open ? t.intel.research.expand : undefined}
        >
          {summary}
        </div>
      )}
      {it.stocks.length > 0 && (
        <div className="rot-review-chips">
          {it.stocks.map((s) => (
            <span key={s.code} className="rot-review-chip">
              {s.name ?? ''} <b className="mono">{s.code}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** 7x24 快讯面板:东财+新浪双源时间线,挂载期间 30s 静默轮询。 */
export default function NewsFlashPanel({ t }: { t: Translation }) {
  const fl = t.intel.flash
  const { data, loading, error, lastUpdated, refresh } = useNewsFlash()

  return (
    <>
      <div className="panel-title themes-toolbar">
        <h2>
          <Lightning size={18} weight="bold" style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {t.intel.tabFlash}
        </h2>
        <span className="themes-updated">
          {lastUpdated && `${fl.lastUpdated} ${lastUpdated.toLocaleTimeString()} · `}
          {fl.autoNote}
          {data && !data.sources.eastmoney && <span className="sc-save-fail-badge">⚠ {SOURCE_LABEL.eastmoney}{fl.sourceDown}</span>}
          {data && !data.sources.sina && <span className="sc-save-fail-badge">⚠ {SOURCE_LABEL.sina}{fl.sourceDown}</span>}
        </span>
        <button className="sc-scan-btn" onClick={refresh} disabled={loading}>
          <ArrowClockwise size={15} className={loading ? 'spin' : ''} />
          {fl.refresh}
        </button>
      </div>
      <p className="themes-desc">{fl.desc}</p>

      {/* 有旧数据时错误也要露出(同 ScreenerView 约定) */}
      {error && <div className="alert-item danger">{fl.loadFail}</div>}
      {!data && loading && <div className="themes-desc">{fl.refresh}…</div>}

      {data &&
        (data.items.length === 0 ? (
          <div className="themes-desc">{fl.empty}</div>
        ) : (
          <div className="rot-review intel-flash-list">
            {data.items.map((it) => (
              <FlashRow key={it.id} it={it} t={t} />
            ))}
          </div>
        ))}
    </>
  )
}
