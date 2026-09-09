---
name: daily-review
description: 执行 A 股收盘复盘归档、叙事注入及日度日志，或响应 /daily-review [日期]。仅适用于上游数据仍对应目标收盘日的窗口；单纯分析行情不触发落盘。
---

# 每日收盘复盘

这是写入工作流：`server/scripts/backfillDay.ts` 当前默认运行六步
`ladder,screener,structure,tempo,review,forward`，写入 `docs/ladder/`、
`docs/screener/`，PG 可用时同步快照；叙事另行注入日志。

## 日期与前置条件

- 输入 `/daily-review [YYYY-MM-DD]`。省略日期取最近已完成交易日并说明选择，
  结合上海时区、交易日历及上游真实日期；周末不机械询问或假定周五一定开市。
- 今日归档等到上海时间 15:10 后，并确认数据已定盘。脚本的工作日时间推算
  和 15:30 时钟垫片不能证明上游数据日期正确，也不提供任意历史回放。
- 检查项目依赖与 PG 状态。PG 缺失不阻断磁盘归档，但说明入库及连续性限制；
  环境修复仅在任务需要时进行，不默认要求启动 Docker Desktop。
- 日期不符时先诊断。`--force` 仅用于日历判断错误且已核实上游为目标日定盘数据；
  不用于绕过盘中、未来或错日数据限制。窗口关闭后改用真实历史数据或报告阻塞。

## 运行与核验

将 shell 工作目录设为 `server/`，使用已安装的 tsx：

```powershell
node node_modules/tsx/dist/cli.mjs scripts/backfillDay.ts <YYYY-MM-DD>
```

1. 检查退出码和六步摘要，核对计算/磁盘 `asof`、覆盖及实际生成时间。
   连板档检查 `archiveStage`；`core-settled` 必须保留
   `formalSignalEligible=false`，文件存在不代表完整或可交易。
2. 选股质量以当前服务的覆盖率、日期与降级标记为准；`universe<3000`
   只是遗留告警，超过它不等于质量通过。不得用固定全市场家数放行归档。
3. 失败只重跑受影响步骤及其依赖，例如选股恢复后
   `--only=screener,review,forward`。限流时换可用来源或有依据地退避；
   没有状态变化不反复重试，记录未完成部分。
4. structure 缺失时可运行
   `node node_modules/tsx/dist/cli.mjs scripts/backfillStructure.ts <日期>`。
   核对数据来源、日期、生成时间与重构标记；默认已有档会跳过。
   `--overwrite` 只用于已确认的档案修复，不能以更弱数据覆盖较强档。

## 叙事与交付

读取目标日复盘和选股档的数据区；已有合格叙事无需重写。需要补写或修订时，
由当前执行助手根据 `server/services/dailyReviewPrompt.ts` 的
`REVIEW_SYSTEM_PROMPT` 撰写：只用档案事实，全文不超过350字，保留
`**一句话定调**`、`### 今日主线`、`### 明日关注` 格式及其内容边界。
用文件编辑工具保存 UTF-8 临时文件，避免通过 shell 插值传递多行正文。

在 `server/` 运行：

```powershell
node node_modules/tsx/dist/cli.mjs scripts/injectNarrative.ts <日期> <叙事文件绝对路径>
```

已授权修订现有叙事时使用 `--force`。核对目标 review 的
`narrative.markdown/tone` 和 `docs/screener/daily-journal.md` 同日条目。
日志是幂等更新；`docs/screener/` 被 gitignore，不是唯一留存。

仅在需要刷新运行中页面且服务对应目标日期时，刷新 daily-review 缓存后读取
`/api/screener/daily-review`；历史归档以目标文件为准，不因 API 返回最新日重跑。
汇报目标日、市场摘要、实际成功步数/请求步数、降级项、叙事/日志及 PG 状态。
部分成功应保留有效成果并说明余项，不把叙事缺失报告为完整交付。
