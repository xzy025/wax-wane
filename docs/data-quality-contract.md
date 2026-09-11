# 数据质量闭环契约

## 目标

本项目不能控制上游行情供应商是否永远正确或可用，但必须保证：未经证明的数据不会被当成正式数据使用；无法证明时显式降级或阻断；正式结果可以通过原始哈希、时间和规则版本复现。

## 数据分层

1. **原始证据**：供应商原始响应，追加写入，不覆盖。
2. **规范化数据**：统一字段、单位、复权口径、交易日和来源元数据。
3. **派生结果**：指标、候选、评分和快照，必须记录输入哈希与规则版本。

统一响应结构见 [dataQuality.ts](../server/market-data/dataQuality.ts) 和 [marketDataSource.ts](../server/market-data/marketDataSource.ts)。

## 用途门槛

| 用途 | 允许降级/过期 | 最低要求 |
| --- | --- | --- |
| display | 可以，但必须标注 | 不得把 unavailable 当成成功 |
| research | 可以，但必须标注 | 不得声称具备正式交易资格 |
| scoring | 不可以 | full、来源时间、asOf、覆盖率和生产来源 |
| formal | 不可以 | scoring 全部要求，并且必须是已结算的正式快照 |

用途级门槛由 [qualityPolicy.ts](../server/market-data/qualityPolicy.ts) 执行。正式快照还必须通过 [snapshotPolicy.ts](../server/market-data/snapshotPolicy.ts)。

## 正式快照不变量

- 只接受 `close + confirmed + closed=true`。
- 行情 `asOf` 必须等于快照交易日。
- `universe >= 97%`、报价/新鲜报价 `>= 98%`、历史 K 线 `>= 95%`、跨源一致率 `>= 95%`。
- 同日较低覆盖率、过期、降级或临时结果不得覆盖已确认结果。
- 当前投影用于兼容旧读者；每次接受的写入同时追加到 `screener_snapshot_revisions`，不得原地修改审计记录。
- 研究源、shadow 源和缺少必要时间证据的数据不能进入正式评分或执行资格。
- 正式用途的 `providerAt` 必须是可解析时间，且不能晚于本系统的 `receivedAt`；上游时钟超前或字段语义不明时保持阻断。

## 变更要求

新增 Provider、缓存或派生指标时，必须同时补齐：

- `datasetId`、schema 版本、来源、请求/接收/上游时间和 `asOf`；
- 覆盖率、缺失原因、回退链、原始哈希和调整口径；
- display/research/scoring/formal 的用途判定；
- 正常、空响应、部分响应、过期、日期错位、跨源冲突和重复写入测试。

质量字段不能只在 UI 展示；正式入口必须调用质量闸门。

## 运维审计

`GET /api/ops/data-quality` 是只读审计入口：只读取本地选股/连板归档和
PostgreSQL 快照投影，不触发行情抓取、不修复文件。它分别报告选股正式快照、
连板核心归档、连板 enriched 正式信号和数据库修订链；`block` 表示不能把对应
结果当作正式输入，`warn` 表示可回看但仍存在新鲜度或证据缺口。

实时市场风险闸门也会将未通过评分用途契约的 A 股综合行情从评分输入中剔除，
并保留阻断原因。`receivedAt` 只能证明本系统收到数据，不能替代上游
`providerAt`。
