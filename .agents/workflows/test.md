---
description: /test - Establishes or executes the project's testing strategy. Automatically detects if the repo needs a new strategy or already has one to execute.
---

# Strategic Testing

This workflow operates in two modes automatically detected by the repository's state.

## Mode Detection

The system scans the repository looking for evidence of an existing testing strategy. Evidence includes, but is not limited to:

- `docs/TEST.md` (formal Kairós contract)
- Test runners configuration (`pytest.ini`, `pyproject.toml [tool.pytest]`, `jest.config.*`, `vitest.config.*`, `.mocharc.*`, `phpunit.xml`)
- Test directories (`test/`, `tests/`, `__tests__/`, `spec/`)
- Inline tests or validation scripts in CI/CD (`.github/workflows/`, `Makefile` with `test` target)
- Manual checklists or QA documents in any format

**Detection Result:**

- If NO testing evidence is found → **Mode 1: Propose strategy**
- If an existing strategy is found and is at least partially appropriate for the repository's scope → **Mode 2: Execute existing suite**
- If an existing strategy is found but is entirely inadequate for the current scope (e.g., only tests from an abandoned module) → **Mode 1**, but the system documents what was found and why it is discarded.

---

## Mode 1: Propose Strategy

### Phase 1: Repository Analysis

1. `docs/MASTER-SPEC.md` is read to understand the architecture and critical flows.
2. The codebase is scanned to identify: languages, frameworks, directory structure, existing tests (if any).
3. The flows the user needs to visually verify and the critical flows that cannot fail are identified.

### Phase 2: Strategy Design

The testing strategy is designed from the user's perspective: what needs verification, what flows are critical, what regressions are unacceptable.

**Default testing pyramid for greenfield:**

| Layer | Typical Tool | Target Coverage | Authority | Success Criterion |
|---|---|---|---|---|
| Unit tests | vitest, pytest, go test, jest | Business logic, pure functions, utilities | `.LLM` (fully automatable) | Every function with non-trivial logic has a test |
| Integration tests | vitest, pytest, supertest | End-to-end data flows, APIs, DB queries | `.MIX` (system designs and runs; human validates critical flow coverage) | Every endpoint/critical flow has a test |
| E2E / visual tests | Playwright | Visible user flows, UI regressions | `.MIX` (system executes; human validates visual correctness) | Every critical flow in MASTER-SPEC has a test |
| Exploratory / perceptual | Manual | UX coherence, aesthetic judgment, edge cases requiring domain intuition | `.HUM` (requires human execution) | Critical judgment calls documented |

The user can always implicitly override any element of the proposed strategy (e.g., "I don't want Playwright" → respected without questioning).

### Phase 3: TEST.md Generation

`docs/TEST.md` is generated with the materialized strategy:

```markdown
# TEST.md

## Testing Stack
- Runner: [e.g., vitest, pytest]
- E2E: [if applicable: playwright, none]
- Mocking: [strategy]

## Automatic Triggers
<!-- Conditions under which the AI executes tests without being asked -->
- Upon completing any TASK modifying [component X]
- Upon modifying [specific files/patterns]
- Upon closing an epic

## High Priority Tests (Inviolable Boundaries)
<!-- Tests validating NO Inviolable Boundary is breached -->
- [ ] [Test description]. Validates §4 of MASTER-SPEC

## Regression Tests
<!-- Added when debugging reveals a bug -->

## E2E Policy
- Activate when: [conditions]
- Do not activate when: [conditions]
```

### Phase 4: Confirmation

`TEST.md` is presented to the user. Tests are not implemented until the contract is confirmed.

---

## Mode 2: Execute Existing Suite

### Step 1: Read Strategy

The detected testing strategy is loaded:

- If `docs/TEST.md` exists: it is used as the formal contract (which runner, which triggers, which high-priority tests).
- If the strategy is in runner configurations (pytest.ini, jest.config, etc.): config files and existing tests are read to understand what runs and how.
- If the strategy is a manual checklist or a QA document: it is read and used as a guide.

### Step 2: Evaluate Context

The subset to execute is determined:
- If the user specifies the subset in the invocation (e.g., `/test auth`), that subset is executed.
- If the conversational context implies an area (e.g., "I just refactored the auth module"), tests for that area are executed.
- If there is no specific context, the system executes the full suite.

### Step 3: Execute Tests

The relevant tests are executed using the detected runner. If a test fails:
1. The root cause is analyzed.
2. A fix is proposed.
3. Tests are re-executed to validate.

### Step 4: Document Result

- If bugs are discovered → they are added to regression tests (in TEST.md if it exists, or it is created).
- If the correction reveals a transferable pattern → it becomes a candidate for MEMORY.md (with anti-bias protocol).
- Coverage count is updated if applicable.
- If the project uses a legacy strategy without a formal TEST.md, its migration to `docs/TEST.md` is proposed for future executions.

**The system halts and the workflow completes.**
