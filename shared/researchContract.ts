// 挥手研究运行的**公开形状**。
//
// 公开侧的 `services/dailyOutputValidation.ts` 要在不安装私有战法包的前提下
// 校验每日产出（包括挥手研究的 run.json），所以它必须知道 run 的字段名。
// 但**怎么产生**这些研究结论属私有层（见私有包 `shared/huishouResearch.ts` 的完整定义）。
//
// 边界：这里只保留公开侧实际读取的字段 + research-only 标记。任何策略口径
// （候选怎么选、门槛多少）不在这里，也永远不会被公开侧读。

export interface ResearchRun {
  schemaVersion: 1
  runId: string
  target: string
  /** 研究态硬标记：公开侧据此断言「研究结论不得当交易门槛」。 */
  researchOnly: true
  eligibleAsTradeGate: false
  status: 'running' | 'completed' | 'cancelled' | 'interrupted' | 'failed'
  phase: 'scan' | 'verify' | 'done'
  createdAt: string
  updatedAt: string
  universeCount: number
  processed: number
  candidateStocks: number
  notComparable?: number
  error: string | null
}
