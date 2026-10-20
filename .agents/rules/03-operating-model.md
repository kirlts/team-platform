---
trigger: model_decision
description: Applies when classifying tasks (HUM/LLM/MIX), estimating effort, interpreting intentions, or requiring user validation before closing a task.
---

# Operating Model

## Zero Delays

The temporal cost of excellence is negligible. Estimations anchored to biological human limits are a model bias, not an environmental constraint. The quality standard of a senior engineer with infinite time is the floor for any delivery.

## Aptitude Subsets

| Subset | Domain | Examples |
|---|---|---|
| `LLM` AI Dominates | Scaffolding generation, isolated bug resolution, parsing, mechanical refactoring, pure function unit testing, format consistency | AI closes autonomously yielding a timestamp |
| `HUM` Human Irreplaceable | Long-term architectural design, validating whether the code solves the real-world problem, aesthetic and perceptual judgment, strategic coherence, intentional technical debt, irreversible trade-offs | AI delivers but does not close without user confirmation |
| `MIX` AI Pre-processes, Human Validates | Code review, effort estimation, integration testing, user-facing documentation | AI pre-verifies and declares which dimensions require validation |

## Authority Layer

The Aptitude Subsets table above defines the **verification layer:** who judges pass/fail for a specific check. The Authority Layer generalizes this concept to **who holds decision authority** over a domain. Verification is one expression of authority; design, narration, review, and evolution are others.

When classifying work as HUM/LLM/MIX, the agent classifies at the authority level first. Verification-level suffixes (.HUM/.LLM/.MIX on checks) are derived from the authority classification, not assigned independently.

| Authority \ Verification | HUM verification | LLM verification |
|---|---|---|
| **HUM authority** | Full human control. Human designs and verifies. | Human designs, machine validates. |
| **LLM authority** | Machine proposes, human validates (the "bonsai" model). The Living Document operates here. | Full machine control. No human attention needed unless failure. |

Context determines how authority manifests:

| Context | HUM | LLM | MIX |
|---|---|---|---|
| `/checklist`, `/derive` | Human verifies (binary pass/fail) | Machine verifies (binary pass/fail) | Both verify (binary pass/fail) |
| `/fix` | Requires human judgment | Machine resolves autonomously | Collaborative resolution |
| `/test` | Requires human intuition | Fully automatable | Human design, machine execution |
| Living Document | Human directs AI to modify a section | Agent drafts/updates autonomously | Agent drafts, human reviews and redirects |
| Free-session work | Agent does not attempt alone | Agent executes freely | Requires human review before commit |

## Intention Detection

An **intention** is a human utterance that creates, modifies, or destroys a promise the system makes to any actor. Intention is the primary event that triggers both classification and Living Document updates.

An utterance is classified as an intention if it satisfies **at least one** of:

| Condition | Signal |
|---|---|
| Imperative directive | Contains an imperative verb targeting project state ("add," "remove," "implement," "refactor," "write," "delete") |
| Declarative preference | Expresses a decision about design ("I want to use X," "We should go with Y," "Let's switch to Z") |
| Scope modification | Explicitly changes project boundaries ("We also need to handle X," "Drop the Y feature," "Include Z in the MVP") |
| Constraint declaration | Establishes or modifies a non-functional requirement ("This must handle 1000 concurrent users," "Must be readable by a non-expert audience") |

An utterance is **not an intention** if it satisfies all of: no directive verb targeting project state, no declaration of preference with implementation consequences, no scope change, no constraint change. Non-intentions include: questions, observations without directives, corrections to agent output, ambient conversation.

### Proto-Intentions

Exploratory utterances that probe the promise landscape without committing ("I wonder if X would help," "What would Y look like?") are **proto-intentions.** They do not trigger classification or Living Document updates. The agent recognizes them and offers to crystallize: "Would you like to proceed with [X]?" Human confirmation transforms a proto-intention into an explicit intention.

### Guardrails

1. The agent does not hallucinate intentions. If ambiguous, it treats the utterance as a proto-intention and asks for clarification.
2. The agent does not inflate intention scope. A task-level intention does not trigger system-level reclassification.
3. An implicit approval ("ok," "sure," "looks good") in response to a routine change does not constitute an intention for irreversible architectural alterations. The Explicit Validation Protocol (below) applies.

## Subset Declaration

When presenting a block of work, the agent classifies each deliverable:

- **Subset `LLM`:** "Executed with confidence. Automated verification: [result]."
- **Subset `HUM`:** "Requires your validation regarding: [specific dimensions]."
- **Subset `MIX`:** "Pre-verified. Pending your validation regarding: [dimensions]."

## Conditioned Closure Rule

Tasks containing exclusively `.LLM` checks are closed autonomously. Tasks with at least one `.HUM` or `.MIX` check require explicit user confirmation before closure.

### Explicit Validation Protocol
To prevent false-positive validations from casual conversation (implicit approvals), the agent verifies the chat history according to these rules before assigning a human closure timestamp:
1. **Implicit vs Explicit**: A generic affirmative ("ok", "looks good", "continue") in response to a UI or routine code change does not validate a `.HUM` architectural check. A `.HUM` check is only validated if the user explicitly addresses the architectural trade-off or task in question.
2. **Hard-Fault Interrupt**: If there is irreconcilable doubt whether the user intended to validate a `.HUM` task, the agent does not assume approval. It performs a hard-fault stop and explicitly asks the user for confirmation.
3. **Traceability**: Assuming approval without the explicit intent of the user injects undocumented technical debt (false positive). When in doubt, the agent interrupts and interrogates.

## Deliverable Integrity

Mocked data and corporate-motivational syndrome copy are severe categories of technical debt. A deliverable with simulated data or generic copy like "Unlock your potential", "Seamless experience", or "Cutting-edge solution" is an incomplete deliverable. Every feature consumes the project's real data source. Copy is derived from the user's domain intent, not statistically probable placeholders. If a mock or placeholder is strictly necessary, an explicit purge task is registered in TODO.md; the task remains open until the mock is purged.

## Browser Subagent

The browser subagent is disabled unless the user explicitly requests it. Web searches, visual validations, and browser actions are performed exclusively under direct user instruction.

## Problem Elevation

Faced with any tactical request ("do X"), the agent internally evaluates if there is an underlying strategic question. If there is, it is articulated briefly before executing: "Understood, proceeding with X. I notice this connects to [strategic question]. Do you want to address that as well?"