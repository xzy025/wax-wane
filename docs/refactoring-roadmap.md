# TradeReview 重构路线图

> 最后更新：2026-06-01
> 总工时：~74d（约 3.5 个月）
> 并行优化后：~3 个月

---

## 总览

```
Phase 1  基础架构升级（2-3 周）
  ├── P1-1  上下文压缩              2d   🔴
  ├── P1-2  Redis 短期记忆           2d   🔴
  ├── P1-3  Skill 标准化             3d   🔴
  └── P1-4  Middleware 管道           3d   🔴

Phase 2  RAG 升级（2 周）
  ├── P2-1  GraphRAG 图结构搭建      3d   🔴
  ├── P2-2  图构建自动化             3d   🔴
  └── P2-3  GraphRAG 查询 + 新 Tools 4d   🔴

Phase 3  后端重构（2.5 周）
  ├── P3-1  Nest + LangChain 脚手架  3d   🔴
  ├── P3-2  SSE 流式接口迁移         2d   🔴
  ├── P3-3  工具迁移 (16 个)         4d   🔴
  ├── P3-4  Redis 集成到 Nest        2d   🟡
  └── P3-5  数据库迁移 (TypeORM/Prisma) 3d 🟡

Phase 4  MCP Server 化（2 周）
  ├── P4-1  市场数据 MCP Server      3d   🔴
  ├── P4-2  RAG MCP Server           3d   🔴
  ├── P4-3  交易数据库 MCP Server    2d   🟡
  └── P4-4  Memory MCP Server        2d   🟡

Phase 5  Multi-Agent（2-3 周）
  ├── P5-1  Orchestrator + 复盘子 Agent  4d  🔴
  ├── P5-2  理论分析 Agent (4 个)        3d  🔴
  ├── P5-3  Context Pipeline 通信        2d  🔴
  └── P5-4  Data / Analysis Agent 分离   3d  🟡

Phase 6  Memory 增强（1-2 周）
  ├── P6-1  交易画像增强             2d   🔴
  ├── P6-2  对话 Memory 增强         2d   🔴
  ├── P6-3  交易经验 Memory          2d   🟡
  └── P6-4  Memory 与 RAG 联动       2d   🟡

Phase 7  DeepAgents 集成（2 周）
  ├── P7-1  最小集成 demo            2d   🟡
  ├── P7-2  替换 agentLoop.ts        3d   🟡
  ├── P7-3  启用内置能力             3d   🟡
  └── P7-4  Redis checkpointer       2d   🟢
```

---

## 依赖关系

```
Phase 1 (基础)          Phase 2 (RAG)
  上下文压缩              GraphRAG
  Redis 短期记忆            │
  Skill 标准化              │
  Middleware 管道            │
       │                    │
       ▼                    ▼
Phase 3 (后端重构)  ←─────┘
  Nest + LangChain
  SSE 流式迁移
  工具迁移
       │
       ├──────────────────┐
       ▼                  ▼
Phase 4 (MCP)      Phase 5 (Multi-Agent)
  市场数据 MCP        Orchestrator
  RAG MCP             复盘子 Agent
  交易 DB MCP         理论分析 Agent
  Memory MCP          Context Pipeline
       │                  │
       └────────┬─────────┘
                ▼
         Phase 6 (Memory 增强)
           交易画像增强
           对话 Memory
           交易经验 Memory
                │
                ▼
         Phase 7 (DeepAgents)
           最小集成
           替换 agentLoop
           启用内置能力
```

---

## Phase 1: 基础架构升级（2-3 周）

### P1-1 上下文压缩（2d）

**目标**：token 消耗减少 60%

**实现**：
- 分层压缩策略：系统 prompt + 摘要 + 最近 N 条 + 当前任务
- Tool result 压缩：大结果提取关键字段
- 滑动窗口：只保留最近 6 条消息

**关键文件**：`src/agent/agentLoop.ts`

**验收标准**：
- [ ] 对话 token 消耗减少 50%+
- [ ] Agent 回答质量不下降

### P1-2 Redis 短期记忆（2d）

**目标**：会话级状态管理

**实现**：
- 对话历史存储（TTL 2h）
- 复盘进度存储（TTL 30min）
- 工具结果缓存（TTL 30s）
- 市场数据快照缓存

**关键文件**：新建 `server/redis.ts`，改造 `server/memoryStore.ts`

**验收标准**：
- [ ] 对话历史在页面刷新后保持
- [ ] 市场数据 30 秒内重复调用走缓存

### P1-3 Skill 标准化（3d）

**目标**：复盘流程不跳步

**实现**：
- 定义 Skill 接口（id, trigger, steps, tools）
- 实现 Skill Router（关键词匹配）
- 注册结构化复盘 Skill（5 步）
- 注册理论引导复盘 Skill（4 步）

**关键文件**：新建 `src/agent/skills/` 目录

**验收标准**：
- [ ] "复盘" 触发 structured-review Skill
- [ ] 5 步全部执行，不跳步
- [ ] 无 Skill 匹配时走通用 Agent

### P1-4 Middleware 管道（3d）

**目标**：代码解耦、可测试

**实现**：
- AgentMiddleware 接口（before/after/onToolCall/onError）
- 6 个 Middleware：auth, compression, cache, memory, logging, rateLimit
- Pipeline 执行引擎

**关键文件**：新建 `src/agent/pipeline/` 目录

**验收标准**：
- [ ] Middleware 按 order 顺序执行
- [ ] 每个 Middleware 可独立测试
- [ ] 工具缓存命中时跳过执行

---

## Phase 2: RAG 升级为 GraphRAG（2 周）

### P2-1 图结构搭建（3d）

**目标**：PG 邻接表实现图存储

**实现**：
- graph_nodes 表（id, type, properties, embedding）
- graph_edges 表（source_id, target_id, type, properties）
- 实体类型：TradeGroup, Stock, Sector, Mistake, Strategy, Theory, MarketPhase, Lesson
- 关系类型：BELONGS_TO, HAS_MISTAKE, USED_STRATEGY, OCCURRED_DURING, GENERATED, VIOLATES

**关键文件**：新建 `server/graph/` 目录

**验收标准**：
- [ ] 图表结构创建成功
- [ ] 基础 CRUD API 可用

### P2-2 图构建自动化（3d）

**目标**：数据变更自动同步到图

**实现**：
- 交易导入时自动创建 TradeGroup → Stock → Sector
- 复盘时自动创建 Mistake → Theory → Lesson
- 市场数据更新时创建 MarketPhase
- 复用现有 useRagSync 的触发机制

**关键文件**：新建 `server/graph/graphSync.ts`

**验收标准**：
- [ ] 交易导入后图自动更新
- [ ] 复盘后图自动更新

### P2-3 GraphRAG 查询 + 新 Tools（4d）

**目标**：图 + 向量混合查询

**实现**：
- hybridSearch（向量搜索 + 图遍历）
- 多跳推理查询（Cypher 风格）
- 新增 Agent Tools：graphQuery, findRelatedTrades, findPatternPath
- 更新 System Prompt

**关键文件**：`server/graph/graphQuery.ts`，`src/agent/tools/`

**验收标准**：
- [ ] "追高交易发生在什么市场阶段？" 能回答
- [ ] 新 Tools 在 Agent 中正常调用

---

## Phase 3: Nest + LangChain 后端重构（2.5 周）

### P3-1 Nest 项目脚手架（3d）

**目标**：模块化项目结构

**实现**：
- NestJS 项目初始化
- 模块划分：agent, market-data, rag, database, memory
- 依赖注入配置
- 环境变量管理

**关键文件**：新建 `apps/server/` 目录

**验收标准**：
- [ ] Nest 项目可启动
- [ ] 模块结构清晰

### P3-2 SSE 流式接口迁移（2d）

**目标**：替换手写 SSE

**实现**：
- @Sse() 装饰器 + Observable
- LangGraph stream 原生支持
- 删除 toAnthropicRequest / toOpenAIRequest / anthropicToOpenAIStream

**关键文件**：`apps/server/src/agent/agent.controller.ts`

**验收标准**：
- [ ] SSE 流式接口功能完全兼容
- [ ] 多模型切换正常

### P3-3 工具迁移（4d）

**目标**：16 个工具转成 LangChain 格式

**实现**：
- DynamicStructuredTool 封装
- zod schema 定义
- 闭包捕获 state

**关键文件**：`apps/server/src/agent/tools/`

**验收标准**：
- [ ] 所有 16 个工具正常工作
- [ ] 工具结果格式兼容

### P3-4 Redis 集成到 Nest（2d）

**目标**：Redis 服务化

**实现**：
- @nestjs-modules/ioredis
- RedisService 封装

**关键文件**：`apps/server/src/redis/`

### P3-5 数据库迁移（3d）

**目标**：ORM 化

**实现**：
- TypeORM 或 Prisma 替换手写 SQL
- Entity 定义
- Migration 脚本

**关键文件**：`apps/server/src/database/`

---

## Phase 4: MCP Server 化（2 周）

### P4-1 市场数据 MCP Server（3d）

**实现**：9 个 tools（getAShareQuote, getAShareBreadth, getIndexTrends, getLimitPool, getHKData, getUSData, getMacroIndicators, getNewsSummary, getHotList）

### P4-2 RAG MCP Server（3d）

**实现**：3 个 tools（semanticSearch, syncTradeGroups, getDocumentCount）

### P4-3 交易数据库 MCP Server（2d）

**实现**：4 个 tools（queryTrades, getTradeGroups, upsertReviewNote, getReviewNote）

### P4-4 Memory MCP Server（2d）

**实现**：4 个 tools（getMemory, updateTradingProfile, addImprovementPlan, updateConversationSummary）

**验收标准**：
- [ ] Claude Desktop 能通过 MCP 调用
- [ ] Cursor 能通过 MCP 调用

---

## Phase 5: Multi-Agent 拆分（2-3 周）

### P5-1 Orchestrator + 复盘子 Agent（4d）

**实现**：
- Orchestrator Agent（接收指令，协调流程）
- 5 个子 Agent：Macro, News, Market, Sector, Trade Reviewer
- 顺序执行，前一个输出作为下一个输入

### P5-2 理论分析 Agent（3d）

**实现**：
- 4 个理论 Agent：Wyckoff, Dow, Al Brooks, A股情绪
- 1 个 Synthesizer Agent
- 并行执行，综合报告

### P5-3 Context Pipeline 通信（2d）

**实现**：
- PipelineContext 接口
- Agent 间数据传递机制

### P5-4 Data / Analysis Agent 分离（3d）

**实现**：
- Data Agent（获取清洗数据）
- Analysis Agent（纯推理）

---

## Phase 6: Memory 增强（1-2 周）

### P6-1 交易画像增强（2d）

**新增字段**：preferredSectors, avgHoldingDays, riskTolerance, emotionalPatterns

### P6-2 对话 Memory 增强（2d）

**新增字段**：keyDecisions, openQuestions, actionItems

### P6-3 交易经验 Memory（2d）

**新增**：lessons, patterns, successPatterns

### P6-4 Memory 与 RAG/GraphRAG 联动（2d）

**实现**：自动从复盘提取经验，同步到 Memory + 向量库 + 图

---

## Phase 7: DeepAgents 集成（2 周）

### P7-1 最小集成 demo（2d）

**实现**：安装 deepagents，创建最小 agent demo

### P7-2 替换 agentLoop.ts（3d）

**实现**：用 createDeepAgent 替换手写循环

### P7-3 启用内置能力（3d）

**实现**：write_todos（任务规划）+ task（子 Agent 委托）+ 文件系统上下文管理

### P7-4 Redis checkpointer（2d）

**实现**：LangGraph 持久化，跨会话恢复

---

## 时间线

```
月 1:    Phase 1 + Phase 2 (并行)     → 基础架构 + GraphRAG
月 2:    Phase 3 + Phase 4 (串行)     → 后端重构 + MCP
月 3:    Phase 5 + Phase 6 (并行)     → Multi-Agent + Memory
月 4 周1-2: Phase 7                   → DeepAgents
```

只做高优先级（🔴）任务：约 2 个月
