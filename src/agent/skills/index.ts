// ── Skill System ──────────────────────────────────────────

export type {
  Skill,
  SkillTrigger,
  SkillStep,
  SkillContext,
  SkillStepResult,
  SkillExecutionResult,
} from './skill.types'

export { matchSkill, matchAllSkills, isStructuredRequest } from './skill.router'
export { executeSkill, validateSkillTools } from './skill.executor'

// ── Registered Skills ─────────────────────────────────────

import type { Skill } from './skill.types'
import { structuredReviewSkill } from './structured-review.skill'
import { theoryReviewSkill } from './theory-review.skill'

/** All registered skills — add new skills here */
export const skills: Skill[] = [
  structuredReviewSkill,
  theoryReviewSkill,
]

/** Get a skill by ID */
export function getSkillById(id: string): Skill | undefined {
  return skills.find((s) => s.id === id)
}
