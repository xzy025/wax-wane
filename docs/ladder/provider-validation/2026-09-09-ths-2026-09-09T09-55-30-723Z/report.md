# 同花顺连板日 K 并行校验 2026-09-09

状态：research-only；providerAt=null；不能据此放行正式候选。

冻结证据：D:\AI\codex\todo-list\docs\ladder\2026\09\09\evidence-limit-ladder-v6.json
证据 SHA256：482d61981a45598f3ab02c739ce83be2799eef67aa66399f15fa982c2b9bed60
窗口：2026-08-31—2026-09-09；股票 48/48；请求 96。
OHLCV 一致 96；不一致 0；无效响应 0；不可用 0。

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
| 000523 | qfq | ohlcv-agrees |
| 000523 | raw | ohlcv-agrees |
| 000565 | qfq | ohlcv-agrees |
| 000565 | raw | ohlcv-agrees |
| 000759 | qfq | ohlcv-agrees |
| 000759 | raw | ohlcv-agrees |
| 000798 | qfq | ohlcv-agrees |
| 000798 | raw | ohlcv-agrees |
| 000912 | qfq | ohlcv-agrees |
| 000912 | raw | ohlcv-agrees |
| 000930 | qfq | ohlcv-agrees |
| 000930 | raw | ohlcv-agrees |
| 000972 | qfq | ohlcv-agrees |
| 000972 | raw | ohlcv-agrees |
| 000978 | qfq | ohlcv-agrees |
| 000978 | raw | ohlcv-agrees |
| 000980 | qfq | ohlcv-agrees |
| 000980 | raw | ohlcv-agrees |
| 000993 | qfq | ohlcv-agrees |
| 000993 | raw | ohlcv-agrees |
| 002040 | qfq | ohlcv-agrees |
| 002040 | raw | ohlcv-agrees |
| 002046 | qfq | ohlcv-agrees |
| 002046 | raw | ohlcv-agrees |
| 002068 | qfq | ohlcv-agrees |
| 002068 | raw | ohlcv-agrees |
| 002077 | qfq | ohlcv-agrees |
| 002077 | raw | ohlcv-agrees |
| 002155 | qfq | ohlcv-agrees |
| 002155 | raw | ohlcv-agrees |
| 002162 | qfq | ohlcv-agrees |
| 002162 | raw | ohlcv-agrees |
| 002295 | qfq | ohlcv-agrees |
| 002295 | raw | ohlcv-agrees |
| 002349 | qfq | ohlcv-agrees |
| 002349 | raw | ohlcv-agrees |
| 002377 | qfq | ohlcv-agrees |
| 002377 | raw | ohlcv-agrees |
| 002470 | qfq | ohlcv-agrees |
| 002470 | raw | ohlcv-agrees |
| 002498 | qfq | ohlcv-agrees |
| 002498 | raw | ohlcv-agrees |
| 002790 | qfq | ohlcv-agrees |
| 002790 | raw | ohlcv-agrees |
| 600121 | qfq | ohlcv-agrees |
| 600121 | raw | ohlcv-agrees |
| 600192 | qfq | ohlcv-agrees |
| 600192 | raw | ohlcv-agrees |
| 600255 | qfq | ohlcv-agrees |
| 600255 | raw | ohlcv-agrees |
| 600359 | qfq | ohlcv-agrees |
| 600359 | raw | ohlcv-agrees |
| 600403 | qfq | ohlcv-agrees |
| 600403 | raw | ohlcv-agrees |
| 600540 | qfq | ohlcv-agrees |
| 600540 | raw | ohlcv-agrees |
| 600698 | qfq | ohlcv-agrees |
| 600698 | raw | ohlcv-agrees |
| 600778 | qfq | ohlcv-agrees |
| 600778 | raw | ohlcv-agrees |
| 600792 | qfq | ohlcv-agrees |
| 600792 | raw | ohlcv-agrees |
| 600865 | qfq | ohlcv-agrees |
| 600865 | raw | ohlcv-agrees |
| 600869 | qfq | ohlcv-agrees |
| 600869 | raw | ohlcv-agrees |
| 601579 | qfq | ohlcv-agrees |
| 601579 | raw | ohlcv-agrees |
| 601872 | qfq | ohlcv-agrees |
| 601872 | raw | ohlcv-agrees |
| 601890 | qfq | ohlcv-agrees |
| 601890 | raw | ohlcv-agrees |
| 603042 | qfq | ohlcv-agrees |
| 603042 | raw | ohlcv-agrees |
| 603162 | qfq | ohlcv-agrees |
| 603162 | raw | ohlcv-agrees |
| 603186 | qfq | ohlcv-agrees |
| 603186 | raw | ohlcv-agrees |
| 603308 | qfq | ohlcv-agrees |
| 603308 | raw | ohlcv-agrees |
| 603328 | qfq | ohlcv-agrees |
| 603328 | raw | ohlcv-agrees |
| 603421 | qfq | ohlcv-agrees |
| 603421 | raw | ohlcv-agrees |
| 603650 | qfq | ohlcv-agrees |
| 603650 | raw | ohlcv-agrees |
| 603900 | qfq | ohlcv-agrees |
| 603900 | raw | ohlcv-agrees |
| 605077 | qfq | ohlcv-agrees |
| 605077 | raw | ohlcv-agrees |
| 605162 | qfq | ohlcv-agrees |
| 605162 | raw | ohlcv-agrees |
| 605198 | qfq | ohlcv-agrees |
| 605198 | raw | ohlcv-agrees |
