import { ArrowRight, CalendarBlank, CircleNotch, Compass, Lightning, ShieldCheck } from 'phosphor-react'
import MacroBanner from '../components/MacroBanner'
import AShareBanner from '../components/AShareBanner'
import HKBanner from '../components/HKBanner'
import USBanner from '../components/USBanner'
import HotListBanner from '../components/HotListBanner'
import MarketDatePicker from '../components/MarketDatePicker'
import type { Translation } from '../types'

interface MarketViewProps {
  t: Translation
  language: 'zh' | 'en'
  selectedDate: string
  onSelectDate: (date: string) => void
  onRefresh: () => void
  refreshKey: number
}

export default function MarketView({
  t,
  language,
  selectedDate,
  onSelectDate,
  onRefresh,
  refreshKey,
}: MarketViewProps) {
  const zh = language === 'zh'
  const copy = zh
    ? {
        kicker: 'DAILY MARKET BRIEF',
        title: '先看环境，再找机会',
        description: '把宏观、指数、情绪与热度放在同一条研究路径里，减少在数据之间来回切换。',
        live: '研究窗口',
        window: '当前数据窗口',
        sequence: '研究顺序',
        sequenceValue: '宏观 → A股 → 跨市场',
        sequenceHint: '先确认风险偏好，再比较个股强弱',
        context: '宏观风向',
        contextHint: '利率、美元与大宗商品决定今天的风险底色。',
        contextMeta: 'Global context',
        ashare: 'A股温度',
        ashareHint: '指数、涨跌家数与情绪指标，快速判断市场是否允许进攻。',
        ashareMeta: 'Breadth & sentiment',
        cross: '跨市场映射',
        crossHint: '用港股与美股确认外部风险和主题共振。',
        crossMeta: 'Asia / US',
        hot: '研究线索',
        hotHint: '热榜只负责发现方向，进入个股前仍需回到基本面与量价证据。',
        hotMeta: 'Watchlist signals',
        sync: '刷新数据',
      }
    : {
        kicker: 'DAILY MARKET BRIEF',
        title: 'Read the regime, then find the edge',
        description: 'Macro, indices, breadth, sentiment, and heat now follow one research path.',
        live: 'Research window',
        window: 'Data window',
        sequence: 'Research order',
        sequenceValue: 'Macro → A-share → Cross-market',
        sequenceHint: 'Confirm risk appetite before comparing stocks.',
        context: 'Macro context',
        contextHint: 'Rates, dollar, and commodities set today’s risk backdrop.',
        contextMeta: 'Global context',
        ashare: 'A-share temperature',
        ashareHint: 'Indices, breadth, and sentiment show whether the market is attackable.',
        ashareMeta: 'Breadth & sentiment',
        cross: 'Cross-market map',
        crossHint: 'Use Hong Kong and US markets to confirm external risk and resonance.',
        crossMeta: 'Asia / US',
        hot: 'Research leads',
        hotHint: 'Heat finds directions; fundamentals and price action still validate the stock.',
        hotMeta: 'Watchlist signals',
        sync: 'Refresh data',
      }

  return (
    <div className="market-view">
      <section className="market-intro">
        <div className="market-intro-copy">
          <p className="market-kicker">{copy.kicker}</p>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="market-intro-controls">
          <div className="market-session-pill">
            <span className="market-session-dot" aria-hidden="true" />
            <span>{copy.live}</span>
          </div>
          <MarketDatePicker
            selectedDate={selectedDate}
            onSelect={onSelectDate}
            onRefresh={onRefresh}
            t={t}
          />
        </div>
      </section>

      <section className="market-orientation" aria-label={copy.sequence}>
        <article className="market-orientation-card market-orientation-card--accent">
          <div className="market-orientation-icon" aria-hidden="true">
            <Compass size={18} />
          </div>
          <div>
            <span>{copy.sequence}</span>
            <strong>{copy.sequenceValue}</strong>
            <small>{copy.sequenceHint}</small>
          </div>
        </article>
        <article className="market-orientation-card">
          <div className="market-orientation-icon" aria-hidden="true">
            <CalendarBlank size={18} />
          </div>
          <div>
            <span>{copy.window}</span>
            <strong>{selectedDate}</strong>
            <small>{copy.sync}</small>
          </div>
        </article>
        <article className="market-orientation-card">
          <div className="market-orientation-icon" aria-hidden="true">
            <ShieldCheck size={18} />
          </div>
          <div>
            <span>{zh ? '判断闸门' : 'Decision gate'}</span>
            <strong>{zh ? '先风险，后收益' : 'Risk before return'}</strong>
            <small>{zh ? '每条线索都保留数据状态' : 'Every lead keeps its data state'}</small>
          </div>
        </article>
      </section>

      <section className="market-section">
        <div className="market-section-heading">
          <div>
            <span className="market-section-index">01 / CONTEXT</span>
            <h3>{copy.context}</h3>
            <p>{copy.contextHint}</p>
          </div>
          <span className="market-section-meta">{copy.contextMeta}</span>
        </div>
        <MacroBanner key={`macro-${refreshKey}`} t={t} date={selectedDate} />
      </section>

      <section className="market-section">
        <div className="market-section-heading">
          <div>
            <span className="market-section-index">02 / BREADTH</span>
            <h3>{copy.ashare}</h3>
            <p>{copy.ashareHint}</p>
          </div>
          <span className="market-section-meta">{copy.ashareMeta}</span>
        </div>
        <AShareBanner key={`ashare-${refreshKey}`} t={t} date={selectedDate} />
      </section>

      <section className="market-section">
        <div className="market-section-heading">
          <div>
            <span className="market-section-index">03 / CONFIRMATION</span>
            <h3>{copy.cross}</h3>
            <p>{copy.crossHint}</p>
          </div>
          <span className="market-section-meta">{copy.crossMeta}</span>
        </div>
        <div className="market-cross-grid">
          <div className="market-cross-column">
            <HKBanner key={`hk-${refreshKey}`} t={t} date={selectedDate} />
          </div>
          <div className="market-cross-column">
            <USBanner key={`us-${refreshKey}`} t={t} date={selectedDate} />
          </div>
        </div>
      </section>

      <section className="market-section market-section--last">
        <div className="market-section-heading">
          <div>
            <span className="market-section-index">04 / DISCOVERY</span>
            <h3>{copy.hot}</h3>
            <p>{copy.hotHint}</p>
          </div>
          <span className="market-section-meta">{copy.hotMeta}</span>
        </div>
        <HotListBanner key={`hot-${refreshKey}`} t={t} date={selectedDate} />
      </section>

      <div className="market-footer-note">
        <Lightning size={15} aria-hidden="true" />
        <span>{zh ? '数据源状态会在每个模块内单独标注，避免把缺失误读成中性。' : 'Each module keeps its data status visible so missing data is never mistaken for neutral.'}</span>
        <ArrowRight size={15} aria-hidden="true" />
      </div>

      <div className="market-screen-reader-status" aria-live="polite">
        <CircleNotch size={14} aria-hidden="true" />
        {selectedDate}
      </div>
    </div>
  )
}
