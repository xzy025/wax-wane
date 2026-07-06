# Wax Wane 代码评审与重构迭代计划

> 评审日期：2026-07-06
> 评审范围：全项目（src/ + server/ + mcp-servers/）
> 代码规模：~733 个 TS/TSX/MJS 文件，82 个测试文件

---

## 一、项目概览

### 1.1 项目定位

Wax Wane 是一个 **A 股交易纪律分析平台**，核心能力包括：
- 交易记录导入与持仓管理
- 交易复盘与行为模式识别
- 多维度选股（8 套回测验证的战法 + 3 套监控清单）
- AI Agent 辅助分析（多模型 SSE 流式对话 + 多 Agent 编排）
- RAG 语义搜索 + GraphRAG 知识图谱
- 市场数据全景看板（A股/港股/美股/宏观/资金流/龙虎榜）

### 1.2 技术栈

| 层级 | 技术 | 备注 |
|------|------|------|
| 前端 | React 19 + TypeScript + Vite 7 | 无状态管理库，Context + useReducer |
| 后端 | Express 5 + tsx | 纯 ESM，无 ORM |
| 数据库 | PostgreSQL + pgvector | 手写 SQL，无 Migration |
| 缓存 | Redis (ioredis) | ⚠ 依赖在 devDependencies |
| AI | 自研 Agent Loop + 多模型代理 | MiMo/Claude/GPT/Gemini 协议转换 |
| 向量 | pgvector + BM25 + RRF 混合搜索 | 自研 Embedding 代理 |
| MCP | 4 个独立 Server | ⚠ 多数为 Stub |

### 1.3 架构亮点

```
前端 (React 19)
  ├── 11 个业务视图 (Market/Themes/Screener/Dashboard/...)
  ├── 23 个自定义 Hooks (数据获取层)
  ├── Agent Chat Panel (SSE 流式 + 工具卡片)
  └── Context + Reducer 状态管理 (localStorage 持久化)

后端 (Express)
  ├── 10 个路由模块 (agent/market/screener/db/memory/...)
  ├── 66 个服务文件 (选股规则/市场数据/RAG/图谱/...)
  ├── Agent Pipeline (LLM 代理 + 工具执行)
  └── PostgreSQL + Redis

Agent 系统
  ├── agentLoop.ts (V1 原始循环)
  ├── deep-agents/ (V2 规划模式 + 标准模式)
  ├── multi-agent/ (5 Agent 顺序 + 4 Agent 并行编排)
  ├── skills/ (结构化复盘/理论引导复盘)
  ├── pipeline/ (6 个 Middleware)
  └── tools/ (29 个 Agent 工具)
```

---

## 二、代码评审发现

### 2.1 ✅ 优秀实践

#### 2.1.1 选股配置的回测驱动文化

`server/config/screener.ts` 是整个项目的标杆文件：
- 每个阈值都有回测数据背书（期望值/盈亏因子/胜率/样本量/最大回撤）
- 记录了完整的校准过程和翻案记录（如 LHB 因子前视偏差修正）
- 使用 `as const satisfies Config` 保证类型安全
- 一键回退参数说明清晰

#### 2.1.2 缓存层设计

`server/lib/cache.ts` 设计精良：
- **市场感知 TTL**：盘中短 TTL、盘后长 TTL，减少上游调用
- **并发去重**：5 个 Banner 同时挂载时共享一次 fetch
- **Serve-stale-on-error**：上游限流时返回上次好值
- **冷启动种子**：从磁盘快照懒加载，重启即有数据

#### 2.1.3 上下文压缩

`src/agent/contextCompression.ts` 实现了分层压缩：
- Tool Result 按工具类型智能压缩（交易取样本、新闻取标题）
- 消息历史按重要度评分保留最近 N 条
- Token 估算 + 滑动窗口控制上下文膨胀

#### 2.1.4 防御性编程

服务层普遍采用 best-effort 模式：
- 外部数据源失败时优雅降级（返回中性默认值，不中断主流程）
- 选股扫描不健康时跳过存档（避免覆盖好快照）
- DB 未连接时自动退化为 localStorage 模式

#### 2.1.5 测试覆盖

82 个测试文件覆盖：
- 前端：组件测试（18 个）+ Hook 测试 + 工具函数测试
- 后端：选股规则测试（16 个）+ 回测引擎测试 + RAG 测试
- Agent：Multi-Agent/Pipeline/Skills/DeepAgents/ContextCompression 测试

---

### 2.2 ⚠️ 架构问题

#### 问题 1：Agent Loop 双系统重复（🔴 高优先级）

`agentLoop.ts`（V1）和 `deep-agents/agent.ts`（V2）存在严重代码重复：

- `deep-agents/agent.ts` 的 `executeStandard()` 函数（~100 行）与 `agentLoop.ts` 的 `runAgent()` 几乎逐行相同
- 两者都实现了：消息构建 → 流式调用 → 工具执行 → 压缩 → 循环
- V2 增加了 Planning Mode 路由，但 Standard Mode 是 V1 的复制品

**影响**：维护两份相同逻辑，修改一处需同步两处，容易遗漏。

#### 问题 2：MCP Server 多数为 Stub（🔴 高优先级）

`mcp-servers/market-data/src/index.mjs` 中 9 个工具的实现状态：

| 工具 | 状态 |
|------|------|
| getAShareQuote | ✅ 真实实现 |
| getAShareBreadth | ⚠️ 简化版（只取指数涨跌家数，无涨停跌停） |
| getIndexTrends | ✅ 真实实现 |
| getLimitPool | ❌ 返回空数组（"requires specialized API access"） |
| getHKData | ❌ 返回 mock（"requires HKEX API access"） |
| getUSData | ❌ 返回静态列表 |
| getMacroIndicators | ❌ 全部返回 N/A（"requires specialized API keys"） |
| getNewsSummary | ❌ 返回空数组（"requires RSS feed configuration"） |
| getHotList | ❌ 返回空数组（"requires specialized API"） |

**影响**：MCP Server 无法实际使用，与文档声称的"25 个 MCP 工具"严重不符。后端 `server/services/` 已有这些数据的真实实现，但 MCP Server 没有复用。

#### 问题 3：Multi-Agent 子 Agent 无 LLM 推理（🟡 中优先级）

`src/agent/multi-agent/agents/base.agent.ts` 的 `execute()` 方法：
1. 调用一个工具获取数据
2. 用 `postProcess()` 做简单 JSON 格式化
3. 返回格式化后的字符串

**问题**：子 Agent 只做了"取数据 + 格式化"，没有 LLM 推理步骤。例如 `MacroAnalystAgent` 只是把宏观数据拼成 `"美债10Y: X\n黄金: Y"` 的字符串，没有"判断当前宏观环境"的分析。

这与 `architecture-review.md` 中设计的"每个子 Agent 输出分析小结"不符。当前实现更像是 Tool Wrapper 而非真正的 Agent。

#### 问题 4：Pipeline Middleware 未集成（🟡 中优先级）

`src/agent/pipeline/` 定义了 6 个 Middleware（auth/rateLimit/memory/compression/cache/logging），但从 `agentLoop.ts` 和 `deep-agents/agent.ts` 的代码看，Agent Loop 并未通过 Pipeline 执行。Middleware 系统似乎定义了但未接入主流程。

#### 问题 5：后端无 TypeScript 类型检查（🟡 中优先级）

`tsconfig.json` 的 `include` 只有 `["src"]`，不包含 `server/`。意味着：
- 后端代码没有编译时类型检查
- IDE 可能不会报告 server 目录的类型错误
- `npm run lint` 虽然覆盖 `server/`，但 lint ≠ 类型检查

#### 问题 6：CORS 配置安全漏洞（🟡 中优先级）

`server/index.ts` 第 35-42 行：
```typescript
origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true)
  } else {
    callback(null, true) // Permissive for local dev; tighten for production
  }
}
```
`else` 分支也返回 `true`，意味着 CORS 实际允许所有来源。注释说"tighten for production"，但没有环境判断。

---

### 2.3 ⚠️ 代码质量问题

#### 2.3.1 `pgDatabase.ts` 上帝文件（548 行）

`server/db/pgDatabase.ts` 包含：
- Schema 初始化（6 张表的 CREATE TABLE）
- Import Batches CRUD
- Trades CRUD
- Trade Groups CRUD
- Review Notes CRUD
- Vector Search（3 个搜索函数）
- Fundamental Reports CRUD
- Agent Memory CRUD
- Screener Snapshots CRUD

**建议**：按领域拆分为 `repositories/trades.repo.ts`、`repositories/tradeGroups.repo.ts` 等。

#### 2.3.2 `any` 类型使用

在以下文件中发现 `any` 类型：
- `src/agent/llmClient.ts` — `StreamChatResult` 接口未使用但定义了
- `src/agent/pipeline/pipeline.types.ts`
- `src/agent/skills/skill.types.ts`
- `src/agent/multi-agent/agents/fundamental.agent.ts`
- `src/engine/holdings.ts`
- `server/lib/llm.ts` — `fetchWithProxy(url, options: any)`

#### 2.3.3 console 日志泛滥

后端 60+ 文件使用 `console.log/warn/error`，没有结构化日志。生产环境难以：
- 按级别过滤
- 关联请求 ID 追踪
- 接入日志收集系统（ELK/Loki）

#### 2.3.4 前端无路由懒加载

`App.tsx` 中所有视图组件都是 eager import，首屏加载全部 JS。虽然有 vendor 分包，但业务代码仍在一个 chunk。

---

### 2.4 ⚠️ 依赖与配置问题

#### 2.4.1 依赖放置错误

| 依赖 | 当前位置 | 应在位置 | 原因 |
|------|---------|---------|------|
| `ioredis` | devDependencies | dependencies | `server/lib/redis.ts` 生产使用 |
| `@types/pg` | dependencies | devDependencies | 类型定义，非运行时 |
| `@types/ioredis` | devDependencies | 可删除 | ioredis 5.x 自带类型 |

#### 2.4.2 `phosphor-react` 已废弃

`phosphor-react` 最后发布于 2022 年，官方已迁移到 `@phosphor-icons/react`。

#### 2.4.3 无数据库 Migration 系统

Schema 通过 `CREATE TABLE IF NOT EXISTS` 在启动时创建，无法：
- 追踪 schema 变更历史
- 回滚到特定版本
- 在生产环境安全地做 schema 演进

---

### 2.5 ⚠️ 文档与实现不同步

#### 2.5.1 `final-architecture.md` 严重过时

- 声称"Phase 1-7 全部完成"，但 Phase 3 (Nest + LangChain) 已在 `refactoring-roadmap.md` 中明确标记为放弃
- 仍列出 `apps/server/` 目录（已删除）
- 声称"MCP Server 25 个工具"，实际多数为 stub
- 部署架构图仍包含 NestJS :3002 端口

#### 2.5.2 `architecture-review.md` 与实际架构有差异

- 文档中 Agent Tools 为 16 个，实际已有 29 个
- 文档中 MCP 拆分方案是规划，但实际实现状态未更新

---

## 三、重构与迭代计划

### Phase 1: 技术债清理（1-2 周）

#### P1-1 Agent Loop 统一（2d）🔴

**目标**：消除 `agentLoop.ts` 与 `deep-agents/agent.ts` 的代码重复

**方案**：
- 保留 `deep-agents/agent.ts` 作为唯一入口
- 将 `agentLoop.ts` 的 `runAgent` 标记为 deprecated 或删除
- `executeStandard()` 直接复用 `agentLoop.ts` 的核心逻辑（提取为共享函数）
- 确保 Planning Mode 和 Standard Mode 共享工具执行/流式处理/压缩逻辑

**验收**：
- [ ] 只有一个 Agent Loop 实现
- [ ] Planning Mode 和 Standard Mode 都正常工作
- [ ] 现有测试全部通过

#### P1-2 MCP Server 真实实现或移除（3d）🔴

**目标**：让 MCP Server 产生实际价值

**方案**：
- **方案 A（推荐）**：MCP Server 复用 `server/services/` 的真实实现，通过 import 或 HTTP 调用后端 API
- **方案 B**：如果 MCP Server 暂时不需要，移除 stub 代码和文档中的相关声明

**验收**：
- [ ] MCP Server 工具返回真实数据（非 mock/placeholder）
- [ ] Claude Desktop 可通过 MCP 获取真实市场数据

#### P1-3 依赖修正（0.5d）🟡

- 将 `ioredis` 移到 dependencies
- 将 `@types/pg` 移到 devDependencies
- 删除 `@types/ioredis`（ioredis 5.x 自带类型）
- 评估 `phosphor-react` → `@phosphor-icons/react` 迁移

#### P1-4 后端 TypeScript 配置（1d）🟡

- 新建 `server/tsconfig.json`（extends 根 tsconfig）
- 根 `tsconfig.json` 添加 `references` 或 `include` server
- 运行 `tsc --noEmit` 检查后端类型错误并修复

#### P1-5 CORS 安全修复（0.5d）🟡

```typescript
origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin)) {
    callback(null, true)
  } else {
    callback(new Error('Not allowed by CORS'))
  }
}
```
或通过 `NODE_ENV` 控制是否宽松。

#### P1-6 文档同步（1d）🟡

- 更新 `final-architecture.md`：移除 NestJS 相关内容，标注 MCP 实际状态
- 更新 `architecture-review.md`：同步当前工具数量和架构
- 合并或标注 `refactoring-roadmap.md` 中已完成/已放弃的 Phase

---

### Phase 2: 架构优化（2-3 周）

#### P2-1 数据库层重构（3d）🔴

**目标**：拆分 `pgDatabase.ts` 上帝文件

**结构**：
```
server/db/
  ├── connection.ts          # Pool 初始化 + isDbReady
  ├── migrations/            # SQL 迁移脚本
  │   ├── 001_init.sql
  │   └── 002_screener.sql
  ├── repositories/
  │   ├── trades.repo.ts
  │   ├── tradeGroups.repo.ts
  │   ├── reviewNotes.repo.ts
  │   ├── agentMemory.repo.ts
  │   ├── fundamentalReports.repo.ts
  │   └── screenerSnapshots.repo.ts
  └── vectorSearch.ts        # 向量搜索（跨表）
```

#### P2-2 Multi-Agent 子 Agent 增强 LLM 推理（3d）🔴

**目标**：让子 Agent 真正"分析"而非仅"取数据"

**方案**：
- `BaseAgent.execute()` 增加可选的 LLM 推理步骤
- 工具获取数据后，将数据 + 专用 prompt 发给 LLM 做分析
- 每个子 Agent 定义自己的分析 prompt（如宏观分析师 prompt 专注宏观面判断）

```typescript
abstract class BaseAgent {
  protected abstract analysisPrompt: string  // 子类定义分析 prompt

  async execute(context: AgentContext): Promise<AgentResult> {
    const rawData = await this.fetchToolData(context)
    const analysis = await this.llmAnalyze(rawData, context)  // 新增 LLM 步骤
    return { content: analysis, ... }
  }
}
```

#### P2-3 Pipeline Middleware 集成或移除（2d）🟡

**决策点**：
- 如果 Middleware 有价值 → 集成到 Agent Loop 执行链
- 如果 Middleware 是实验性代码 → 移除以减少认知负担

**推荐**：集成 cache 和 compression middleware（已有实际逻辑），移除未使用的 auth/rateLimit（当前是单用户本地应用）。

#### P2-4 前端路由懒加载（1d）🟡

```typescript
const ScreenerView = lazy(() => import('./views/ScreenerView'))
const AgentView = lazy(() => import('./views/AgentView'))
// ...
```

配合 `Suspense` 使用，减小首屏 bundle。

#### P2-5 数据库 Migration 系统（2d）🟡

- 引入 `node-pg-migrate` 或自研轻量 migration
- 将 `initDatabase()` 中的 schema 转为 migration 脚本
- 支持 `npm run migrate` 和 `npm run migrate:rollback`

---

### Phase 3: 生产就绪（2-3 周）

#### P3-1 结构化日志（2d）🔴

- 引入 `pino` 或 `winston`
- 替换所有 `console.log/warn/error`
- 添加请求 ID 关联（中间件注入）
- 支持日志级别配置（`LOG_LEVEL=debug|info|warn|error`）

#### P3-2 错误监控（2d）🟡

- 集成 Sentry（前端 + 后端）
- Agent Loop 错误上报
- Tool 执行失败上报
- 前端 ErrorBoundary 错误上报

#### P3-3 CI/CD 流水线（2d）🟡

```yaml
# .github/workflows/ci.yml
jobs:
  lint:
    - npm run lint
  typecheck:
    - tsc --noEmit
  test:
    - npm run test
    - npm run test:server
  build:
    - npm run build
```

#### P3-4 健康检查增强（1d）🟡

```typescript
// /api/health 返回：
{
  status: 'ok' | 'degraded',
  services: {
    database: 'connected' | 'disconnected',
    redis: 'connected' | 'disconnected',
    llm: 'configured' | 'missing',
  },
  version: '0.1.0',
  uptime: 3600,
}
```

#### P3-5 环境配置管理（1d）🟡

- 使用 `zod` 验证环境变量
- 统一配置入口 `server/config/env.ts`
- 启动时验证必需的环境变量

---

### Phase 4: 功能迭代（持续）

#### P4-1 RAG 混合搜索优化（3d）🟡

- BM25 + pgvector + GraphRAG 三路融合
- Rerank 模型集成
- 查询扩展（同义词/术语映射）

#### P4-2 Memory 跨会话持久化（2d）🟡

- Redis 短期记忆 → PostgreSQL 长期记忆
- 交易经验自动提取与召回
- 用户画像渐进式丰富

#### P4-3 选股系统增强（持续）🟢

- 更多战法回测验证
- 实盘战绩跟踪与策略迭代
- 分钟级数据接入（突破日撮合精度）

#### P4-4 Agent 工具扩展（持续）🟢

- 龙虎榜深度分析工具
- 融资融券数据工具
- 板块轮动对比工具
- 个股深度研报生成工具

---

## 四、优先级矩阵

```
          高影响
            │
    P1-1    │    P2-2
  Agent统一  │  子Agent增强
    P1-2    │    P2-1
  MCP实现   │  DB层重构
    ────────┼──────── 低成本
    P1-3    │    P1-6
  依赖修正   │  文档同步
    P1-5    │    P3-4
  CORS修复  │  健康检查
            │
          低影响
```

### 建议执行顺序

| 批次 | 任务 | 预估工时 | 收益 |
|------|------|---------|------|
| 第 1 批 | P1-3 依赖修正 + P1-5 CORS + P1-6 文档 | 2d | 快速消除安全/配置风险 |
| 第 2 批 | P1-1 Agent 统一 + P1-4 后端 TS 配置 | 3d | 消除最大代码重复 |
| 第 3 批 | P1-2 MCP 实现 + P2-2 子 Agent 增强 | 6d | 让 AI 系统真正可用 |
| 第 4 批 | P2-1 DB 重构 + P2-5 Migration | 5d | 为后续迭代打基础 |
| 第 5 批 | P3-1 日志 + P3-2 监控 + P3-3 CI/CD | 6d | 生产可观测性 |

**总预估**：~22 个工作日（约 4-5 周），可与功能迭代并行。

---

## 五、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| Agent Loop 统一可能引入回归 | 中 | 高 | 先加测试覆盖再重构 |
| DB 重构影响现有功能 | 中 | 高 | 逐表迁移，保持接口兼容 |
| 子 Agent 增 LLM 推理增加 token 成本 | 高 | 中 | 可配置开关，复杂场景才启用 |
| MCP 实现依赖后端 API 稳定性 | 低 | 中 | MCP Server 内置错误处理 + 缓存 |

---

## 六、总结

### 核心价值判断

Wax Wane 是一个**技术深度很高的个人交易分析平台**，在以下方面表现突出：
- 选股系统的回测驱动文化（每个参数都有数据背书）
- Agent 系统的架构设计（多 Agent 编排 + 上下文压缩 + 工具系统）
- 缓存与容错设计（市场感知 TTL + serve-stale + 优雅降级）

### 主要改进方向

1. **消除重复**：Agent Loop 双系统是最大的技术债
2. **兑现承诺**：MCP Server 的 stub 需要真实实现或移除
3. **增强智能**：Multi-Agent 子 Agent 需要真正的 LLM 推理而非数据格式化
4. **生产加固**：结构化日志 + 错误监控 + CI/CD
5. **基础治理**：后端类型检查 + DB Migration + 文档同步

### 预期收益

- Agent Loop 统一 → 维护成本降低 50%
- MCP 真实实现 → 可在 Claude Desktop/Cursor 中使用市场数据
- 子 Agent LLM 增强 → 复盘报告质量显著提升
- 生产就绪 → 可安全部署为多用户服务

---

*文档结束。*
