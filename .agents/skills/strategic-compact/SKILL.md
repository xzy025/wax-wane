---
name: strategic-compact
description: Preserve a concise task checkpoint during sustained multi-phase work or resume after context compaction. Use at meaningful phase boundaries; skip routine edits.
---

# Task continuity

The host controls context compaction. This skill preserves recovery state; it
does not invoke compaction, timers or token-count estimates.

## At a meaningful boundary

After research, a validated milestone, or before a handoff, update
`docs/agent/ACTIVE_CONTEXT.md` if the recovery state changed. Keep these fields:

- `GOAL`: current requested outcome and completion criteria.
- `CONSTRAINTS`: scope and relevant invariants.
- `DECISIONS`: choices needed to continue, with short reasons.
- `FAILED_APPROACHES / DO_NOT_RETRY`: failure, cause, and conditions for retry.
- `CHANGED_FILES`: paths owned by this task; distinguish pre-existing edits.
- `TEST_STATUS`: commands, outcomes and material gaps.
- `BLOCKERS`: unresolved dependencies, or None.
- `NEXT_ACTION`: one concrete next step, or Completed.

Keep only the active task. Link evidence at its source; omit raw logs, full diffs,
historical conversations and private disclosures. Do not interrupt a logical
edit or pending tool operation merely to write a checkpoint.

## On resume

Read the checkpoint if present, then inspect the current workspace and latest
user request. Reuse only context for the same task. Revalidate relevant state;
an old test result does not establish that the current files pass. Correct stale
decisions before editing or retrying a failed approach.
