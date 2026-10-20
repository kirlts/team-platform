---
description: /checklist - Generates an exhaustive, domain-agnostic MECE verification checklist from any input. Standalone; produces an internal chat artifact that does NOT integrate into project documentation unless explicitly requested by the user.
---

# Checklist (Standalone Promise Decomposition)

The system generates a complete, domain-agnostic verification checklist from any input (text, documentation, images, URLs, code, or any combination). The checklist is a self-contained deliverable. It does NOT integrate into MASTER-SPEC, TODO.md, or any project documentation. The output is an internal chat artifact; the user decides what to do with it.

## Core Constraint

The output of /checklist is an internal artifact of the conversation. The alteration of `/docs/` requires explicit instruction from the user. This workflow produces a standalone deliverable that the user may choose to save, discard, or move at their discretion.

## Execution Mandates (MANDATORY)

1. **Anti-Paraphrasing Directive:** The process constitutes a rigid mathematical execution. Summarizing steps, skipping phases, or merging tables is strictly prohibited. The execution occurs strictly and sequentially.
2. **Coverage Preservation Rule:** The final dimensionality of the checklist has NO hardcoded ceiling. For EVERY valid actor detected, the MECE matrix cross-referencing naturally produces at minimum 10 atomic checks per actor. Merging functionalities, skipping categories, or artificially reducing the promise horizon due to procedural fatigue is strictly forbidden. N actors yield at minimum N × 10 checks. The computational count remains unmanipulated.
3. **Chain-of-Thought (CoT) Inversion Mandate:** To prevent premature convergence and lazy generation, "Reasoning precedes Resolution". In every `GATE` and every deliberation table, the system explicitly documents its empirical analysis and logical friction in the Reasoning column FIRST. ONLY AFTER the reasoning is recorded is the system permitted to issue the verdict.
   - *ANTI-PATTERN:* Writing `[x] G1-ACTORS - Yes, I found 3 actors.` constitutes a corrupt, backward logic flow. The full analysis is recorded *before* marking the status.
   - *ANTI-PATTERN:* Pre-filling a Status column as ✅ and then backfilling the Reasoning column with a justification that matches the pre-decided verdict. This behavior demonstrates confirmation bias rather than deliberation.
4. **Separation of Concerns:** 
   - All reasoning, derivation, and Gate deliberation happen EXCLUSIVELY inside `[subject]_working.md`.
   - The final checklist is stored cleanly in `[subject]_checklist.md`.
5. **Domain-Native Language:** The output language (idiom) and vocabulary are determined dynamically during Phase 0.5 (Domain Intelligence). Two distinct determinations are required:
   - **Idiom:** The human language of ALL generated content (Spanish, English, Portuguese, etc.). Resolved via the Language Resolution Cascade defined in Phase 0.5.
   - **Vocabulary:** The domain-specific terminology. Technical terminology is exclusively reserved for software/technical domains.
   Both determinations are legally binding for the working document, the deliverable, and any chat summaries.
6. **Tool Safety (Friction Override):** Using bash to create or edit large documents is prohibited. The native agentic filesystem tools (`write_to_file`, `multi_replace_file_content`) are required.
7. **User Sovereignty:** The user's prompt may contain explicit instructions that modify, restrict, or extend the behavior of this algorithm. These overrides are captured in Phase 0 and operate as binding instructions. The 10-check-per-actor minimum is the ONLY immutable constraint; overrides cannot reduce it.

---

## STEP 1: Initialization

1. **Clean Slate Protocol:** Existing `[subject]_working.md` or `[subject]_checklist.md` artifacts from previous executions are purged to prevent cross-contamination.
2. **Artifact Isolation Mandate:** The working document is created within the agent's artifact directory or scratch space. Creating working artifacts inside the project's source directories, `docs/`, or the repository root is strictly forbidden. The working document acts as ephemeral deliberation and does not belong in the codebase.
3. A working document is created using the artifact tool (`write_to_file`) and named `[subject]_working.md`.
4. The EXACT contents of `.agents/templates/checklist-working.md` are copied into it.
5. The internal instructions (`<!-- INSTRUCTION: ... -->`) embedded directly in the structural headings of the template are read and evaluated.
   - *ANTI-PATTERN:* Skipping the instantiation of the working document or the reading of the template by outputting a summarized checklist directly in the chat. This violates the entire methodology.

## STEP 2: The Core Loop (Phases 0 to 5 + Domain Intelligence)

The system processes Phase 0 through Phase 5 sequentially within `[subject]_working.md`, including Phase 0.5 (Domain Intelligence) between Phase 0 and Phase 1.

- **The Anchor Rule:** The system writes `<!-- CHECKPOINT: Phase [N] started -->` precisely when beginning a new phase block.
- **Tool-Level Pacing Mandate (Anti-One-Shot):** Attempting to generate Phases 0-5 in a single file-writing execution is strictly forbidden. The system executes this iteratively:
  1. Internal reasoning is used to deliberate Phase N.
  2. A file modification tool outputs ONLY Phase N and its Gate to the file.
  3. The Gate determines progression; the system evaluates the Gate before proceeding to Phase N+1 in a SUBSEQUENT writing operation.
- **The Gate Rule (CoT Enforcement):** The system proceeds to Phase N+1 ONLY AFTER ALL guardrails in the `⛔ GATE N` table are marked `[x]`. The Reasoning column is populated FIRST with genuine analytical friction.
- **The Halt Condition:** If any guardrail evaluates to a fundamental failure, the system halts and corrects the structural gap before proceeding.
   - *ANTI-PATTERN:* Parsing through Phases 0-5 all at once, filling all matrices, and then bulk-checking all the Gates at the very end.
   - *ANTI-PATTERN:* Treating Gates as a formality by writing "Yes, this is correct" in every Reasoning cell without genuine interrogation.

## STEP 3: The Deliverable

Once GATE 5 is successfully resolved:
1. A new artifact named `[subject]_checklist.md` is created.
2. The template from `.agents/templates/checklist-output.md` is copied.
3. The header fields (Domain, Audience, Date, Source context) are populated.
4. ONLY the final list of synthesized checks from Phase 4 is extracted and grouped cleanly under each Actor. All reasoning matrices, gate tables, or phase markers are eliminated.
   - *ANTI-PATTERN:* Including traces of your logic (e.g., "Because this actor interacts with...") or retaining deliberation artifacts in the clean document.
   - *ANTI-PATTERN:* Rewriting or paraphrasing checks during extraction to "improve readability" or "smooth the language." The check text in the deliverable is semantically identical to the synthesized check in Phase 4. Cosmetic rewording that dilutes specificity, softens falsability, or generalizes an observable action is avoided as it corrupts the algorithm's output.
5. The quantitative footer with explicit per-actor counts is populated.

## STEP 4: Self-Verification Audit (GATE 6)

This is the terminal gate. The system executes it AFTER generating the deliverable but BEFORE presenting it to the user.

1. `[subject]_checklist.md` is opened and audited against the invariants in GATE 6 of the working document.
2. For EACH invariant, empirical reasoning is written FIRST, then the verdict.
3. **Hard Failure Protocol:** If G6-DENSITY fails for ANY actor (any actor has <10 checks), the system returns to Phase 2 in the working document, expands the Promise Matrix for that actor, propagates through Phases 3-4, regenerates the deliverable, and re-runs GATE 6. Exceptions are prohibited.
4. Once all GATE 6 invariants pass, the `[subject]_checklist.md` is presented to the user in chat.

**The system halts, generates a summary, and terminates.**
