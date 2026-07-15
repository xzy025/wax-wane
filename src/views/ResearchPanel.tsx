import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowClockwise, CaretDown, CaretUp, FileText } from 'phosphor-react'
import { useResearch, useResearchDates, type FeishuSyncStatus, type ResearchReportEntry } from '../hooks/useResearch'
import type { Translation } from '../types'

/** 飞书同步状态小字:出错 > 同步中 > 最近成功时间;未配置/从未同步不渲染。
 *  相对时间以 asOfMs(数据拉取时刻)为基准,渲染保持纯函数。 */
function FeishuBadge({
  feishu,
  asOfMs,
  rs,
}: {
  feishu?: FeishuSyncStatus
  asOfMs?: number
  rs: Translation['intel']['research']
}) {
  if (!feishu?.configured) return null
  if (feishu.lastError) {
    return (
      <span className="sc-cache-badge" title={feishu.lastError}>
        {rs.feishuError}
      </span>
    )
  }
  if (feishu.syncing) return <span className="sc-cache-badge">{rs.feishuSyncing}</span>
  if (!feishu.lastSyncAt || asOfMs === undefined) return null
  const mins = Math.max(0, Math.round((asOfMs - new Date(feishu.lastSyncAt).getTime()) / 60_000))
  return (
    <span>
      {rs.feishuSynced} · {mins < 1 ? rs.feishuJustNow : `${mins}${rs.feishuMinAgo}`}
    </span>
  )
}

function ReportCard({ entry, t }: { entry: ResearchReportEntry; t: Translation }) {
  const rs = t.intel.research
  const [open, setOpen] = useState(false)
  const a = entry.analysis

  if (entry.status !== 'analyzed' || !a) {
    // 待分析 / 解析失败:文件名 + 状态,不装有内容
    return (
      <div className={`sc-card${entry.status === 'extract_failed' ? '' : ' sc-card--watch'}`}>
        <div className="sc-card-top">
          <div className="sc-card-id">
            <span className="sc-card-name">{entry.file.name}</span>
          </div>
          <span className={`sc-chip${entry.status === 'pending' ? ' hot' : ''}`}>
            {entry.status === 'pending' ? rs.pending : rs.extractFailed}
          </span>
        </div>
        {entry.error && <span className="sc-watch-note">{entry.error}</span>}
        <span className="sc-meta">
          {entry.file.kind.toUpperCase()} · {(entry.file.sizeBytes / 1024).toFixed(0)}KB
        </span>
      </div>
    )
  }

  const chips: { label: string; value: string }[] = []
  if (a.rating) chips.push({ label: rs.rating, value: a.rating })
  if (a.targetPrice) chips.push({ label: rs.targetPrice, value: a.targetPrice })
  if (a.industry) chips.push({ label: rs.industry, value: a.industry })
  if (a.brokerage) chips.push({ label: rs.brokerage, value: a.brokerage })
  const secs: { label: string; items: string[] }[] = [
    { label: rs.thesis, items: a.thesis },
    { label: rs.catalysts, items: a.catalysts },
    { label: rs.risks, items: a.risks },
  ].filter((s) => s.items.length > 0)

  return (
    <div className="sc-card">
      <div className="sc-card-top">
        <div className="sc-card-id">
          <span className="sc-card-name">{a.stockName ?? a.fileName}</span>
          {a.stockCode && <span className="sc-card-code mono">{a.stockCode}</span>}
        </div>
        {secs.length > 0 && (
          <button type="button" className="rot-review-toggle" onClick={() => setOpen(!open)}>
            {open ? rs.collapse : rs.expand}
            {open ? <CaretUp size={12} /> : <CaretDown size={12} />}
          </button>
        )}
      </div>
      {chips.length > 0 && (
        <div className="rot-review-chips">
          {chips.map((c) => (
            <span key={c.label} className="rot-review-chip">
              {c.label} <b>{c.value}</b>
            </span>
          ))}
        </div>
      )}
      <div className="intel-report-oneliner">{a.oneLiner}</div>
      {open &&
        secs.map((s) => (
          <div key={s.label}>
            <span className="rot-drill-grouptag">{s.label}</span>
            <ul className="intel-report-list">
              {s.items.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        ))}
      <span className="sc-meta">
        {a.fileName} · {rs.analyzedAt} {new Date(a.analyzedAt).toLocaleString()}
        {a.truncated && ` · ${rs.truncatedNote}`}
      </span>
    </div>
  )
}

/** 每日研报面板:目录扫描 + LLM 结构化卡片 + 当日汇总,pending 时 20s 收敛轮询。 */
export default function ResearchPanel({ t }: { t: Translation }) {
  const rs = t.intel.research
  const { dates, reload } = useResearchDates()
  const [date, setDate] = useState<string | undefined>(undefined)
  const { data, loading, error, lastUpdated, refresh } = useResearch(date)

  const digest = data?.digest ?? null
  const analyzedCount = data?.reports.filter((r) => r.status === 'analyzed').length ?? 0

  return (
    <>
      <div className="panel-title themes-toolbar">
        <h2>
          <FileText size={18} weight="bold" style={{ verticalAlign: '-3px', marginRight: 6 }} />
          {t.intel.tabResearch}
          {data && ` · ${data.date}`}
        </h2>
        <span className="themes-updated">
          {data?.analyzing && <span className="sc-cache-badge">{rs.analyzing}</span>}
          <FeishuBadge feishu={data?.feishu} asOfMs={lastUpdated?.getTime()} rs={rs} />
          {lastUpdated && lastUpdated.toLocaleTimeString()}
        </span>
        <button
          className="sc-scan-btn"
          onClick={() => {
            reload()
            void refresh()
          }}
          disabled={loading}
        >
          <ArrowClockwise size={15} className={loading ? 'spin' : ''} />
          {rs.refresh}
        </button>
      </div>
      <p className="themes-desc">{rs.desc}</p>

      {dates.length > 1 && (
        <div className="seg-group">
          {dates.map((d) => (
            <button
              key={d}
              className={`seg-btn${(date ?? data?.date) === d ? ' active' : ''}`}
              onClick={() => setDate(d)}
            >
              {d.slice(5)}
            </button>
          ))}
        </div>
      )}

      {error && <div className="alert-item danger">{rs.loadFail}</div>}
      {!data && loading && <div className="themes-desc">{rs.refresh}…</div>}
      {data && !data.llmConfigured && <div className="alert-item danger">{rs.llmDown}</div>}

      {digest && (
        <div className="rot-review">
          <div className="rot-structure-head">
            <span className="rot-structure-title">
              {rs.digestTitle} · {digest.reportCount}
              {rs.reportCount}
            </span>
            <span className="themes-updated">{new Date(digest.generatedAt).toLocaleString()}</span>
          </div>
          <div className="ai-markdown rot-review-md">
            {/* digest 由不可信的研报正文经 LLM 生成(PDF 里可埋 prompt 注入):
                图片渲染即向外带请求、链接是钓鱼入口,一律降级为纯文本。 */}
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}
            >
              {digest.overview}
            </ReactMarkdown>
          </div>
          {(digest.hotIndustries.length > 0 || digest.keyStocks.length > 0) && (
            <div className="rot-review-chips">
              {digest.hotIndustries.length > 0 && <span className="rot-review-boards-label">{rs.hotIndustries}</span>}
              {digest.hotIndustries.map((ind) => (
                <span key={ind} className="rot-review-chip">
                  {ind}
                </span>
              ))}
              {digest.keyStocks.length > 0 && <span className="rot-review-boards-label">{rs.keyStocks}</span>}
              {digest.keyStocks.map((s) => (
                <span key={`${s.name}-${s.code}`} className="rot-review-chip" title={s.reason}>
                  {s.name} {s.code && <b className="mono">{s.code}</b>}
                </span>
              ))}
            </div>
          )}
          {digest.consensus && (
            <div className="rot-review-nonarrative" style={{ marginTop: 8, marginBottom: 0 }}>
              {rs.consensus}:{digest.consensus}
            </div>
          )}
        </div>
      )}
      {data && !digest && analyzedCount > 0 && <div className="rot-review-nonarrative">{rs.digestPending}</div>}

      {data &&
        (data.reports.length === 0 ? (
          <div className="themes-desc">
            {rs.empty} — {rs.dirHint}
          </div>
        ) : (
          <div className="sc-grid">
            {data.reports.map((entry) => (
              <ReportCard key={entry.file.fingerprint} entry={entry} t={t} />
            ))}
          </div>
        ))}
    </>
  )
}
