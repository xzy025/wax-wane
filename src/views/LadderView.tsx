import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import Papa from 'papaparse'
import { ArrowClockwise, FileArrowUp, FlagBanner, X } from 'phosphor-react'
import {
  useLadderAnalysis,
  useLadderReason,
  type LadderImportPayload,
  type LadderImportStock,
  type LadderState,
  type LadderStockAnalysis,
} from '../hooks/useLadderAnalysis'
import { getLastTradingDay } from '../components/MarketDatePicker'
import type { Translation } from '../types'

interface LadderViewProps {
  t: Translation
  language: 'zh' | 'en'
}

type ViewMode = 'single' | 'list'
type BoardFilter = 'all' | 'main' | 'twenty'
type StateFilter = 'all' | LadderState

const STATE_ORDER: LadderState[] = ['candidate', 'waiting', 'observe', 'exclude']

function fmtTime(value: string): string {
  if (!value) return '--:--'
  const digits = value.padStart(6, '0')
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`
}

function fmtRatio(value: number | null, suffix = 'x'): string {
  return value == null ? '--' : `${value.toFixed(2)}${suffix}`
}

function fmtYi(value: number): string {
  return value > 0 ? `${(value / 1e8).toFixed(2)}亿` : '--'
}

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = row[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return undefined
}

function numberValue(value: unknown): number | undefined {
  const normalized = String(value ?? '')
    .replace(/[,%亿万]/g, '')
    .trim()
  if (!normalized) return undefined
  const number = Number(normalized)
  return Number.isFinite(number) ? number : undefined
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (['true', '1', 'yes', '是', '一字'].includes(normalized)) return true
  if (['false', '0', 'no', '否'].includes(normalized)) return false
  return undefined
}

function normalizeImportRow(row: Record<string, unknown>): LadderImportStock | null {
  const code = String(pick(row, ['code', '代码', '股票代码']) ?? '')
    .replace(/\D/g, '')
    .padStart(6, '0')
    .slice(-6)
  if (!/^\d{6}$/.test(code) || code === '000000') return null
  const themes = String(pick(row, ['themes', 'theme', '题材', '概念']) ?? '')
    .split(/[|、,，]/)
    .map((value) => value.trim())
    .filter(Boolean)
  return {
    code,
    name: String(pick(row, ['name', '名称', '股票名称']) ?? '').trim() || undefined,
    status: String(pick(row, ['status', '状态']) ?? '').trim() || undefined,
    consecutiveDays: numberValue(pick(row, ['consecutiveDays', 'boards', '连板数', '板数'])),
    nDayBoards: String(pick(row, ['nDayBoards', '几天几板', '涨停统计']) ?? '').trim() || undefined,
    themes,
    subtheme: String(pick(row, ['subtheme', '细分题材', '细分']) ?? '').trim() || undefined,
    role: String(pick(row, ['role', '角色', '定位']) ?? '').trim() || undefined,
    reason: String(pick(row, ['reason', '涨停原因', '原因']) ?? '').trim() || undefined,
    firstTime: String(pick(row, ['firstTime', '首次封板', '首封时间']) ?? '').trim() || undefined,
    lastTime: String(pick(row, ['lastTime', '最后封板', '末封时间']) ?? '').trim() || undefined,
    openCount: numberValue(pick(row, ['openCount', '炸板次数', '开板次数'])),
    turnoverRate: numberValue(pick(row, ['turnoverRate', '换手率'])),
    amount: numberValue(pick(row, ['amount', '成交额'])),
    sealAmount: numberValue(pick(row, ['sealAmount', '封单额'])),
    onePrice: booleanValue(pick(row, ['onePrice', '一字板'])),
  }
}

async function parseImportFile(file: File, asof: string): Promise<LadderImportPayload> {
  const text = await file.text()
  if (file.name.toLowerCase().endsWith('.json')) {
    const parsed = JSON.parse(text) as
      | { asof?: string; stocks?: Record<string, unknown>[] }
      | Record<string, unknown>[]
    const rows = Array.isArray(parsed) ? parsed : (parsed.stocks ?? [])
    const stocks = rows.map(normalizeImportRow).filter((row): row is LadderImportStock => !!row)
    return { asof: Array.isArray(parsed) ? asof : (parsed.asof ?? asof), stocks }
  }
  const parsed = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: true })
  if (parsed.errors.length && parsed.data.length === 0) throw new Error(parsed.errors[0].message)
  return {
    asof,
    stocks: parsed.data.map(normalizeImportRow).filter((row): row is LadderImportStock => !!row),
  }
}

function StateBadge({ state, t }: { state: LadderState; t: Translation['ladder'] }) {
  return <span className={`ladder-state ladder-state--${state}`}>{t.states[state]}</span>
}

function StockCard({
  stock,
  t,
  onSelect,
}: {
  stock: LadderStockAnalysis
  t: Translation['ladder']
  onSelect: (stock: LadderStockAnalysis) => void
}) {
  const isChiNext = /^(300|301)/.test(stock.code)
  return (
    <button
      type="button"
      className={`ladder-stock ladder-stock--${stock.state}`}
      onClick={() => onSelect(stock)}
      title={`${stock.name} · ${stock.nDayBoards} · ${t.states[stock.state]} · ${stock.score}`}
    >
      <div className="ladder-stock-meta">
        <span className="ladder-stock-flags">
          {stock.isMarginEligible && (
            <span className="ladder-flag ladder-flag--margin">{t.badges.margin}</span>
          )}
          {isChiNext && (
            <span className="ladder-flag ladder-flag--chinext">{t.badges.chiNext}</span>
          )}
          {stock.onePrice && (
            <span className="ladder-flag ladder-flag--one">{t.badges.onePrice}</span>
          )}
          {stock.tBoard && <span className="ladder-flag ladder-flag--t">{t.badges.tBoard}</span>}
        </span>
        <span className="ladder-first-time mono">
          {t.firstSealShort}
          {fmtTime(stock.firstTime)}
        </span>
      </div>
      <strong>{stock.name}</strong>
      <span className="ladder-stock-code mono">{stock.code}</span>
      <span className="ladder-stock-themes">
        {stock.themes.slice(0, 2).map((theme, index) => (
          <span
            className={`ladder-theme ${index === 0 ? `ladder-theme--${stock.themeGrade}` : ''}`}
            key={theme}
          >
            {theme}
          </span>
        ))}
      </span>
    </button>
  )
}

function EvidenceDrawer({
  stock,
  date,
  t,
  onClose,
}: {
  stock: LadderStockAnalysis
  date: string
  t: Translation['ladder']
  onClose: () => void
}) {
  const { detail, loading: reasonLoading, error: reasonError } = useLadderReason(stock.code, date)
  const reason = detail?.reason || stock.reason
  const extraExplanation =
    detail?.explanation && !reason.includes(detail.explanation) ? detail.explanation : ''
  const reasonParagraphs = reason
    .split(/\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const dimensions = [
    ['market', t.detail.market],
    ['theme', t.detail.theme],
    ['ladder', t.detail.ladder],
    ['technical', t.detail.technical],
    ['seal', t.detail.seal],
  ] as const
  return (
    <div
      className="ladder-drawer-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="ladder-drawer" aria-label={t.detail.title}>
        <header className="ladder-drawer-header">
          <div>
            <div className="ladder-drawer-titleline">
              <h2>{stock.name}</h2>
              <StateBadge state={stock.state} t={t} />
            </div>
            <span className="mono">
              {stock.code} · {stock.consecutiveDays}
              {t.boards} · {t.roles[stock.role]}
            </span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title={t.detail.close}>
            <X size={18} />
          </button>
        </header>

        <div className="ladder-drawer-score">
          <span>{t.detail.score}</span>
          <strong>{stock.score}</strong>
        </div>

        <section className="ladder-evidence">
          <h3>{t.detail.evidence}</h3>
          {dimensions.map(([key, label]) => {
            const evidence = stock.dimensions[key]
            return (
              <div className="ladder-evidence-row" key={key}>
                <span>{label}</span>
                <div className="ladder-evidence-track">
                  <span style={{ width: `${evidence.score}%` }} />
                </div>
                <strong className="mono">{Math.round(evidence.score)}</strong>
                <small>{evidence.note}</small>
              </div>
            )
          })}
        </section>

        <section className="ladder-detail-metrics">
          <div>
            <span>{t.detail.amountRatio}</span>
            <strong>{fmtRatio(stock.technical.amountRatio20)}</strong>
          </div>
          <div>
            <span>{t.detail.range20}</span>
            <strong>{fmtRatio(stock.technical.pre20RangePct, '%')}</strong>
          </div>
          <div>
            <span>{t.detail.position120}</span>
            <strong>{fmtRatio(stock.technical.prePosition120Pct, '%')}</strong>
          </div>
          <div>
            <span>{t.detail.episodeReturn}</span>
            <strong>{fmtRatio(stock.technical.episodeReturnPct, '%')}</strong>
          </div>
          <div>
            <span>{t.detail.onset}</span>
            <strong className="mono">{stock.technical.episodeOnsetDate ?? '--'}</strong>
          </div>
          <div>
            <span>{t.table.shape}</span>
            <strong>{t.shapes[stock.technical.shape]}</strong>
          </div>
        </section>

        <section className="ladder-action-band ladder-action-band--trigger">
          <span>{t.detail.trigger}</span>
          <p>{stock.trigger}</p>
        </section>
        <section className="ladder-action-band ladder-action-band--risk">
          <span>{t.detail.invalidation}</span>
          <p>{stock.invalidation}</p>
        </section>

        {(stock.penalties.length > 0 || stock.warnings.length > 0) && (
          <section className="ladder-drawer-notes">
            {stock.penalties.length > 0 && (
              <div>
                <strong>{t.detail.penalty}</strong>
                <p>{stock.penalties.join(' · ')}</p>
              </div>
            )}
            {stock.warnings.length > 0 && (
              <div>
                <strong>{t.detail.warnings}</strong>
                <p>{stock.warnings.join(' · ')}</p>
              </div>
            )}
          </section>
        )}

        <section className="ladder-reason-detail">
          <header>
            <h3>{t.detail.limitReason}</h3>
            {(detail || stock.reasonSource !== 'none') && <span>{t.detail.kaipanlaSource}</span>}
          </header>
          <div className="ladder-reason-themes">
            {stock.themes.slice(0, 6).map((theme) => (
              <span key={theme}>{theme}</span>
            ))}
          </div>
          {reasonLoading && <div className="ladder-reason-loading">{t.detail.reasonLoading}</div>}
          {reasonParagraphs.length > 0 ? (
            <div className="ladder-reason-copy">
              {reasonParagraphs.map((paragraph, index) => (
                <p key={`${index}-${paragraph}`}>{paragraph}</p>
              ))}
              {extraExplanation && <p>{extraExplanation}</p>}
            </div>
          ) : !reasonLoading ? (
            <p className="ladder-reason-empty">{reasonError || t.detail.reasonUnavailable}</p>
          ) : null}
          {(detail?.marketRole || detail?.hotReason) && (
            <dl className="ladder-reason-signals">
              {detail.marketRole && (
                <div>
                  <dt>{t.detail.marketRole}</dt>
                  <dd>{detail.marketRole}</dd>
                </div>
              )}
              {detail.hotReason && (
                <div>
                  <dt>{t.detail.hotReason}</dt>
                  <dd>{detail.hotReason}</dd>
                </div>
              )}
            </dl>
          )}
        </section>
      </aside>
    </div>
  )
}

export default function LadderView({ t, language }: LadderViewProps) {
  const copy = t.ladder
  const [date, setDate] = useState(getLastTradingDay())
  const [mode, setMode] = useState<ViewMode>('single')
  const [selectedThemes, setSelectedThemes] = useState<Set<string>>(new Set())
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [boardFilter, setBoardFilter] = useState<BoardFilter>('all')
  const [heightFilter, setHeightFilter] = useState('all')
  const [selectedStock, setSelectedStock] = useState<LadderStockAnalysis | null>(null)
  const [importMessage, setImportMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const { data, loading, error, refresh, importData } = useLadderAnalysis(date)

  const filteredStocks = useMemo(() => {
    if (!data) return []
    return data.stocks.filter((stock) => {
      if (selectedThemes.size && !stock.themes.some((theme) => selectedThemes.has(theme)))
        return false
      if (stateFilter !== 'all' && stock.state !== stateFilter) return false
      if (boardFilter === 'main' && stock.boardType !== 'main') return false
      if (boardFilter === 'twenty' && stock.boardType !== 'twenty') return false
      if (heightFilter !== 'all' && stock.consecutiveDays !== Number(heightFilter)) return false
      return true
    })
  }, [boardFilter, data, heightFilter, selectedThemes, stateFilter])

  const ladderLevels = useMemo(() => {
    const levels = new Map<number, LadderStockAnalysis[]>()
    for (const stock of filteredStocks.filter((item) => item.consecutiveDays >= 2)) {
      levels.set(stock.consecutiveDays, [...(levels.get(stock.consecutiveDays) ?? []), stock])
    }
    return Array.from(levels.entries()).sort(([a], [b]) => b - a)
  }, [filteredStocks])
  const firstBoards = filteredStocks.filter((stock) => stock.consecutiveDays === 1)

  const toggleTheme = (name: string) => {
    setSelectedThemes((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const payload = await parseImportFile(file, date)
      if (!payload.stocks.length) throw new Error(copy.empty)
      const ok = await importData(payload)
      setImportMessage(ok ? copy.importOk : copy.importFail)
    } catch (err) {
      setImportMessage(`${copy.importFail}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="ladder-page" lang={language === 'zh' ? 'zh-CN' : 'en'}>
      <section className="ladder-toolbar">
        <div className="ladder-mode" role="tablist">
          {(['single', 'list'] as ViewMode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={mode === value ? 'active' : ''}
              onClick={() => setMode(value)}
              role="tab"
              aria-selected={mode === value}
            >
              {copy[value]}
            </button>
          ))}
        </div>
        <div className="ladder-market-strip">
          {data && (
            <>
              <span className={`ladder-phase ladder-phase--${data.market.cycle.phase}`}>
                {copy.phases[data.market.cycle.phase]}
              </span>
              <span>
                {copy.limitUp} <b>{data.market.limitUp}</b>
              </span>
              <span>
                {copy.limitDown} <b>{data.market.limitDown}</b>
              </span>
              <span>
                {copy.breakRate} <b>{data.market.breakRate.toFixed(1)}%</b>
              </span>
              <span>
                {copy.promotionRate} <b>{data.market.promotionRate.toFixed(1)}%</b>
              </span>
              <span>
                {copy.maxBoards}{' '}
                <b>
                  {data.market.maxBoards}
                  {copy.boards}
                </b>
              </span>
            </>
          )}
        </div>
        <div className="ladder-toolbar-actions">
          <label className="ladder-date">
            <span>{copy.date}</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept=".csv,.json"
            onChange={handleImport}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => fileRef.current?.click()}
            title={copy.import}
          >
            <FileArrowUp size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void refresh()}
            title={copy.refresh}
            disabled={loading}
          >
            <ArrowClockwise size={18} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </section>

      {importMessage && <div className="ladder-notice">{importMessage}</div>}
      {data?.warnings.length ? (
        <div className="ladder-quality-warning">{data.warnings.join(' · ')}</div>
      ) : null}

      {data && (
        <section className="ladder-theme-strip" aria-label={copy.allThemes}>
          <button
            type="button"
            className={selectedThemes.size === 0 ? 'active' : ''}
            onClick={() => setSelectedThemes(new Set())}
          >
            {copy.allThemes} {data.stocks.length}
          </button>
          {data.themes.map((theme) => (
            <button
              type="button"
              key={theme.name}
              className={`${selectedThemes.has(theme.name) ? 'active ' : ''}grade-${theme.grade}`}
              onClick={() => toggleTheme(theme.name)}
            >
              {theme.name} {theme.count}
            </button>
          ))}
        </section>
      )}

      {loading && !data && <div className="ladder-loading">{copy.loading}</div>}
      {error && !data && (
        <div className="ladder-error">
          <strong>{copy.loadFail}</strong>
          <span>{error}</span>
        </div>
      )}

      {data && mode === 'single' && (
        <section className="ladder-board">
          {ladderLevels.map(([boards, stocks]) => (
            <div className="ladder-level" key={boards}>
              <div className="ladder-level-rail">
                <span>{boards}</span>
              </div>
              <div className="ladder-level-track">
                {stocks.map((stock) => (
                  <StockCard key={stock.code} stock={stock} t={copy} onSelect={setSelectedStock} />
                ))}
              </div>
            </div>
          ))}
          <div className="ladder-first-title">
            <FlagBanner size={16} />
            <strong>
              {copy.firstBoard} ({firstBoards.length})
            </strong>
          </div>
          <div className="ladder-first-grid">
            {firstBoards.map((stock) => (
              <StockCard key={stock.code} stock={stock} t={copy} onSelect={setSelectedStock} />
            ))}
          </div>
          {!filteredStocks.length && <div className="ladder-empty">{copy.empty}</div>}
        </section>
      )}

      {data && mode === 'list' && (
        <section className="ladder-list">
          <div className="ladder-list-filters">
            <label>
              {copy.filters.state}
              <select
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value as StateFilter)}
              >
                <option value="all">{copy.filters.all}</option>
                {STATE_ORDER.map((state) => (
                  <option key={state} value={state}>
                    {copy.states[state]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {copy.filters.board}
              <select
                value={boardFilter}
                onChange={(event) => setBoardFilter(event.target.value as BoardFilter)}
              >
                <option value="all">{copy.filters.all}</option>
                <option value="main">{copy.filters.main}</option>
                <option value="twenty">{copy.filters.twenty}</option>
              </select>
            </label>
            <label>
              {copy.filters.height}
              <select
                value={heightFilter}
                onChange={(event) => setHeightFilter(event.target.value)}
              >
                <option value="all">{copy.filters.all}</option>
                {Array.from(new Set(data.stocks.map((stock) => stock.consecutiveDays)))
                  .sort((a, b) => b - a)
                  .map((height) => (
                    <option key={height} value={height}>
                      {height}
                      {copy.boards}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="ladder-table-wrap">
            <table className="ladder-table">
              <thead>
                <tr>
                  <th>{copy.table.rank}</th>
                  <th>{copy.table.state}</th>
                  <th>{copy.table.stock}</th>
                  <th>{copy.filters.height}</th>
                  <th>{copy.table.role}</th>
                  <th>{copy.table.theme}</th>
                  <th>{copy.table.shape}</th>
                  <th>{copy.table.volume}</th>
                  <th>{copy.table.position}</th>
                  <th>{copy.table.firstSeal}</th>
                  <th>{copy.table.opens}</th>
                  <th>{copy.table.trigger}</th>
                  <th>{copy.table.risk}</th>
                </tr>
              </thead>
              <tbody>
                {filteredStocks.map((stock) => (
                  <tr key={stock.code} onClick={() => setSelectedStock(stock)}>
                    <td className="mono">{stock.rank}</td>
                    <td>
                      <StateBadge state={stock.state} t={copy} />
                    </td>
                    <td>
                      <strong>{stock.name}</strong>
                      <span className="mono">{stock.code}</span>
                    </td>
                    <td>
                      {stock.consecutiveDays}
                      {copy.boards}
                    </td>
                    <td>{copy.roles[stock.role]}</td>
                    <td>
                      <span className={`ladder-theme ladder-theme--${stock.themeGrade}`}>
                        {stock.primaryTheme}
                      </span>
                    </td>
                    <td>{copy.shapes[stock.technical.shape]}</td>
                    <td className="mono">{fmtRatio(stock.technical.amountRatio20)}</td>
                    <td className="mono">{fmtRatio(stock.technical.prePosition120Pct, '%')}</td>
                    <td className="mono">{fmtTime(stock.firstTime)}</td>
                    <td className="mono">{stock.openCount}</td>
                    <td>{stock.trigger}</td>
                    <td>{stock.mainRisk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {data && (
        <footer className="ladder-footer">
          <span>
            {copy.source}: {data.quality.source}
          </span>
          <span>
            {copy.quality}: {data.quality.klineComplete}/{data.quality.klineTotal}
          </span>
          {data.quality.degraded && <span>{copy.degraded}</span>}
          {data.archived && <span>{copy.archived}</span>}
          <span className="mono">{data.ruleVersion}</span>
          <span>{fmtYi(data.stocks.reduce((sum, stock) => sum + stock.amount, 0))}</span>
        </footer>
      )}

      {selectedStock && (
        <EvidenceDrawer
          stock={selectedStock}
          date={date}
          t={copy}
          onClose={() => setSelectedStock(null)}
        />
      )}
    </div>
  )
}
