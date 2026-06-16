---
name: equity
description: 对A股标的做全维度综合研究（Equity Research）——技术面+基本面+消息面+综合结论一份完整研报，复刻项目的多Agent个股分析编排器。当用户要某只股票的综合分析、完整研报、全面评估、值不值得买，或直接输入 /equity <代码> 时触发。
---

# /equity — 标的全维度综合研究

对单只 A 股出一份**完整研报** = 技术面 + 基本面 + 消息面 + 综合评价。复刻项目
`src/agent/multi-agent/orchestrators/stock-analysis.orchestrator.ts`（三维并行 → 综合）。
`/equity` ⊇ `/ta` + `/fa` + 消息面 + 综合。

## 输入

`/equity <6位代码或中文名> [交易模式id ...]`
- 例：`/equity 600519`、`/equity 宁德时代 2b-buy`、`/equity 300750 wyckoff sentiment`
- 交易模式 id 见 methodology.md；未给则默认 `wyckoff` + `dow` + `price-action` + `sentiment`。

## 步骤

1. **解析标的**：按 `.claude/skills/_shared/data-sources.md` 第 0 节规范化为 6 位代码。
2. **并行取数**（按 data-sources.md，失败各自静默降级）：
   - K 线（第 1 节）
   - 基本面快照 + 归档深度报告（第 2、4 节）
   - 个股新闻（第 3 节）
3. **读交易模式**：读 `src/agent/tradingPatterns.ts` 取所选模式的 analysisGuide。
4. **三维分析**（口径见 `.claude/skills/_shared/methodology.md`）：
   - 技术面（第二节）
   - 基本面（第三节）
   - 消息面（第四节）
5. **综合判断**（第五节）：汇总三维方向信号给综合结论，结合所选交易模式给可执行建议（入场/仓位/止损位参考）。
6. **输出完整四段报告**（第六节格式）：

```
## 📊 个股分析报告 — {名称}（{代码}） — {YYYY/M/D}

### 一、技术面分析
...（技术信号: **...**）

### 二、基本面分析
...（估值判断: **...**）

### 三、消息面分析
...（消息面情绪: **...**）

### 四、综合评价
- 跨维度方向：**综合偏多/中性/偏空**
- 各维度结论与分歧点
- 交易模式对照与可执行建议
- 风险提示

> 本分析由数据自动生成，仅供研究参考，不构成投资建议。
```

## 注意
- 若某维度数据彻底拿不到，该段注明「无数据」，其余维度照常输出。
- 只读项目源码，不修改 `src/`、`server/`。
- 无需任何 API key（综合那一步由我直接完成）；不使用 tushare。
