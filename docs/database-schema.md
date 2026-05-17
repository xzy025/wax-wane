# Database Schema

The MVP can use SQLite locally. The same model can later move to PostgreSQL with minor type changes.

## Core Tables

### import_batches

Stores one uploaded delivery statement file.

```sql
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  source_filename TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'excel')),
  broker_name TEXT,
  account_alias TEXT,
  imported_at TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('draft', 'imported', 'failed')),
  mapping_json TEXT NOT NULL,
  notes TEXT
);
```

### trades

Stores standardized transaction rows.

```sql
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  import_batch_id TEXT NOT NULL REFERENCES import_batches(id),
  source_row_number INTEGER NOT NULL,
  trade_date TEXT NOT NULL,
  settlement_date TEXT,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price REAL NOT NULL CHECK (price > 0),
  gross_amount REAL NOT NULL,
  commission REAL NOT NULL DEFAULT 0,
  stamp_tax REAL NOT NULL DEFAULT 0,
  transfer_fee REAL NOT NULL DEFAULT 0,
  other_fee REAL NOT NULL DEFAULT 0,
  net_amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'warning', 'error')),
  validation_message TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Recommended indexes:

```sql
CREATE INDEX idx_trades_date ON trades(trade_date);
CREATE INDEX idx_trades_stock ON trades(stock_code, trade_date);
CREATE INDEX idx_trades_import_batch ON trades(import_batch_id);
```

### position_snapshots

Stores reconstructed position state after each trade. This makes audits and recalculation easier.

```sql
CREATE TABLE position_snapshots (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL REFERENCES trades(id),
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  quantity_after INTEGER NOT NULL,
  avg_cost_after REAL NOT NULL,
  cost_basis_after REAL NOT NULL,
  realized_pnl_delta REAL NOT NULL DEFAULT 0,
  fee_delta REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

Recommended indexes:

```sql
CREATE INDEX idx_position_snapshots_stock_date ON position_snapshots(stock_code, snapshot_date);
CREATE UNIQUE INDEX idx_position_snapshots_trade ON position_snapshots(trade_id);
```

### trade_groups

Stores a complete or active trading cycle for one stock.

```sql
CREATE TABLE trade_groups (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
  buy_count INTEGER NOT NULL DEFAULT 0,
  sell_count INTEGER NOT NULL DEFAULT 0,
  total_buy_amount REAL NOT NULL DEFAULT 0,
  total_sell_amount REAL NOT NULL DEFAULT 0,
  total_fee REAL NOT NULL DEFAULT 0,
  realized_pnl REAL NOT NULL DEFAULT 0,
  realized_return REAL,
  holding_days INTEGER,
  max_position_quantity INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Recommended indexes:

```sql
CREATE INDEX idx_trade_groups_stock ON trade_groups(stock_code);
CREATE INDEX idx_trade_groups_closed_at ON trade_groups(closed_at);
CREATE INDEX idx_trade_groups_status ON trade_groups(status);
```

### trade_group_items

Links transaction rows to trade groups.

```sql
CREATE TABLE trade_group_items (
  id TEXT PRIMARY KEY,
  trade_group_id TEXT NOT NULL REFERENCES trade_groups(id),
  trade_id TEXT NOT NULL REFERENCES trades(id),
  sequence_no INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

Recommended indexes:

```sql
CREATE UNIQUE INDEX idx_group_items_trade ON trade_group_items(trade_id);
CREATE INDEX idx_group_items_group ON trade_group_items(trade_group_id, sequence_no);
```

### review_notes

Stores user review content for a trade group.

```sql
CREATE TABLE review_notes (
  id TEXT PRIMARY KEY,
  trade_group_id TEXT NOT NULL REFERENCES trade_groups(id),
  review_status TEXT NOT NULL CHECK (review_status IN ('not_reviewed', 'reviewed', 'follow_up')),
  buy_reason TEXT,
  sell_reason TEXT,
  original_plan TEXT,
  execution_review TEXT,
  lesson TEXT,
  mood_tag TEXT,
  strategy_tag_id TEXT REFERENCES tags(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### tags

Stores strategy, mistake, and mood labels.

```sql
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('strategy', 'mistake', 'mood')),
  color TEXT NOT NULL DEFAULT '#64748b',
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

### review_note_tags

Links review notes to multiple tags. Mistake tags use this table.

```sql
CREATE TABLE review_note_tags (
  review_note_id TEXT NOT NULL REFERENCES review_notes(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY (review_note_id, tag_id)
);
```

## Optional Later Tables

### market_quotes

```sql
CREATE TABLE market_quotes (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  quote_date TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume INTEGER,
  amount REAL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### report_snapshots

```sql
CREATE TABLE report_snapshots (
  id TEXT PRIMARY KEY,
  report_type TEXT NOT NULL CHECK (report_type IN ('weekly', 'monthly', 'quarterly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  markdown TEXT,
  created_at TEXT NOT NULL
);
```

## Moving Average PnL Rules

For a buy:

```text
new_quantity = old_quantity + buy_quantity
new_cost_basis = old_cost_basis + gross_amount + fees
new_avg_cost = new_cost_basis / new_quantity
realized_pnl_delta = 0
```

For a sell:

```text
cost_removed = old_avg_cost * sell_quantity
sell_proceeds = gross_amount - fees
realized_pnl_delta = sell_proceeds - cost_removed
new_quantity = old_quantity - sell_quantity
new_cost_basis = old_avg_cost * new_quantity
```

If `new_quantity = 0`, reset `new_avg_cost` and `new_cost_basis` to `0`.

## Trade Group Rules

- Sort trades by `trade_date`, then source row order.
- A new group starts when stock quantity changes from `0` to positive.
- All subsequent trades for the stock belong to the active group.
- The group closes when quantity returns to `0`.
- If a sell exceeds current quantity, mark the trade as error and exclude it from grouping until corrected.

## Default System Tags

Strategy tags:

- Breakout
- Pullback
- Event driven
- Reversal
- Index beta

Mistake tags:

- Chasing high
- Panic selling
- No plan
- Late stop loss
- Oversized position
- Early profit taking
- Revenge trading

Mood tags:

- Calm
- Fearful
- Greedy
- Impatient
- Hesitant
