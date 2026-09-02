import {
  usePremarketWorkbench,
  type WorkbenchBehavior,
  type WorkbenchCheckpointSpec,
  type WorkbenchStatusEntry,
} from '../hooks/usePremarketWorkbench'
import type { CrossMarketSnapshot } from '../hooks/useLadderAnalysis'

const CHECKPOINT_LABEL: Record<string, string> = {
  'overnight-context': '07:50 隔夜',
  'asia-open': '08:00 日韩开',
  'asia-0830': '08:30 日韩30m',
  'asia-0900': '09:00 日韩60m',
  'pre-auction': '09:14 竞价前',
  'auction-initial': '09:15 申报',
  'auction-probe': '09:17 试盘',
  'auction-prelock': '09:19 锁价前',
  'auction-lock': '09:20 锁定',
  'auction-locked-mid': '09:22 锁定中',
  'auction-prefinal': '09:24 终盘前',
  'auction-final': '09:25 定盘',
  'open-initial': '09:30 首笔',
  'open-confirm': '09:35 承接',
  settled: '15:10 结算',
}

function statusDot(status: WorkbenchStatusEntry | undefined): { cls: string; text: string } {
  if (!status) return { cls: 'wb-none', text: '—' }
  if (status.status === 'success') return { cls: 'wb-ok', text: '✓' }
  if (status.status === 'degraded') return { cls: 'wb-warn', text: '△' }
  if (status.captureStatus === 'on-time' && status.sourceStatus === 'full') return { cls: 'wb-ok', text: '✓' }
  return { cls: 'wb-none', text: '✕' }
}

function fmtPct(value: number | null, digits = 2): string {
  if (value == null) return '—'
  return value.toFixed(digits)
}

function behaviorClass(behavior: WorkbenchBehavior): string {
  const label = behavior.labels[0]?.label
  if (label === 'locked-confirmed') return 'wb-behavior-ok'
  if (label === 'probe-only' || label === 'absorbed-not-withdrawn') return 'wb-behavior-warn'
  if (label === 'late-reinforcement') return 'wb-behavior-ok'
  return 'wb-behavior-none'
}

function behaviorLabelText(behavior: WorkbenchBehavior): string {
  return behavior.labels[0]?.label ?? 'insufficient-data'
}

function Timeline({ specs, lastRuns }: { specs: WorkbenchCheckpointSpec[]; lastRuns: Record<string, WorkbenchStatusEntry> }) {
  const partitions: Array<{ title: string; checkpoints: WorkbenchCheckpointSpec[] }> = [
    { title: '盘前', checkpoints: specs.filter((row) => row.phase === 'premarket') },
    { title: '竞价', checkpoints: specs.filter((row) => row.phase === 'auction') },
    { title: '开盘', checkpoints: specs.filter((row) => row.phase === 'open') },
    { title: '结算', checkpoints: specs.filter((row) => row.phase === 'settled') },
  ]
  return (
    <div className="wb-timeline">
      {partitions.map((part) => (
        <div className="wb-timeline-part" key={part.title}>
          <div className="wb-timeline-title">{part.title}</div>
          <div className="wb-timeline-dots">
            {part.checkpoints.map((spec) => {
              const status = lastRuns[spec.checkpoint]
              const dot = statusDot(status)
              return (
                <div className="wb-timeline-item" key={spec.checkpoint} title={status?.warnings?.join('；') ?? ''}>
                  <span className={`wb-dot ${dot.cls}`}>{dot.text}</span>
                  <span className="wb-checkpoint-label">
                    {CHECKPOINT_LABEL[spec.checkpoint] ?? spec.checkpoint}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function UsMappingPanel({ snapshot }: { snapshot: CrossMarketSnapshot | null | undefined }) {
  const lanes = (snapshot?.capitalSeesaw?.lanes ?? []).filter((lane) =>
    lane.id === 'hard-tech' || lane.id === 'innovative-drug',
  )
  return (
    <div className="wb-us-mapping-section">
      <div className="wb-context-heading">
        <strong>美股映射</strong>
        <span>题材方向研究 · 不进入连板分数/确认</span>
      </div>
      {lanes.length === 0 ? (
        <span className="wb-muted">美股题材映射尚不可用</span>
      ) : (
        lanes.map((lane) => (
          <div key={lane.id} className="wb-mapping-row">
            <div>
              <strong>{lane.label}</strong>
              <span className="wb-muted">{lane.state} · research-score</span>
            </div>
            <b className={lane.externalShock < 0 ? 'wb-down' : lane.externalShock > 0 ? 'wb-up' : 'wb-neutral'}>
              {lane.externalShock >= 0 ? '+' : ''}{lane.externalShock.toFixed(2)}
            </b>
            <small>{lane.reasons.slice(0, 2).join(' · ') || '无映射证据'}</small>
          </div>
        ))
      )}
      {(snapshot?.warnings ?? []).slice(0, 2).map((warning, index) => (
        <div key={index} className="wb-warning">⚠ {warning}</div>
      ))}
    </div>
  )
}

function AsiaPanel({ asia }: { asia: Record<string, { instruments: Array<{ symbol: string; market: string; price: number | null; returnFromClose: number | null; sessionStatus: string }>; quality: string; warnings: string[] } | null | undefined> }) {
  const rows = Object.entries(asia ?? {})
  return (
    <div className="wb-asia-section">
      <div className="wb-context-heading">
        <strong>日韩指数/科技大票背景</strong>
        <span>白天竞价情绪参考 · 非科技连板不直接套用</span>
      </div>
      {rows.length === 0 ? (
        <span className="wb-muted">日韩状态尚未采集</span>
      ) : (
        rows.map(([checkpoint, state]) => (
          <div key={checkpoint} className="wb-asia-checkpoint">
            <span className="wb-muted">{checkpoint}</span>
            {!state ? (
              <span className="wb-dot wb-none">✕</span>
            ) : (
              <span className={`wb-asia-state wb-state-${state.quality}`}>{state.quality}</span>
            )}
            <span className="wb-asia-instruments">
              {(state?.instruments ?? []).map((inst) => (
                <span key={inst.symbol} className="wb-asia-instrument" title={`${inst.sessionStatus}`}>
                  {inst.symbol}
                  <b>{inst.price == null ? '—' : inst.price.toFixed(2)}</b>
                  <i className={inst.returnFromClose == null ? 'wb-neutral' : inst.returnFromClose >= 0 ? 'wb-up' : 'wb-down'}>
                    {inst.returnFromClose == null ? '—' : `${inst.returnFromClose >= 0 ? '+' : ''}${inst.returnFromClose.toFixed(2)}%`}
                  </i>
                </span>
              ))}
            </span>
          </div>
        ))
      )}
      {Object.values(asia ?? {})
        .filter((state): state is NonNullable<typeof state> => !!state)
        .flatMap((state) => state.warnings)
        .map((warning, index) => (
          <div key={index} className="wb-warning">⚠ {warning}</div>
        ))}
    </div>
  )
}

function AuctionBehaviors({ auction }: { auction: { behaviors: WorkbenchBehavior[]; labels: Record<string, number>; warnings: string[] } | null }) {
  const behaviors = auction?.behaviors ?? []
  const labels = auction?.labels ?? {}
  return (
    <div className="wb-auction-section">
      <div className="wb-auction-counts">
        {Object.entries(labels).map(([label, count]) => (
          <span key={label} className={`wb-label-count wb-${behaviorLabelClass(label)}`}>
            {label} {count}
          </span>
        ))}
        {!behaviors.length && <span className="wb-muted">竞价行为数据不足</span>}
      </div>
      <div className="wb-behavior-list">
        {behaviors.slice(0, 40).map((behavior) => (
          <div key={behavior.symbol} className={`wb-behavior-row ${behaviorClass(behavior)}`}>
            <span className="wb-symbol">{behavior.symbol}</span>
            <span className="wb-behavior-label">{behaviorLabelText(behavior)}</span>
            <span title="09:20 保留率">
              锁 {behavior.lockRetention == null ? '—' : (behavior.lockRetention * 100).toFixed(0)}%
            </span>
            <span title="09:25 保留率">
              终 {behavior.finalRetention == null ? '—' : (behavior.finalRetention * 100).toFixed(0)}%
            </span>
            <span title="匹配转化">
              转 {behavior.matchedConversion == null ? '—' : fmtPct(behavior.matchedConversion)}
            </span>
          </div>
        ))}
      </div>
      {(auction?.warnings ?? []).map((warning, index) => (
        <div key={index} className="wb-warning">⚠ {warning}</div>
      ))}
    </div>
  )
}

function behaviorLabelClass(label: string): string {
  if (label === 'locked-confirmed' || label === 'late-reinforcement') return 'ok'
  if (label === 'probe-only') return 'warn'
  return 'none'
}

export interface PremarketWorkbenchProps {
  refreshKey?: number
  crossMarket?: CrossMarketSnapshot | null
}

export default function PremarketWorkbench({ refreshKey = 0, crossMarket = null }: PremarketWorkbenchProps) {
  const { data, error, loading } = usePremarketWorkbench(true, refreshKey)
  return (
    <section className="premarket-workbench">
      <div className="wb-head">
        <span className="wb-title">盘前工作台</span>
        <span className="wb-date">{data?.tradeDate ?? ''}</span>
        {loading && <span className="wb-muted">刷新中…</span>}
        {error && <span className="wb-error">⚠ {error}</span>}
      </div>
      {data && (
        <>
          <Timeline specs={data.scheduler.checkpoints} lastRuns={data.scheduler.lastRuns} />
          <div className="wb-grid">
            <UsMappingPanel snapshot={crossMarket} />
            <AsiaPanel asia={data.asia} />
            <AuctionBehaviors auction={data.auction} />
          </div>
        </>
      )}
    </section>
  )
}
