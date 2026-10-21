# REPOMAP: team-platform

> Generated: 2026-10-20 21:05 (Kairós v0.99)  
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
| `docs/MASTER-SPEC.md` | **[Domain Axiom]** Foundational specification: identity, architecture, stack, constraints, trade-offs, UI, modules, operational rules. | Before any design, architecture, dependency, or scope decision. Before writing code that touches more than one module. |
| `docs/TODO.md`, `docs/VERIFICATION.md`, `docs/USER-DECISIONS.md`, `docs/MEMORY.md`, `docs/CHANGELOG.md`, `docs/RULES.md` | **[Documentary Axis]** Tasks with traceability, verification checks, human decisions (ADR), transferable heuristics, versioned history, operational rules (MASTER-SPEC §8). | Per `[RULE: TASK INITIATION & AUTHORIZATION]`: TODO before starting a task; VERIFICATION and USER-DECISIONS before closing one or when a decision is contested; RULES before any code or dependency change; MEMORY when a pattern repeats; CHANGELOG at release. |
| `docs/investigaciones/` | **[Domain Axiom, dated]** Research reports with sources and dates (vendors, prices, limits, comparable products). Facts here age; the date in the filename is part of the fact. | When a MASTER-SPEC §3 or §5 choice is questioned, or before re-researching a topic already covered. Never cite a figure from here without its date. |
| `LICENSE` | **[Root Config]** MIT (UD-004). | When adding a dependency, to check license compatibility. |
| `idea.md` | **[Domain Axiom]** The founder's original design dump: concepts (message, response, thread, area), the LLM decomposition mechanic, views, roles, stack intent. Source of truth for intent until MASTER-SPEC absorbs it. | When MASTER-SPEC §1, §6 or §7 is incomplete or contradicts itself; when a product question needs the original wording. |
| `Plataforma Team.png` | **[Domain Axiom, visual]** Hand-drawn mockup of the home view, drawn before `idea.md` and partially superseded by it. Shows sidebar, message bar with attachments and audio, analysis preview with confirm button, latest messages and responses. | When designing or judging any screen of the home view, sidebar, or message cards. `idea.md` wins on conflict. |
| `.gitignore` | **[Root Config]** Ignore rules, including the Kairós block (scratch, personal roles, living document). | Only when adding a new artifact class that must not be committed. |
