# Wax Wane 架构评审：MCP / Multi-Agent / Memory 规划

> 评审日期：2026-06-01
> 项目：Wax Wane — A 股交易纪律分析平台
> 技术栈：React 19 + TypeScript + Express + PostgreSQL + pgvector

---

## 一、项目现状

### 当前架构

```
前端 (React 19) ──→ Express 后端 ──→ PostgreSQL + pgvector
     │                    │
     │                    ├── LLM Agent (16 tools, SSE streaming)
     │                    ├── RAG 向量搜索 (vectra / pgvector)
     │                    ├── 知识库 (Wyckoff / Dow / PriceAction / A股)
     │                    └── 市场数据 (A股 / 港股 / 美股 / 宏观 / 新闻)
     │
     └── Agent Chat UI (ChatPanel + ToolCallCard)
```

### 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| Agent Loop | `src/agent/agentLoop.ts` | 单 Agent 循环，最多 10 轮迭代 |
| Tool Registry | `src/agent/tools/index.ts` | 注册 16 个工具函数 |
| System Prompt | `src/agent/prompts.ts` | 复盘流程、理论分析、K线识别 |
| LLM Client | `src/agent/llmClient.ts` | SSE streaming，支持 OpenAI / Anthropic / MiMo |
| 后端入口 | `server/index.ts` | Express 路由、LLM 代理、MCP 风格 API |
| Memory Store | `server/memoryStore.ts` | 用户画像、改进计划、市场分析、对话摘要 |
| 向量搜索 | `server/vectorStore.ts` | RAG 语义搜索 |
| 知识库 | `server/knowledge/` | Wyckoff / Dow Theory / Price Action / A股板学 |

### 现有 Agent Tools（16 个）

| Tool | 用途 |
|------|------|
| `queryTradeHistory` | 查询交易记录 |
| `getTradeGroupDetail` | 查询交易组详情 |
| `calculateMetrics` | 计算胜率、盈亏比等指标 |
| `findPatternTrades` | 查找特定模式交易 |
| `getRiskAlerts` | 获取风险提醒 |
| `getStockQuote` | 个股行情 |
| `getMarketBreadth` | 市场宽度（涨跌家数） |
| `getMacroIndicators` | 宏观指标 |
| `getLimitPool` | 涨停/跌停池 |
| `getIndexTrends` | 指数分时走势 |
| `getNewsSummary` | RSS 新闻摘要 |
| `semanticSearch` | RAG 语义搜索 |
| `analyzeWithTheory` | 理论框架分析 |
| `analyzeTradePatterns` | 交易模式识别 |
| `generateImprovementPlan` | 生成改进计划 |
| `screenStocks` | 选股 |

---

## 二、MCP Server 拆分方案

### 什么是 MCP

MCP (Model Context Protocol) 是 Anthropic 推出的标准化协议，将工具能力封装为独立 Server，任何 MCP Client（Claude Desktop、Cursor、自定义 Agent）都能调用。

### 拆分原则

1. **无状态优先**：数据获取类 API 天然适合 MCP
2. **独立职责**：每个 MCP Server 只负责一个领域
3. **复用现有代码**：当前 `/api/mcp/*` 路由可直接迁移

### 2.1 市场数据 MCP Server（🔴 高优先级）

```
market-data-mcp-server/
├── src/
│   ├── index.ts              # MCP Server 入口
│   ├── tools/
│   │   ├── getAShareQuote.ts       # 个股行情
│   │   ├── getAShareBreadth.ts     # 市场宽度
│   │   ├── getIndexTrends.ts       # 指数分时
│   │   ├── getLimitPool.ts         # 涨停/跌停池
│   │   ├── getHKData.ts            # 港股数据
│   │   ├── getUSData.ts            # 美股数据
│   │   ├── getMacroIndicators.ts   # 宏观指标
│   │   ├── getNewsSummary.ts       # RSS 新闻
│   │   └── getHotList.ts           # 热股排行
│   └── resources/
│       └── marketSnapshot.ts       # 当日市场快照资源
├── package.json
└── mcp.json                        # MCP Server 声明
```

**迁移来源**：
- `server/ashare.ts` → A股数据
- `server/hk.ts` → 港股数据
- `server/us.ts` → 美股数据
- `server/macro.ts` → 宏观数据
- `server/news.ts` → 新闻数据
- `server/hotlist.ts` → 热股排行

**理由**：这些数据源无状态、可复用，做成 MCP 后可被任何 Agent 框架调用。

### 2.2 RAG 向量搜索 MCP Server（🔴 高优先级）

```
rag-mcp-server/
├── src/
│   ├── index.ts
│   ├── tools/
│   │   ├── semanticSearch.ts       # 语义搜索交易历史
│   │   ├── syncTradeGroups.ts      # 同步交易数据到向量库
│   │   └── getDocumentCount.ts     # 文档统计
│   └── resources/
│       └── ragStatus.ts            # RAG 状态资源
├── package.json
└── mcp.json
```

**迁移来源**：
- `server/vectorStore.ts` → 向量存储
- `server/ragSync.ts` → 同步逻辑
- `server/embedding.ts` → 嵌入服务

**理由**：RAG 是独立能力，做成 MCP 后任何 Agent 都能搜索交易经验库。

### 2.3 交易数据库 MCP Server（🟡 中优先级）

```
trade-database-mcp-server/
├── src/
│   ├── index.ts
│   ├── tools/
│   │   ├── queryTrades.ts          # 查询交易记录
│   │   ├── getTradeGroups.ts       # 查询交易组
│   │   ├── upsertReviewNote.ts     # 写入复盘笔记
│   │   └── getReviewNote.ts        # 读取复盘笔记
│   └── resources/
│       ├── trades.ts               # 交易数据表资源
│       └── tradeGroups.ts          # 交易组表资源
├── package.json
└── mcp.json
```

**迁移来源**：
- `server/pgDatabase.ts` → 数据库操作

### 2.4 Agent Memory MCP Server（🟡 中优先级）

```
memory-mcp-server/
├── src/
│   ├── index.ts
│   ├── tools/
│   │   ├── getMemory.ts            # 获取用户记忆
│   │   ├── updateTradingProfile.ts # 更新交易画像
│   │   ├── addImprovementPlan.ts   # 添加改进计划
│   │   └── updateConversationSummary.ts  # 更新对话摘要
│   └── resources/
│       └── userMemory.ts           # 用户记忆资源
├── package.json
└── mcp.json
```

**迁移来源**：
- `server/memoryStore.ts` → Memory 存储

**理由**：做成 MCP 后可跨 Agent 共享用户画像。

### 2.5 知识库 MCP Server（🟢 低优先级）

```
knowledge-mcp-server/
├── src/
│   ├── index.ts
│   ├── tools/
│   │   ├── analyzeWithTheory.ts        # 理论分析
│   │   ├── analyzeTradePatterns.ts     # 交易模式识别
│   │   └── generateImprovementPlan.ts  # 生成改进计划
│   └── resources/
│       ├── wyckoff.ts                  # Wyckoff 理论
│       ├── dowTheory.ts                # 道氏理论
│       ├── priceAction.ts              # 价格行为
│       └── ashareBoard.ts              # A股板学
├── package.json
└── mcp.json
```

**迁移来源**：
- `server/knowledge/` → 知识库
- `src/agent/tools/analyzeWithTheory.ts` → 理论分析工具
- `src/agent/tools/analyzeTradePatterns.ts` → 模式识别工具
- `src/agent/tools/generateImprovementPlan.ts` → 改进计划工具

### MCP Server 总览

```
┌─────────────────────────────────────────────────────┐
│                   MCP Clients                       │
│  Claude Desktop / Cursor / 前端 Agent / 其他框架     │
└──────┬──────────┬──────────┬──────────┬─────────────┘
       │          │          │          │
┌──────▼───┐ ┌───▼────┐ ┌───▼────┐ ┌───▼──────┐
│ Market   │ │ RAG    │ │ Trade  │ │ Memory   │
│ Data MCP │ │ MCP    │ │ DB MCP │ │ MCP      │
│          │ │        │ │        │ │          │
│ 9 tools  │ │ 3 tools│ │ 4 tools│ │ 4 tools  │
└──────────┘ └────────┘ └────────┘ └──────────┘
┌──────────┐
│Knowledge │
│ MCP      │
│          │
│ 3 tools  │
└──────────┘
```

---

## 三、Multi-Agent 拆分方案

### 当前问题

当前是**单 Agent + 16 tools**架构，存在以下问题：

1. **复盘流程容易跳步**：`prompts.ts` 定义了 5 步复盘流程，单 Agent 可能遗漏步骤
2. **理论分析不够深入**：需要同时运用 4 种理论框架，单 Agent 难以深入
3. **工具选择困难**：16 个工具太多，单 Agent 选择准确率下降
4. **上下文窗口压力**：所有工具 schema + 知识库 + 交易数据塞进一个 prompt

### 3.1 复盘流程 Agent（🔴 高优先级）

**场景**：用户发送"复盘"、"一键复盘"、"review"等指令

**当前实现**：`prompts.ts` 第 127-213 行，单 Agent 按序调用 5 个步骤

**问题**：单 Agent 容易跳步、上下文膨胀、无法并行

**方案**：Orchestrator + 5 个专用子 Agent

```
┌──────────────────┐
│   Orchestrator   │  ← 接收"复盘"指令，协调流程
│   Agent          │
└────────┬─────────┘
         │ 顺序调用（前一个输出作为下一个输入）
         ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Macro    │→│ News     │→│ Market   │→│ Sector   │→│ Trade    │
│ Analyst  │  │ Analyst  │  │ Analyst  │  │ Analyst  │  │ Reviewer │
│ Agent    │  │ Agent    │  │ Agent    │  │ Agent    │  │ Agent    │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
  Tools:        Tools:        Tools:        Tools:        Tools:
  getMacro      getNews       getBreadth    getLimitPool  queryTrades
  Indicators    Summary       getIndex      + 板块分析    + 结合上下文
                               Trends                      分析
```

**每个子 Agent 的职责**：

| Agent | 输入 | 输出 | 专用 Tools |
|-------|------|------|-----------|
| Macro Analyst | 无 | 宏观面小结 | `getMacroIndicators` |
| News Analyst | 无 | 消息面小结 | `getNewsSummary` |
| Market Analyst | 无 | 大盘小结 | `getMarketBreadth`, `getIndexTrends` |
| Sector Analyst | 无 | 板块小结 | `getLimitPool` |
| Trade Reviewer | 前 4 个 Agent 的输出 | 交易复盘小结 + 改进建议 | `queryTradeHistory`, `calculateMetrics` |

**Orchestrator 逻辑**：
1. 解析用户意图（是否包含"复盘"关键词）
2. 按顺序调用 5 个子 Agent
3. 将每个 Agent 的输出追加到 Context
4. 最终整合为结构化复盘报告

### 3.2 理论引导复盘 Agent（🔴 高优先级）

**场景**：用户发送"帮我复盘"、"用理论分析"等指令

**当前实现**：`prompts.ts` 第 216-296 行

**方案**：Orchestrator + 4 个理论 Agent + 1 个综合 Agent

```
┌──────────────────┐
│   Orchestrator   │
└────────┬─────────┘
         │ 并行调用
         ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Wyckoff  │ │ Dow      │ │ Al Brooks│ │ A股情绪  │
│ Agent    │ │ Agent    │ │ Agent    │ │ Agent    │
└────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
     │            │            │            │
     └────────────┴────────────┴────────────┘
                        │
                 ┌──────▼──────┐
                 │ Synthesizer │  ← 综合 4 个视角，生成报告
                 │ Agent       │
                 └─────────────┘
```

**每个理论 Agent 的职责**：

| Agent | 理论框架 | 分析内容 | 关联 Tools |
|-------|---------|---------|-----------|
| Wyckoff Agent | 量价理论 | 吸筹/派发阶段判断 | `getIndexTrends`, `getMarketBreadth` |
| Dow Agent | 道氏理论 | 趋势方向判断 | `getIndexTrends` |
| Al Brooks Agent | 价格行为 | K线形态、支撑阻力 | `getIndexTrends` |
| A股情绪 Agent | 情绪周期 | 冰点/修复/高潮/退潮 | `getLimitPool`, `getMarketBreadth` |

### 3.3 数据获取 + 分析分离（🟡 中优先级）

**当前**：Agent 调用 tool → 获取数据 → 自己分析 → 回复

**改进**：Data Agent → 获取并清洗数据 → Analysis Agent → 分析推理 → 回复

```
用户问题
    │
    ▼
┌──────────────┐
│ Router Agent │  ← 判断需要哪些数据
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Data Agent   │  ← 调用 tools 获取数据，清洗格式
└──────┬───────┘
       │ 传递结构化数据
       ▼
┌──────────────┐
│ Analysis     │  ← 纯推理，不需要调用工具
│ Agent        │
└──────────────┘
```

**理由**：
- Data Agent 专注于数据完整性、格式正确性
- Analysis Agent 专注于推理和洞察，上下文更干净
- 分离关注点，各自优化

### 3.4 交易模式识别 Agent（🟡 中优先级）

**场景**：分析用户交易中的行为模式

**方案**：多策略并行检测

```
┌──────────────────┐
│ Pattern          │
│ Coordinator      │
└────────┬─────────┘
         │ 并行调用
         ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ 追高检测 │ │ 扛单检测 │ │ 频繁交易 │ │ 过早止盈 │
│ Agent    │ │ Agent    │ │ Agent    │ │ Agent    │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

### 3.5 日报/周报生成 Agent（🟢 低优先级）

**场景**：定时生成交易报告

```
Scheduler Agent → 每日 15:00 触发
    → Market Snapshot Agent (获取当日数据)
    → Trade Review Agent (复盘当日交易)
    → Report Agent (生成报告)
    → 保存到 Memory / 推送通知
```

---

## 四、Multi-Agent 通信方案

### 方案 1: 共享上下文管道（✅ 推荐 — 最简单）

```
Orchestrator 维护一个 Context 对象:

interface PipelineContext {
  macroAnalysis?: string
  newsAnalysis?: string
  marketAnalysis?: string
  sectorAnalysis?: string
  tradeReview?: string
  finalReport?: string
}

每个 Agent:
  输入: Context + 自己的 prompt
  输出: 更新 Context 的对应字段
```

**优点**：简单、可调试、无额外依赖
**缺点**：只适合顺序执行
**适用场景**：复盘流程（宏观 → 新闻 → 大盘 → 板块 → 交易）

### 方案 2: 消息总线（Event-Driven）

```
Agent A ──emit("analysis:macro", data)──→ EventBus
                                              │
Agent B ──on("analysis:macro")───────────────→ 收到数据，开始工作
                                              │
Agent C ──on("analysis:news")────────────────→ 收到数据，开始工作
```

**实现方式**：
- 简单版：Node.js EventEmitter
- 生产版：Redis Pub/Sub 或 RabbitMQ

**优点**：支持并行执行、动态触发、松耦合
**缺点**：调试困难、需要额外基础设施
**适用场景**：理论分析（4 个理论 Agent 并行）

### 方案 3: Tool Call 委托（✅ 推荐 — 最自然）

Orchestrator Agent 通过 tool call 调用子 Agent：

```typescript
// Orchestrator 的 tools 中定义:
{
  name: "analyzeMacro",
  description: "调用宏观分析师获取宏观面分析",
  parameters: { context: "当前市场上下文" }
}

// 执行时:
async function analyzeMacro(args, state) {
  const subAgent = new MacroAnalystAgent()
  return await subAgent.run({
    tools: [getMacroIndicators],
    systemPrompt: "你是宏观分析师...",
    userMessage: args.context
  })
}
```

**优点**：对 LLM 最自然，当前架构最容易改造
**缺点**：子 Agent 的 token 消耗较大
**适用场景**：所有场景，尤其是当前项目（已有 tool call 机制）

### 方案 4: 共享 Memory（长期协作）

```
Agent A ──write("macroPhase", "easing")──→ Shared Memory Store
Agent B ──read("macroPhase")─────────────→ "easing"
Agent C ──read("macroPhase")─────────────→ "easing"
```

**实现方式**：扩展现有 `memoryStore.ts`

**优点**：支持跨会话、跨 Agent 共享状态
**缺点**：不适合实时通信
**适用场景**：用户画像、交易经验、长期目标

### 推荐的混合方案

```
┌─────────────────────────────────────────────────────┐
│                    Orchestrator Agent                │
│  接收用户指令 → 决定调用哪些子 Agent → 整合结果       │
└──────────┬──────────────────────────────┬───────────┘
           │ Tool Call 委托                │ 共享 Memory
           ▼                               ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Macro Agent  │  │ Market Agent │  │ Review Agent │
│ (专用 tools) │  │ (专用 tools) │  │ (专用 tools) │
└──────────────┘  └──────────────┘  └──────────────┘
           │                │                │
           └────────────────┴────────────────┘
                            │
                     共享 Context Pipeline
                     (macro → news → market → sector → trade)
```

---

## 五、Memory 系统增强方案

### 当前实现

`server/memoryStore.ts` 已实现：

```typescript
interface AgentMemory {
  tradingProfile: {
    commonMistakes: string[]
    tradingStyle: string
    strengths: string[]
    weaknesses: string[]
    theoryGaps: string[]
  }
  improvementPlans: Array<{...}>
  marketAnalysis: {
    wyckoffPhase: string
    dowTrend: string
    sentimentPhase: string
  }
  conversationSummary: string
}
```

### 5.1 增强交易画像 Memory（🔴 高优先级）

```typescript
interface EnhancedTradingProfile {
  // ── 当前已有 ──
  commonMistakes: string[]
  tradingStyle: string
  strengths: string[]
  weaknesses: string[]
  theoryGaps: string[]

  // ── 建议新增 ──
  preferredSectors: string[]           // 偏好板块（如半导体、新能源）
  avgHoldingDays: number               // 平均持仓天数
  riskTolerance: 'low' | 'mid' | 'high'  // 风险偏好
  bestPerformingStrategy: string       // 最赚钱的策略
  worstPerformingStrategy: string      // 最亏钱的策略
  emotionalPatterns: {
    fomoTriggers: string[]             // 追高触发条件（如"看到涨停板"）
    panicTriggers: string[]            // 恐慌卖出触发（如"大盘暴跌"）
  }
  tradingFrequency: {
    avgTradesPerWeek: number
    highFrequencyPeriods: string[]     // 高频交易的时段
  }
}
```

### 5.2 增强对话 Memory（🔴 高优先级）

```typescript
interface ConversationMemory {
  summary: string                      // 当前已有
  keyDecisions: Array<{                // 关键决策记录
    date: string
    decision: string                   // "决定减仓茅台"
    reasoning: string                  // "道氏理论显示趋势反转"
    outcome?: string                   // "事后证明正确，避免了5%亏损"
  }>
  openQuestions: string[]              // 未解决的问题
  actionItems: Array<{                 // 待办事项
    task: string
    deadline?: string
    status: 'pending' | 'done'
  }>
}
```

### 5.3 增强市场环境 Memory（🟡 中优先级）

```typescript
interface MarketMemory {
  current: {
    wyckoffPhase: string
    dowTrend: string
    sentimentPhase: string
  }
  history: Array<{                     // 历史判断记录
    date: string
    wyckoffPhase: string
    dowTrend: string
    sentimentPhase: string
    accuracy?: string                  // 事后验证准确性
  }>
  regimeChanges: Array<{               // 市场体制变化
    date: string
    from: string                       // "震荡市"
    to: string                         // "趋势市"
    trigger: string                    // "政策利好"
  }>
}
```

### 5.4 交易经验 Memory（🟡 中优先级）

```typescript
interface TradeExperienceMemory {
  lessons: Array<{
    id: string
    date: string
    tradeGroupId: string
    lesson: string                     // "不要在情绪高涨时追板"
    category: 'entry' | 'exit' | 'position_sizing' | 'timing'
    theory: string                     // 关联的理论框架
    timesRecalled: number              // 被召回次数（越多次越重要）
  }>
  patterns: Array<{
    pattern: string                    // "追高后第二天低开"
    frequency: number                  // 出现次数
    avgLoss: number                    // 平均亏损
    preventionRule: string             // "开盘前设好止损位"
  }>
  successPatterns: Array<{             // 成功模式
    pattern: string                    // "首板涨停次日低吸"
    frequency: number
    avgGain: number
    conditions: string[]               // 触发条件
  }>
}
```

### 5.5 Agent 自身 Memory（🟢 低优先级）

```typescript
interface AgentSelfMemory {
  toolUsageStats: Record<string, {     // 工具使用统计
    callCount: number
    avgLatency: number
    errorRate: number
    lastUsed: string
  }>
  userPreferences: {                   // 用户偏好
    preferredLanguage: 'zh' | 'en'
    detailLevel: 'brief' | 'normal' | 'detailed'
    reportFormat: 'table' | 'narrative' | 'mixed'
  }
  effectivePrompts: string[]           // 有效的 prompt 模板
}
```

### 5.6 跨会话 Memory（🟢 低优先级）

```typescript
interface CrossSessionMemory {
  sessionSummaries: Array<{
    date: string
    duration: number                   // 会话时长（分钟）
    topics: string[]                   // 讨论主题
    keyInsights: string[]              // 关键洞察
  }>
  longTermGoals: Array<{               // 长期目标
    goal: string                       // "将胜率从 40% 提升到 60%"
    startDate: string
    targetDate?: string
    progress: number                   // 0-100
    milestones: string[]               // 里程碑
  }>
  skillProgress: Record<string, {      // 技能进步
    level: 'beginner' | 'intermediate' | 'advanced'
    lastAssessed: string
    evidence: string[]                 // 证据
  }>
}
```

### Memory 架构总览

```
┌─────────────────────────────────────────────────────┐
│                   Memory Router                      │
│  根据查询类型路由到不同的 Memory Store                 │
└──────┬──────────────┬──────────────┬────────────────┘
       │              │              │
┌──────▼──────┐ ┌─────▼──────┐ ┌────▼─────────┐
│ Short-term  │ │ Long-term  │ │ Episodic     │
│ Memory      │ │ Memory     │ │ Memory       │
│             │ │            │ │              │
│ 当前会话    │ │ 交易画像   │ │ 具体交易     │
│ 对话上下文  │ │ 长期目标   │ │ 经验教训     │
│ 临时状态    │ │ 技能进度   │ │ 模式记忆     │
│             │ │            │ │              │
│ 存储：内存  │ │ 存储：PG   │ │ 存储：PG +   │
│             │ │            │ │ Vector       │
└─────────────┘ └────────────┘ └──────────────┘
```

### Memory 与 RAG 联动

```
交易完成
    │
    ▼
┌──────────────┐
│ 自动提取     │  ← 从复盘笔记中提取经验
│ 经验教训     │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 存入 Memory  │  ← Episodic Memory
│ + RAG 向量库 │  ← 同步到向量库供语义搜索
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ 用户提问时   │  ← semanticSearch 检索相关经验
│ 自动召回     │  ← Memory 提供用户画像上下文
└──────────────┘
```

---

## 六、实施路径

### Phase 1: MCP Server 化（1-2 周）

| 步骤 | 任务 | 优先级 | 预估工时 |
|------|------|--------|---------|
| 1.1 | 创建 MCP Server 项目脚手架 | 🔴 | 0.5d |
| 1.2 | 迁移市场数据到 MCP Server | 🔴 | 2d |
| 1.3 | 迁移 RAG 搜索到 MCP Server | 🔴 | 1.5d |
| 1.4 | 迁移交易数据库到 MCP Server | 🟡 | 1d |
| 1.5 | 迁移 Memory 到 MCP Server | 🟡 | 1d |
| 1.6 | 迁移知识库到 MCP Server | 🟢 | 1d |
| 1.7 | 前端适配 MCP Client | 🔴 | 1d |
| 1.8 | 测试：Claude Desktop / Cursor 连接 | 🔴 | 0.5d |

**验收标准**：
- [ ] Claude Desktop 能通过 MCP 调用市场数据
- [ ] Cursor 能通过 MCP 搜索交易经验
- [ ] 前端 Agent 功能不受影响

### Phase 2: Multi-Agent 拆分（2-3 周）

| 步骤 | 任务 | 优先级 | 预估工时 |
|------|------|--------|---------|
| 2.1 | 实现 Orchestrator Agent 框架 | 🔴 | 2d |
| 2.2 | 实现 5 个复盘子 Agent | 🔴 | 3d |
| 2.3 | 实现 Context Pipeline 通信 | 🔴 | 1d |
| 2.4 | 实现 4 个理论分析 Agent | 🔴 | 2d |
| 2.5 | 实现 Synthesizer Agent | 🟡 | 1d |
| 2.6 | 实现 Data Agent + Analysis Agent 分离 | 🟡 | 2d |
| 2.7 | 测试：一键复盘功能 | 🔴 | 1d |
| 2.8 | 测试：理论引导复盘 | 🔴 | 1d |

**验收标准**：
- [ ] "复盘" 指令触发完整的 5 步流程，不跳步
- [ ] 4 个理论 Agent 能并行分析，综合报告质量高于单 Agent
- [ ] 子 Agent 失败时 Orchestrator 能优雅降级

### Phase 3: Memory 增强（1-2 周）

| 步骤 | 任务 | 优先级 | 预估工时 |
|------|------|--------|---------|
| 3.1 | 增强交易画像字段 | 🔴 | 1d |
| 3.2 | 增强对话 Memory（决策、待办） | 🔴 | 1d |
| 3.3 | 增强市场环境 Memory（历史记录） | 🟡 | 1d |
| 3.4 | 实现交易经验 Memory | 🟡 | 1.5d |
| 3.5 | 实现 Memory 与 RAG 联动 | 🟡 | 1d |
| 3.6 | 实现跨会话 Memory | 🟢 | 1d |
| 3.7 | 测试：Memory 跨会话持久化 | 🔴 | 0.5d |

**验收标准**：
- [ ] 用户画像在新会话中自动加载
- [ ] 交易经验能被 semanticSearch 检索
- [ ] 市场判断历史能事后验证准确性

---

## 七、风险与注意事项

### 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| MCP Server 增加延迟 | 用户体验下降 | 本地 MCP Server，网络开销最小 |
| Multi-Agent token 消耗增加 | 成本上升 | 缓存子 Agent 结果，避免重复调用 |
| 子 Agent 失败级联 | 复盘中断 | Orchestrator 实现 fallback 逻辑 |
| Memory 数据量增长 | 查询变慢 | 定期归档，分层存储 |

### 架构决策

| 决策点 | 推荐方案 | 理由 |
|--------|---------|------|
| MCP Server 部署 | 本地进程 | 减少延迟，简化部署 |
| Agent 通信 | Tool Call + Context Pipeline | 最自然，最容易改造 |
| Memory 存储 | PostgreSQL（已有） | 复用现有基础设施 |
| 向量搜索 | pgvector（已有） | 复用现有基础设施 |

---

## 八、总结

### 核心价值

1. **MCP Server 化**：让工具能力标准化、可复用，接入任何 AI 客户端
2. **Multi-Agent**：让复杂流程可拆分、可并行、可容错
3. **Memory 增强**：让 Agent 真正"认识"用户，提供个性化分析

### 优先级排序

```
Phase 1 (MCP)        Phase 2 (Multi-Agent)   Phase 3 (Memory)
┌──────────────┐     ┌──────────────┐        ┌──────────────┐
│ 市场数据 MCP │     │ 复盘流程     │        │ 交易画像增强 │
│ RAG MCP      │     │ 理论分析     │        │ 对话 Memory  │
│ 前端适配     │     │ Orchestrator │        │ 经验 Memory  │
└──────────────┘     └──────────────┘        └──────────────┘
   1-2 周                2-3 周                  1-2 周
```

### 预期收益

- **MCP**：可在 Claude Desktop / Cursor 中直接调用你的市场数据和交易经验库
- **Multi-Agent**：复盘报告质量提升，不跳步、不遗漏，理论分析更深入
- **Memory**：Agent 真正理解你的交易习惯，每次对话都有积累

---

*文档结束。请 review 后反馈意见。*
