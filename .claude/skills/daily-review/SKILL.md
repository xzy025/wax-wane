---
name: daily-review
description: 执行A股每日收盘后复盘流水线(五步回填+Claude撰写叙事+注入存档+累积日志)。当用户要求跑每日复盘、收盘复盘、战法复盘落盘、日度流水线、补当日/某日档,或直接输入 /daily-review [日期] 时触发。仅限交易日收盘后(≥15:10 北京时间)执行。
---

# /daily-review — 每日收盘复盘 SOP

## 输入

`/daily-review [YYYY-MM-DD]` — 省略日期=今天(上海时区)。周末给日期默认指上周五,先与用户确认。

## 步骤

0. **前置检查**
   - Docker/PG 探活:`docker ps` 应见 `trade-review-pg`;引擎没起先启动 Docker Desktop(容器随之自启)。PG 掉线非致命(快照仅落磁盘),但丢 appearStreak 连续性,能修先修。
   - 时间闸门:目标日=今天时必须 ≥15:10 北京时间,盘中拒绝执行(数据未定盘)。**注意沙箱 shell 的 `date` 可能显示 UTC,判断北京时间用 `date -u` 加 8 小时**。

1. **跑流水线**(cwd 必须是 server 目录,`npm --prefix` 不切换 cwd 会 ERR_MODULE_NOT_FOUND)
   `cd server && npx tsx scripts/backfillDay.ts <date>`
   - 五步=选股快照/structure/tempo/review/forward。闸门报「完结交易日不符」而你确认确为目标日盘后(如法定节假日调休):加 `--force`。

2. **核验快照质量(clist 限流陷阱)**
   读 `docs/screener/<date>.json` 的 `universe`:应≈5540。**<3000 = 东财 clist 限流静默降级档**,等约 20 分钟冷却后重跑 `npx tsx scripts/backfillDay.ts <date> --only=screener,review,forward`;不要立即连环重试(延长封锁)。PG 在跑时对照:`docker exec trade-review-pg psql -U postgres -d trade_review -tAc "SELECT asof,universe,regime_phase FROM screener_snapshots ORDER BY asof DESC LIMIT 3"`。

3. **structure 失败处理(东财板块K线断供常态)**
   structure 步 ❌ 时同日执行 `npx tsx scripts/backfillStructure.ts <date>`(recon-eqw 等权重构)。
   **假✅陷阱:必须核验 `structure-<date>.json` 的 `generatedAt` 是刚才的真实时间**——磁盘兜底旧档会伪装成功;重构档应带 `reconstructed:true`。次日 09:20–09:35 若东财板块日K放行,可 `backfillStructure.ts <date> --overwrite` 升级为精确档。

4. **Claude 撰写叙事**(会话内完成,不依赖 Gemini)
   材料=`review-<date>.json` 数据区(外围/消息/龙虎榜/A股/结构)+ `<date>.json` 的 regime 与各战法命中。硬规则与 `server/services/dailyReviewPrompt.ts` 的 REVIEW_SYSTEM_PROMPT 一致:
   - 只用档案数据,禁止编造数字/个股/事件;缺失段落直接跳过。
   - 不做投资建议、不荐股、不预测点位;用「关注/留意」,禁用「买入/看多」。
   - 全文 ≤350 字,严格三段:`**一句话定调**:<≤40字>` → `### 今日主线`(2~4条) → `### 明日关注`(2~3条),无前言无代码围栏。
   - 用 Write 工具存到 scratchpad 临时文件(UTF-8),**绝不经 PowerShell/bash 引号传中文多行文本**。

5. **注入 + 日志**
   `cd server && npx tsx scripts/injectNarrative.ts <date> <叙事md绝对路径>`
   - 一条命令完成:review 档注入(prior 复用机制保证对后续一切重算持久)+ `docs/screener/daily-journal.md` 幂等 upsert(最新在前,同日重跑整块替换不重复;数据摘要由脚本从五档磁盘真值自动生成)。
   - 修订已注入的叙事:加 `--force`(注入错稿不会自愈,这是唯一修复途径)。

6. **终验与汇报**
   - 文件级:`review-<date>.json` 的 narrative.tone 非空;`daily-journal.md` 顶部有 `## <date>` 条目。
   - API 级(dev server 在跑时):`curl -X POST localhost:3002/api/refresh?market=daily-review` 后 `GET /api/screener/daily-review` narrative 非 null(前端复盘卡即显示)。
   - 聊天末尾输出当日总结(见「输出」)。

## 输出

```
## 📋 每日复盘 — <date>
定调:<一句话定调>
市况:<regime·温度·涨停/跌停·上涨/下跌>
命中:<各战法计数一行>
落盘:<n>/5 ✅(universe <n> / structure <实跑|重构> / 叙事已注入 / 日志已更新)
> 数据自动生成,仅供复盘参考,不构成投资建议。
```

## 注意

- 本技能只写 `docs/screener/`(生成物)与 scratchpad 临时文件;不修改 `src/`、`server/services/` 源码。
- `docs/screener/` 已 gitignore,daily-journal.md 不在版本控制内,勿当唯一留存。
- 周末:backfillDay 拒绝周末日期,补周五用周五的日期(时钟垫片会伪装成周五 15:30)。
- 叙事失败/跳过不阻断落盘(narrative=null 也能落),但本 SOP 的意义就是叙事不再依赖外部 LLM——第 4 步由执行本技能的 Claude 本体完成。
