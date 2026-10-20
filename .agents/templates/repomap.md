# REPOMAP: [INSERT_PROJECT_NAME]

> Generated: [INSERT_TIMESTAMP] (Kairós v[INSERT_VERSION])  
> Purpose: Routing matrix. Defines when the AI is authorized to read each directory or file.

## Authoring Constraints (Read Before Populating)

- **Scope:** The agent maps the host project only. Kairós release metadata files (`README-KAIROS.md`, `kairos-version.txt`) are distribution artifacts and do not appear as Domain Axioms or individual rows. If listed at all, they are compressed into a single noise cluster row. The `.agents/` directory is the **active governance layer** and is handled by a hardcoded mandatory row below — it is not classified as a noise cluster or invisible infrastructure. The documentary axis files in `docs/` are project documentation, not governance. `docs/MASTER-SPEC.md` receives an individual row as a Domain Axiom; the remaining axis files defined in `04-documentation.md` are grouped into a single row.
- **Abstraction level:** Source code files are always mapped at the directory level, rather than as individual rows. Only documentation and specification files qualify for individual rows as Domain Axioms, per the three-signal detection algorithm in the `/repomap` workflow.
- **Anti-recency bias:** The physical timestamp of a file is not a factor. Recently modified files are not elevated. Prominence is determined by the architectural role defined in `MASTER-SPEC`, not by modification date.
- **MECE:** Every row is Mutually Exclusive (no overlapping access conditions) and Collectively Exhaustive (every directory or logical cluster is represented).
- **Language:** This document is written in English regardless of the host project's language.

## Routing Matrix

| Directory / File | Nature | When to Consult |
|---|---|---|
| `.agents/` | **[Active Governance]** Rules, skills, workflows, and templates that define agent behavior. | **MANDATORY.** The agent consults `01-behavior.md` at session start; the agent dynamically loads other files per `[RULE: DYNAMIC CONTEXT LOAD]` and `[RULE: DYNAMIC SKILL ACTIVATION]` triggers. |
[INSERT_TOPOLOGY_ROWS]
