# A Share Delivery Statement Review System PRD

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
- ✅ 12 registered tools: trade queries, metrics calculation, pattern finding, risk alerts, market data, news, semantic search
- ✅ Streaming responses with SSE (Server-Sent Events)
- ✅ Dual LLM protocol support (OpenAI + Anthropic)
- ✅ Conversation history management
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

- ✅ Vectra embedded vector database for semantic search
- ✅ Trade groups, review notes, and lessons indexed as vectors
- ✅ Embedding via LLM API with TF-IDF fallback
- ✅ Automatic sync when trade data changes
- ✅ `semanticSearch` tool for Agent to retrieve historical experiences

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

## 12. Future Enhancements

- Broker-specific mapping templates.
- OCR import for PDF or image delivery statements.
- K-line chart with buy and sell markers.
- Market quote import and benchmark comparison.
- FIFO cost mode.
- Corporate action handling.
- ~~AI-generated review summaries.~~ ✅ Implemented via AI Agent
- Multi-account support.
- Markdown and PDF report export.
- SQLite storage layer (currently using localStorage).
- AnalyticsView enhancements: backtest, Sharpe ratio, max drawdown.
- Milvus migration (currently using Vectra embedded).
- RSS news feed: paid wechat2rss service for latest articles.
