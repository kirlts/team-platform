<!-- TEMPLATE START -->
# Working Document: Derive: [Subject Name]

> **GLOBAL RULES AND INVIOLABLE LIMITS**:
> 1. **MANDATORY:** The agent operates as an automaton. The agent executes this PHASE BY PHASE, without skipping steps or combining them. Each Phase is written in a SEPARATE file operation. The agent does not write multiple phases in a single tool call.
> 2. **LANGUAGE MANDATE:** While these instructions are in English, ALL GENERATED CONTENT (Reasoning, Tables, Checks) is written in the predominant locale of the repository (e.g., Spanish).
> 3. **COVERAGE PRESERVATION RULE:** The agent is prevented from curtailing the check count. Generating exactly "1 check per category" is a statistical failure (Dimensionality Collapse). The agent generates multiple specific variations, failure states, and edge cases per category. The rigorous application dictates a MINIMUM of 10 atomic checks per Actor, with NO global maximum ceiling. The count is not manipulated.
> 4. **CHECKPOINT ANCHOR:** Before initiating any Phase, the system outputs exactly: `<!-- CHECKPOINT: Phase [N] started at [timestamp] -->`
> 5. **GATES (CoT INVERSION):** The agent processes every `⛔ GATE` table. The agent writes its reasoning in the `Empirical Reasoning (CoT)` column BEFORE generating the final `Status` (✅ / ❌ / ⚠️). A Status of ❌ halts the algorithm. The column order in every gate table is intentional: Reasoning FIRST, Status LAST.
>    - *ANTI-PATTERN:* Deciding the status mentally and then writing a justification that matches. This is confirmation bias. The agent genuinely interrogates the output.
>    - *ANTI-PATTERN:* Writing a single sentence like "Looks good" or "Confirmed" as reasoning. Reasoning demonstrates empirical engagement with the data.
> 6. **CRITICAL CONSTRAINTS (PRIMACY DUPLICATION; repeated at end of file for Recency anchoring):**
>    - Every check uses taxonomy `[ACTOR.CAT.NN.VER]` with verificability suffix (.LLM, .HUM, .MIX).
>    - Every check is atomic: ONE action, ONE result, binary pass/fail.
>    - The MECE audit is non-negotiable: overlaps are eliminated, gaps are filled.
>    - The final deliverable traces back to VERIFICATION.md.

---
## Phase 0: Input Classification & System Identity

<!-- INSTRUCTION: The agent extracts Domain Knowledge (technical facts), Author-Provided Checks (explicit acceptance behavior provided by the human), Platform Constraints, and User Overrides. The system identity is compressed into ONE sentence answering: What it does, for whom, and why.

DISCRIMINATION TEST: Checks vs Overrides:
  Does the user's statement describe a PROPERTY of the system that can be verified (e.g., "must support 10k concurrent users")? → Author-Provided Check. It becomes a verifiable check.
  Does the user's statement describe HOW THIS ALGORITHM behaves (e.g., "focus only on the frontend", "ignore the API layer")? → User Override. It modifies scope.
  If ambiguous, it is classified as Author-Provided Check. It is safer to generate a verifiable check from it than to absorb it silently as a scope restriction. -->

- **Text input:** [pending]
- **Code available:** [pending]
- **Documentation available:** [pending]

### Domain Knowledge
[pending or "None found"]

### Author-Provided Checks (verbatim)
[pending or "None found"]

### Platform Constraints
[pending or "None found"]

### User Overrides to this Algorithm
<!-- INSTRUCTION: If the user's prompt contains instructions that modify the algorithm's scope or behavior, they are captured here VERBATIM. -->
[pending or "None; execute with default parameters"]

### System Identity
[pending]

**⛔ GATE 0**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G0-IN-DOMAIN | [Write: What technical facts were extracted from the input? Is the domain knowledge sufficient to identify actors and their promises?] | ☐ |
| G0-IN-AUTHOR | [Write: Did the human provide explicit acceptance criteria or checks? List them if yes. If no, state that the algorithm derives them.] | ☐ |
| G0-IN-PLATFORM | [Write: What platform constraints were identified? List technologies, runtimes, and environmental dependencies.] | ☐ |
| G0-TECH | [Write: Is the tech stack clearly identifiable from the input? List the primary technologies found.] | ☐ |
| G0-BENEFICIARY | [Write: Who is the primary beneficiary of this system? Name a concrete entity that receives value.] | ☐ |
| G0-AGNOSTIC | [Write: Is the system identity written without framework-specific jargon? Could someone unfamiliar with the codebase understand what the system does?] | ☐ |
| G0-OVERRIDES | [Write: Did the user provide scope restrictions or algorithmic overrides? If yes, list them. If no, write "None; full scope."] | ☐ |

---
## Phase 1: Actor Discovery

<!-- INSTRUCTION: The agent identifies ALL entities that interact with, influence, or are affected by the system. Every Discovery Probe below is run against the input.

CRITICAL RULES:
  - Actors are discovered from the INPUT (code, docs, config), not invented.
  - Each actor is a distinct entity; not a synonym or subset of another.
  - An actor may satisfy multiple Discovery Probes. A single-probe classification is not forced.

ANTI-PATTERN: Listing only the obvious actors (e.g., only "User" and "Database"). All five probes are executed.
ANTI-PATTERN: Stopping at exactly 3 actors because the minimum is met. Software systems typically have 4-8 distinct actors. -->

### Discovery Probes
<!-- These five questions decompose ALL possible relationships an entity can have with a software system. They are search beams, not classification labels. -->

| Probe | Question |
|---|---|
| Value reception | Who receives output, rendered content, API responses, or processed data from this system? |
| Resource provision | Who provides infrastructure, data stores, services, or configuration this system depends on? |
| State observation | Who monitors, logs, audits, or passively observes this system's state? |
| External constraint | What external dependency, runtime, specification, or platform does this system run within but cannot control? |
| Mediation | What connects, routes, or bridges between system components or between the system and its consumers? |

### Derivation
**Verbs found in input:** [pending]
**Subjects/Objects found in input:** [pending]

### Discovery Probe Results
<!-- MANDATORY: Each probe is run and its yields are recorded BEFORE assembling the Actor List. -->
| Probe | Entities Found |
|---|---|
| Value reception | [pending; who receives output?] |
| Resource provision | [pending; who provides resources?] |
| State observation | [pending; who observes state?] |
| External constraint | [pending; what constrains the system?] |
| Mediation | [pending; what mediates or bridges?] |

### Actor List
| # | Actor | Relationship to System | Interacts with (INTERFACE / OUTPUT / BOTH) |
|---|---|---|---|
| 1 | [pending] | [pending; describe in system's terms, not probe labels] | [pending] |

**⛔ GATE 1**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G1-PROBES | [Write: List what each of the 5 Discovery Probes yielded. Were any probes skipped? Did any probe yield zero entities; if so, justify why that relationship genuinely does not exist for this system.] | ☐ |
| G1-MINIMUM-ACTORS | [Write: How many actors were found? List them. Are there ≥3? If <5, list at least 3 candidate entities that were CONSIDERED and REJECTED, with the specific reason for each rejection.] | ☐ |
| G1-EXTERIOR | [Write: Did you identify at least one entity that is EXTERNAL to the system; a runtime, platform, or dependency the system cannot control?] | ☐ |
| G1-VALUE-RECEPTION | [Write: Did you identify at least one entity that receives value or output from the system?] | ☐ |
| G1-VOCABULARY | [Write: Are the actor names specific to this system's domain? Would a developer reading only the actor names understand the system's architecture?] | ☐ |

---
## Phase 2: Promise Matrix

<!-- INSTRUCTION - CATEGORY DICTIONARY
For EACH Actor above, the matrix is completed based on:
- Availability (AV): The actor can access the system when requested. It arrives.
- Functionality (FN): The system performs the state change or action the actor expects.
- Correctness (CR): The output or data matches the truth/domain rules precisely.
- Integrity (IN): The state remains consistent across time/failures (no corruption).
- Resilience (RS): The system degrades gracefully or blocks the actor if abused.

MULTIPLE promises are generated per category. A single promise per category is Dimensionality Collapse. Each promise has a concrete failure mechanism; How can this promise be broken?

ANTI-PATTERN: Writing abstract, unfalsifiable promises ("The system should work well", "Data should be correct"). Every promise describes a specific, observable state.
ANTI-PATTERN: Generating exactly 2 promises per category across all actors to hit the minimum of 10. The minimum is a FLOOR.
ANTI-PATTERN: Copy-pasting the same promise structure across actors with minor word changes. Each actor has a UNIQUE relationship with the system. -->

### [Actor Name]
| Category | Promise | Failure Mechanism | Falsable? |
|---|---|---|---|
| Availability | [pending] | [pending] | ☐ |
| Functionality | [pending] | [pending] | ☐ |
| Correctness | [pending] | [pending] | ☐ |
| Integrity | [pending] | [pending] | ☐ |
| Resilience | [pending] | [pending] | ☐ |

<!-- Repeat this table for EACH actor independently -->

**⛔ GATE 2**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G2-CELLS | [Write: Count total cells across all actors. Are there any empty or placeholder cells? List any gaps found.] | ☐ |
| G2-FALSABILITY | [Write: For each promise marked as falsable, can you articulate the YES/NO test? Pick 3 random promises and write their tests here.] | ☐ |
| G2-TAUTOLOGY-PURGE | [Write: Are any promises tautological ("X should do X")? List any found and rewrite them.] | ☐ |
| G2-THRESHOLD | [Write: Count total promises derived. Count number of actors. Calculate: Total ≥ (N_Actors × 10)? Show the math. If NO, the system expands the matrix before proceeding.] | ☐ |
| G2-VOCABULARY | [Write: Scan all promise text. Is the terminology consistent across actors? If one actor uses "request" and another uses "petition" for the same concept, normalize.] | ☐ |

---
## Phase 3: Observables & Verificability Classification

<!-- INSTRUCTION: For every Promise defined in Phase 2, HOW it is observed from the OUTSIDE is defined AND WHO is the best-qualified entity to verify it is classified.
Format: Action → Expected Result → Verifier
The observation is EXTERNAL; it describes what a verifier sees, not what happens internally.

VERIFIABILITY CLASSIFICATION: The Verifier column classifies which entity is best qualified to verify the promise in ideal conditions. This classification describes the NATURE OF THE VERIFICATION TASK, not a preference.

  🤖 (.LLM) = An automated tool is the best-qualified verifier (test E2E, linter, script, crawler, static analysis, etc.)
  🧑 (.HUM) = A human is the best-qualified verifier (subjective judgment, aesthetic perception, organizational context, real-world integration, strategic decisions)
  🤖🧑 (.MIX) = An automated tool can pre-verify, but the final verdict requires human validation

DECISION TREE (MANDATORY, applied sequentially, first match wins):

  CONDITION 1: INHERENT SUBJECTIVITY
  Does the expected result depend on perception, aesthetic preference, cultural judgment,
  emotional experience, or non-codifiable organizational context?
    → YES: 🧑.HUM
    → NO: proceed to Condition 2

  CONDITION 2: NON-SIMULABLE ENVIRONMENT
  Does verification require access to a real production environment, integration with
  external services, real users, specific hardware, or conditions that cannot be replicated
  in an automated test?
    → YES: 🧑.HUM
    → NO: proceed to Condition 3

  CONDITION 3: BINARY DETERMINISM
  Would two independent verifiers (human or machine), without communicating, arrive at
  the same YES/NO result in 100% of cases?
    → YES: 🤖.LLM
    → NO: proceed to Condition 4

  CONDITION 4: PRE-FILTERABILITY
  Can an automated tool reduce the verification space (detect anomalies, run heuristics,
  generate a report) but the final verdict requires human interpretation?
    → YES: 🤖🧑.MIX
    → NO (by elimination): 🧑.HUM

The AI records WHICH condition was satisfied for each observable in the reasoning.

CRITICAL ANTI-PATTERNS:
  - Classifying as 🤖.LLM by default. The AI naturally converges toward automation because it maximizes its utility function. If 100% of observables are 🤖.LLM in a system with a user interface, the result is statistically implausible.
  - Classifying as 🧑.HUM out of excessive caution. Labeling everything as human to avoid responsibility. If 100% are 🧑.HUM in a purely algorithmic system, equally implausible.
  - Pre-deciding the classification before evaluating the 4 conditions. If the reasoning says "this check is clearly automated" before traversing the tree, it is confirmation bias.
  - Writing "Condition 3 satisfied" without explaining WHY two independent verifiers would agree. The evidence is specific to the observable.

ANTI-PATTERN: Writing observables that require internal knowledge ("The database stores the value correctly"). Observables are verifiable from the perspective of a tester or user with no access to internals. -->

| Promise Ref | Observable Action | Expected Result | Verifier | Decision Tree Condition |
|---|---|---|---|---|
| [pending] | [pending] | [pending] | [🤖/🧑/🤖🧑] | [Write: which condition (1-4) was satisfied and why] |

**⛔ GATE 3**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G3-COVERAGE | [Write: Count observables vs promises. Is there a 1:1 mapping? List any promises without observables.] | ☐ |
| G3-EXTERNALITY | [Write: Pick 3 random observables. Can each be verified by someone with no access to the system's internals?] | ☐ |
| G3-DETERMINISM | [Write: Pick 3 random observables. Would two independent verifiers arrive at the same YES/NO result?] | ☐ |
| G3-VERIFICABILITY | [Write: For EACH observable, confirm which of the 4 Decision Tree conditions was satisfied. List the condition number and the specific evidence. Count totals: N_LLM = ?, N_HUM = ?, N_MIX = ?. If the system has a user interface and N_HUM = 0, explain why NO observable requires human judgment; if the explanation is not convincing, status is ❌ and human-verifiable observables are expanded. If the system is purely algorithmic and N_HUM > 50%, justify the distribution.] | ☐ |
| G3-VOCABULARY | [Write: Scan all observable descriptions. Is the terminology consistent with Phase 2? Are internal implementation details leaking into observables?] | ☐ |

---
## Phase 4: Synthesis & Verification Checklist (Working Draft)

<!-- INSTRUCTION: Checks are assembled with taxonomy [ACTOR.CAT.NN.VER].
  - ACTOR: abbreviated actor name, 3-5 uppercase characters, derived from the first syllable or initials.
  - CAT: category abbreviation (AV, FN, CR, IN, RS), 2 uppercase characters.
  - NN: two-digit sequential number, zero-padded (01, 02...).
  - VER: verificability suffix; one of: LLM, HUM, MIX. Inherited from the observable's Verifier classification in Phase 3.
  All abbreviations are defined ONCE in the key table below, then reused consistently.

  The emoji (🤖, 🧑, or 🤖🧑) is placed as a PREFIX before the check ID for visual scannability.
  The suffix (.LLM, .HUM, .MIX) is part of the ID for textual traceability (search, filters, scripts).

Rules:
  - Compound checks are decomposed. One action, one result.
  - Each check is self-contained; understandable without reading the working document.
  - Each check INHERITS its verificability classification from its parent observable in Phase 3. If a compound check was decomposed, the Decision Tree is re-evaluated for each atomic part.

ANTI-PATTERN: Writing checks that require context from the working document to be understood.
ANTI-PATTERN: Merging two observables into one check to reduce count.
ANTI-PATTERN: Using inconsistent abbreviations for the same actor across different checks.
ANTI-PATTERN: Assigning a verificability suffix that contradicts the parent observable's classification without re-applying the Decision Tree. -->

### Abbreviation Key
| Full Name | Abbreviation | Type |
|---|---|---|
| [pending] | [pending] | Actor / Category |
| Verifiable by AI/automated tool | LLM | Verifier |
| Requires human verification | HUM | Verifier |
| Pre-verifiable by AI, final human validation | MIX | Verifier |

### Checklist Draft
- 🧑 `[ACTOR.CAT.NN.HUM]` Action → Expected Result. *(Promise: ...)*
- 🤖 `[ACTOR.CAT.NN.LLM]` Action → Expected Result. *(Promise: ...)*
- 🤖🧑 `[ACTOR.CAT.NN.MIX]` Action → Expected Result. *(Promise: ...)*

### Atomicity Verification
<!-- INSTRUCTION: For EACH check, four properties are verified independently. Batch-verification is prevented.

ANTI-PATTERN: Marking all checks as ATOMIC without examining each one. The verdict column is filled ONLY after all boolean columns are evaluated. -->

| Check ID | Singular Action? | Singular Result? | Implicit Compound? | Coherent Verifier? | Verdict (ATOMIC/COMPOUND) |
|---|---|---|---|---|---|
| [ID] | [Write: Does this check contain exactly ONE verb/action?] | [Write: Does this check describe exactly ONE observable outcome?] | [Write: Could this check be split into two checks that verify different things?] | [Write: Does the .LLM/.HUM/.MIX suffix match the Decision Tree applied to this check's parent observable? If the check was decomposed from a compound, was the Decision Tree re-evaluated for each atomic part?] | [pending; fill ONLY after all columns] |

**⛔ GATE 4**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G4-ATOMICITY | [Write: How many checks were marked COMPOUND? Were ALL of them decomposed? List the original compound checks and their decompositions.] | ☐ |
| G4-DENSITY-PER-ACTOR | [Write: For EACH actor, count the checks. List: Actor1=N, Actor2=N, Actor3=N... Does EVERY actor have ≥10? If ANY actor has <10, the process halts. The agent returns to Phase 2 and expands that actor's promise matrix. The agent does not proceed.] | ☐ |

---
## Phase 5: MECE Audit (Mutually Exclusive, Collectively Exhaustive)

<!-- INSTRUCTION: 
ME Audit: Compare checks that appear similar. Are they verifying exactly the same state, or different facets?
CE Audit: Are there gaps in coverage? Does the matrix lack tests for edge cases, failure modes, or boundary conditions?

ANTI-PATTERN: Declaring "no overlaps found" without examining specific pairs. The compared pairs are listed.
ANTI-PATTERN: Declaring "no gaps found" without examining the coverage matrix cell by cell. -->

### ME Pairs Examined
| Pair (ID-a ↔ ID-b) | Same Promise? | Resolution |
|---|---|---|
| [pending; list SPECIFIC pairs compared] | [Write: What do they share? What differentiates them?] | [pending; fill ONLY after analyzing the pair] |

### Coverage Matrix
| Actor | AV | FN | CR | IN | RS |
|---|---|---|---|---|---|
| [name] | [count] | [count] | [count] | [count] | [count] |

**⛔ GATE 5**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G5-ME-PAIRS | [Write: How many pairs did you examine? List the most ambiguous pair and explain why they are or are not duplicates.] | ☐ |
| G5-CE-MATRIX | [Write: Examine the coverage matrix. Are there any cells with 0 checks? If so, is the gap justified or does it indicate a missing promise?] | ☐ |
| G5-CE-NO-GAPS | [Write: Consider the system holistically. Is there any requirement, constraint, or behavior mentioned in the input that is NOT covered by any check?] | ☐ |
| G5-AUDIT-DELTA | [Write: Did this audit result in any additions, removals, or modifications? List them.] | ☐ |
| G5-POST-MECE-DENSITY | [Write: After all ME removals from this audit, re-count checks per actor. List: Actor1=N, Actor2=N... Does EVERY actor still have ≥10? If ANY actor dropped below 10 due to duplicate removal, the process halts. The agent returns to Phase 2, generates replacement promises for the removed duplicates, and propagates through Phases 3-4 before proceeding.] | ☐ |

---
## GATE 6: Self-Verification Audit (Terminal)

<!-- INSTRUCTION: This is the terminal gate. The agent audits its OWN output against immutable invariants.

EXECUTION SEQUENCE (MANDATORY):
  1. The agent generates `[subject]_checklist.md` using the output template BEFORE reaching this gate.
  2. The agent stops writing the working document.
  3. The agent opens `[subject]_checklist.md`; the DELIVERABLE, not the working draft above.
  4. The agent counts its actual contents: actors, checks per actor, terminology used.
  5. The findings are recorded below.
  6. If any invariant fails, remediation occurs before proceeding to integration.
  This gate audits the DELIVERABLE, not the working document.

ANTI-PATTERN: Treating this as a rubber-stamp. If a failure is found, remediation is executed; rationalization is prevented.
ANTI-PATTERN: Writing "All actors have ≥10 checks" without listing the actual counts. The work is shown.
ANTI-PATTERN: Filling this gate by referencing Phase 4 counts instead of counting the deliverable directly. The deliverable is the source of truth. -->

| ID | Invariant | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|---|
| G6-ACTOR-COUNT | ≥3 actors identified | [Write: List every actor in the deliverable. Count them.] | ☐ |
| G6-DENSITY | ≥10 checks per actor (NO EXCEPTIONS) | [Write: For EACH actor, count the checks in the deliverable. Format: Actor1=N, Actor2=N... If ANY <10, status is ❌ and the agent returns to Phase 2.] | ☐ |
| G6-ATOMICITY | Every check has ONE action and ONE result | [Write: Sample 5 random checks. For each, identify the single action and single result. Flag any that contain conjunctions (and/or/also).] | ☐ |
| G6-MECE | No duplicates, no gaps | [Write: Were all ME pairs resolved? Were all CE gaps closed?] | ☐ |
| G6-FALSABILITY | Every check is binary (pass/fail) | [Write: Pick 3 random checks. For each, articulate the exact binary test. If any check requires subjective interpretation, flag it.] | ☐ |
| G6-HUMAN-CHECKS | Verificability distribution reflects system nature | [Write: Count checks by verifier type IN THE DELIVERABLE (not the working document): Total .LLM = ?, Total .HUM = ?, Total .MIX = ?. For EACH .HUM and .MIX check, list its ID and the Decision Tree condition (1-4) that justified its classification. CROSS-REFERENCE: Does the system have a user interface? If YES and .HUM = 0: status is ❌. Does the system integrate with external services? If YES and .HUM + .MIX = 0: status is ❌. Is the system purely algorithmic with no human-facing output? If YES and .HUM > 50%: justify or status is ❌.] | ☐ |
| G6-ALGORITHM | All 6 phases and 7 gates executed sequentially | [Write: List each checkpoint anchor found in this document. Count: Phase 0, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5 = 6 phases. Gate 0, Gate 1, Gate 2, Gate 3, Gate 4, Gate 5, Gate 6 = 7 gates.] | ☐ |
| G6-OVERRIDES | All user overrides respected | [Write: List each override from Phase 0. For each, confirm how it was applied. If no overrides, write "No overrides specified."] | ☐ |

**HARD FAILURE PROTOCOL:** If G6-DENSITY is ❌, the agent returns to Phase 2, expands the deficient actor(s), propagates through Phases 3-5, regenerates the deliverable, and re-executes GATE 6.
**HUMAN-CHECKS FAILURE PROTOCOL:** If G6-HUMAN-CHECKS is ❌, the agent returns to Phase 3, re-evaluates the Decision Tree for the flagged observables, propagates through Phase 4, regenerates the deliverable, and re-executes GATE 6.

---
## ⛔ GATE 7: Anti-Slop Verification (Post-Deliverable)

<!-- INSTRUCTION: This gate verifies that the deliverable does not contain AI-generated filler, corporate-motivational copy, or RLHF fingerprints. It operates by heuristic pattern detection, not semantic judgment. -->

| ID | Pattern Category | Detection Heuristic | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|---|---|
| G7-RLHF-FILLER | RLHF transition fillers | Scan deliverable for: «It's worth noting that», «Cabe destacar que», «Es importante señalar», «En este contexto», «Por otro lado» | [Write: List any instances found. If none, write "Zero instances."] | ☐ |
| G7-NEG-PARALLELISM | Negative parallelisms | Scan for: «not just X, but Y», «no solo X, sino Y», «more than just» | [Write: List any instances found.] | ☐ |
| G7-CORPORATE-COPY | Corporate-motivational copy | Scan for: «cutting-edge», «seamless», «innovative», «unlock», «empower», «transform your», «leverage» | [Write: List any instances found.] | ☐ |
| G7-SERVILE-POSITIVITY | Servile positivity | Scan for: «¡Excelente pregunta!», «Gran observación», «Eso es muy interesante», «Great question» | [Write: List any instances found.] | ☐ |
| G7-EM-DASHES | Em dashes | Scan deliverable for ANY em dash character (—). Zero tolerance: if count > 0, flag. Replace with period, comma, semicolon, or parentheses as appropriate | [Write: Total count. If > 0, list each instance and its replacement.] | ☐ |

If ANY gate fails: the agent remediates the deliverable by replacing the flagged patterns with domain-specific language derived from the input.

---
> **CRITICAL CONSTRAINTS (RECENCY DUPLICATION; first stated in GLOBAL RULES at top of file):**
> - Every check uses taxonomy `[ACTOR.CAT.NN.VER]` with verificability suffix (.LLM, .HUM, .MIX).
> - Every check is atomic: ONE action, ONE result, binary pass/fail.
> - The MECE audit is non-negotiable: overlaps are eliminated, gaps are filled.
> - ≥10 checks per actor, NO EXCEPTIONS.
> - The final deliverable forms the VERIFICATION.md contract.

<!-- TEMPLATE END -->
