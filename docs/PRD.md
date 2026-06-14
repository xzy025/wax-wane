# Trade Review System PRD — Wax Wane

> **现状更新(as-built):** 本 PRD 的 MVP 以 A 股交割单复盘起步;产品已扩展至**多市场**
> (A 股 / 港股 / 美股),并落地了 AI Agent、RAG、多 Agent 编排、GraphRAG、基本面(东财 F10)
> 分析等能力。下文 §6.0 与 §12 已对齐当前代码;§13 中已实现项保留删除线标注。
> 接口契约见 `docs/api/`,数据表见 `docs/database-schema.md`,AI 子系统见 `docs/AI-ARCHITECTURE.md`。

## 1. Product Overview

This product helps individual A-share investors review brokerage delivery statements. Users import Excel or CSV statements, the system standardizes transaction records, rebuilds positions, calculates realized PnL and trading behavior metrics, then supports manual review notes and tag-based diagnosis.

The first version focuses on offline review and local data accuracy. Market quotes, OCR, AI diagnosis, and multi-broker automation are later-stage capabilities.

## 2. Goals

- Import common A-share delivery statement files and convert them into a standard trade ledger.
- Rebuild stock-level positions and closed trade groups from historical transactions.
- Calculate realized PnL, fees, holding period, win rate, payoff ratio, and behavioral patterns.
- Let users add review notes, strategy tags, mistake tags, and emotional state for each trade group.
- Generate useful weekly and monthly review reports.

## 3. Non Goals For MVP

- Real-time trading or order placement.
- Broker account login, scraping, or automatic sync.
- Tax filing or official accounting output.
- Full corporate action handling for every dividend, split, allotment, and rights issue.
- AI investment advice or stock recommendation.

## 4. Target Users

- Active A-share retail investors who trade manually and want to improve discipline.
- Swing traders who need stock-level and trade-cycle review.
- Users who already export delivery statements from their broker app or desktop client.

## 5. Core User Problems

- Delivery statements are transaction ledgers, not review tools.
- Users know a final profit or loss number but cannot identify behavior patterns.
- Buy and sell records are separated, making closed trade analysis difficult.
- Fees, holding period, and repeated mistakes are hard to quantify manually.
- Review notes are often disconnected from actual trade records.

## 6. MVP Scope

### 6.1 Import

> **Note**: The following sections describe the current implementation. Features marked with ✅ are implemented.

### 6.0 AI Agent & Market Data (Implemented)

#### 6.0.1 AI Agent

- ✅ ReAct-style agent loop with tool calling
- ✅ **28 registered tools** (see `src/agent/tools/index.ts`): trade queries & metrics, pattern/risk analysis, market data (A/HK/US), K-line, fundamentals (F10), news, web search, semantic search, GraphRAG queries, and composite Agent-as-Tool reviews
- ✅ **Multi-Agent orchestration**: 12 expert agents + Synthesizer, serial pipeline + parallel fan-out (`src/agent/multi-agent/`)
- ✅ Streaming responses with SSE (Server-Sent Events)
- ✅ Dual LLM protocol support (OpenAI + Anthropic)
- ✅ Conversation history management + two-layer context compression
- ✅ Abort/cancellation support

#### 6.0.2 Market Data Integration

- ✅ Macro indicators: US 10Y/5Y Treasury, Gold, DXY, USD/CNY, Crude Oil, VIX
- ✅ A-share market breadth: advance/decline, limit up/down counts
- ✅ Index intraday trends (分时数据): SSE Composite, SZSE Component, ChiNext
- ✅ Limit pool data: 涨停/跌停 stocks with industry and consecutive days
- ✅ Individual stock quotes

#### 6.0.3 Structured Review Workflow

- ✅ One-click review button triggering 6-step workflow:
  1. Macro analysis (Treasury, Gold, USD, Oil, VIX)
  2. News summary (RSS feeds from WeChat public accounts)
  3. Market trends (breadth + index intraday)
  4. Sector analysis (limit pool, hot sectors)
  5. Trade review (combine market context with user's trades)
- ✅ Structured output report template

#### 6.0.4 RAG (Retrieval-Augmented Generation)

- ✅ **PostgreSQL + pgvector** as the vector store (Vectra embedded DB kept as a no-Postgres fallback)
- ✅ Trade groups, review notes, and fundamental reports indexed as `VECTOR(1536)` columns
- ✅ Embedding via LLM API with TF-IDF fallback
- ✅ Automatic sync when trade data changes
- ✅ `semanticSearch` / `hybridSearch` tools for the Agent to retrieve historical experiences
- ✅ **GraphRAG** knowledge graph (`graph_nodes` / `graph_edges`) for relational queries over mistakes, strategies, and theories

### 6.1 Import

- Upload `.xlsx`, `.xls`, or `.csv` files.
- Preview the first 50 rows.
- Map source columns to standard fields.
- Save the raw file metadata and standardized rows.
- Detect missing required fields and invalid values.

Required standard fields:

- Trade date
- Stock code
- Stock name
- Side
- Quantity
- Price
- Gross amount
- Commission
- Stamp tax
- Transfer fee
- Net amount

### 6.2 Trade Ledger

- Show all standardized trades in a searchable table.
- Filter by date range, stock, side, import batch, and validation status.
- Allow limited manual correction for mapping mistakes.
- Preserve original source values for auditability.

### 6.3 Position Reconstruction

- Rebuild current position by stock.
- Support moving weighted average cost in MVP.
- Calculate quantity, average cost, total cost, realized PnL, and total fees.
- Flag abnormal states, such as selling more shares than available.

### 6.4 Closed Trade Grouping

- Group buy and sell records into trade cycles per stock.
- A trade group starts when position goes from zero to positive.
- A trade group closes when position returns to zero.
- Partial sells remain inside the active group.
- Calculate group-level PnL, return, holding days, total fees, buy count, and sell count.

### 6.5 Review Notes

- Add note, plan, buy reason, sell reason, execution review, mistake tags, strategy tag, and mood tag.
- Allow review status: not reviewed, reviewed, needs follow-up.
- Keep note history for future audit in later versions.

### 6.6 Analytics Dashboard

- Summary cards: total realized PnL, win rate, payoff ratio, average holding days, total fees.
- Charts: equity curve placeholder, PnL distribution, fee ratio, mistake ranking.
- Lists: best trades, worst trades, high-fee trades, long-held losing trades.

### 6.7 Reports

- Generate weekly and monthly summaries.
- Include top winners, top losers, most frequent mistake tags, and discipline score.
- Export report to Markdown in later version.

## 7. User Flow

1. User opens dashboard and selects import.
2. User uploads a delivery statement.
3. System previews rows and suggests column mapping.
4. User confirms mapping.
5. System validates and imports standardized trades.
6. System rebuilds positions and trade groups.
7. User reviews dashboard anomalies.
8. User opens a trade group and adds notes and tags.
9. User reads weekly or monthly report.

## 8. Functional Requirements

### Import Requirements

- The system must support CSV and Excel imports.
- The system must show source filename, import time, row count, success count, and error count.
- The system must block import when required field mapping is missing.
- The system must store raw source column names and normalized fields.

### Calculation Requirements

- Buy trade increases position quantity and cost basis.
- Sell trade decreases position quantity and realizes PnL based on moving weighted average cost.
- Fees must be included in realized PnL calculation.
- Stamp tax applies to sell records when present in source data.
- Holding days are calculated from first buy date to final sell date for a closed group.

### Review Requirements

- Every closed trade group can have one current review note.
- Users can apply multiple mistake tags.
- Users can apply one primary strategy tag.
- Notes must be editable after creation.

### Dashboard Requirements

- Metrics must react to selected date range.
- The system must separate realized PnL from current floating PnL.
- MVP may show floating PnL as unavailable unless quotes are imported.

## 9. Data Quality Rules

- Stock code must be 6 digits.
- Side must normalize to `buy` or `sell`.
- Quantity must be positive.
- Price must be positive.
- Trade date must be parseable.
- Fees cannot be negative unless the source row is explicitly marked as adjustment.
- Selling quantity cannot exceed available position unless short position mode is enabled. MVP does not enable short mode.

## 10. Key Metrics

- Total realized PnL
- Total fee
- Fee to gross amount ratio
- Win rate
- Payoff ratio
- Average holding days
- Average profit per winning trade
- Average loss per losing trade
- Max single-trade loss
- Consecutive losing trades
- Trade frequency
- Most frequent mistake tag

## 11. MVP Acceptance Criteria

- User can import at least one correctly formatted CSV sample.
- Imported rows appear in the trade ledger.
- Position reconstruction matches manual moving-average calculations for sample data.
- Closed trade groups are created correctly when a stock position returns to zero.
- Dashboard metrics match grouped trades.
- User can write and edit a review note for a closed trade.
- Production build passes.

## 12. UI Design System

### 12.0 UI Layout & Naming Convention

```
┌─────────────────────────────────────────────────────────────────┐
│ ┌──────────┐  ┌────────────────────────────────────────────┐   │
│ │          │  │ topbar (顶部栏)                            │   │
│ │ sidebar  │  │  [日期范围: 周度|月度|季度|年度] [语言]    │   │
│ │ (侧边栏) │  ├────────────────────────────────────────────┤   │
│ │          │  │ date-picker (日期选择器)                   │   │
│ │ ──────── │  ├────────────────────────────────────────────┤   │
│ │ 工作台   │  │ macro-banner (宏观看板)                    │   │
│ │ 导入     │  │  美债 | 黄金 | 美元 | 原油 | VIX          │   │
│ │ 流水     │  ├────────────────────────────────────────────┤   │
│ │ 复盘     │  │ ashare-banner (A股看板)                    │   │
│ │ 分析     │  │  指数 | 涨停跌停 | 涨跌 | 成交量          │   │
│ │          │  ├────────────────────────────────────────────┤   │
│ │ ──────── │  │ workspace (工作区)                         │   │
│ │ 成本模式 │  │  收益曲线 / 表单 / 图表等                  │   │
│ └──────────┘  └────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

#### 区域术语表

| 术语 | CSS 类名 | 指代 |
|------|----------|------|
| **侧边栏** | `.sidebar` | 左侧导航栏，包含 logo + 5 个 tab |
| **顶部栏** | `.topbar` | 右侧顶部，包含日期范围、语言切换 |
| **日期选择器** | `.date-picker` | 日期按钮 + 日历弹窗 |
| **宏观看板** | `.macro-banner` | 宏观经济指标（美债、黄金、美元、原油、VIX） |
| **A股看板** | `.ashare-banner` | A股市场数据（指数、涨跌停、成交量） |
| **工作区** | `.workspace` | 主内容区（收益曲线、表格等） |

#### Tab 名称

| 术语 | 路由 | 指代 |
|------|------|------|
| **行情** | `/market` | 全球行情总览（默认首页） |
| **工作台** | `/dashboard` | 复盘工作台，收益曲线和交易闭环 |
| **导入** | `/import` | 交割单导入 |
| **台账** | `/ledger` | 交易流水/台账列表 |
| **复盘** | `/reviews` | 交易闭环复盘 |
| **分析** | `/analytics` | 统计分析 |
| **AI Agent** | `/agent` | 对话式复盘助手（流式展示推理→调工具→观察） |

> 共 7 个导航视图，定义见 `src/App.tsx` `navItems`。

#### 显示规则

| 元素 | 行情 | 工作台 | 其他 Tab |
|------|------|--------|----------|
| 日期范围选择器 | ✅ | ✅ | ❌ |
| 日期选择器 | ✅ | ❌ | ❌ |
| 宏观看板 | ✅ | ❌ | ❌ |
| A股看板 | ✅ | ❌ | ❌ |
| 港股看板 | ✅ | ❌ | ❌ |
| 美股看板 | ✅ | ❌ | ❌ |
| 热门榜单 | ✅ | ❌ | ❌ |
| 收益曲线 | ❌ | ✅ | ❌ |
| 风险提示 | ❌ | ✅ | ❌ |
| 交易闭环 | ❌ | ✅ | ❌ |
| 语言切换 | ✅ | ✅ | ✅ |

### 12.1 Color Scheme (Dark "Cyberpunk × Apple")

> 2026-06-14 重塑:浅蓝主题 → **暗色「赛博 × 苹果」**(均衡强度,唯一默认,无主题切换)。
> 真相来源 `src/styles.css` `:root`。Apple 一侧:毛玻璃、圆角、克制、大留白;赛博一侧:近黑底、
> 霓虹辉光(仅激活导航/品牌标/主按钮/FAB)、等宽数字、极淡网格底纹。

| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#0A0E16` | Page background(近黑冷调) |
| `--surface` | `#121826` | 实心面板(不便毛玻璃处) |
| `--surface-glass` | `rgba(20,26,40,.62)` | 毛玻璃卡片底(配 `--blur`) |
| `--surface-soft` | `rgba(255,255,255,.04)` | 细微区 / 表头 |
| `--line` | `rgba(255,255,255,.09)` | 发丝边框 |
| `--ink` | `#E6EAF2` | Primary text |
| `--muted` | `#8A93A6` | Secondary text |
| `--blue` | `#3B8EFF` | Primary actions, links(亮版 `--blue-bright #5AA2FF`) |
| `--cyan` | `#2DD4E8` | Accent, secondary actions |
| `--red` | `#FF4D5E` | Rise (涨), danger |
| `--green` | `#2BD96A` | Fall (跌), success |
| `--orange` | `#FFA53B` | Warning |

**效果与排版 token:**
- `--blur: blur(18px) saturate(160%)` — 侧栏 / 卡片 / 面板 / 看板 / 对话面板毛玻璃
- `--glow-blue` — 霓虹辉光(激活导航、主按钮、品牌标、FAB)
- `--font-mono`(`SF Mono` / `ui-monospace` …)— 所有数值(价格、盈亏、指标)
- 字体主栈 `-apple-system / SF Pro` 优先(苹果设计语言)
- 透明度一律 `rgba(var(--blue-rgb), a)` 等写法,**不再硬编码 hex**
- 红涨绿跌(A 股约定)保留,暗底下提亮

### 12.2 Icon System

Phosphor Icons (Apple-style line icons) with regular weight for:
- Clean, modern appearance
- Consistent with Apple SF Symbols design language
- Financial and tech-oriented iconography

Key icons:
- `ChartBar` - Dashboard
- `ChartPieSlice` - Analytics
- `TrendUp/Down` - Market trends
- `CurrencyCircleDollar` - Financial metrics
- `Robot` - AI Agent

### 12.3 A-Share Dashboard Features

#### Market Indices
- Shanghai Composite (上证指数)
- Shenzhen Component (深证成指)
- ChiNext (创业板指)
- STAR 50 (科创50)
- BSE 50 (北证50)

#### Market Sentiment Indicators
- Limit up/down counts with red/green colors
- Advance/decline ratio with colored numbers
- Profitability score (0-100)
- Promotion rate (连板晋级率)
- New high stocks list

#### Volume Statistics
- 7-day volume history chart
- Volume in trillions (万亿)
- Red bars for volume increase vs previous day
- Green bars for volume decrease vs previous day

### 12.3.1 Hong Kong Market

#### Indices
- Hang Seng Index (恒生指数)
- Hang Seng TECH (恒生科技)
- China Internet (中概互联)

#### Display
- Price colored by direction (red up, green down)
- Change percentage with trend icon
- Links to East Money quote pages

### 12.3.2 US Market

#### Stocks (A-share US mapping)
- NVIDIA (英伟达)
- Lumentum
- AMD
- TSMC (台积电)

#### Display
- Price in USD with $ prefix
- Change percentage with trend icon
- Links to East Money quote pages

### 12.3.3 Hot Stock Rankings

Four ranking sources displayed in a 4-column grid:

| Source | Features |
|--------|----------|
| 东方财富 热搜榜 | Hot search ranking |
| 同花顺 热榜 | Concept tags + popularity tags |
| 淘股吧 热榜 | Leader/follower/emotion tags |
| 龙虎榜 | Net buy amount + seat explanation |

- Each panel separated by vertical divider
- Dragon Tiger (龙虎榜) shows institutional activity
- All stocks link to East Money quote pages

### 12.4 Date Range & Selection

#### Range Options
- Week (周度): Last 7 days
- Month (月度): Last 30 days
- Quarter (季度): Last 90 days
- Year (年度): Last 365 days

#### Date Picker
- Weekends (Saturday/Sunday) are disabled
- Default selection: Last trading day
- Calendar shows current month

### 12.5 Data Caching

Market data is cached per date in localStorage:
- First fetch for each date is cached
- Page refresh uses cached data (no API call)
- Manual refresh button forces new data fetch
- Cache expires after 30 days (pruned automatically)

### 12.6 Dashboard Layout

The dashboard tab shows:
- Date picker and range selector
- Macro indicators banner (Treasury, Gold, USD, Oil, VIX)
- A-Share market banner (indices, sentiment, volume)
- Equity curve chart
- Risk alerts
- Recent trade groups

Other tabs (Import, Ledger, Reviews, Analytics) do not show these elements.

## 13. Future Enhancements

- Broker-specific mapping templates.
- OCR import for PDF or image delivery statements.
- K-line chart with buy and sell markers. _(数据侧已就绪：`getStockKline` 工具 + `/api/stock/kline`；UI 标注图待补。)_
- Market quote import and benchmark comparison.
- FIFO cost mode.
- Corporate action handling.
- ~~AI-generated review summaries.~~ ✅ Implemented via AI Agent
- ~~Multi-market support (HK / US).~~ ✅ Implemented (行情看板 + 个股报价)
- ~~Fundamental analysis.~~ ✅ Implemented (东财 F10 + 一页纸研报 `/api/analysis/fundamental`)
- Multi-account support.
- Markdown and PDF report export.
- ~~Backend persistence layer.~~ ✅ Implemented (前端 localStorage + 后端 PostgreSQL 写穿；`src/store/persistence.ts`)
- ~~AnalyticsView quant metrics (Sharpe, max drawdown, payoff…).~~ ✅ Implemented；回测仍为 future。
- ~~Vector store migration.~~ ✅ Moved to PostgreSQL + pgvector (Vectra kept as fallback)。
- RSS news feed: paid wechat2rss service for latest articles.
