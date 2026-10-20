---
description: /document - Synchronizes the documentary axis (MASTER-SPEC, TODO, MEMORY, USER-DECISIONS, CHANGELOG) with the real state of the project. Enforces structural lint against canonical templates in ALL modes before content synchronization. In sessions with no prior work, also evaluates full structural synchronization against current templates.
---

# Documentary Synchronization

This workflow ensures that all project documentation accurately reflects the current state of the code and architecture.

> **Standard Requirement:** Before executing any mode, the system reads all template files from `.agents/templates/` into working memory. Skipping this step invalidates the synchronization. The templates define the canonical structure; a document is not considered synchronized if its format diverges from its template.

## Mode Detection

- If the session has prior work (modified code, executed tasks): **Normal Mode** (incremental synchronization).
- If the session has no prior work (the user invoked `/document` as the first action, or it runs as the closure of `/fix`, `/derive`, etc.): **Audit Mode** (full verification against current templates).

---

## Step 0: Structural Lint (MANDATORY in both modes)

The system runs structural lint unconditionally before any content synchronization or audit. It detects format divergence between existing documentation and canonical templates.

### 0.1. Load Canonical Templates

The system reads every template file from `.agents/templates/` into working memory:

| Template File | Governs |
|---|---|
| `.agents/templates/master-spec.md` | `docs/MASTER-SPEC.md` |
| `.agents/templates/todo.md` | `docs/TODO.md` |
| `.agents/templates/memory.md` | `docs/MEMORY.md` |
| `.agents/templates/user-decisions.md` | `docs/USER-DECISIONS.md` |
| `.agents/templates/changelog.md` | `docs/CHANGELOG.md` |
| `.agents/templates/TEST.md` | `docs/TEST.md` (if exists) |
| `.agents/templates/technical-debt.md` | `docs/TECHNICAL-DEBT.md` (if exists) |
| `.agents/templates/rules.md` | `docs/RULES.md` (if exists) |

### 0.2. Verify Mandatory Sections

For each existing document in `docs/`, the system compares it against its canonical template:

1. **Header and identity line:** Does the document start with the canonical header pattern?
2. **Symbol Legend:** Does the document contain the Kairós Symbol Legend table (if the template defines one)?
3. **Mandatory sections:** Does the document contain every section defined in the template (e.g., `## §8. Verification Checklist` with canonical numbering)?
4. **Closing markers:** Is the closing line (e.g., "End of the Master Specification" or equivalent) positioned AFTER all canonical sections, not before?
5. **Summary table structure:** Does the summary table (if template defines one) contain all canonical columns (e.g., `.LLM / .HUM / .MIX` columns in TODO.md)?

### 0.3. Verify Mandatory Fields Per Item

For repeating items (TASKs, checks, heuristics, decisions), the system verifies mandatory fields exist:

| Document | Item Type | Mandatory Field | If Missing |
|---|---|---|---|
| TODO.md | TASK | `**Covered checks:**` | Add with `Transversal governance` if no VERIFICATION.md checks apply |
| VERIFICATION.md | Check (Implemented) | Verification emoji + timestamp | Add `(🤖 Verified by tool; DATE)` format |
| USER-DECISIONS.md | UD entry | All 5 ADR fields | Flag as incomplete |
| MEMORY.md | HEU entry | `**Source:**` field | Flag as incomplete |

### 0.4. Retroactive Compliance and Version Porting

When templates have evolved (new sections, new fields, new columns), historical content must be evaluated. This includes **cross-version porting**: when a repository's documentation was created under a prior version of Kairos, the `/document` workflow is responsible for migrating it to the current template version without destroying information.

#### Version Detection

The system detects the Kairos version that generated the existing documentation by examining:
- Explicit version markers in document headers (if present).
- Structural fingerprints: which sections exist, what format they use, what fields they contain.
- Absence of sections that are mandatory in the current template version.

If the detected version differs from the current template version, the full porting logic activates.

#### Porting Algorithm

```
For each document in docs/:
  Detect the Kairos version that generated it.
  Load the current canonical template for this document type.

  For each section in the current template:
    Does this section exist in the document (even under a legacy name)?
      YES → Does the section's format match the current template?
        YES → No action needed.
        NO  →
          Is the format migration non-destructive?
            YES → Migrate format autonomously. Preserve all content.
            NO  → Catalog as "requires approval". Present diff to user.
      NO  → Is the section empty in the template (a structural placeholder)?
        YES → Add the empty section. Non-destructive.
        NO  → Catalog as "requires approval". Present what would be added.

  For each section in the document that does NOT exist in the current template:
    This is legacy content with no current equivalent.
    DO NOT delete. Append to an "Archived Sections" area at the bottom
    of the document, clearly marked as legacy. Present to user for review.
```

#### Tactical Porting: MASTER-SPEC §8 → VERIFICATION.md
If the system detects that `docs/MASTER-SPEC.md` contains a populated `§8. Verification Checklist` (legacy format), the system performs an automatic, non-destructive migration before running lint rules:
1. Extract the ENTIRE contents of `§8` verbatim.
2. Initialize `docs/VERIFICATION.md` using its canonical template and deposit the extracted checks.
3. Remove the entire `§8` section from `MASTER-SPEC.md`.
4. Scan `docs/TODO.md` and perform a silent find/replace of any string mentioning `MASTER-SPEC §8` (e.g., `Ref: MASTER-SPEC §8`) with `Ref: VERIFICATION.md`.

**Invariant:** Zero bytes of user-written content are deleted without explicit user approval. The porting process adds, restructures, and migrates, but never silently removes.

### 0.5. Structural Lint Report

The system generates a lint report BEFORE proceeding to Audit or Normal Mode:

| Document | Divergence | Type | Severity | Action | Status |
|---|---|---|---|---|---|
| [file] | [what diverges from template] | Missing Section / Legacy Format / Stale Content / Missing Field | High / Medium | [what was done/proposed] | ✅ Fixed / ⏳ Pending approval |

If the report contains zero divergences, the system logs: `Structural Lint: PASS (0 divergences)`.

If the report contains divergences, all autonomous fixes are applied before proceeding. Pending-approval items are presented to the user. The workflow is blocked (no further steps execute) until every pending-approval item is explicitly resolved by the user.

---

## Audit Mode (cold-start)

The system executes this mode when `/document` is invoked without prior work context. Its purpose is to detect structural divergence between existing documentation and current templates embedded in `.agents/templates/`.

### Step 1: Inventory Existing Documentation

The system scans `docs/` looking for the documentary axis files:

| File | Canonical Template | Mandatory |
|---|---|---|
| `docs/MASTER-SPEC.md` | `.agents/templates/master-spec.md` | Yes |
| `docs/TODO.md` | `.agents/templates/todo.md` | Yes |
| `docs/MEMORY.md` | `.agents/templates/memory.md` | Yes |
| `docs/USER-DECISIONS.md` | `.agents/templates/user-decisions.md` | Yes |
| `docs/CHANGELOG.md` | `.agents/templates/changelog.md` | Yes |
| `docs/TEST.md` | `.agents/templates/TEST.md` | No (created via /test) |
| `docs/TECHNICAL-DEBT.md` | `.agents/templates/technical-debt.md` | No (created via /fix) |
| `docs/RULES.md` | `.agents/templates/rules.md` | No (created by user) |

### Step 2: Catalog Discrepancies

The system compares each existing file against its canonical template and classifies each discrepancy:

| Type | Description | Example |
|---|---|---|
| **Missing File** | A mandatory file does not exist | `docs/USER-DECISIONS.md` does not exist |
| **Missing Section** | File exists but lacks template sections | MASTER-SPEC without §1.Identity, or without "Problem it solves" fields |
| **Legacy Format** | File exists but uses incompatible format | TODO without `[EPIC-NNN]`/`[TASK-NNN]` taxonomy, MEMORY without `[HEU-NNN]` |
| **Stale Content** | File exists, proper format, but contradicts code | MASTER-SPEC lists an obsolete module |
| **Slop Detected** | File contains AI writing patterns (see Slop Detection) | Section containing "cutting-edge solution" |

### Step 3: Action Decision Logic

Decision algorithm for each cataloged discrepancy:

```
Does the file exist?
  NO → Create from template. Autonomous action.
  YES →
    Does the correction destroy content written by the user?
      NO (e.g. adding missing section, new field, injecting taxonomy):
        → Execute Soft-Update autonomously. Do not request approval.
      YES (e.g. restructuring existing sections, renaming IDs, archiving/rebuilding):
        → Catalog as "requires approval". Present diff to user.
    Does the correction modify IDs referenced by other files?
      YES → Requires approval. Present impact map.
      NO → Autonomous if non-destructive.
```

### Step 4: Execute Corrections

1. The system executes all autonomous corrections simultaneously.
2. The user is presented with the list of corrections requiring approval with concrete diffs.
3. The system awaits user confirmation for destructive actions.

### Step 5: Reporting

Generate consolidated table:

| Document | Discrepancy | Type | Action | Status |
|---|---|---|---|---|
| [file] | [what diverges] | [missing/legacy/stale/slop] | [what was done/proposed] | [x] Corrected / [ ] Pending approval |

---

## Normal Mode (incremental synchronization)

The system executes this mode directly without prior user validation.

### Code Synchronization

The system mathematically verifies the coherence of each document with the project's current state:

- Does the MASTER-SPEC reflect the real implemented architecture?
- Does MASTER-SPEC contain a §8 (Operational Rules) section? If missing, add the empty section from the template.
- If §8 points to `docs/RULES.md`, does that file exist? If it exists, lint it against `.agents/templates/rules.md`.
- Does the TODO reflect real progress with correct timestamps?
- Are there decisions in the codebase missing in USER-DECISIONS.md?
- Are there product changes missing in CHANGELOG.md?

### Slop and Mock Detection

The system verifies that no deliverables marked as "complete" contain:

| Category | Detection Patterns |
|---|---|
| **Corporate-Motivational Copy** | "Unlock your potential", "Seamless experience", "Cutting-edge solution", "Empower your workflow", "Transform your business", "Innovative platform", adjectives empty of specific content |
| **Mocked Data** | Hardcoded constants simulating real data, dummy arrays disconnected from data sources, mocked HTTP responses presented as real integration |
| **RLHF Documentation Patterns** | "It's worth noting that", "It is important to point out", negative parallelisms ("not just X, but Y"), servile positivity |
| **Em dashes** | Any instance of the character (—). Zero tolerance |

If slop or mocks are detected in "completed" features, the system reports them in the gap table and creates a purge TASK in TODO.md.

### VERIFICATION.md ↔ TODO Traceability Coherence

Mandatory cross-verification:

1. **Checks without TASK:** Are there unimplemented checks in VERIFICATION.md without an associated TASK? → Create the missing TASKs.
2. **TASKs without check:** Are there TASKs referencing non-existent IDs in VERIFICATION.md? → Correct references or delete TASKs.
3. **Ghost checks:** Are there checks marked as implemented whose code no longer exists? → Unmark and create reimplementation TASK.
4. **Coverage count per actor:** For each actor in VERIFICATION.md, count implemented vs. pending checks. Log in TODO summary table.

### Cross-Coherence Validation

The system verifies no internal contradictions exist:

- Intentions/Purposes in MASTER-SPEC §1 ↔ Epics in TODO.md
- Constraints in MASTER-SPEC §4 ↔ Rules in `.agents/rules/05-constraints.md`
- Decisions in USER-DECISIONS.md ↔ Trade-offs in MASTER-SPEC §5
- Checks in VERIFICATION.md ↔ TASKs in TODO.md (bidirectional)

### Verificability Coherence (LLM/HUM/MIX)

Deterministic 6-step algorithm:

**STEP 0. INPUT VALIDATION (mandatory field audit):** Before running the coherence algorithm, the system scans ALL TASKs in TODO.md:

```
For each TASK in TODO.md:
  Does it have a "Covered checks:" field?
    NO → [WARNING] MISSING MANDATORY FIELD.
          If the TASK relates to governance or has no VERIFICATION.md checks:
            → Add: **Covered checks:** Transversal governance
          Else:
            → Flag for manual assignment.
  Is the field empty or contains only generic terms ("active", "N/A")?
    YES → [WARNING] INVALID FIELD VALUE. Flag for correction.
```

This step ensures the subsequent inventory does not silently skip TASKs lacking the field.

**STEP 1. INVENTORY:** Read `docs/VERIFICATION.md`. Extract all checks with their classifier (.LLM/.HUM/.MIX). Build internal memory: `{Check_ID, Verifier, Status}`.

**STEP 2. CROSS-REFERENCE:** Read TODO.md. Extract all tasks and covered checks. Build internal memory: `{Task_ID, [Check_IDs], Task_Status, Has_Human_Closure_Restriction}`.

**STEP 3. COHERENCE VALIDATION:** For each check where Verifier = .HUM or .MIX:
- Find the corresponding task in TODO.md.
- Does the task have a human-closure restriction? → NO: [WARNING] CONFLICT.
- If the task is marked as completed: Does it have a human verification timestamp? → NO: [WARNING] CONFLICT.
- **Context Verification (Hard-Fault):** Audit the chat history. Was the validation explicit? An implicit approval (e.g., "ok to all") to visual changes DOES NOT validate irreversible architectural alterations. Upon irreconcilable doubt regarding intentionality, declare [WARNING] CONFLICT and require direct human confirmation.

**STEP 4. TIMESTAMP VALIDATION:** For each check marked as Implemented:
- Does it include a timestamp? → NO: [WARNING] CONFLICT.
- Does the verification type (LLM/HUM/MIX) match the check's classifier? → NO: [WARNING] CONFLICT.

**STEP 5. REPORTING:** Generate quantitative summary:

```
Total checks: N
  - .LLM: X (Y implemented, Z pending)
  - .HUM: X (Y implemented, Z pending human validation)
  - .MIX: X (Y implemented, Z pending)
  - Coherence conflicts: N [list]
  - TASKs missing "Covered checks:" field: N [list]
```

If checks without verificability suffix (legacy) are detected, the system classifies them retroactively using the Decision Tree in `derive-working.md`. If non-destructive (adding suffixes), execute autonomously. If destructive (renaming IDs), require human approval.

### Routing Matrix Sync (REPOMAP)

1. The `/repomap` workflow executes and overwrites `docs/REPOMAP.md` to match the repository's current physical state.
2. One line is appended to the `/document` sync report: "REPOMAP synchronized."

> **Critical Isolation Rule:** The `/document` workflow does not read, write, or touch `docs/LIVING-DOCUMENT.md`. The Living Document is strictly isolated and is modified exclusively via the `/narrate` workflow.
