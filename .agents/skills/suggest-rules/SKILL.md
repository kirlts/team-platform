---
name: suggest-rules
description: Activates when the user declares a transversal operational pattern ("always do X", "from now on", "in every case"), or when the agent detects within the current session that a user correction or directive has systemic implications beyond the immediate task.
---

# Rule Crystallization

Operational directives that outlive a single task belong in the project's rule system, not in volatile conversation context. This skill promotes transient directives to permanent rules.

## Phase 1: Pattern Recognition

The agent identifies a candidate rule from one of these sources:

- **Explicit declaration:** The user states that a directive should apply permanently ("always", "from now on", "in every case", or equivalent).
- **Systemic correction:** The user corrects the agent's output and the correction implies a principle that applies beyond the current file or task.
- **Document evidence:** During review of `docs/MEMORY.md` or `docs/USER-DECISIONS.md`, the agent detects a heuristic or decision with transversal applicability that has no corresponding entry in the project's rule system.

## Phase 2: Proposal

The agent articulates the detected pattern as a concrete, testable rule and presents it to the user:

- **Source:** Where the pattern was detected (conversation turn, document entry, correction).
- **Proposed rule:** The directive expressed as a permanent operational rule.

The agent does not write a rule without explicit user confirmation.

## Phase 3: Integration

Upon user confirmation:

1. The rule is appended to `docs/RULES.md` (or the system declared in MASTER-SPEC §8).
2. If `docs/RULES.md` does not exist, it is created from `.agents/templates/rules.md` and the confirmed rule is written into the `## Rules` section.
3. If MASTER-SPEC §8 does not point to any rules system, §8 is updated to point to `docs/RULES.md`.
4. A record is logged in `docs/USER-DECISIONS.md` documenting the promotion.

## Constraints

- The agent does not write a rule without explicit user confirmation.
- The internal vocabulary of this skill (crystallization, promotion, pattern recognition) does not appear in user-facing output.
- If the user's repository uses a custom rules system (declared in §8), the agent proposes writing to that system, not to RULES.md.
