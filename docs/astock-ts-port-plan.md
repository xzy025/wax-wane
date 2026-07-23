# a-stock-data 剩余端点 TS 移植计划

> 2026-07-14 立项。架构裁决(8-agent 工作流+对抗校验)已定:**继续 TS 逐端点移植,否决后端 Python 化**。
> 依据:a-stock-data 不是 pip 包(0 个 .py,SKILL.md 单文件内嵌 47 个代码块,作者定调永不包化),
> 改 Python 换不来 import/自动更新;全量重写 45~70 人日 vs 本计划 16~27 小时。
> 情报源:`D:\AI\Vibe-Research\a-stock-data\SKILL.md`(v3.4.0,Apache-2.0,翻译合法)。

## 总览

| # | 项 | 预估 | commit 粒度 | 状态 |
|---|---|---|---|---|
| ② | 全局东财节流 `emFetch` | 4~6h | `8bb7941` | ✅ 已完成(2026-07-16;18 文件 741+,probe:emfetch 实抓验收) |
| ③ | 解禁角标 | 3~5h | 本 commit | ✅ 已完成(2026-07-16;liftBan 服务+9 卡角标+probe:liftban;⚠实测 FREE_RATIO 可>1=首发解禁达流通盘数倍) |
| ⑤ | 股东户数(数据侧) | 2~3h | 单 commit | ✅ 已完成(2026-07-23;holderNum 服务+吸筹组纯展示徽标+probe:holdernum;⚠实抓证伪 SKILL 列名:户均持股=AVG_HOLD_NUM、RATIO 已是百分数;LATEST 表一股一行、in(...) 批量 filter 可用。因子回测另计 4~8h 未开工,过线前不进评分) |
| ⑥ | 研报主动拉取 | 3~5h | 单 commit | 待做 |
| ④ | 交易所官方备胎 | 4~8h | 单 commit | 待做(最后) |
| ① | 财联社三源 | — | `0bea24f` | ✅ 已完成(移植成本基准:6 文件 +209 行,签名 17 行) |

**顺序理由**:② 是横切基础设施,先落地可保护后面所有新增抓取(盘后一键扫描是高危批量场景);③⑤ 是项目已抄熟 5 遍的 datacenter 模式换 reportName,速赢;⑥ 复用 feishuSync 落盘管道;④ 是降级路径改造,依赖面最广放最后。

**前置**:当前工作树有三栈待 commit(落盘修复 / 飞书同步 / stale 补扫)+ feat/screener-accum 未提交改动,先收尾再开工,避免混杂。

**统一验收标准**(每项 commit 前):
- server 测试基线 523 passed + 4 skipped 不倒退,新增逻辑带纯函数测试(fetch 层保持薄)
- 前端基线 419 不倒退;涉及 UI 的项补组件测试 + i18n(en.ts/zh.ts 双语)
- `npm run lint` 0 error、tsc 无新增错
- 每项加/复用 `npm run probe:*` 探针实抓验证(现有 7 个 probe 脚本惯例)

---

## ② 全局东财节流 `server/lib/emFetch.ts`(4~6h)

**现状**:项目零全局节流(grep throttle/rateLimit 只命中注释),防护全靠镜像轮换——`ashare.ts:754-768` tripKlineHost 60 秒熔断、`screener.ts:236` CLIST_HOSTS 三镜像、`fundFlow.ts:12` FF_HOSTS、mapLimit 并发 12/15。实测风控阈值:>5/s、1min≥200、5min≥300 封 IP。

**SKILL 对应**:`em_get()`(L342-403,核心节流+session+重试约 33~57 行 Python):Session 复用 + 429/5xx 指数退避 + 403 不重试 + 最小间隔 1s + 抖动。

**TS 设计**(~100 行 + 测试):
- 新建 `server/lib/emFetch.ts`:Promise 串行队列 + 按域名分级最小间隔 + AbortSignal 超时 + 指数退避重试(403 不重试)。undici fetch 自带 Keep-Alive,无需新依赖。
- **不照抄 1s 串行**:screener 全市场扫描(top600 逐股拉 K 线,CONCURRENCY=12)照抄会拖到 10 分钟级。按端点分级:`datacenter-web`(低频报表)用 ~1s 间隔;`push2his` K 线用更短间隔或令牌桶;现有镜像轮换+熔断保留为第二层防线,不动。
- **接线**:12 个非测试文件共 30 处东财 URL 字面量改走统一入口——ashare.ts 10 处、moneyflow.ts 5 处、orgSurvey/hotlist/rotation 各 2 处、fundFlow/emQuotes(host 模板变量)、f10/newsFlash/stockSearch/webSearch 各 1 处。全是机械替换。

**测试**:队列间隔/退避/403 短路的纯函数测试(fake timers);probe 实跑盘后扫描确认不劣化耗时。

---

## ③ 解禁角标(3~5h)

**SKILL 对应**:§3.6(L1237-1300),`RPT_LIFT_STAGE` 走 `datacenter-web.eastmoney.com/api/data/v1/get`,纯 JSON GET、零签名。**必须用新列名 `FREE_SHARES_TYPE`/`FREE_SHARES`/`able_shares`(旧列名恒空)**。

**设计**:
- 服务层 ~1h:新建 `server/services/liftBan.ts`,照抄 `orgSurvey.ts:89` 的 datacenter 调用模式(项目已抄过 5 张 RPT_* 报表:DAILYBILLBOARD/BILLBOARD_DAILYDETAILS/ORG_SURVEYNEW/F10_*),换 reportName + 字段映射。会话 TTL 缓存(lib/cache.ts)。
- 前端:选股卡片右上角风险角标,复用「连N」药丸(computeStreaks)的展示模式——未来 N 日内有解禁则显示「解禁」徽标 + tooltip(日期/解禁量占比)。i18n 双语。
- 接线:screener enrich 阶段批量查(仿 enrichRelStrength 事后批量模式),不进规则层不影响回测。

**测试**:字段映射纯函数测试(fixture 用真实响应)+ 组件测试;probe 实抓验证新列名非空。

---

## ⑤ 股东户数(数据侧 2~3h;因子回测另计 4~8h)

**SKILL 对应**:§4.3(L1522-1552),`RPT_HOLDERNUMLATEST`,与③完全同构的 datacenter 模式。

**设计**:
- 服务层:`server/services/holderNum.ts`,reportName + 5 字段映射(户数/变化率/披露日期),同③模式。
- **⚠ 铁律**:接 screener 打分前必须先回测,且**按披露日对齐**(季度披露口径有前视风险——FUNDRES 披露日前视坑已付过学费)。因子分桶回测 4~8h 与语言无关,单独立项,数据侧先落地供 [[screener-accum]] 吸筹监控做确认因子展示(纯展示不计分,不需回测门槛)。

**测试**:映射纯函数测试 + probe 实抓;回测裁决通过前不进任何战法评分。

---

## ⑥ 研报主动拉取(3~5h)

**SKILL 对应**:§2.1(L588-720),`reportapi.eastmoney.com/report/list` 分页 JSON(零签名,仅需 Referer 头)+ `pdf.dfcfw.com/pdf/H3_{infoCode}_1.pdf` 二进制下载。

**设计**:
- 新建 `server/services/reportPull.ts`:按关注列表/板块拉当日研报清单 → 下载 PDF。
- **落盘管道直接复用 `feishuSync.ts:176-185` 既有模式**:远端拉 PDF → `.part` 临时文件 → rename 进 RESEARCH_DIR → 按文件名幂等去重。下游 research 流水线(指纹幂等 → LLM 分析 → 当日汇总)零改动自动接手——等于把「飞书消息源」换成「东财 reportapi 源」,两源并存。
- 触发:挂进盘后一键扫描,或 intel 路由加手动触发端点。

**可选扩展(默认不做)**:§2.2 同花顺一致预期 EPS 是 HTML 表格,TS 需引 cheerio(+2~3h);§2.3 iwencai 需申请 API key——均不进本期。

**测试**:清单解析/文件名生成纯函数测试;probe 实抓一篇 PDF 验证管道端到端。

---

## ④ 交易所官方备胎(4~8h)

**SKILL 对应**:「备用源速查」(L2651-2733),3 个备胎函数,全零鉴权 HTTP:
- `dragon_tiger_backup`:深交所 JSON + 上交所 JSONP(返回 `fileContents` 纯文本行)
- `fund_flow_backup`:新浪日度四档资金流 JSONP(注意:这是新浪源,非交易所)
- `announcements_backup`:深交所 POST JSON(⚠沪市段实际走东财 np-anotice,与东财主源同风控面,不算独立备胎)

**设计**:
- 新建 `server/services/exchangeBackup.ts`,接线进 lhbHistory/moneyflow/fundFlow 的 allSettled 降级路径(主源失败才走)。
- 三个已知坑:(a) szse 需 TLS 放行——undici Agent `rejectUnauthorized:false` 等价 Python 的 `ssl.CERT_NONE`;(b) 上交所龙虎榜纯文本先存 raw(SKILL 自己也只给 raw),结构化席位解析 +2~3h 视需求;(c) szse annList 是 POST JSON 非 GET。
- 券商评级备胎的 AES-128-CBC `Accept-Enckey`(key=iv 固定串,node:crypto 十行)——项目用不到,不做。

**测试**:fixtures 降级路径测试(主源 reject → 备胎接管);probe 实抓两所各一条。

---

## 明确不做(负清单)

- **mootdx**(通达信 TCP 7709 二进制):其 K 线/五档/F10 用途已被东财+腾讯 HTTP 覆盖;唯一无 HTTP 等价的是逐笔成交,当前无战法消费。若将来需要 → **spawn 一次性 Python 脚本逃生舱**(半天搭 runner:spawn + JSON stdout + `PYTHONIOENCODING=utf-8`,零端口零常驻避 winnat 坑,冷启动实测 0.5~1.5s 仅限低频),不上常驻 sidecar、不改后端语言。
- 百度K线 / ETF期权 / iwencai(需 key)/ 同花顺一致预期(HTML 解析):无消费方,不融。

## 上游追更机制

上游节奏 ~4.7 天一版,半数是救火修复(字段改名/签名变),delta 语言无关分钟级。约定:每次去 `D:\AI\Vibe-Research\a-stock-data\` `git pull` 后读 CHANGELOG,只搬「本项目已移植章节」的变更(§5.2 财联社、§3.6 解禁、§4.3 股东户数、§2.1 研报、备用源速查);其余章节变更忽略。
