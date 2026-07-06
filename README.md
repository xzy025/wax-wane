# Wax Wane · 交易复盘系统

> 面向个人投资者的**全栈交易复盘工具**,覆盖 A 股 / 港股 / 美股。导入券商交割单即自动还原持仓与盈亏,聚合行情 / 宏观 / 消息 / 基本面多源数据,由自研 **ReAct AI Agent** 按「宏观 → 消息 → 大盘 → 板块 → 个股」流程生成结构化复盘报告。

[![CI](https://github.com/xzy025/wax-wane/actions/workflows/ci.yml/badge.svg)](https://github.com/xzy025/wax-wane/actions/workflows/ci.yml)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![Tests](https://img.shields.io/badge/tests-373%20passing-3DA639)
![i18n](https://img.shields.io/badge/i18n-中文%20%2F%20EN-blue)

---

## ✨ 核心亮点

- 🤖 **自研 ReAct AI Agent** — `async generator` 实现「推理 → 调工具 → 观察」循环,**28 个领域工具**,SSE 全程流式、可中断,两层上下文压缩防止 context 爆炸。
- 🧠 **多 Agent 编排** — **12 个专家 Agent**(宏观 / 消息 / 大盘 / 板块 / 基本面 / 技术 / 道氏 / 威科夫 / 价格行为 / 情绪…)+ Synthesizer 汇总,支持**串行流水线**与**并行扇出 + 跨理论投票**两种模式,以 **Agent-as-Tool** 模式对主 Agent 透明。
- 🔍 **RAG + 知识图谱** — Embedding + 向量检索(pgvector)+ BM25 混合搜索做历史交易语义召回;GraphRAG + 交易理论知识库,让 Agent 基于框架点评交易。
- 📊 **多市场行情看板** — 聚合 A 股 / 港股 / 美股指数、热门股榜单、龙虎榜、市场情绪与宏观指标,按交易日缓存。
- 🧾 **基本面分析** — 接入东方财富 F10 真实数据(公司快照、4 年财务、十大股东),Agent 可生成基本面研报并存档检索。
- 🧮 **交割单解析引擎** — 纯函数实现 CSV / Excel 解析 → 买卖配对 → 持仓还原 → 交易分组,并计算胜率、盈亏比、R 倍数等量化指标。
- 🌐 **中 / 英双语** — 全量 i18n 词典,界面一键切换。
- ✅ **373 个测试用例全部通过** — Vitest + Testing Library 覆盖引擎层与视图层(33 个测试文件)。

> 📐 AI 子系统的完整架构拆解(含 Mermaid 图)见 **[docs/AI-ARCHITECTURE.md](docs/AI-ARCHITECTURE.md)**。

---

## 🛠 技术栈

| 层 | 技术 |
|---|---|
| **前端** | React 19 · TypeScript 5.9 · Vite 7 · React Router 7 · Recharts · Phosphor Icons · react-markdown |
| **后端** | Node.js · Express 5 · tsx (ESM) · PostgreSQL + pgvector |
| **AI / 数据** | LLM API (SSE 流式) · RAG 向量检索 (pgvector + BM25 混合) · Embedding · GraphRAG · Multi-Agent 编排 |
| **工程化** | Vitest 4 + Testing Library (373 用例) · ESLint v10 + Prettier · 代码分包 / 懒加载 · 中英 i18n |

---

## 🏗 架构概览

```
前端 (React 19 + Vite, :3000)              后端 (Express, :3002)
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ 行情 / 工作台 / 导入 / 台账     │          │ routes/   agent·market·analysis │
│ 复盘 / 分析 / AI Agent          │   HTTP   │           db·memory·mcp         │
│                                │ ───────► │ services/ 行情·宏观·热榜·新闻·F10 │
│ ReAct Agent (28 工具)           │   SSE    │ rag/      embedding + 向量库      │
│  └ 多 Agent 编排(Agent-as-Tool)│          │ graph/    GraphRAG 知识图谱      │
└──────────────────────────────┘          │ knowledge/ 道氏·威科夫·价格行为   │
                                           └──────────────────────────────┘
                                                       │
                                          东方财富 / 开盘啦 / RSS / Web 搜索
```

详见 [AI 架构文档](docs/AI-ARCHITECTURE.md) · [REST API 文档](docs/api/README.md)(52 端点 / OpenAPI 3.1)。

---

## 📁 目录结构

```
src/
├── engine/      纯业务逻辑(CSV/Excel 解析、持仓还原、交易分组)
├── agent/       AI Agent 系统(ReAct 循环、工具、上下文压缩、多 Agent)
│   ├── tools/         28 个 function-calling 工具
│   └── multi-agent/   12 专家 Agent + Synthesizer + 3 编排器(串行 / 并行 / 个股)
├── views/       主视图(行情、工作台、导入、台账、复盘、分析、Agent)
├── components/  共享 UI(指数 banner、日期选择、表格、错误边界)
├── hooks/       数据 hooks(A股 / 宏观 / 港股 / 美股 / 热榜 / RAG 同步)
├── store/       全局状态 + 本地持久化
├── i18n/        中 / 英双语词典
└── utils/       量化指标计算、行情历史缓存

server/          Express API(按领域分层,独立 package.json)
├── routes/      agent · market · analysis · db · memory · mcp
├── services/    外部数据抓取:ashare · hk · us · hotlist · kaipanla · macro · news · f10 · webSearch
├── rag/         embedding · vectorStore (pgvector) · ragSync
├── graph/       GraphRAG 知识图谱
├── knowledge/   交易理论知识库(道氏 · 威科夫 · 价格行为)+ 基本面 / 教学语料
├── memory/      长期记忆(抽取 / 存储)
└── lib/         LLM 客户端 · 缓存
```

---

## 🚀 快速开始

```bash
# 1. 安装前端依赖
npm install

# 2. 安装并启动后端(独立 package.json,端口 3002)
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
npm test          # 前端测试(373 用例,jsdom)
npm run lint      # ESLint 检查(覆盖 src/ 与 server/)

# 后端测试(77 用例,node 环境)
npx vitest run --config vitest.server.config.ts
```

> 🔐 API Key 仅存于 `server/.env`,前端只发送模型 ID,永不接触密钥。

---

## 🧩 主要功能

| 视图 | 说明 |
|---|---|
| **行情看板** | A 股 / 港股 / 美股指数、成交量统计、热门股榜单、龙虎榜、市场情绪、宏观指标 |
| **复盘工作台** | 资金曲线、风险提醒、近期交易概览 |
| **交割单导入** | CSV / Excel 解析,自动配对买卖、还原持仓 |
| **交易台账** | 按交易分组展示每笔交易的盈亏、持仓周期 |
| **平仓复盘** | 一键结构化复盘 + 理论引导复盘 + 个股多维度分析 |
| **量化分析** | 资金曲线、胜率、盈亏比、R 倍数等指标 |
| **AI Agent** | 对话式复盘助手,实时流式展示「推理 → 调工具 → 观察」全过程 |

---

> 个人全栈项目。ReAct AI Agent、RAG、多 Agent 编排为核心技术亮点,详细实现见 [docs/AI-ARCHITECTURE.md](docs/AI-ARCHITECTURE.md)。
