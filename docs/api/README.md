# API 参考 — Wax Wane

后端 Express 服务的 REST 接口速查。机器可读规范见同目录 [`openapi.yaml`](./openapi.yaml)(OpenAPI 3.1)。

- **Base URL:** `http://localhost:3002`(`server/index.ts` 默认 `PORT=3002`;前端 `vite.config.ts` 把 `/api` 代理到 3002)
- **路径前缀:** 各 router 自带 `/api...` 前缀,服务端未挂全局前缀
- **错误格式:** 统一 `{ "error": string }`,状态码多为 `400 / 404 / 500 / 503`
- **流式:** `POST /api/agent/chat` 与 `POST /api/analysis/fundamental` 为 **SSE**(`text/event-stream`),以 `data: {...}` 行推送、`data: [DONE]` 结束
- **大小写:** `Database` 组的请求/响应字段为 **snake_case**(直连 DB 层);前端领域类型为 camelCase,经 `src/store/persistence.ts` 映射
- **真相来源:** 端点定义在 `server/routes/*.ts`,数据表在 `server/db/pgDatabase.ts` 与 `server/graph/graphSchema.ts`

> 交互式浏览:把 `openapi.yaml` 贴到 <https://editor.swagger.io>,或导入 Postman / Insomnia / Redoc。

共 **52** 个端点,分 6 组。

## Agent
| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/agent/chat` | LLM 流式聊天代理(SSE),OpenAI/Anthropic 协议自适配,key 仅在服务端 |
| GET | `/api/health` | 健康检查(LLM/DB 配置状态) |

## Market
| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/refresh?market=` | 清行情缓存(刷新按钮);省略 market 清全部 |
| GET | `/api/ashare` | A 股大盘(指数/涨跌停/涨跌家数/成交量) |
| GET | `/api/hk` | 港股指数 |
| GET | `/api/hk/quote?codes=` | 港股个股报价(批量) |
| GET | `/api/us` | 美股指数 |
| GET | `/api/us/quote?codes=` | 美股个股报价(批量) |
| GET | `/api/hotlist` | 热门股榜单(东财/同花顺/淘股吧/龙虎榜) |
| GET | `/api/highs` | 创新高 / 52 周高分析 |
| GET | `/api/sentiment` | 市场情绪温度计(开盘啦) |

## Analysis
| 方法 | 路径 | 用途 |
|---|---|---|
| POST | `/api/analysis/fundamental` | 流式生成基本面一页纸研报(SSE)+ 双存档(md + 向量) |
| GET | `/api/analysis/fundamental/latest?query=` | 取最近存档研报(DB 优先,回退文件) |

## Database (snake_case)
| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/db/trades` | 查交易(`stock_code/start_date/end_date/side/limit`) |
| POST | `/api/db/trades` | 插入单条交易 |
| GET | `/api/db/trade-groups` | 查交易分组(`status/stock_code`) |
| POST | `/api/db/trade-groups` | 插入交易分组 |
| GET | `/api/db/review-notes/:groupId` | 取复盘笔记 |
| PUT | `/api/db/review-notes/:groupId` | upsert 复盘笔记 |
| POST | `/api/db/import-batches` | 记录导入批次 |

## Memory
**基础:**
| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/memory/:userId` | 取记忆 |
| PUT | `/api/memory/:userId` | 保存完整记忆 |
| PATCH | `/api/memory/:userId/profile` | 更新交易画像 |
| POST | `/api/memory/:userId/plans` | 新增改进计划 |
| PATCH | `/api/memory/:userId/plans/:planId` | 更新计划 |
| PATCH | `/api/memory/:userId/market` | 更新大盘分析 |
| PATCH | `/api/memory/:userId/summary` | 更新对话摘要 |

**增强(懒加载):**
| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/memory-enhanced/:userId` | 取增强记忆(含序列化) |
| PATCH | `/api/memory-enhanced/:userId/profile` | 更新增强画像 |
| POST | `/api/memory-enhanced/:userId/infer-profile` | 从交易分组推断画像 |
| POST | `/api/memory-enhanced/:userId/lessons` | 从复盘抽取教训 |
| POST | `/api/memory-enhanced/:userId/patterns` | 从交易抽取行为模式 |
| POST | `/api/memory-enhanced/:userId/decisions` | 新增关键决策 |
| POST | `/api/memory-enhanced/:userId/actions` | 新增行动项 |
| PATCH | `/api/memory-enhanced/:userId/actions/:actionId` | 标记行动项完成 |

## Data / MCP
| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/mcp/ashare/trends?code=` | 指数/个股分时 |
| GET | `/api/mcp/ashare/quote?code=` | A 股个股报价 |
| GET | `/api/stock/kline?code=&period=&count=` | 个股 K 线 |
| GET | `/api/stock/fundamentals?code=` | 个股基本面快照 |
| GET | `/api/stock/news?code=&count=` | 个股新闻搜索 |
| GET | `/api/web/search?q=&count=` | Web 搜索代理 |
| GET | `/api/mcp/ashare/breadth` | 市场广度统计 |
| GET | `/api/mcp/ashare/limit-pool?direction=up\|down` | 涨停/跌停池 |
| GET | `/api/mcp/ashare/indices` | 主要指数 |
| GET | `/api/mcp/news/summary` | RSS 新闻摘要 |
| GET | `/api/mcp/macro/indicators` | 宏观指标 |
| GET | `/api/mcp/rag/status` | RAG 文档计数 |
| GET | `/api/mcp/rag/search?query=&type=&topK=` | 语义检索 |
| POST | `/api/mcp/rag/sync` | 同步交易分组到向量库 |
| POST | `/api/mcp/graph/sync` | 同步交易到知识图谱 |
| GET | `/api/mcp/graph/stats` | 图谱节点/边统计 |
| POST | `/api/mcp/graph/query` | 图谱查询(`findTradesByMistake` 等 5 种 `queryType`) |

> MCP **stdio 服务器**(供 Claude Desktop 等接入)是另一套封装,见 [`../../mcp-servers/README.md`](../../mcp-servers/README.md)。本页只覆盖 HTTP REST 接口。
