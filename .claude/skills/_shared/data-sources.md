# 数据获取契约（个股分析 Skill 共用）

> 本文件是 `/ta`、`/fa`、`/equity` 三个 skill 的**数据层单一事实来源**。
> 所有数据源**均无需 API key**。**禁止使用 tushare**（本机 token 已失效，会报 `您的token不对`）。

## 0. 代码 / 名称规范化

- 标的统一用 **6 位数字代码**（如 `600519`、`300750`、`000001`）。
- 用户给中文名（如「贵州茅台」）时，先解析成 6 位码：
  1. 优先 WebFetch 东财搜索建议接口：
     `https://searchadapter.eastmoney.com/api/suggest/get?input=<名称>&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=5`
     从返回里取 `Code`（A股）。
  2. 兜底用 WebSearch「<名称> 股票代码」。
- 东财 `secid` 前缀规则（需要时）：`6` 开头 → `1.`（上交所），`0`/`3` 开头 → `0.`（深交所），`8`/`4` 开头 → `1.`（北交所，按需）。
  例：`600519` → `1.600519`，`300750` → `0.300750`。

## 1. 价格 / K 线（始终可用基线）

用 akshare MCP（已实测可用，免 token）：

- 工具：`mcp__plugin_financial-analysis_akshare__get_stock_quote`
- 参数：`symbol=<6位码>`，`period="daily"`，`adjust="qfq"`，`start_date`/`end_date` 取约 **60 个交易日**的区间（end 用最近交易日，start 往前推约 3 个月）。
- 返回字段：`date/open/high/low/close/volume/amount/turnover`，按日期升序，用最后一根为「最新」。

> 若同时项目服务在跑，也可用 `GET http://localhost:3002/api/stock/kline?code=<码>&period=101&count=60`（东财 push2his，字段含 `changePct`）。两者择一即可，**默认走 akshare MCP**。

## 2. 基本面快照（PE/PB/ROE/市值/行业等）

按优先级降级：

1. **项目服务在跑时优先**（字段最全，东财 F10）：
   `GET http://localhost:3002/api/stock/fundamentals?code=<码>`
   返回 `StockFundamentals`：`name,pe,pb,ps,roe,grossMargin,netMargin,revenueGrowth,profitGrowth,marketCap,eps,bvps,industry,turnoverRate,volumeRatio,debtRatio` 等。
2. **兜底直取东财**（无需服务）：WebFetch
   `https://push2.eastmoney.com/api/qt/stock/get?fltt=2&secid=<secid>&fields=f57,f58,f162,f167,f173,f184,f105,f116,f117,f9`
   （f57 代码 / f58 名称 / f162 PE(动) / f167 PB / f173 ROE / f116 总市值 / f117 流通市值 / f9 PE(静)）。
3. **再兜底**：`mcp__plugin_financial-analysis_akshare__get_financial_statements` 取财报后自算比率。

## 3. 消息面（新闻 + 情绪）

1. **项目服务在跑时优先**：
   `GET http://localhost:3002/api/stock/news?code=<码>&count=10`
   返回 `{ news: [{title,url,time,source,snippet}], code }`。
2. **兜底直取东财资讯**（已实测，需带 `User-Agent`/`Referer` 头）：
   `https://np-listapi.eastmoney.com/comm/web/getListInfo?client=web&mTypeAndCode=<secid>&type=1&pageSize=10&pageIndex=1`
   返回 `data.list[]`，取 `Art_Title`（标题）、`Art_ShowTime`（时间）、`Art_Url`（链接）。
   （旧的 `search-api-web.eastmoney.com/search/jsonp` 现返回 400，已弃用。）
3. **再兜底**：WebSearch「<名称> 最新消息/公告」。

## 4. 归档深度基本面报告（仅项目服务在跑时）

`GET http://localhost:3002/api/analysis/fundamental/latest?query=<码或名称>`
返回 `{ found, createdAt, reportMd, summary, ageDays, stale }`（>30 天为 stale）。有则在基本面段落附「历史深度报告摘要」，无则跳过。

## 5. 服务探活与降级（务必静默）

- 任何 `localhost:3002` 调用前，先探活：`curl -s -m 2 http://localhost:3002/api/stock/kline?code=600519&period=101&count=1`。
- 探活/请求失败 → **静默降级**到对应的 MCP / 东财直取兜底，**不要**把「服务没开」当报错抛给用户。
- 全部数据源都拿不到时，才提示「无法获取 <数据维度> 数据」，并继续输出其余可得维度。

## 来源依据（项目内，只读参考，勿改）

- `server/services/ashare.ts` — kline / fundamentals 上游（东财 push2 为主，Sina 兜底）
- `server/services/webSearch.ts` — 东财资讯 `type=8001`
- `server/routes/mcp.ts` — `/api/stock/{kline,fundamentals,news}` 路由
- `server/routes/analysis.ts` — `/api/analysis/fundamental/latest`
- `src/agent/tools/*` — 客户端工具对应关系
