# Wax Wane 最终架构文档

> 更新日期：2026-06-01
> 版本：2.0.0
> 重构完成：Phase 1-7 全部完成

---

## 一、项目概览

Wax Wane 是一个 A 股交易纪律分析平台，帮助交易者复盘交易、识别行为模式、提升交易纪律。

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite |
| 后端 | Express + NestJS (迁移中) |
| 数据库 | PostgreSQL + pgvector |
| 缓存 | Redis |
| AI 框架 | LangChain + DeepAgents |
| 向量搜索 | pgvector + 自定义 Embedding |
| 图数据库 | PostgreSQL 邻接表 |
| MCP | Model Context Protocol Server |

---

## 二、系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         前端 (React 19)                          │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │ Market  │ │Dashboard│ │ Import  │ │ Ledger  │ │ Review  │  │
│  │  View   │ │  View   │ │  View   │ │  View   │ │  View   │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Agent Chat Panel                       │   │
│  │  (ChatPanel + ToolCallCard + StreamingBubble)            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      后端 (Express / Nest)                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │ Agent API   │ │ Market API  │ │ Memory API  │              │
│  │ SSE Stream  │ │ REST        │ │ REST        │              │
│  └─────────────┘ └─────────────┘ └─────────────┘              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Agent Pipeline                          │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         │   │
│  │  │ Auth │→│ Rate │→│Memory│→│Compr.│→│Cache │         │   │
│  │  │      │ │Limit ││      ││      ││      ││         │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘         │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              DeepAgents Agent Engine                      │   │
│  │  ┌──────────────┐    ┌──────────────┐                   │   │
│  │  │  Planning    │    │  Standard    │                   │   │
│  │  │  Mode        │    │  Mode        │                   │   │
│  │  │ (复盘/理论)  │    │ (自由对话)   │                   │   │
│  │  └──────────────┘    └──────────────┘                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Multi-Agent Orchestrator                     │   │
│  │  ┌─────────────────────┐  ┌─────────────────────┐       │   │
│  │  │ Structured Review   │  │ Theory Review       │       │   │
│  │  │ (5 Agent 顺序)      │  │ (4 Agent 并行)      │       │   │
│  │  └─────────────────────┘  └─────────────────────┘       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  PostgreSQL   │  │     Redis     │  │   MCP Servers │
│  + pgvector   │  │   (缓存)      │  │   (外部集成)  │
│  (主数据库)   │  │               │  │               │
└───────────────┘  └───────────────┘  └───────────────┘
```

---

## 三、模块详解

### 3.1 上下文压缩 (Phase 1)

```
src/agent/contextCompression.ts
```

| 策略 | 说明 | 效果 |
|------|------|------|
| 分层压缩 | 系统 prompt + 摘要 + 最近 N 条 + 当前任务 | Token 减少 63% |
| Tool Result 压缩 | 按工具类型智能压缩（交易取样本、新闻取标题） | 大结果减少 80% |
| 滑动窗口 | 只保留最近 6 条完整消息 | 上下文可控 |

### 3.2 Redis 短期记忆 (Phase 1)

```
server/redis.ts
```

| 存储类型 | Key 格式 | TTL | 用途 |
|---------|---------|-----|------|
| 对话历史 | `agent:conv:{id}:messages` | 2h | 会话级状态 |
| 复盘进度 | `agent:review:{id}:progress` | 30min | 复盘中间结果 |
| 工具缓存 | `agent:cache:{tool}:{hash}` | 30s | 减少 API 调用 |
| 市场快照 | `agent:market:snapshot:{date}` | 当日 | 市场数据缓存 |
| 会话管理 | `agent:session:{id}` | 2h | 用户会话 |

### 3.3 Skill 系统 (Phase 1)

```
src/agent/skills/
```

| Skill | 触发词 | 步骤数 | 工具 |
|-------|--------|--------|------|
| 结构化复盘 | 复盘, review, 一键复盘 | 6 | getMacroIndicators, getNewsSummary, getMarketBreadth, getIndexTrends, getLimitPool, queryTradeHistory |
| 理论引导复盘 | 理论分析, 用理论, 帮我复盘 | 4 | analyzeWithTheory, analyzeTradePatterns, semanticSearch, generateImprovementPlan |

### 3.4 Middleware 管道 (Phase 1)

```
src/agent/pipeline/
```

| Middleware | Order | 功能 |
|-----------|-------|------|
| auth | 0 | 验证 userId |
| rate-limit | 1 | 限流 (30 req/min) |
| memory | 5 | 注入用户画像 |
| compression | 10 | 上下文压缩 |
| cache | 20 | 工具结果缓存 |
| logging | 99 | 日志记录 |

### 3.5 GraphRAG (Phase 2)

```
server/graph/
```

**实体类型 (12 种)**：
TradeGroup, Stock, Sector, Mistake, Strategy, Theory, MarketPhase, Lesson, Pattern, User, MacroIndicator, NewsEvent

**关系类型 (15 种)**：
BELONGS_TO, INVOLVES, HAS_MISTAKE, USED_STRATEGY, OCCURRED_DURING, GENERATED, VIOLATES, APPLIES_TO, LINKED_TO, PRONE_TO, FOLLOWS, IN_SECTOR, CORRELATED_WITH, CHARACTERIZED_BY, AFFECTS

**查询能力**：
- `findTradesByMistake` — 按错误查找交易
- `findTradesByPhase` — 按市场阶段查找交易
- `findRelatedTrades` — 关联交易发现
- `findPatternPath` — 错误→理论推理路径
- `hybridSearch` — 向量+图混合搜索

### 3.6 Nest + LangChain (Phase 3)

```
apps/server/
```

| 模块 | 职责 |
|------|------|
| AgentModule | SSE 流式接口、Agent 业务逻辑 |
| LLMModule | LLM 工厂 (MiMo/Claude/GPT/Gemini) |
| ToolsModule | Tool → LangChain 转换器 |
| StreamingModule | AsyncGenerator → Observable |
| DatabaseModule | PostgreSQL 连接池 |
| RedisModule | ioredis 封装 |

### 3.7 MCP Servers (Phase 4)

```
mcp-servers/
```

| Server | Tools | 功能 |
|--------|-------|------|
| market-data | 9 | A股/港股/美股行情、宏观指标、新闻、热股 |
| rag | 4 | 语义搜索、向量同步、混合搜索 |
| trade-db | 4 | 交易查询、复盘笔记 CRUD |
| memory-graph | 8 | 用户记忆、图查询、关联发现 |
| **总计** | **25** | |

### 3.8 Multi-Agent (Phase 5)

```
src/agent/multi-agent/
```

**结构化复盘 (顺序执行)**：
```
Orchestrator → MacroAnalyst → NewsAnalyst → MarketAnalyst → SectorAnalyst → TradeReviewer → Report
```

**理论引导复盘 (并行执行)**：
```
Orchestrator → [Wyckoff | Dow | AlBrooks | Sentiment] → Synthesizer → Report
```

| Agent | 职责 | 工具 |
|-------|------|------|
| MacroAnalyst | 宏观面分析 | getMacroIndicators |
| NewsAnalyst | 消息面分析 | getNewsSummary |
| MarketAnalyst | 大盘分析 | getMarketBreadth |
| SectorAnalyst | 板块分析 | getLimitPool |
| TradeReviewer | 交易复盘 | queryTradeHistory |
| WyckoffAgent | Wyckoff 理论 | analyzeWithTheory |
| DowAgent | 道氏理论 | analyzeWithTheory |
| AlBrooksAgent | 价格行为 | analyzeWithTheory |
| SentimentAgent | A股情绪 | analyzeWithTheory |
| SynthesizerAgent | 综合分析 | (无，纯推理) |

### 3.9 Memory 增强 (Phase 6)

```
server/memory/memoryEnhanced.ts
server/memory/memoryExtraction.ts
```

**增强 Memory 结构**：
```
EnhancedAgentMemory
├── tradingProfile (增强)
│   ├── preferredSectors: string[]
│   ├── avgHoldingDays: number
│   ├── riskTolerance: 'low' | 'mid' | 'high'
│   ├── bestPerformingStrategy: string
│   ├── worstPerformingStrategy: string
│   ├── emotionalPatterns
│   │   ├── fomoTriggers: string[]
│   │   └── panicTriggers: string[]
│   └── tradingFrequency
│       ├── avgTradesPerWeek: number
│       └── highFrequencyPeriods: string[]
├── conversationMemory (新增)
│   ├── summary: string
│   ├── keyDecisions: KeyDecision[]
│   ├── openQuestions: string[]
│   └── actionItems: ActionItem[]
├── tradeExperience (新增)
│   ├── lessons: TradeLesson[]
│   ├── patterns: TradePattern[]
│   └── successPatterns: SuccessPattern[]
└── marketAnalysis (增强)
    ├── current: { wyckoff, dow, sentiment }
    ├── history: MarketPhaseRecord[]
    └── regimeChanges: RegimeChange[]
```

**自动提取**：
| 功能 | 触发时机 | 提取内容 |
|------|---------|---------|
| 画像推断 | 交易导入时 | 偏好板块、持仓天数、风险偏好、交易频率 |
| 教训提取 | 复盘完成时 | 交易教训、分类、关联理论 |
| 模式识别 | 交易分析时 | 失败模式、成功模式、预防规则 |
| 决策提取 | 对话进行时 | 关键决策、推理依据 |

### 3.10 DeepAgents (Phase 7)

```
src/agent/deep-agents/
```

**智能路由**：
```
用户消息
    │
    ▼
isStructuredRequest?
    │
    ├── Yes → Planning Mode
    │         ├── 复盘 → StructuredReviewOrchestrator
    │         └── 理论 → TheoryReviewOrchestrator
    │
    └── No → Standard Mode
              └── 普通 Agent Loop + 工具调用
```

---

## 四、工具清单

### 4.1 Agent Tools (22 个)

| 工具 | 类别 | 功能 |
|------|------|------|
| queryTradeHistory | 数据 | 查询交易记录 |
| getTradeGroupDetail | 数据 | 查询交易组详情 |
| calculateMetrics | 分析 | 计算胜率、盈亏比等指标 |
| findPatternTrades | 分析 | 查找特定模式交易 |
| getRiskAlerts | 风险 | 获取风险提醒 |
| getStockQuote | 行情 | 个股行情 |
| getMarketBreadth | 行情 | 市场宽度 |
| getMacroIndicators | 宏观 | 宏观指标 |
| getLimitPool | 行情 | 涨停/跌停池 |
| getIndexTrends | 行情 | 指数分时走势 |
| getNewsSummary | 新闻 | RSS 新闻摘要 |
| semanticSearch | RAG | 语义搜索 |
| analyzeWithTheory | 理论 | 理论框架分析 |
| analyzeTradePatterns | 分析 | 交易模式识别 |
| generateImprovementPlan | 计划 | 生成改进计划 |
| screenStocks | 选股 | 选股筛选 |
| graphQuery | GraphRAG | 图遍历查询 |
| findRelatedTrades | GraphRAG | 关联交易发现 |
| findPatternPath | GraphRAG | 错误→理论路径 |
| hybridSearch | GraphRAG | 向量+图混合搜索 |
| runStructuredReview | Multi-Agent | 结构化复盘 |
| runTheoryReview | Multi-Agent | 理论引导复盘 |

### 4.2 MCP Server Tools (25 个)

| Server | Tool | 功能 |
|--------|------|------|
| market-data | getAShareQuote | A股个股行情 |
| market-data | getAShareBreadth | 市场宽度 |
| market-data | getIndexTrends | 指数分时 |
| market-data | getLimitPool | 涨停/跌停池 |
| market-data | getHKData | 港股数据 |
| market-data | getUSData | 美股数据 |
| market-data | getMacroIndicators | 宏观指标 |
| market-data | getNewsSummary | 新闻摘要 |
| market-data | getHotList | 热股排行 |
| rag | semanticSearch | 语义搜索 |
| rag | syncTradeGroups | 向量同步 |
| rag | getDocumentCount | 文档统计 |
| rag | hybridSearch | 混合搜索 |
| trade-db | queryTrades | 交易查询 |
| trade-db | getTradeGroups | 交易组查询 |
| trade-db | upsertReviewNote | 复盘笔记 |
| trade-db | getReviewNote | 获取笔记 |
| memory-graph | getMemory | 获取记忆 |
| memory-graph | updateTradingProfile | 更新画像 |
| memory-graph | addImprovementPlan | 添加计划 |
| memory-graph | updateConversationSummary | 更新摘要 |
| memory-graph | graphQuery | 图查询 |
| memory-graph | findRelatedTrades | 关联交易 |
| memory-graph | findPatternPath | 模式路径 |
| memory-graph | getGraphStats | 图统计 |

---

## 五、API 端点

### 5.1 Agent API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/agent/chat` | POST/SSE | Agent 流式对话 |
| `/api/health` | GET | 健康检查 |

### 5.2 Market Data API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/ashare` | GET | A股数据 |
| `/api/hk` | GET | 港股数据 |
| `/api/us` | GET | 美股数据 |
| `/api/hotlist` | GET | 热股排行 |
| `/api/mcp/ashare/trends` | GET | 指数分时 |
| `/api/mcp/ashare/quote` | GET | 个股行情 |
| `/api/mcp/ashare/breadth` | GET | 市场宽度 |
| `/api/mcp/ashare/limit-pool` | GET | 涨停池 |
| `/api/mcp/ashare/indices` | GET | 指数列表 |
| `/api/mcp/news/summary` | GET | 新闻摘要 |
| `/api/mcp/macro/indicators` | GET | 宏观指标 |

### 5.3 RAG API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/mcp/rag/status` | GET | RAG 状态 |
| `/api/mcp/rag/search` | GET | 语义搜索 |
| `/api/mcp/rag/sync` | POST | 向量同步 |

### 5.4 Database API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/db/trades` | GET/POST | 交易 CRUD |
| `/api/db/trade-groups` | GET/POST | 交易组 CRUD |
| `/api/db/review-notes/:id` | GET/PUT | 复盘笔记 CRUD |
| `/api/db/import-batches` | POST | 导入批次 |

### 5.5 Memory API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/memory/:userId` | GET/PUT | 基础记忆 |
| `/api/memory/:userId/profile` | PATCH | 交易画像 |
| `/api/memory/:userId/plans` | POST | 改进计划 |
| `/api/memory/:userId/plans/:id` | PATCH | 更新计划 |
| `/api/memory/:userId/market` | PATCH | 市场分析 |
| `/api/memory/:userId/summary` | PATCH | 对话摘要 |

### 5.6 Enhanced Memory API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/memory-enhanced/:userId` | GET | 增强记忆 |
| `/api/memory-enhanced/:userId/profile` | PATCH | 更新画像 |
| `/api/memory-enhanced/:userId/infer-profile` | POST | 推断画像 |
| `/api/memory-enhanced/:userId/lessons` | POST | 提取教训 |
| `/api/memory-enhanced/:userId/patterns` | POST | 提取模式 |
| `/api/memory-enhanced/:userId/decisions` | POST | 添加决策 |
| `/api/memory-enhanced/:userId/actions` | POST | 添加待办 |
| `/api/memory-enhanced/:userId/actions/:id` | PATCH | 完成待办 |

### 5.7 GraphRAG API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/mcp/graph/sync` | POST | 图同步 |
| `/api/mcp/graph/stats` | GET | 图统计 |
| `/api/mcp/graph/query` | POST | 图查询 |

---

## 六、数据库 Schema

### 6.1 PostgreSQL 表

```sql
-- 交易记录
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  trade_date TEXT NOT NULL,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  side TEXT NOT NULL,  -- buy/sell
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  gross_amount REAL NOT NULL,
  net_amount REAL NOT NULL,
  ...
);

-- 交易组
CREATE TABLE trade_groups (
  id TEXT PRIMARY KEY,
  stock_code TEXT NOT NULL,
  stock_name TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  status TEXT NOT NULL,  -- open/closed
  pnl REAL NOT NULL,
  strategy TEXT,
  mistakes_json TEXT,
  embedding VECTOR(1536),
  ...
);

-- 复盘笔记
CREATE TABLE review_notes (
  id TEXT PRIMARY KEY,
  trade_group_id TEXT REFERENCES trade_groups(id),
  buy_reason TEXT,
  sell_reason TEXT,
  execution_review TEXT,
  lesson TEXT,
  embedding VECTOR(1536),
  ...
);

-- Agent 记忆
CREATE TABLE agent_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  trading_profile_json TEXT NOT NULL,
  improvement_plans_json TEXT NOT NULL,
  market_analysis_json TEXT NOT NULL,
  conversation_summary TEXT,
  last_updated TEXT NOT NULL
);

-- 图节点
CREATE TABLE graph_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 图边
CREATE TABLE graph_edges (
  id SERIAL PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 6.2 Redis 数据结构

```
# 对话历史 — List
agent:conv:{sessionId}:messages → [msg1, msg2, ...]
TTL: 2 小时

# 复盘进度 — Hash
agent:review:{reviewId}:progress → {step: {status, result}}
TTL: 30 分钟

# 工具缓存 — String
agent:cache:{toolName}:{argsHash} → {result}
TTL: 30 秒

# 市场快照 — String
agent:market:snapshot:{date} → {data}
TTL: 当日有效

# 会话管理 — String
agent:session:{sessionId} → {userId, startedAt, lastActivity}
TTL: 2 小时
```

---

## 七、测试覆盖

### 7.1 测试统计

| 模块 | 测试文件 | 测试数 | 状态 |
|------|---------|--------|------|
| 上下文压缩 | contextCompression.test.ts | 16 | ✅ |
| Redis | redis.test.ts | 20 | ✅ |
| Skill 系统 | skills.test.ts | 20 | ✅ |
| Pipeline | pipeline.test.ts | 17 | ✅ |
| GraphRAG | graph.test.ts | 11 | ✅ (4 跳过) |
| Multi-Agent | multi-agent.test.ts | 17 | ✅ |
| DeepAgents | deep-agents.test.ts | 12 | ✅ |
| **总计** | **7** | **113** | **✅** |

### 7.2 测试运行

```bash
# 运行所有测试
npx vitest run

# 运行特定模块
npx vitest run src/agent/
npx vitest run server/redis.test.ts
npx vitest run server/graph/

# 运行单个测试文件
npx vitest run src/agent/contextCompression.test.ts
```

---

## 八、部署架构

### 8.1 开发环境

```
┌─────────────────────────────────────────┐
│              开发机 (localhost)           │
│                                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐ │
│  │  Vite   │  │ Express │  │ NestJS  │ │
│  │  :5173  │  │  :3001  │  │  :3002  │ │
│  └─────────┘  └─────────┘  └─────────┘ │
│                                         │
│  ┌─────────┐  ┌─────────┐              │
│  │PostgreSQL│  │  Redis  │              │
│  │  :5432  │  │  :6379  │              │
│  └─────────┘  └─────────┘              │
└─────────────────────────────────────────┘
```

### 8.2 生产环境

```
┌─────────────────────────────────────────────────────────┐
│                    生产服务器                              │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                 Nginx / Caddy                    │   │
│  │           (反向代理 + 静态文件)                    │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                               │
│         ┌───────────────┼───────────────┐              │
│         ▼               ▼               ▼              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐         │
│  │  前端    │    │  后端    │    │  MCP     │         │
│  │  静态    │    │  API     │    │  Servers │         │
│  └──────────┘    └──────────┘    └──────────┘         │
│                         │                               │
│         ┌───────────────┼───────────────┐              │
│         ▼               ▼               ▼              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐         │
│  │PostgreSQL│    │  Redis   │    │  LLM API │         │
│  │          │    │          │    │ (MiMo/   │         │
│  │          │    │          │    │ Claude)  │         │
│  └──────────┘    └──────────┘    └──────────┘         │
└─────────────────────────────────────────────────────────┘
```

---

## 九、配置文件

### 9.1 环境变量 (.env)

```bash
# PostgreSQL
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=trade_review
PG_USER=postgres
PG_PASSWORD=postgres

# Redis
REDIS_URL=redis://localhost:6379

# LLM API
LLM_API_URL=https://token-plan-cn.xiaomimimo.com/v1
LLM_API_KEY=your-api-key
LLM_MODEL=mimo-v2.5-pro

# Claude (可选)
CLAUDE_API_URL=https://api.anthropic.com
CLAUDE_API_KEY=your-claude-key
CLAUDE_MODEL=claude-sonnet-4-20250514

# OpenAI (可选)
OPENAI_API_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4o

# Gemini (可选)
GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-2.5-flash

# Proxy (可选)
SOCKS_PROXY=socks5://127.0.0.1:10808
```

### 9.2 Claude Desktop MCP 配置

```json
{
  "mcpServers": {
    "trade-review-market-data": {
      "command": "node",
      "args": ["path/to/mcp-servers/market-data/src/index.mjs"]
    },
    "trade-review-rag": {
      "command": "node",
      "args": ["path/to/mcp-servers/rag/src/index.mjs"]
    },
    "trade-review-trade-db": {
      "command": "node",
      "args": ["path/to/mcp-servers/trade-db/src/index.mjs"]
    },
    "trade-review-memory-graph": {
      "command": "node",
      "args": ["path/to/mcp-servers/memory-graph/src/index.mjs"]
    }
  }
}
```

---

## 十、项目统计

### 10.1 文件统计

| 类别 | 文件数 |
|------|--------|
| 源代码 (src/) | 65 |
| 服务端 (server/) | 20 |
| MCP Servers | 9 |
| Nest Server | 12 |
| 测试文件 | 15 |
| 文档 | 5 |
| **总计** | **126** |

### 10.2 代码行数估算

| 模块 | 行数 |
|------|------|
| Agent 核心 | ~2,000 |
| 工具系统 | ~1,500 |
| Multi-Agent | ~1,200 |
| GraphRAG | ~800 |
| Memory 系统 | ~600 |
| MCP Servers | ~1,200 |
| Nest Server | ~800 |
| 测试代码 | ~1,500 |
| **总计** | **~9,600** |

### 10.3 工具统计

| 类别 | 数量 |
|------|------|
| Agent Tools | 22 |
| MCP Server Tools | 25 |
| **总计** | **47** |

---

## 十一、后续优化建议

### 短期 (1-2 周)

- [ ] 完善 MCP Server 的真实数据源集成
- [ ] 添加更多单元测试和集成测试
- [ ] 优化前端 UI 适配新的 Agent 能力
- [ ] 添加错误监控和日志收集

### 中期 (1-2 月)

- [ ] 完成 Nest + LangChain 迁移
- [ ] 添加用户认证和权限系统
- [ ] 实现多用户支持
- [ ] 添加数据导出功能

### 长期 (3-6 月)

- [ ] 实现实时行情推送 (WebSocket)
- [ ] 添加移动端支持
- [ ] 集成更多数据源 (龙虎榜、融资融券等)
- [ ] 实现 AI 自动生成复盘报告

---

## 十二、快速开始

### 12.1 安装依赖

```bash
# 根目录
npm install

# Nest Server (可选)
cd apps/server && npm install

# MCP Servers (可选)
cd mcp-servers/market-data && npm install
cd mcp-servers/rag && npm install
cd mcp-servers/trade-db && npm install
cd mcp-servers/memory-graph && npm install
```

### 12.2 配置环境

```bash
# 复制环境变量模板
cp server/.env.example server/.env

# 编辑配置
vim server/.env
```

### 12.3 初始化数据库

```bash
# 启动 PostgreSQL
# 启动 Redis

# 启动后端 (自动初始化数据库)
cd server && npx tsx index.ts
```

### 12.4 启动前端

```bash
npm run dev
```

### 12.5 运行测试

```bash
npm test
```

---

*文档完成。如有问题请提交 Issue。*
