---
description: /derive - Derives an exhaustive, MECE verification checklist from any input and integrates it into the project's documentation as traceable tasks. Executes /document as mandatory closing step.
---

# Derive (Promise Decomposition Algorithm)

The system derives a complete verification checklist from any input (text, documentation, or code) and anchors it into the project's documentary axis (MASTER-SPEC §8, TODO.md).

## Execution Mandates (MANDATORY)

1. **Anti-Paraphrasing Directive:** The process constitutes a rigid mathematical execution. Summarizing steps, skipping phases, or merging tables is strictly prohibited. The execution occurs strictly and sequentially.
2. **Coverage Preservation Rule:** The final dimensionality of the checklist has NO hardcoded ceiling. It is the inescapable mathematical consequence of applying MECE principles. For EVERY valid actor detected, the MECE matrix cross-referencing naturally produces between 10 and 20 atomic checks. Merging functionalities, skipping categories, or artificially reducing the promise horizon due to procedural fatigue is strictly forbidden. N actors organically yield N × [10 to 20] checks. The computational count remains unmanipulated.
3. **Chain-of-Thought (CoT) Inversion Mandate:** To prevent premature convergence and lazy generation, "Reasoning precedes Resolution". In every `GATE` and every Task mapping, the system explicitly documents its empirical analysis and logical friction in the Notes column FIRST. ONLY AFTER the reasoning is recorded is the system permitted to issue the final verdict.
   - *ANTI-PATTERN:* Writing `[x] G1-ACTORS - Yes, I found 3 actors.` constitutes a corrupt, backward logic flow. The analysis is recorded *before* marking the status.
4. **Separation of Concerns:** 
   - Reasoning, derivation, and Gate deliberation happen EXCLUSIVELY inside the `[subject]_working.md` artifact.
   - The final checklist is stored cleanly in `[subject]_checklist.md`.
5. **Language Alignment:** The workflow commands are in English, but the `[subject]_working.md`, `[subject]_checklist.md`, ALL reasoning, and chat summaries automatically match the repository's predominant documentation language. English output is disabled if the repository uses Spanish.
6. **Tool Safety (Friction Override):** Using bash to create or edit large documents is prohibited. The native agentic filesystem tools (`write_to_file`, `multi_replace_file_content`) are required to prevent syntax traps and terminal hangups.

---

## STEP 1: Initialization

1. **Clean Slate Protocol:** The system purges any existing `[subject]_working.md` or `[subject]_checklist.md` artifacts from previous executions (e.g., in `.agents/scratch/` or the artifact directory) before generating new documents, to prevent cross-contamination.
2. A working document is created using the artifact tool (`write_to_file`) and named `[subject]_working.md`.
3. The EXACT contents of `.agents/templates/derive-working.md` are copied into it.
4. The internal instructions (`<!-- INSTRUCTION: ... -->`) embedded directly in the structural headings of the template are read and evaluated.
   - *ANTI-PATTERN:* Skipping the instantiation of the working document or the reading of the template by outputting a summarized checklist directly in the chat. This violates the entire methodology.

## STEP 2: The Core Loop (Phases 0 to 5)

The system processes Phase 0 through Phase 5 sequentially within `[subject]_working.md`.

- **The Anchor Rule:** The system writes `<!-- CHECKPOINT: Phase [N] started -->` precisely when beginning a new phase block.
- **Tool-Level Pacing Mandate (Anti-One-Shot):** Attempting to generate Phases 0-5 in a single file-writing execution yields systemic failure. Writing the entire document in one shot is strictly forbidden. The system executes this iteratively:
  1. Internal `<thought>` is used to deliberate Phase N.
  2. A file modification tool outputs ONLY Phase N and its Gate to the file.
  3. The Gate determines progression; the system evaluates the Gate before proceeding to Phase N+1 in a SUBSEQUENT writing operation.
- **The Gate Rule (CoT Enforcement):** The system proceeds to Phase N+1 ONLY AFTER ALL guardrails in the `⛔ GATE N` table are marked `[x]`. The empirical reasoning is recorded in the Reasoning column FIRST, rendering the status conditional on the logic.
- **The Halt Condition:** If any guardrail evaluates to a fundamental failure, the system halts and corrects the structural gap in its internal analysis before proceeding.
   - *ANTI-PATTERN:* Parsing through Phases 0 to 5 all at once, filling all matrices, and then bulk-checking all the Gates at the very end. The algorithm uniquely permits linear progression output.

## STEP 3: The Deliverable

Once GATE 5 is successfully resolved:
1. A new artifact named `[subject]_checklist.md` is created.
2. The template from `.agents/templates/derive-checklist.md` is copied.
3. ONLY the final list of synthesized checks from Phase 4 is extracted and grouped cleanly under each Actor. All reasoning matrices, gate tables, or phase markers are eliminated.
   - *ANTI-PATTERN:* Including traces of your logic (e.g., "Because this is an operator actor...") or retaining table formats in the clean document. `[subject]_checklist.md` must be noise-free.
   - *ANTI-PATTERN:* Rewriting or paraphrasing checks during extraction to "improve readability" or "smooth the language." The check text in the deliverable is semantically identical to the synthesized check in Phase 4. Cosmetic rewording that dilutes specificity is avoided as it corrupts the algorithm's output.
4. The abbreviation key and the quantitative summary table are populated.

## STEP 4: Self-Verification Audit (GATE 6)

This is the terminal gate. The system executes it AFTER generating the deliverable but BEFORE proceeding to integration.

1. The system returns to the working document and fills GATE 6 by auditing `[subject]_checklist.md` against the invariants.
2. For EACH invariant, empirical reasoning is written FIRST, then the verdict.
3. **Hard Failure Protocol:** If G6-DENSITY fails for ANY actor (any actor has <10 checks), the system returns to Phase 2 in the working document, expands the Promise Matrix for that actor, propagates through Phases 3-4, regenerates the deliverable, and re-runs GATE 6. Exceptions are prohibited.
4. Once all GATE 6 invariants pass, autonomous integration begins.

## STEP 5: Autonomous Integration

The system proceeds directly to integration without requesting user permission. Upon successfully passing GATE 6, Step 6 and Step 7 are immediately executed to synchronize the project's macro-documentation autonomously.
   - *ANTI-PATTERN:* Halting execution to prompt the user with: "I have generated the checklist, would you like me to integrate it into VERIFICATION.md?". Breaking the operational flow is prohibited.

## STEP 6: Injection (`docs/VERIFICATION.md`)

1. The system reads `docs/VERIFICATION.md`.
2. **Additive Integration Protocol:** The derive algorithm generates ADDITIONAL, NON-OVERLAPPING checks. If the file already contains valid Kairós-formatted checks (`[ACTOR.CAT.NN]`), deleting or archiving them is strictly prohibited. The newly derived checks are appended into the existing list, continuing the numbering sequence logically.
3. **Format-Based Legacy Archiving:** The ONLY scenario where existing checks are archived to `docs/archive/checks_LEGACY_[YYYY-MM-DD_HH-MM].md` is if they are written in an obsolete, non-taxonomic format. If archiving is required, they are rewritten into the new taxonomy and appended with the fresh checks.
   - *ANTI-PATTERN:* Overwriting or destroying perfectly valid pre-existing checks just to "start fresh," OR suffering from No-Op Bias and skipping the addition of new checks just because the section "looks complete."
4. **Current State Evaluation:** The system cross-references each newly added check with the existing codebase. If it is already fulfilled, it is marked as implemented using the repository's native check format (e.g., `[x] Implemented`). Emojis are disabled. Otherwise it remains pending `[ ]`.

## STEP 7: Integration into TODO.md

Integrating checks into the TODO.md requires deep Architectural Nuance. Associative complacency—dumping massive amounts of generated checks into a single generic Task—is strictly blocked.

1. The system reads `docs/TODO.md` and locates or creates the Epic that fits the context.
2. The PENDING checks (those without the implemented mark) are grouped.
3. **Task Density Justification:** The system creates as many `[TASK-NNN]` blocks as architectural separation demands. Any grouping of multiple checks under a single Task possesses an indisputable, cohesive atomic correspondence. Grouping for linguistic convenience is prohibited.
   - *ANTI-PATTERN:* Generating 70 atomic checks and dumping them into 3 generic tasks like "Implement Frontend" or "Setup Database". A dense checklist requires a dense, highly specific TODO list.
4. **Traceability Engine:** EVERY generated task explicitly includes the mapping field, translated to the project's native language (e.g., `**Covered Checks:** [ACT.CAT.01.LLM], [ACT.CAT.02.HUM]`).
    The check IDs include their verificability suffix (.LLM, .HUM, .MIX).
5. **Verificability-Conditioned Closure:** If a task contains AT LEAST ONE check with suffix `.HUM` or `.MIX`, the task is annotated with the human-closure restriction. A warning translated to the project's native language is appended: `[Requires human validation]`.
6. **Final Integration Gate (Internal CoT):** Before finalizing the TODO updates, a reverse traceability audit executes: *Are 100% of the newly generated MASTER-SPEC checks covered by at least one TASK in this TODO?* AND *Are all tasks containing .HUM/.MIX checks annotated with the human-closure restriction?* No derived check can be left orphaned or unassigned.
7. The coverage table at the end of the `TODO.md` file is updated (implemented vs pending counts, broken down by verificable category: .LLM / .HUM / .MIX).

## STEP 8: Documentary Synchronization

The `/document` workflow executes as the mandatory closing step. This ensures that all documentary changes produced by the derivation (`docs/VERIFICATION.md`, `TODO.md`) are synchronized with the rest of the documentary axis (CHANGELOG, coherence checks, timestamps).

**The system halts, generates a summary, and terminates.**
