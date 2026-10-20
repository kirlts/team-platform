---
description: /fix - Diagnoses and resolves technical debt, specific errors, or areas of structural improvement in the code. Algorithmic 5-phase process with best-practice research and documentary closure.
---

# Fix (Algorithmic Remediation)

This workflow diagnoses and resolves technical debt through a rigorous 5-phase process. It operates in two modes depending on its invocation.

## Mode Detection

- **`/fix` (no arguments):** Global scan. Identifies technical debt patterns across the codebase.
- **`/fix [text]` (focused):** Surgical repair of the specific error or area described.

---

## Phase 1: Intake

**Objective:** Identify remediation targets.

- **Global mode:** The system scans the codebase for debt patterns (missing tests, obsolete dependencies, inconsistent patterns, duplicated code, type safety errors). `docs/TECHNICAL-DEBT.md` (if it exists) and `docs/TODO.md` are read to identify already documented debt.
- **Focused mode:** The target is what the user describes. The system locates the code, files, and dependencies involved.

**Output of Phase 1:** Prioritized list of targets with severity (High / Medium / Low) and authority classification:

- `.LLM`: Debt the system resolves autonomously (formatting, type errors, dependency updates, mechanical refactoring).
- `.HUM`: Debt requiring human architectural judgment (design pattern changes, irreversible trade-offs, strategic decisions).
- `.MIX`: Debt requiring collaborative resolution (the system proposes, the human validates the approach before execution).

## Phase 2: Chesterton's Fence

**Objective:** Understand WHY each element is the way it is before changing it.

For each identified target:
1. The git history (`git log --follow`, `git blame`) is read to understand who introduced the pattern and when.
2. `docs/USER-DECISIONS.md` and `docs/MEMORY.md` are consulted to determine if it was an explicit user decision.
3. If the decision was explicit, the system declares to the user before proposing a change: "This pattern was a deliberate decision logged in [reference]. Do you confirm you want to revise it?"
4. If there is no trace of deliberate intention, the system proceeds.

**Output of Phase 2:** Each target annotated with its historical context and justification (or lack thereof).

## Phase 3: Best Practice Research

**Objective:** Verify that the proposed correction is the current best practice.

For High or Medium severity targets involving a change of tool, framework, or architectural pattern:
- The `standard-research` skill activates.
- Current SOTA solutions are triangulated before proposing remedies.

For Low severity targets or mechanical corrections (typos, types, imports):
- The system proceeds directly without external research.

**Output of Phase 3:** Each target with its proposed remedy and supporting sources (if applicable).

## Phase 4: Correction Plan and Execution

**Objective:** Generate and execute the remediation plan.

1. The system generates `implementation_plan.md` with each correction as a verifiable subtask.
2. Each subtask references the MASTER-SPEC §8 check it satisfies (if applicable).
3. Corrections are classified by severity AND authority (from Phase 1):
   - **Quick Wins** (Low severity, `.LLM` authority): Applied immediately. Tests, dependencies, types, imports.
   - **Structural Corrections** (High/Medium severity, `.HUM` or `.MIX` authority): Changes respecting the MASTER-SPEC architecture are proposed. `.HUM` targets require user confirmation before execution. `.MIX` targets are pre-verified by the system, then presented for validation.
4. `docs/TECHNICAL-DEBT.md` is updated. Discovered items are added, and resolved ones are marked with timestamps depending on the project's native check format.

**Output of Phase 4:** Corrected code + updated TECHNICAL-DEBT.md.

## Phase 5: Documentary Closure

1. `docs/TODO.md` is updated with the progress made.
2. If any correction implies a significant architectural decision, it is logged in `docs/USER-DECISIONS.md` after user confirmation.
3. If the correction reveals a transferable pattern, it becomes a candidate for `docs/MEMORY.md` (using the anti-bias protocol: verify if the pattern is generalizable).
4. The `/document` workflow executes as the mandatory closing step.

**Output of Phase 5:** Synchronized documentation. Workflow completes.
