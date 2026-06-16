---
name: ta
description: 对A股标的做技术分析（Technical Analysis）。覆盖K线/量价/趋势/形态、Wyckoff量价阶段、道氏理论、Al Brooks价格行为，并可套用项目交易模式。当用户提到某只股票的技术面、走势、K线、量价、支撑阻力、买卖点，或直接输入 /ta <代码> 时触发。
---

# /ta — 标的技术分析

对单只 A 股做**技术面**分析（不含基本面/消息面，那两块用 `/fa`、`/equity`）。

## 输入

`/ta <6位代码或中文名> [交易模式id ...]`
- 例：`/ta 600519`、`/ta 宁德时代 2b-buy`、`/ta 300750 wyckoff dow`
- 交易模式 id 见 `.claude/skills/_shared/methodology.md`；未给则默认套 `wyckoff` + `dow` + `price-action`。
- **Larry Williams 短线交易秘诀（%R / 波动突破 / Oops / Smash Day / 短线摆动点）始终叠加输出**，无需指定。

## 步骤

1. **解析标的**：按 `.claude/skills/_shared/data-sources.md` 第 0 节把输入规范化为 6 位代码（中文名先解析）。拿不到合法代码就提示用户给 6 位码，停止。
2. **取 K 线**：按 data-sources.md 第 1 节取约 60 根日线（默认 akshare MCP；项目服务在跑可用 kline 接口）。失败按第 5 节降级；彻底无数据则告知并停止。
3. **读交易模式**：读 `src/agent/tradingPatterns.ts`，取本次要套用的模式的 `analysisGuide` 与关键要素。
4. **分析**：按 `.claude/skills/_shared/methodology.md` 第二节（技术面映射）逐项计算：5/20日涨跌、20日区间位置、量比与放缩量、K线形态、Wyckoff阶段、支撑阻力、多空信号；再用第一节逐条对照所选交易模式的关键要素，指出符合/不符合。
5. **输出**：只出技术面单段，结构如下，末尾用粗体给 `技术信号`，并附免责声明行。

```
## 📈 技术面分析 — {名称}（{代码}） — {YYYY/M/D}
- 最新价 / 涨跌幅
- 5日 / 20日涨跌
- 20日区间位置
- 量能（5/20日量比）
- K线形态（如有）
- Wyckoff阶段判断
- 支撑位 / 阻力位
- **Larry Williams 短线信号**：%R(10) 读数与超买/超卖、上破/下破触发位、Oops/Smash 判定、最近短线摆动高低点 → 短线倾向
- 交易模式对照：{逐条 符合/不符合}
- 技术信号: **偏多/中性/偏空**

> 本分析由数据自动生成，仅供研究参考，不构成投资建议。
```

## 注意
- 只读项目源码，不修改 `src/`、`server/`。
- 无需任何 API key；不使用 tushare。
