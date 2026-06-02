import type { Skill } from './skill.types'

// ── Skill Router ──────────────────────────────────────────

/** Match a user message against registered skills */
export function matchSkill(
  userMessage: string,
  skills: Skill[],
): Skill | null {
  const normalized = userMessage.toLowerCase()

  for (const skill of skills) {
    const minMatches = skill.trigger.minMatches ?? 1
    const matchCount = skill.trigger.keywords.filter((kw) =>
      normalized.includes(kw.toLowerCase()),
    ).length

    if (matchCount >= minMatches) {
      return skill
    }
  }

  return null
}

/** Get all skills that match a user message (for debugging/logging) */
export function matchAllSkills(
  userMessage: string,
  skills: Skill[],
): Array<{ skill: Skill; matchCount: number }> {
  const normalized = userMessage.toLowerCase()

  return skills
    .map((skill) => {
      const matchCount = skill.trigger.keywords.filter((kw) =>
        normalized.includes(kw.toLowerCase()),
      ).length
      return { skill, matchCount }
    })
    .filter((m) => m.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount)
}

/** Check if a message looks like it needs a skill vs free-form chat */
export function isStructuredRequest(userMessage: string, skills: Skill[]): boolean {
  return matchSkill(userMessage, skills) !== null
}
