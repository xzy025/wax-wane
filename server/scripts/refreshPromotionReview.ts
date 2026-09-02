import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  buildPromotionReview,
  loadPromotionInputs,
  writePromotionReview,
} from '../services/promotionReview'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ladderRoot = join(__dirname, '..', '..', 'docs', 'ladder')
const inputs = loadPromotionInputs(ladderRoot)
if (!inputs.length) {
  console.error('[promotion-review] 未找到已结算的连板天梯 outcome 归档')
  process.exit(1)
}
const review = buildPromotionReview(inputs)
const paths = writePromotionReview(ladderRoot, review)
console.log(`[promotion-review] ✅ 信号日 ${review.sample.signalDays} / 正式候选 ${review.sample.formalCandidates} / 晋级率 ${review.overall.promotionRate ?? '--'}%`)
console.log(`[promotion-review] JSON: ${paths.jsonPath}`)
console.log(`[promotion-review] Markdown: ${paths.markdownPath}`)

