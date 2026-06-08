# TradeReview · A股交易复盘系统

> 面向 A 股个人投资者的**全栈交易复盘工具**:导入券商交割单后自动还原持仓与盈亏,聚合行情 / 宏观 / 消息多源数据,由自研 **AI Agent** 按「宏观 → 消息 → 大盘 → 板块 → 个股」流程生成结构化复盘报告。

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![Tests](https://img.shields.io/badge/tests-300%20passing-3DA639)

---

## ✨ 核心亮点

- 🤖 **自研 ReAct AI Agent** — `async generator` 实现「推理 → 调工具 → 观察」循环,27 个领域工具,SSE 全程流式、可中断,两层上下文压缩防止 context 爆炸。
- 🧠 **多 Agent 编排** — 14 个专家 Agent(宏观 / 板块 / 技术 / 情绪 / 道氏 / 威科夫 / 价格行为…)协作,支持**串行流水线**与**并行扇出 + Synthesizer 汇总**两种模式,以 Agent-as-Tool 模式对主 Agent 透明。
- 🔍 **RAG + 知识图谱** — Embedding + 向量检索(pgvector / Vectra)做历史交易语义召回;GraphRAG + 交易理论知识库让 Agent 基于框架点评交易。
- 📊 **多市场行情看板** — 聚合 A 股 / 港股 / 美股指数、热门股榜单、龙虎榜、市场情绪与宏观指标,按交易日缓存。
- 🧾 **交割单解析引擎** — 纯函数实现 CSV/Excel 解析 → 买卖配对 → 持仓还原 → 交易分组,并计算胜率、盈亏比、R 倍数等量化指标。
- ✅ **300 个测试用例全部通过** — Vitest + Testing Library 覆盖引擎层与视图层。

> 📐 AI 子系统的完整架构拆解(含 Mermaid 图)见 **[docs/AI-ARCHITECTURE.md](docs/AI-ARCHITECTURE.md)**。

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| **前端** | React 19 · TypeScript 5.9 · Vite 7 · React Router 7 · Recharts · Phosphor Icons |
| **后端** | Node.js · Express 5 · tsx (ESM) · PostgreSQL + pgvector · Redis (ioredis) |
| **AI / 数据** | LLM API (SSE 流式) · RAG 向量检索 (Vectra / pgvector) · Embedding · GraphRAG · Multi-Agent 编排 |
| **工程化** | Vitest 4 + Testing Library (300 用例) · ESLint v10 + Prettier · 代码分包 / 懒加载 |

**规模:** 前端 ~18k 行 · 后端 ~8.4k 行 TypeScript

---

## 🏗 架构概览

```
前端 (React 19 + Vite)                 后端 (Express, :3001)
┌──────────────────────────┐          ┌──────────────────────────┐
│ 行情 / 工作台 / 复盘 / 分析 │          │ routes/   agent·market·db │
│                          │  HTTP    │ services/ 行情·宏观·热榜·新闻 │
│ AI Agent (ReAct Loop)    │ ───────► │ rag/      embedding+向量库  │
│  ├ 27 工具 (function call) │  SSE     │ graph/    GraphRAG 知识图谱 │
│  └ 多 Agent 编排子系统      │          │ memory/   长期记忆          │
└──────────────────────────┘          └──────────────────────────┘
                                              │
                                     东方财富 / 开盘啦 / RSS 等外部数据源
```

详见 [AI 架构文档](docs/AI-ARCHITECTURE.md)。

---

## 📁 目录结构

```
src/
├── engine/      纯业务逻辑(交割单解析、持仓还原、交易分组)
├── agent/       AI Agent 系统(ReAct 循环、工具、上下文压缩、多 Agent)
│   ├── tools/         27 个 function-calling 工具
│   ├── multi-agent/   专家 Agent + 编排器(串行 / 并行)
│   └── ...
├── views/       主视图(行情、工作台、导入、台账、复盘、分析)
├── components/  共享 UI(指数 banner、日期选择、错误边界)
├── hooks/       数据 hooks(A股 / 宏观 / 港股 / 美股 / 热榜)
└── utils/       量化指标计算、行情历史缓存

server/          Express API(按领域分层)
├── routes/      agent · market · mcp · db · memory
├── services/    外部数据抓取:ashare · hk · us · hotlist · macro · news
├── rag/         embedding · vectorStore (pgvector) · ragSync
├── graph/       GraphRAG 知识图谱
└── knowledge/   交易理论知识库(道氏 · 威科夫 · 价格行为)
```

---

## 🚀 快速开始

```bash
# 1. 安装前端依赖
npm install

# 2. 安装并启动后端(独立 package.json,端口 3001)
cd server && npm install
cp .env.example .env   # 配置 LLM_API_URL / LLM_API_KEY / 数据库连接
npm run dev            # tsx watch index.ts

# 3. 启动前端(另开终端,默认 :3000)
npm run dev
```

常用脚本:

```bash
npm run dev       # 启动开发服务器
npm run build     # 生产构建
npm test          # 运行 300 个测试用例
npm run lint      # ESLint 检查
```

> 🔐 API Key 仅存于 `server/.env`,前端只发送模型 ID,永不接触密钥。

---

## 🧩 主要功能

| 模块 | 说明 |
|---|---|
| **行情看板** | A 股 / 港股 / 美股指数、成交量统计、热门股榜单、龙虎榜、市场情绪 |
| **交割单导入** | CSV / Excel 解析,自动配对买卖、还原持仓 |
| **交易台账** | 按交易分组展示每笔交易的盈亏、持仓周期 |
| **AI 复盘** | 一键结构化复盘 + 理论引导复盘 + 个股多维度分析 |
| **量化分析** | 资金曲线、胜率、盈亏比、R 倍数等指标 |

---

> 个人全栈项目。AI Agent、RAG、多 Agent 编排为核心技术亮点,详细实现见 [docs/AI-ARCHITECTURE.md](docs/AI-ARCHITECTURE.md)。
</content>
