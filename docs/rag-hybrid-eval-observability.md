# Wax Wane RAG 升级:混合检索 + 评测 + 可观测

> 2026-06 把 RAG 从「单一向量检索」升级为生产级三件套:**混合检索(Hybrid Retrieval)**、**离线评测(Eval)**、**可观测(Observability)**。这三项正好对应 AI 应用工程师面试的三个高频考点,且每项都有可运行的代码与可量化的结果。

---

## 1. 混合检索(Hybrid Retrieval)

**为什么**:原来只有 dense 向量检索(pgvector),对「罕见精确词」(股票代码 `300750`、标签「追高」、`Wyckoff`)召回差——这些词在 embedding 空间里会被「平均掉」。BM25 关键词检索正好互补。两者用 **RRF(Reciprocal Rank Fusion)** 融合,而不是二选一。

**链路**:`dense(pgvector) + lexical(BM25) → RRF 融合 → 可选 LLM rerank`

| 文件 | 职责 |
|---|---|
| `server/rag/tokenize.ts` | 中英混合分词(汉字 unigram + bigram + 拉丁词),BM25 与 embedding 的统一分词口径 |
| `server/rag/bm25.ts` | 纯函数 Okapi BM25(k1=1.5, b=0.75),内存索引 |
| `server/rag/fusion.ts` | RRF(rank-based,跨不同分数量纲安全)+ 可选加权分数融合 |
| `server/rag/rerank.ts` | 可选 cross-encoder 式重排(用 LLM 当打分器),**默认关闭**,无 LLM 时自动降级 |
| `server/rag/hybridSearch.ts` | 编排器:逐段埋 trace,单个检索失败时**独立降级**(DB 不可用时另一路仍可用) |
| `server/rag/vectorStore.ts` | 新增 `getCorpus()`(为 BM25 取全量语料);dense/lexical 共用 row→doc 构造器,保证 id/text 一致(融合按 id 对齐) |

**接口**:`GET /api/mcp/rag/hybrid-search?query=...&topK=5&rerank=0`
返回 `{ query, results[], meta:{ denseCount, lexicalCount, fusedCount, reranked, traceId, tookMs } }`。前端工具 `src/agent/tools/hybridSearch.ts` 已切到该端点(旧端点 404 时自动回退)。

**关键取舍(面试常问)**:
- RRF 用**排名**而非分数融合,因为 BM25 分数(无界)和 cosine(0..1)不可比;`k=60` 抑制头部权重让低位一致性也计分。
- 一阶段广撒网(candidate_k)、二阶段精排(rerank),是经典的「召回 vs 精度」两段式。
- 每段独立 try/catch + span 记录错误 → 系统**优雅降级**而非整体失败。

---

## 2. 评测(Eval)

**为什么**:「跑通了」≠「检索对了」。AI 系统是概率的,必须用 IR 指标量化检索质量、用 LLM-as-judge 量化生成质量。

| 文件 | 职责 |
|---|---|
| `server/eval/metrics.ts` | 纯函数:Recall@k / Precision@k / MRR / nDCG@k / MAP@k / HitRate |
| `server/eval/corpus.ts` | 内存金标集(12 文档 + 6 标注 query)+ 概念 embedder(演示语义互补,生产可换真模型) |
| `server/eval/retrievers.ts` | 内存版 lexical/dense/hybrid(复用生产同款 BM25 + RRF),embedder 可注入 |
| `server/eval/llmJudge.ts` | LLM-as-judge:打分 faithfulness(是否有据/无幻觉)+ relevancy,无 LLM 降级 |
| `server/eval/runEval.ts` | CLI:对比三种检索,打印指标表 |

**运行**:`npm run eval`(无需 DB / 网络,确定性可复现)

**结果**(本仓库实测):

| retriever | recall@5 | MRR | nDCG@5 | MAP@5 |
|---|---|---|---|---|
| lexical | 83.3% | 0.708 | 0.738 | 0.708 |
| dense | 83.3% | 0.833 | 0.833 | 0.833 |
| **hybrid** | **100.0%** | **0.875** | **0.905** | **0.875** |

> hybrid 同时救回了 **lexical-only 案例**(罕见股票代码 `300750`,dense 漏)和 **dense-only 案例**(「新能源汽车」↔「比亚迪」纯语义,lexical 漏)。这就是融合的价值,且用指标证明,而非口说。

---

## 3. 可观测(Observability)

**为什么**:一条 query 会扇出 embedding→向量检索→BM25→融合→(rerank)→生成,任一步都可能悄悄退化。要能事后回答「为什么这条慢/贵/结果差」。

| 文件 | 职责 |
|---|---|
| `server/observability/tracer.ts` | OTel/LangSmith 风格的 trace/span 模型;可注入时钟(可测);环形缓冲(最近 N);span 计时/状态/属性(结果数、token 数);`getStats()` 聚合 p50/p95/错误率/总 token;可选 JSONL 落盘 |

**接口**:
- `GET /api/mcp/obs/traces?limit=20` — 最近 trace
- `GET /api/mcp/obs/traces/:id` — 单条 trace 详情(逐 span)
- `GET /api/mcp/obs/stats` — 聚合延迟/错误/token 统计

`hybridSearch` 每段(dense/lexical/fusion/rerank)都埋了 span,自动进入上述统计。

**环境变量**:`OBS_MAX_TRACES`(默认 100)、`OBS_TRACE_DIR`(设了才落盘)。

---

## 验证方式

```bash
npm run eval          # 离线评测,打印 hybrid vs dense vs lexical 指标对比
npm run test:server   # 全部后端测试(含本次新增 40 个:bm25/fusion/metrics/retrievers/tracer)
```

- 混合检索单测:`server/rag/bm25.test.ts`、`server/rag/fusion.test.ts`
- 评测单测:`server/eval/metrics.test.ts`、`server/eval/retrievers.test.ts`(断言 hybrid ≥ 两者且救回 q5/q6)
- 可观测单测:`server/observability/tracer.test.ts`(计时/嵌套 span/环形缓冲/stats)

联网端到端(需启动后端 + 有数据):
```bash
curl 'http://localhost:3002/api/mcp/rag/hybrid-search?query=追高的交易&topK=5'
curl 'http://localhost:3002/api/mcp/obs/stats'
```

---

## 面试讲法(把这段经历讲成考点)

- **RAG**:能讲 chunking/embedding 选型、BM25+dense 混合、RRF、二段式 rerank —— 全是亲手写的。
- **Eval**:能讲 Recall/MRR/nDCG/MAP 的区别、LLM-as-judge 的 faithfulness/relevancy、离线金标集怎么搭 —— 大多数转型者缺这块,是差异化护城河。
- **可观测/LLMOps**:能讲 span/trace 模型、p50/p95、token/成本归因、为什么 AI 系统必须可观测。
- **工程素养**:优雅降级、纯函数可测、生产与评测复用同一套核心代码。
