---
description: /release - Generates a new official version of the Kairós framework (Version Bump + Manifest + Public Documentation). EXCLUSIVE use in the canonical repository.
---

# Kairós Release

This workflow automates the creation of a new Kairós framework version. It manages the semantic version calculation (SemVer), manifest reconstruction, Changelog synchronization, public documentation update, and template integrity verification.

## Step 0: Environment Guard

This workflow modifies the global distribution manifest. It is executed only if the current ecosystem is designated as the canonical Kairós repository that redistributes to others. If the execution is within a client repository (e.g., an app, a service), the system immediately aborts and notifies the user.

## Step 1: Detection and Analysis

1. The current `kairos-version.txt` at the repository root is read. Version `vX.Y.Z` is obtained from the first line and the manifest files. (If absent, `v0.1.0` is temporarily assumed).
2. All current real files within the `.agents/` directory (ignoring temporary files or the `scratch/` subdirectory) are listed. Paths must be relative to the root (e.g., `.agents/rules/01-behavior.md`).
3. The **Diff** is calculated:
   - NEW files in `.agents/` not in the old manifest (+).
   - DELETED files from the old manifest no longer in `.agents/` (-).
   - MODIFIED files (compare current content with "what was there", review history if possible, or deduce via the `[Unreleased]` CHANGELOG) (~).
4. `docs/CHANGELOG.md` is read in its `[Unreleased]` section to capture the intent of shifts.

## Step 2: Automatic SemVer Calculation

The system determines the version bump type (SemVer) based on the severity and nature of the Diff:

- **MAJOR BUMP (`v(X+1).0.0`):**
  - Framework files were deleted (killing dependencies of previous rules/workflows).
  - The canonical template structure in `.agents/templates/` was significantly altered.
  - Backward compatibility is broken.
- **MINOR BUMP (`vX.(Y+1).0`):**
  - New `rules/`, `workflows/`, or `skills/` were added cleanly.
  - New functionalities added without removing or breaking previous ones.
- **PATCH BUMP (`vX.Y.(Z+1)`):**
  - Draft corrections (typos).
  - Updates to prompts, internal logic, and structural bugfixes within the same files that do not change the primary contract. No file was deleted.

## Step 3: Triage (Informational)

The release plan is presented to the user and the system proceeds directly to artifact generation:

```markdown
**Current version:** vX.Y.Z
**New proposal:** vA.B.C ([MAJOR/MINOR/PATCH])
**Rationale:** [Brief justification of the bump based on semantics]

**Manifest Diff:**
- [+] [New paths]
- [-] [Deleted paths]
- [~] [Registered changes]
```

## Step 4: Artifact Generation

### 4.1 Version Manifest
1. **Rewrite `kairos-version.txt`**: `kairos-version.txt` is updated:
   - Line 1: New Version (`vA.B.C`)
   - From Line 2 onwards: The clean, alphabetically indexed list of all file paths within `.agents/` (one path per line).

### 4.2 Changelog
2. **Promote Changelog**: `docs/CHANGELOG.md` is modified by updating the `[Unreleased]` title to `[vA.B.C] - YYYY-MM-DD`. A new empty `[Unreleased]` section is added above it.

### 4.3 Public Documentation (READMEs)

READMEs are updated in every release. Two files are mandatory:

- **`.github/README.md`**: Public GitHub README.
- **`README-KAIROS.md`**: Internal README distributed to each adopting project.

**Update Protocol:**

1. **Version bump**: The `> **Version:** vX.Y.Z` field in both files is updated to the new version.
2. **Workflow table**: BOTH workflow tables are verified to be synchronized with real files in `.agents/workflows/`. For each workflow:
   - It has a table entry.
   - The description matches the `description:` frontmatter field.
   - If a workflow was added, its row is appended.
   - If a workflow was deleted, its row is removed.
3. **Component table**: The system component table is verified to reflect the real structure of `.agents/`.
4. **Tone and accessibility**: Each README is evaluated to ensure compliance:
   - The language is accessible for a developer who does NOT know Kairós. No prior framework knowledge is assumed.
   - Features are described in terms of BENEFIT to the user, not internal mechanics ("Generates an exhaustive checklist from any input" > "Executes the promise decomposition algorithm").
   - No internal framework jargon is exposed.
   - Workflows are clearly described regarding both WHEN to use them and WHAT they do.
   - Adoption instructions are step-by-step, concrete, and actionable.
   - *ANTI-PATTERN:* Using framework technical terminology as marketing hooks ("our English-Pivoted CoT system with MECE gates"). The user wants to know what they GET, not the internal mechanism.
   - *ANTI-PATTERN:* Listing features without usage context. Every workflow requires a clear execution scenario.

### 4.4 Template Integrity in `/docs`

The master templates in `.agents/templates/` are the source of truth for documents Kairós generates in adopting projects. Every release must verify their integrity:

1. **Inventory**: All existing templates in `.agents/templates/` are listed.
2. **Documentary Cross-Reference**: For each template corresponding to an axis document (`master-spec.md`, `todo.md`, `memory.md`, `changelog.md`, `user-decisions.md`, `technical-debt.md`), the system verifies:
   - The template structure conforms to the rules in `.agents/rules/04-documentation.md`. If a rule mandates a field or format, the template has it.
   - No orphan templates exist (templates no workflow or rule references).
   - No missing templates exist (documents mentioned in rules whose template is absent).
3. **Workflow Template Cross-Reference**: For each workflow template (`derive-working.md`, `derive-checklist.md`, `checklist-working.md`, `checklist-output.md`), the system verifies:
   - The respective workflow references the exact template filename.
   - The template structure matches the workflow requirements (same phases, gates, fields).
4. **Integrity Report**: A block is generated in the triage (or post-approval if issues arise) listing:
   - [x] Verified, compliant templates.
   - [WARNING] Templates with minor discrepancies (outdated fields).
   - [FAILURE] Templates with critical discrepancies (workflow references missing template, or mismatch).

If [FAILURE] discrepancies are detected, the system corrects them as part of the release. [WARNING] discrepancies are documented and corrected if the effort is low.

## Step 5: Final Verification

Before concluding the release:

1. **Git diff**: `git diff --stat` is executed to verify ONLY expected files were modified. If unexpected files are in the diff, the user is alerted.
2. **Version Consistency**: It is verified that `vA.B.C` appears in:
   - `kairos-version.txt` (line 1)
   - `.github/README.md` (Version field)
   - `README-KAIROS.md` (Version field)
   - `docs/CHANGELOG.md` (recently promoted section title)
3. **Manifest Count**: The file count in `kairos-version.txt` is verified to exactly match the actual `.agents/` file count (excluding `scratch/`).

## Step 6: Final Instruction

The user is notified that the release is ready for push. If the environment requires publishing to `raw.githubusercontent.com` for `/update` to function in other repos, pushing to `main` is required to effectuate the distribution.
