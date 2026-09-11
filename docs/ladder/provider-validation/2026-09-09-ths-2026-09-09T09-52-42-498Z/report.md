# 同花顺连板日 K 并行校验 2026-09-09

状态：research-only；providerAt=null；不能据此放行正式候选。

冻结证据：D:\AI\codex\todo-list\docs\ladder\2026\09\09\evidence-limit-ladder-v6.json
证据 SHA256：482d61981a45598f3ab02c739ce83be2799eef67aa66399f15fa982c2b9bed60
窗口：2026-08-31—2026-09-09；股票 1/48；请求 2。
OHLCV 一致 2；不一致 0；无效响应 0；不可用 0。

契约：[历史行情字段](https://github.com/HiThink-Tech/Financial-API/blob/main/docs/api/endpoints-prices.md)

- Window parity only; does not certify the full archived history or historical point-in-time availability.
- Contract timestamp means latest bar upstream effective/ready time, not explicitly publication time; never copied to providerAt.
- Price tolerance 0.011 CNY; known native lots converted to shares with one-lot (100 shares) quantization tolerance; turnover tolerance 1 CNY.
- Missing peer turnover remains uncomparable; OHLCV agreement is not full parity or production eligibility.
- Raw SHA256 identifies the upstream response; report retains normalized bars only, not a byte-replay capture.

| 股票 | 复权 | 状态 |
|---|---|---|
| 000019 | qfq | ohlcv-agrees |
| 000019 | raw | ohlcv-agrees |
