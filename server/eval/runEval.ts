// Offline eval runner: scores lexical vs dense vs hybrid retrieval on the golden
// set and prints a comparison. Run with:  npm run eval   (from repo root)
//
// No DB or network required — the corpus is in-memory and the dense embedder is
// the pluggable concept embedder (corpus.ts). If an LLM is configured it also
// runs a small LLM-as-judge demo at the end.

import { EVAL_DOCS, EVAL_QUERIES, conceptEmbed } from './corpus'
import { lexicalRetrieve, denseRetrieve, hybridRetrieve } from './retrievers'
import { aggregateMetrics, recallAtK, type RetrievalMetrics } from './metrics'
import { isJudgeAvailable, judgeAnswer } from './llmJudge'

const K = 5

type Retriever = (query: string) => string[]

const RETRIEVERS: Record<string, Retriever> = {
  lexical: (q) => lexicalRetrieve(EVAL_DOCS, q, K),
  dense: (q) => denseRetrieve(EVAL_DOCS, q, K, conceptEmbed),
  hybrid: (q) => hybridRetrieve(EVAL_DOCS, q, K, conceptEmbed),
}

function pct(n: number): string {
  return (n * 100).toFixed(1).padStart(6) + '%'
}

function evaluate(name: string, retrieve: Retriever): RetrievalMetrics {
  const cases = EVAL_QUERIES.map((q) => ({ retrieved: retrieve(q.query), relevant: q.relevantIds }))
  return aggregateMetrics(cases, K)
}

function printMetricsTable(results: Record<string, RetrievalMetrics>): void {
  const header = ['retriever', `recall@${K}`, 'MRR', `nDCG@${K}`, `MAP@${K}`]
  console.log(`\n${header[0].padEnd(10)}${header.slice(1).map((h) => h.padStart(10)).join('')}`)
  console.log('-'.repeat(50))
  for (const [name, m] of Object.entries(results)) {
    const cells = [pct(m.recallAtK), m.mrr.toFixed(3), m.ndcgAtK.toFixed(3), m.mapAtK.toFixed(3)]
    console.log(`${name.padEnd(10)}${cells.map((c) => c.padStart(10)).join('')}`)
  }
}

function printPerQuery(): void {
  console.log(`\nPer-query recall@${K} (★ = the case this query stresses):`)
  console.log(`${'query'.padEnd(8)}${'note'.padEnd(14)}${'lexical'.padStart(9)}${'dense'.padStart(9)}${'hybrid'.padStart(9)}  text`)
  console.log('-'.repeat(80))
  for (const q of EVAL_QUERIES) {
    const r = (fn: Retriever) => recallAtK(fn(q.query), q.relevantIds, K).toFixed(2).padStart(9)
    console.log(
      `${q.id.padEnd(8)}${(q.note ?? '').padEnd(14)}${r(RETRIEVERS.lexical)}${r(RETRIEVERS.dense)}${r(RETRIEVERS.hybrid)}  ${q.query}`,
    )
  }
}

async function maybeRunJudge(): Promise<void> {
  if (!isJudgeAvailable()) {
    console.log('\n[judge] No LLM configured — skipping LLM-as-judge demo. Set LLM_API_KEY in server/.env to enable.')
    return
  }
  console.log('\n[judge] Running LLM-as-judge demo on one grounded vs one hallucinated answer...')
  const context = EVAL_DOCS.filter((d) => ['d1', 'd2', 'd4'].includes(d.id)).map((d) => d.text)
  const grounded = await judgeAnswer({
    query: '白酒板块追高失败的交易有哪些教训？',
    answer: '茅台和五粮液都因为在高位追高接盘而被套、亏损，教训是不要在情绪上头时追高。',
    context,
  })
  const hallucinated = await judgeAnswer({
    query: '白酒板块追高失败的交易有哪些教训？',
    answer: '这些交易都在2008年金融危机期间发生，主要因为美联储加息导致。',
    context,
  })
  console.log('  grounded   :', grounded ? JSON.stringify(grounded) : 'judge call failed')
  console.log('  hallucinated:', hallucinated ? JSON.stringify(hallucinated) : 'judge call failed')
}

async function main(): Promise<void> {
  console.log('='.repeat(50))
  console.log(`RAG retrieval eval — ${EVAL_DOCS.length} docs, ${EVAL_QUERIES.length} queries, k=${K}`)
  console.log('Dense embedder: conceptEmbed (pluggable; swap for a real embeddings model in prod)')
  console.log('='.repeat(50))

  const results: Record<string, RetrievalMetrics> = {
    lexical: evaluate('lexical', RETRIEVERS.lexical),
    dense: evaluate('dense', RETRIEVERS.dense),
    hybrid: evaluate('hybrid', RETRIEVERS.hybrid),
  }

  printMetricsTable(results)
  printPerQuery()

  const { lexical, dense, hybrid } = results
  console.log(
    `\nConclusion: hybrid recall@${K} = ${pct(hybrid.recallAtK)} vs lexical ${pct(lexical.recallAtK)} / dense ${pct(dense.recallAtK)}.`,
  )
  console.log(
    'Hybrid recovers the lexical-only case (rare stock code) AND the dense-only case (paraphrase) that each single retriever misses.\n',
  )

  await maybeRunJudge()
}

main().catch((err) => {
  console.error('[eval] failed:', err)
  process.exit(1)
})
