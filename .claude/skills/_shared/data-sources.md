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
- **港股**为 5 位代码（如 `02476`），`secid` 前缀 `116.`，取数走第 7 节（A 股接口不适用）。

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

## 6. 市场级情绪数据（`first-board` 首板涨停 / `sentiment` 情绪周期模式用）

个股 K 线不含市场情绪；套这两个模式时需取**全市场涨停/跌停家数、连板梯队、个股实时涨停状态**。按优先级降级：

1. **项目服务在跑时优先**：`GET http://localhost:3002/api/mcp/ashare/limit-pool`、`/api/mcp/ashare/breadth`、`/api/sentiment`（开盘啦情绪温度）。
2. **兜底直取东财涨停/跌停池**（已实测，需 `User-Agent`/`Referer` 头）：
   - 涨停池：`https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=<n>&sort=fbt:asc&date=<YYYYMMDD>`
   - 跌停池：`https://push2ex.eastmoney.com/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=<n>&sort=fund:asc&date=<YYYYMMDD>`
   - 返回 `data.tc` = 当日家数；`data.pool[]` 每项含 `n`名称/`c`代码/`lbc`连板数/`zbc`炸板次数/`hybk`所属板块/`zttj.days`(几天)`.ct`(几板)/`fbt`首封时间。
   - 注意：`date` 入参常被忽略，实际返回最新交易日（看响应 `data.qdate`，盘中为当日实时家数）；要高连板梯队就拉大 `pagesize` 后按 `lbc` 排序。
3. **个股实时涨停状态**：`https://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&secid=<secid>&fields=f43,f170,f169,f171`
   → `f43`现价 / `f170`涨跌幅% / `f169`涨跌额 / `f171`振幅%（判断首板/二板/冲板未封）。
4. **再兜底（开盘啦，有反爬、低频）**：`POST https://apphq.longhuvip.com/w1/api/index.php`（form-encoded）
   `a=GetPlateInfo&st=10&apiv=w18&c=DailyLimitResumption&PhoneOSNew=1&Index=20&DeviceID=00000000-025d-1ffd-fa71-8fd5272bb997`
   → `nums`: `ZT`涨停/`DT`跌停/`ZBL`破板率%/`SZJS`上涨家数/`XDJS`下跌家数/`yestRase`昨日涨停今表现%。

> ⚠️ 解析提示：本机 `python -c` 会把**源码里的中文字面量**按 GBK 误解码（导致按板块名/关键词过滤失效、标签输出乱码）。凡是在 python 里写中文做过滤/比较，务必前缀 `PYTHONUTF8=1 python -c ...`；从 JSON 取出的中文打印/比较不受影响。

**情绪阶段速判**（喂给 `sentiment` 模式的四阶段）：
- 冰点：涨停 <~30、跌停偏多、无连板高度
- 修复：涨停回升、开始出现连板梯队
- 高潮：涨停 ~100+、跌停极少、高连板梯队、赚钱效应强（**= 见顶预警区**）
- 退潮：涨停数自高位明显回落、高位股炸板/跌停抬头、连板梯队断裂

## 7. 港股标的（纯港股 / A+H 两地上市）

港股 **akshare MCP `get_stock_quote` 不支持**（仅 A 股）；走东财行情 + 腾讯日线。代码为 5 位（如 `02476`），东财 `secid` 前缀 **`116.`**（`116.02476`）。

1. **行情/估值**（已实测）：`https://push2.eastmoney.com/api/qt/stock/get?fltt=2&invt=2&secid=116.<码>&fields=f57,f58,f43,f44,f45,f46,f60,f170,f171,f167,f116,f117,f127`
   → `f43`现价 / `f44`高 / `f45`低 / `f46`开 / `f60`昨收 / `f170`涨跌幅% / `f171`振幅% / `f167`PB / `f116`总市值 / `f117`流通市值。注意：港股 `f162`(PE) 常返 `-`。**价格单位为 HKD**。
2. **日线（主源，已实测）**：腾讯
   `https://web.ifzq.gtimg.cn/appstock/app/hkfqkline/get?param=hk<码>,day,,,<count>,qfq`
   → `data.hk<码>.qfqday[]`，每行 `[日期, 开, 收, 高, 低, 量, {}, 振幅%, 额, ...]`（**列序是 开/收/高/低**，与东财一致）。次新港股 bar 数较少属正常。
   - 东财 `push2his`（`secid=116.<码>`）对**次新港股常返空**，不作主源。
3. **实时兜底**：`https://hq.sinajs.cn/list=hk<码>`（需 sina Referer）。
4. **HKD/CNY 汇率**（A/H 折算用，已实测）：`https://hq.sinajs.cn/list=fx_shkdcny` → 取买价（约 0.86）；H 股价折人民币 = `H价(HKD) × 汇率`。
5. **A/H 溢价**（两地上市时）：`AH 溢价 = A价(CNY) / (H价(HKD)×汇率) − 1`。≈0 为平价、正数为 A 溢价（H 折价）。可交叉验证：两地**总市值在各自货币下应一致**。
6. **注意**：港股**无涨跌停**（单日振幅可远超 A 股），Larry Williams 的突袭日/突破位口径不变但波动更大；分析时标明币种。

## 来源依据（项目内，只读参考，勿改）

- `server/services/ashare.ts` — kline / fundamentals 上游（东财 push2 为主，Sina 兜底）
- `server/services/webSearch.ts` — 东财资讯 `type=8001`
- `server/routes/mcp.ts` — `/api/stock/{kline,fundamentals,news}` 路由
- `server/routes/analysis.ts` — `/api/analysis/fundamental/latest`
- `src/agent/tools/*` — 客户端工具对应关系
