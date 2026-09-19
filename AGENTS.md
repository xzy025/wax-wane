# Working in Wax Wane

## Project map

- `src/`: React/TypeScript UI and application agents; `server/`: Express services,
  market data, research and scheduling. Each has its own test environment.
- `.agents/skills/`: repository Codex skills; `.claude/skills/`: Claude workflows.
- **Third-party source material and derived research is local-only, never committed.**
  This covers 公众号原文/截图, 作者原图与逐 bar 证据, 第三方课程转录, the distilled
  `analyze-huishou-trading` skill, and the reverse-engineered indicator evidence.
  All of it lives on disk and is gitignored — see the block in `.gitignore` anchored at
  "Third-party source material and derived research". **The repository is public**, so
  anything committed is world-readable. Before staging, classify each path as
  code, project documentation, or evidence/source material; never stage the
  evidence/source paths listed below.
  - Local paths: `docs/n/`, `docs/v13-research/`, `docs/妖股形态/`,
    `server/knowledge/teacher/`, `skills/analyze-huishou-trading/`, `huishou-research.html`.
  - The skill's single source of truth is `skills/analyze-huishou-trading/` on disk.
    Copies under `~/.codex/skills/` and `~/.claude/skills/` are install artifacts:
    edit the working copy, then run `scripts/sync-huishou-skill.ps1` and treat the
    working copy as authoritative whenever they differ. The script syncs the
    Codex install by default; pass `-IncludeClaude` only when that install is
    present. After changing it, bump the
    `verdict-rev` marker at the top of its `SKILL.md` so drift is visible in a diff.
  - Because these paths are untracked, a fresh clone will not have them. Code and CI
    must not depend on them; if a tracked file needs to cite one, state that it is not
    distributed and include a verifiable excerpt or hash.
- `docs/`: research evidence and operating records. Read focused source ranges;
  exclude `docs/archive/raw-sessions/`, generated snapshots and large raw data
  unless the task needs them. Existing uncommitted work may belong to other tasks.

## Execution

- Complete authorized work through verification. Make reasonable, reversible
  implementation choices; ask only when missing information materially changes
  scope, correctness or authorization. A plan is not an extra approval gate.
- Before a non-trivial edit, briefly identify files, checks and non-goals; update
  that scope if new evidence changes it. Follow the user's requested deliverable.
- Use skills for matching tasks and load references as needed. Repository skill
  defaults yield to the user's explicit request within host permissions. If a
  skill blocks progress, identify the file and exact rule causing the stop.
- Batch independent reads and checks. When delegation is permitted, use bounded
  independent subtasks where useful; keep edits to shared files coordinated.
- Preserve `research / shadow / research-only` status. Changing instructions does
  not promote experimental signals or authorize changes to trading eligibility.

## Verification

Use Node 22 and npm. Install with `npm ci` and `npm ci --prefix server` when
dependencies are missing. `npm run start:local` starts the Windows local stack.

| Change | Relevant checks from repository root |
|---|---|
| UI | `npm test -- <test-file>`; `npm run build` for bundling/UI integration |
| Server | `npm run test:server -- <test-file>`; `npm run typecheck:server` |
| Shared behavior/configuration | Both affected suites; `npm run lint` |
| Instructions/docs | Review scope, references, commands and conflicting rules |

Run checks proportionate to the change; add regression tests for changed behavior.
The full CI contract is in `.github/workflows/ci.yml`. Repeat or broaden checks
only for new changes, failures or unresolved risks. Report what passed and what
remains unverified; do not claim existing failures were introduced by this task.

## Continuity

For sustained multi-phase work or resuming after compaction, use
[strategic-compact](.agents/skills/strategic-compact/SKILL.md). Keep only the active
task in `docs/agent/ACTIVE_CONTEXT.md`; routine edits need no checkpoint ceremony.
