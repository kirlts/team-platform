---
trigger: model_decision
description: Applies when creating, reading, or modifying project documentation within the docs/ directory (MASTER-SPEC, TODO, MEMORY, CHANGELOG, RULES).
---

# Documentation & Operational Cycle

## [RULE: REPOSITORY LOCALIZATION]

The repository code, comments, and specific Kairós artifacts (`docs/MASTER-SPEC.md`, `docs/TODO.md`, etc.) belong to the Project Domain. When creating, writing to, or editing these files, the system silently detects the dominant language of the target file (or the user's project context) and strictly appends or modifies content in that same language. Leaking English governance reasoning into localized project documentation is not permitted.

## Documentary Axis

All guiding project documents reside in `/docs/`. The canonical templates reside in `.agents/templates/`. When creating a new document, the corresponding template is copied and populated with the project's content.

| Document | Template | Purpose |
|---|---|---|
| `docs/MASTER-SPEC.md` | `.agents/templates/master-spec.md` | Technical and architectural specification. Everything implemented serves this file. |
| `docs/VERIFICATION.md` | `.agents/templates/verification.md` | Verification checklist and quality contract. Maintained by `/derive`. |
| `docs/TODO.md` | `.agents/templates/todo.md` | Tasks with traceability to VERIFICATION.md. Mandatory timestamps (YYYY-MM-DD HH:MM:SS). |
| `docs/MEMORY.md` | `.agents/templates/memory.md` | Transferable heuristics. Append-only. |
| `docs/USER-DECISIONS.md` | `.agents/templates/user-decisions.md` | Human decisions using an ADR 5-field format. |
| `docs/CHANGELOG.md` | `.agents/templates/changelog.md` | Versioned history. Keep a Changelog format. |
| `docs/TECHNICAL-DEBT.md` | `.agents/templates/technical-debt.md` | Ephemeral file. Self-liquidates when 100% completed. |
| `docs/TEST.md` | (generated via /test) | Testing contract. It is read if it exists. |
| `docs/RULES.md` | `.agents/templates/rules.md` | Repository-specific operational rules for the AI agent. **This is not mandatory.** Only exists if the user declares rules. |
| `docs/LIVING-DOCUMENT.md` | `.agents/templates/living-document.md` | Pedagogical narrative. **Isolated from normal operations.** It is created or modified exclusively via the `/narrate` workflow. |

## Work Cycle

**BEFORE:** The task must exist in `TODO.md` prior to execution. If it affects >1 file or modifies MASTER-SPEC §4/§5, an `implementation_plan.md` artifact with a modular checklist is generated.

**DURING:** If a decision arises with multiple valid options, MASTER-SPEC §5 is referenced to tie-break. If a technical shortcut is taken, it is documented immediately.

**AFTER:** The resulting artifact is validated. The `/document` workflow executes as a mandatory closure. `TODO.md` is updated with a timestamp ONLY after successful validation and synchronization.

## Framework Hermeticity

If the current working directory is the canonical Kairós repository, the files inside `/docs/` are master templates and are not polluted with session-specific logic. Ephemeral logs go to volatile areas.

## Anti-Bias Heuristics Protocol

Before writing a heuristic into `docs/MEMORY.md`:
1. A web search is executed to verify if the pattern is generalized and scientifically sound.
2. If external confirmation exists, it is written citing the source.
3. If no confirmation exists, the system declares to the user: "I observed pattern [X]. I found no external confirmation. Do you confirm this should be memorized?"
4. If the user confirms, it is written with the tag `[Confirmed by user - no external source]`.

## Terminal Bypass

The terminal command retry limit is 1. Upon the second failure, blind direct execution is disabled; output is redirected to a temporary file and inspected via file-reading tools.

## Workflow Fidelity

Workflows are executed exactly to the letter, step by step, including any nested workflows within them. Internal paraphrasing, skipping steps, or compressing workflow instructions is disabled. Every step of a workflow produces a verifiable artifact before advancing to the next.