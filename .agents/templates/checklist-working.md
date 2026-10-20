<!-- TEMPLATE START -->
# Working Document: Checklist: [Subject Name]

> **GLOBAL RULES AND INVIOLABLE LIMITS**:
> 1. **MANDATORY:** The agent operates as an automaton. The agent executes this PHASE BY PHASE, without skipping steps or combining them. Each Phase is written in a SEPARATE file operation. The agent does not write multiple phases in a single tool call.
> 2. **DOMAIN-NATIVE LANGUAGE MANDATE:** ALL GENERATED CONTENT (Reasoning, Tables, Checks, Actor names, Category labels) is written in the LANGUAGE AND VOCABULARY determined during Phase 0.5. The agent does not know the correct language or vocabulary yet; Phase 0.5 determines it. Until Phase 0.5 is complete, neutral placeholder labels are used.
> 3. **COVERAGE PRESERVATION RULE:** The agent is prevented from curtailing the check count. Generating exactly "1 check per category" is a statistical failure (Dimensionality Collapse). The agent generates multiple specific variations, failure states, and edge cases per category. The rigorous application dictates a MINIMUM of 10 atomic checks per Actor, with NO global maximum ceiling. The count is not manipulated.
> 4. **CHECKPOINT ANCHOR:** Before initiating any Phase, the system outputs exactly: `<!-- CHECKPOINT: Phase [N] started at [timestamp] -->`
> 5. **GATES (CoT INVERSION):** The agent processes every `⛔ GATE` table. The agent writes its reasoning in the `Empirical Reasoning (CoT)` column BEFORE generating the final `Status` (✅ / ❌ / ⚠️). A Status of ❌ halts the algorithm. The column order in every gate table is intentional: Reasoning FIRST, Status LAST.
>    - *ANTI-PATTERN:* Deciding the status mentally and then writing a justification that matches. This is confirmation bias. The agent genuinely interrogates the output.
>    - *ANTI-PATTERN:* Writing a single sentence like "Looks good" or "Confirmed" as reasoning. Reasoning demonstrates empirical engagement with the data.
> 6. **ARTIFACT ISOLATION:** The output of /checklist is an internal chat artifact. The alteration of /docs requires explicit user instruction.
> 7. **CRITICAL CONSTRAINTS (PRIMACY DUPLICATION; repeated at end of file for Recency anchoring):**
>    - Every check uses taxonomy `[ACTOR-CAT-NNN.VER]` with verificability suffix (.LLM, .HUM, .MIX).
>    - Every check is atomic: ONE action, ONE result, binary pass/fail.
>    - The MECE audit is non-negotiable: overlaps are eliminated, gaps are filled.
>    - ≥10 checks per actor, NO EXCEPTIONS.
>    - ALL output vocabulary is domain-native (Lexicon Table). Zero software jargon in non-software domains.

---
## Phase 0: Input Ingestion & Classification

<!-- INSTRUCTION: The agent exhausts ALL available context. The input is not just the user's text prompt; it includes any attached files, images, URLs, the open repository or file system in the IDE, and any other contextual data. Three categories are extracted:
  1. Domain Knowledge: factual content, rules, requirements, constraints found in the input
  2. Author-Provided Rules: explicit acceptance criteria, conditions, or behavioral rules stated by the human
  3. User Overrides: any instruction from the user that modifies, restricts, or extends the algorithm itself

CONTEXT SCANNING PROTOCOL: Available sources are scanned in descending order of information density:
  1. The user's prompt and any text provided directly.
  2. Attached files (documents, spreadsheets, PDFs, images); read in full.
  3. Provided URLs; fetched and content extracted.
  4. If a file system or repository is accessible in the IDE: documentation files are scanned first, then configuration/metadata files, then the directory structure overview. Source files are read only if the preceding layers are insufficient to identify actors and domain knowledge. The entire file tree is not read indiscriminately.
  5. If no file system is accessible (standalone prompt), that is valid; the agent proceeds with what is available.
  The goal is sufficiency: scanning is sufficient when the domain, at least 3 distinct actors, and enough vocabulary to populate the Lexicon Table are confidently identified.

VISUAL INPUT PROCESSING PROTOCOL: For image, video, or diagram inputs, the agent:
  1. Describes every observable element factually (text, structure, relationships, layout).
  2. Extracts all visible text verbatim (OCR equivalent).
  3. Identifies structural elements: tables, flowcharts, hierarchies, annotations, labels.
  4. Treats the extracted content as first-class Domain Knowledge; equivalent in authority to text input.
  Dismissing visual inputs as "not applicable" or "decorative" constitutes an ingestion failure.

ANTI-PATTERN: Treating the user's prompt as the ONLY input when additional context is available.
ANTI-PATTERN: Scanning an entire codebase or file tree without a stopping condition. Scanning is performed for domain knowledge, not for completeness. -->

- **Text input:** [pending]
- **Attached files/media:** [pending]
- **File system/IDE context:** [pending or "None accessible"]
- **URLs provided:** [pending]

### Domain Knowledge
[pending or "None found"]

### Author-Provided Rules (verbatim)
[pending or "None found"]

### User Overrides to this Algorithm
<!-- INSTRUCTION: If the user's prompt contains instructions that modify the algorithm's behavior, they are captured here VERBATIM. These are binding for the remainder of execution. The ONLY immutable constraint that cannot be overridden is the 10-check-per-actor minimum.

DISCRIMINATION TEST: Rules vs Overrides:
  Does the statement describe a PROPERTY of the subject that can be verified (e.g., "the proposal must not exceed 20 pages")? → Author-Provided Rule. It becomes a verifiable check.
  Does the statement describe HOW THIS ALGORITHM behaves (e.g., "only consider 3 actors", "use English")? → User Override. It modifies the workflow.
  If ambiguous, it is classified as Author-Provided Rule. It is safer to generate a verifiable check from it than to absorb it silently as a procedural instruction. -->
[pending or "None; execute with default parameters"]

**⛔ GATE 0**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G0-EXHAUSTIVE-INGESTION | [Write: What sources were available? Which were actually read? Is there ANY source detected but not ingested? If so, why?] | ☐ |
| G0-DOMAIN-KNOWLEDGE | [Write: What factual content was extracted? Is it sufficient to define actors and promises?] | ☐ |
| G0-AUTHOR-RULES | [Write: Did the human provide explicit acceptance criteria? If yes, list them. If no, state that the algorithm derives them.] | ☐ |
| G0-OVERRIDES | [Write: Did the user modify the algorithm? If yes, list each override and confirm it does not violate the 10-check minimum.] | ☐ |

---
## Phase 0.5: Domain Intelligence

<!-- INSTRUCTION: This phase determines the ENTIRE linguistic and conceptual universe of the working document and the final checklist. The domain is diagnosed BEFORE any actors, promises, or checks are generated.

CRITICAL ANTI-PATTERNS:
  - Defaulting to software vocabulary ("sistema", "usuario", "endpoint", "validar", "bug") when the domain is NOT software. This is the single most common failure mode.
  - Using generic filler terms ("stakeholder", "proceso", "recurso") instead of the specific vocabulary of the domain.
  - Assuming the domain from a single keyword instead of analyzing the full input context.
  - Copying vocabulary from this template's structural examples. The Lexicon Table is DERIVED from the input, not from these instructions.

PROCEDURE:
  1. The totality of ingested input is analyzed.
  2. The primary domain and its subdomain(s) are determined.
  3. The audience is identified: who reads and uses this checklist?
  4. The linguistic register is determined (formal-academic, professional-executive, technical-operational, etc.)
  5. The Lexicon Table is built: for each abstract concept used by the algorithm, the domain-native term and any prohibited terms that would feel foreign to the audience are determined.
-->

### Domain Diagnosis
- **Primary domain:** [pending; derive from input, do NOT guess]
- **Subdomain(s):** [pending]
- **Audience:** [pending; who will read and use this checklist?]
- **Linguistic register:** [pending]

### Language Resolution Cascade
<!-- INSTRUCTION: The output language (idiom) is determined using the following priority hierarchy. The FIRST tier that yields a definitive answer is applied. Which tier resolved the language is recorded.

  TIER 1: Explicit user declaration. The user's prompt states the language directly (e.g., "generate the checklist in English"). This overrides all other signals.
  TIER 2: Repository/IDE context. If a repository is open, the predominant language of its documentation (README, docs/, comments) is detected. That language is used.
  TIER 3: Attached documents. If the primary input documents are in a single language, that language is used.
  TIER 4: Prompt language. The language the user wrote their prompt in is used.

  ANTI-PATTERN: Defaulting to English without evaluating the cascade. English is a valid output ONLY if it emerges from the cascade, not from model default behavior.
  ANTI-PATTERN: Mixing languages within the output (e.g., Spanish checks with English category labels). Once resolved, the language is uniform and total. -->

- **Output language:** [pending]
- **Resolution tier applied:** [pending; which tier (1-4) determined the language? Cite the evidence.]

### Lexicon Table
<!-- INSTRUCTION: This table is the translation layer. The left column contains abstract concepts that the algorithm uses internally. The center column is what the agent writes in all subsequent phases. The right column lists terms that would be semantically foreign to the audience and are therefore PROHIBITED in any output.

A minimum of 11 rows (8 domain + 3 verificability) are populated. Domain terms are derived from the input; terms are not invented or copied from other domains. The 3 verificability rows use universal emojis but their Domain-Native Term is adapted to the domain's vocabulary.

ANTI-PATTERN: Filling this table with generic management jargon ("stakeholder", "deliverable", "KPI") because it "sounds professional." The terms come from the specific input's vocabulary.
ANTI-PATTERN: Leaving the Prohibited column empty. Every domain has terminology that would be jarring if it appeared. It is identified. -->

| Abstract Concept | Domain-Native Term | Prohibited Terms |
|---|---|---|
| The subject being analyzed | [pending] | [pending] |
| Who receives value | [pending] | [pending] |
| Who provides resources/maintains | [pending] | [pending] |
| Who evaluates/audits | [pending] | [pending] |
| External constraint | [pending] | [pending] |
| A verifiable requirement | [pending] | [pending] |
| A failure/non-compliance | [pending] | [pending] |
| The final deliverable/output | [pending] | [pending] |
| 🤖 Automated/deterministic verification | [pending; e.g., "Confirmable documentalmente", "Medible objetivamente"] | [pending] |
| 🧑 Human judgment verification | [pending; e.g., "Requiere criterio especializado", "Requiere evaluación estética"] | [pending] |
| 🤖🧑 Mixed verification (pre-filterable) | [pending; e.g., "Pre-filtrable, final expert validation"] | [pending] |

### Actor Discovery Probes
<!-- INSTRUCTION: The following five questions represent an exhaustive decomposition of the possible relationships an entity can have with the subject being analyzed. They serve as DISCOVERY TOOLS; not as a classification system. An actor may satisfy multiple probes simultaneously.

PROCEDURE:
  1. Each probe's question is rewritten in the domain's native vocabulary.
  2. During Phase 1 (Actor Discovery), every probe is run against the input. Each probe that yields a "yes" reveals a candidate actor.
  3. Actors are not assigned to a single "type." Instead, in the Actor List (Phase 1), each actor's relationship to the subject is described in the actor's own terms.

ANTI-PATTERN: Treating these probes as a classification menu. They are search beams, not labels. An actor's identity in the checklist comes from the input's vocabulary, not from these probes. -->

| Probe | Universal Question | Domain-Native Question |
|---|---|---|
| Value reception | Is there an entity that receives value, benefit, or output from the subject? | [pending; rewrite in domain terms] |
| Resource provision | Is there an entity that provides resources, input, or support to the subject? | [pending] |
| Judgment / evaluation | Is there an entity that evaluates, audits, scores, or judges the subject? | [pending] |
| External constraint | Is there a force, rule, deadline, regulation, or condition that the subject cannot control but must comply with? | [pending] |
| Mediation / connection | Is there an entity that connects, mediates, or bridges between other entities involved in the subject? | [pending] |

### Promise Category Labels (Domain-Adapted)
<!-- INSTRUCTION: The five promise categories are conceptually universal but are RENAMED to match the domain's vocabulary. The diagnostic questions are also rewritten in domain-native language.

ANTI-PATTERN: Using the technical labels (Availability, Functionality, Correctness, Integrity, Resilience) verbatim in a non-technical domain. These are algorithmic scaffolding, not output vocabulary. -->

| Algorithm Category | Domain-Native Label | Diagnostic Question (Domain-Native) |
|---|---|---|
| Availability | [pending] | [pending; rewrite "Can the actor access/participate when required?" in domain terms] |
| Functionality | [pending] | [pending; rewrite "Does the subject do what is expected?" in domain terms] |
| Correctness | [pending] | [pending; rewrite "Is the output accurate and truthful?" in domain terms] |
| Integrity | [pending] | [pending; rewrite "Is the subject internally consistent across time?" in domain terms] |
| Resilience | [pending] | [pending; rewrite "Does the subject withstand challenges or objections?" in domain terms] |

**⛔ GATE 0.5**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G05-DOMAIN | [Write: What is the domain? What evidence from the input supports this classification? Is this specific enough, or is it a vague umbrella label?] | ☐ |
| G05-LANGUAGE | [Write: Which tier of the Language Resolution Cascade resolved the output language? What specific evidence triggered that tier? If Tier 4 (fallback), confirm that Tiers 1-3 were genuinely inapplicable.] | ☐ |
| G05-LEXICON | [Write: Count the Lexicon Table rows. Are there ≥8? For each row, is the Domain-Native Term genuinely derived from the input or is it a generic placeholder?] | ☐ |
| G05-AUDIENCE | [Write: Who will use this checklist? Is the audience defined with enough specificity to determine vocabulary choices?] | ☐ |
| G05-REGISTER | [Write: What linguistic register was chosen? Why is it appropriate for this audience?] | ☐ |
| G05-COHERENCE | [Write: Read the Lexicon Table as a whole. Would a domain expert find any term unfamiliar or foreign? Would a non-expert in software find any technical jargon?] | ☐ |

---
## Phase 1: Actor Discovery

<!-- INSTRUCTION: ALL entities that interact with, influence, or are affected by the subject are identified. Every Actor Discovery Probe from Phase 0.5 is run against the input.

CRITICAL RULES:
  - Actor names use the domain vocabulary from the Lexicon Table.
  - Actors are discovered from the INPUT, not invented.
  - Each actor is a distinct entity; not a synonym or subset of another.
  - An actor may satisfy multiple Discovery Probes. A single-probe classification is not forced.

ANTI-PATTERN: Listing only the obvious actors. ALL five Discovery Probes are run and what each one yields is listed before finalizing the actor list.
ANTI-PATTERN: Naming actors with generic labels when the input provides specific names. The most specific name the input provides is used.
ANTI-PATTERN: Stopping at exactly 3 actors because the minimum is met. If the input is rich, more actors exist. -->

### Derivation
**Verbs found in input:** [pending]
**Subjects/Objects found in input:** [pending]

### Discovery Probe Results
<!-- MANDATORY: Each probe is run and its yields are recorded BEFORE assembling the Actor List. -->
| Probe | Entities Found |
|---|---|
| Value reception | [pending; which entities receive value?] |
| Resource provision | [pending; which entities provide resources?] |
| Judgment / evaluation | [pending; which entities judge or evaluate?] |
| External constraint | [pending; which forces constrain the subject?] |
| Mediation / connection | [pending; which entities mediate or connect?] |

### Actor List
| # | Actor | Relationship to Subject | Interaction Surface |
|---|---|---|---|
| 1 | [pending] | [pending; describe in domain terms, not probe labels] | [pending] |

**⛔ GATE 1**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G1-PROBES | [Write: List what each of the 5 Discovery Probes yielded. Were any probes skipped? Did any probe yield zero entities; if so, justify why that relationship genuinely does not exist in this domain.] | ☐ |
| G1-MINIMUM-ACTORS | [Write: How many actors did you find? List them. Are there ≥3? If <5, list at least 3 candidate entities that were CONSIDERED and REJECTED, with the specific reason for each rejection.] | ☐ |
| G1-EXTERIOR | [Write: Did you identify at least one entity that is EXTERNAL to the subject; a force, condition, or regulation the subject cannot control?] | ☐ |
| G1-VALUE-RECEPTION | [Write: Did you identify at least one entity that receives value or benefit from the subject?] | ☐ |
| G1-VOCABULARY | [Write: Do all actor names use the Lexicon Table vocabulary? Are there any names that a domain expert would not recognize?] | ☐ |

---
## Phase 2: Promise Matrix

<!-- INSTRUCTION: For EACH Actor, the promise matrix is generated using the Domain-Adapted Category Labels from Phase 0.5.

CRITICAL RULES:
  - The domain-native category labels are used, NOT the algorithm's internal labels.
  - MULTIPLE promises are generated per category. A single promise per category is Dimensionality Collapse.
  - Each promise has a concrete failure mechanism; How can this promise be broken?
  - The Falsable column requires genuine deliberation: can this promise be verified with a binary YES/NO test?

ANTI-PATTERN: Writing abstract, unfalsifiable promises ("The system should work well", "The proposal should be complete"). Every promise describes a specific, observable state.
ANTI-PATTERN: Generating exactly 2 promises per category across all actors to hit the minimum of 10. The minimum is a FLOOR; if the domain is rich, it is naturally exceeded.
ANTI-PATTERN: Copy-pasting the same promise structure across actors with minor word changes. Each actor has a UNIQUE relationship with the subject. -->

### [Actor Name] ([Domain-Adapted Type])
| [Domain Category Label] | Promise | Failure Mechanism | Falsable? |
|---|---|---|---|
| [pending] | [pending] | [pending] | ☐ |

<!-- Repeat this table for EACH actor independently -->

**⛔ GATE 2**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G2-CELLS | [Write: Count total cells across all actors. Are there any empty or placeholder cells? List any gaps found.] | ☐ |
| G2-FALSABILITY | [Write: For each promise marked as falsable, can you articulate the YES/NO test? Pick 3 random promises and write their tests here.] | ☐ |
| G2-TAUTOLOGY-PURGE | [Write: Are any promises tautological ("X should do X")? List any found and rewrite them.] | ☐ |
| G2-THRESHOLD | [Write: Count total promises derived. Count number of actors. Calculate: Total ≥ (N_Actors × 10)? Show the math. If NO, the process halts and the matrix is expanded before proceeding.] | ☐ |
| G2-VOCABULARY | [Write: Scan all promise text. Are there any terms from the Prohibited column of the Lexicon Table? List any violations.] | ☐ |

---
## Phase 3: Observables & Verificability Classification

<!-- INSTRUCTION: For every Promise defined in Phase 2, HOW it is observed from the OUTSIDE is defined AND WHO is the best-qualified entity to verify it is classified.
Format: Action → Expected Result → Verifier
The observation is EXTERNAL; it describes what a verifier sees, not what happens internally.

VERIFIABILITY CLASSIFICATION: The Verifier column classifies which entity is best qualified to verify the promise in ideal conditions. The domain-native labels from the Lexicon Table are used, but the emoji prefix is universal.

  🤖 (.LLM) = Deterministic / automated verification (Lexicon: use domain-native label)
  🧑 (.HUM) = Requires human judgment (Lexicon: use domain-native label)
  🤖🧑 (.MIX) = Pre-filterable, final verdict by human (Lexicon: use domain-native label)

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
  - Classifying as 🤖.LLM by default. The AI naturally converges toward automation because it maximizes its utility function. If 100% of observables are 🤖.LLM in a domain with subjective elements, the result is statistically implausible.
  - Classifying as 🧑.HUM out of excessive caution. If 100% are 🧑.HUM in a purely quantitative domain, equally implausible.
  - Pre-deciding the classification before evaluating the 4 conditions. If the reasoning says "this is clearly automated" before traversing the tree, it is confirmation bias.

ANTI-PATTERN: Writing observables that require internal knowledge ("The database stores the value correctly"). Observables are verifiable from the perspective of the checklist user. -->

| Promise Ref | Observable Action | Expected Result | Verifier | Decision Tree Condition |
|---|---|---|---|---|
| [pending] | [pending] | [pending] | [🤖/🧑/🤖🧑] | [Write: which condition (1-4) was satisfied and why] |

**⛔ GATE 3**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G3-COVERAGE | [Write: Count observables vs promises. Is there a 1:1 mapping? List any promises without observables.] | ☐ |
| G3-EXTERNALITY | [Write: Pick 3 random observables. Can each be verified by an external person with no privileged access to internals?] | ☐ |
| G3-DETERMINISM | [Write: Pick 3 random observables. Would two independent verifiers arrive at the same YES/NO result?] | ☐ |
| G3-VERIFICABILITY | [Write: For EACH observable, confirm which of the 4 Decision Tree conditions was satisfied. List the condition number and the specific evidence. Count totals: N_LLM = ?, N_HUM = ?, N_MIX = ?. If the domain is inherently subjective and N_HUM = 0, explain why; if unconvincing, status is ❌. If the domain is purely quantitative and N_HUM > 50%, justify.] | ☐ |
| G3-VOCABULARY | [Write: Scan all observable descriptions (actions and expected results). Are there any terms from the Prohibited column of the Lexicon Table? Do the actions and results use domain-native vocabulary exclusively?] | ☐ |

---
## Phase 4: Synthesis & Verification Checklist (Working Draft)

<!-- INSTRUCTION: Checks are assembled with taxonomy [ACTOR-CAT-NNN.VER].
  - ACTOR: abbreviated actor name (domain-native), 3-5 uppercase characters, derived from the first syllable or initials.
  - CAT: abbreviated domain-native category label, 2-3 uppercase characters.
  - NNN: three-digit sequential number, zero-padded (001, 002...).
  - VER: verificability suffix; one of: LLM, HUM, MIX. Inherited from the observable's Verifier classification in Phase 3.
  All abbreviations are defined ONCE at the start of this phase in a key table, then reused consistently.

  The emoji (🤖, 🧑, or 🤖🧑) is placed as a PREFIX before the check ID for visual scannability.
  The suffix (.LLM, .HUM, .MIX) is part of the ID for textual traceability.

Rules:
  - Compound checks are decomposed. One action, one result.
  - The check text uses ONLY the Lexicon Table vocabulary.
  - Each check is self-contained; understandable without reading the working document.
  - Each check INHERITS its verificability classification from its parent observable. If a compound check was decomposed, the Decision Tree is re-evaluated for each atomic part.

ANTI-PATTERN: Writing checks that require context from the working document to be understood ("As discussed in Phase 2, this check verifies..."). The checklist is standalone.
ANTI-PATTERN: Merging two observables into one check to reduce count.
ANTI-PATTERN: Using inconsistent abbreviations for the same actor or category across different checks.
ANTI-PATTERN: Assigning a verificability suffix that contradicts the parent observable's classification without re-applying the Decision Tree. -->

### Abbreviation Key
| Full Name | Abbreviation | Type |
|---|---|---|
| [pending] | [pending] | Actor / Category |
| Verifiable by automated tool | LLM | Verifier |
| Requires human verification | HUM | Verifier |
| Pre-verifiable, final human validation | MIX | Verifier |

### Checklist Draft
- 🧑 `[ACTOR-CAT-NNN.HUM]` [Action] → [Expected Result]. *(Promise: ...)*
- 🤖 `[ACTOR-CAT-NNN.LLM]` [Action] → [Expected Result]. *(Promise: ...)*
- 🤖🧑 `[ACTOR-CAT-NNN.MIX]` [Action] → [Expected Result]. *(Promise: ...)*

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
ME Audit: Checks that appear similar are compared. Are they verifying exactly the same state, or different facets?
CE Audit: Are there gaps in coverage? Does the matrix lack tests for edge cases, failure modes, or boundary conditions?

ANTI-PATTERN: Declaring "no overlaps found" without examining specific pairs. The compared pairs are listed.
ANTI-PATTERN: Declaring "no gaps found" without examining the coverage matrix cell by cell. -->

### ME Pairs Examined
| Pair (ID-a ↔ ID-b) | Same Promise? | Resolution |
|---|---|---|
| [pending; list SPECIFIC pairs compared] | [Write: What do they share? What differentiates them?] | [pending; fill ONLY after analyzing the pair] |

### Coverage Matrix
<!-- MANDATORY: Every column header below is replaced with the actual domain-native category labels derived in Phase 0.5. The placeholders [Cat 1]...[Cat 5] are structural scaffolding only.
ANTI-PATTERN: Leaving generic column headers like [Cat 1], [Cat 2] in the populated table. Every header cell contains the domain-native label. -->
| Actor | [Cat 1] | [Cat 2] | [Cat 3] | [Cat 4] | [Cat 5] |
|---|---|---|---|---|---|
| [name] | [count] | [count] | [count] | [count] | [count] |

**⛔ GATE 5**
| ID | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|
| G5-ME-PAIRS | [Write: How many pairs did you examine? List the most ambiguous pair and explain why they are or are not duplicates.] | ☐ |
| G5-CE-MATRIX | [Write: Examine the coverage matrix. Are there any cells with 0 checks? If so, is the gap justified or does it indicate a missing promise?] | ☐ |
| G5-CE-NO-GAPS | [Write: Consider the input holistically. Is there any requirement, constraint, or expectation mentioned in the input that is NOT covered by any check?] | ☐ |
| G5-AUDIT-DELTA | [Write: Did this audit result in any additions, removals, or modifications? List them.] | ☐ |
| G5-POST-MECE-DENSITY | [Write: After all ME removals from this audit, re-count checks per actor. List: Actor1=N, Actor2=N... Does EVERY actor still have ≥10? If ANY actor dropped below 10 due to duplicate removal, the process halts. The agent returns to Phase 2, generates replacement promises for the removed duplicates, and propagates through Phases 3-4 before proceeding.] | ☐ |

---
## GATE 6: Self-Verification Audit (Terminal)

<!-- INSTRUCTION: This is the terminal gate. The agent audits its OWN output against immutable invariants.

EXECUTION SEQUENCE (MANDATORY):
  1. The agent generates `[subject]_checklist.md` using the output template BEFORE reaching this gate.
  2. The agent stops writing the working document.
  3. The agent opens `[subject]_checklist.md`; the DELIVERABLE, not the working draft above.
  4. The actual contents are counted: actors, checks per actor, vocabulary used.
  5. The findings are recorded below.
  6. If any invariant fails, remediation occurs before presenting.
  This gate audits the DELIVERABLE, not the working document. If the deliverable is not generated yet, the process halts and generates it first.

ANTI-PATTERN: Treating this as a rubber-stamp. If a failure is found, remediation is executed; rationalization is prevented.
ANTI-PATTERN: Writing "All actors have ≥10 checks" without listing the actual counts. The work is shown.
ANTI-PATTERN: Filling this gate by referencing Phase 4 counts instead of counting the deliverable directly. The deliverable is the source of truth; extraction errors between Phase 4 and the deliverable are the exact failure mode this gate exists to catch. -->

| ID | Invariant | Empirical Reasoning (CoT) | Status (✅/❌) |
|---|---|---|---|
| G6-ACTOR-COUNT | ≥3 actors identified | [Write: List every actor in the deliverable. Count them.] | ☐ |
| G6-DENSITY | ≥10 checks per actor (NO EXCEPTIONS) | [Write: For EACH actor, count the checks in the deliverable. Format: Actor1=N, Actor2=N... If ANY <10, status is ❌ and the agent returns to Phase 2.] | ☐ |
| G6-ATOMICITY | Every check has ONE action and ONE result | [Write: Sample 5 random checks. For each, identify the single action and single result. Flag any that contain conjunctions (and/or/also).] | ☐ |
| G6-MECE | No duplicates, no gaps | [Write: Were all ME pairs resolved? Were all CE gaps closed?] | ☐ |
| G6-LEXICON | Deliverable uses ONLY domain vocabulary | [Write: Scan the deliverable for ANY term from the Prohibited column of the Lexicon Table. List any found. Also check for generic software jargon if the domain is not software.] | ☐ |
| G6-FALSABILITY | Every check is binary (pass/fail) | [Write: Pick 3 random checks. For each, articulate the exact binary test. If any check requires subjective interpretation, flag it.] | ☐ |
| G6-VERIFICABILITY | Verificability distribution reflects domain nature | [Write: Count checks by verifier type IN THE DELIVERABLE: Total .LLM = ?, Total .HUM = ?, Total .MIX = ?. For EACH .HUM and .MIX check, list its ID and the Decision Tree condition (1-4) that justified it. If the domain is inherently subjective and .HUM = 0: status is ❌. If purely quantitative and .HUM > 50%: justify or ❌.] | ☐ |
| G6-ALGORITHM | All 7 phases and 8 gates executed sequentially | [Write: List each checkpoint anchor found in this document. Were any phases skipped or combined? Count: Phase 0, Phase 0.5, Phase 1, Phase 2, Phase 3, Phase 4, Phase 5 = 7 phases. Gate 0, Gate 0.5, Gate 1, Gate 2, Gate 3, Gate 4, Gate 5, Gate 6 = 8 gates.] | ☐ |
| G6-OVERRIDES | All user overrides respected | [Write: List each override from Phase 0. For each, confirm how it was applied. If no overrides, write "No overrides specified."] | ☐ |

**HARD FAILURE PROTOCOL:** If G6-DENSITY is ❌, the agent returns to Phase 2, expands the deficient actor(s), propagates through Phases 3-5, regenerates the deliverable, and re-executes GATE 6.
**VERIFICABILITY FAILURE PROTOCOL:** If G6-VERIFICABILITY is ❌, the agent returns to Phase 3, re-evaluates the Decision Tree for the flagged observables, propagates through Phase 4, regenerates the deliverable, and re-executes GATE 6.

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
> **ARTIFACT ISOLATION (RECENCY REMINDER):** The output of /checklist is an internal chat artifact. It does NOT alter /docs/ unless the user explicitly instructs it.

> **CRITICAL CONSTRAINTS (RECENCY DUPLICATION; first stated in GLOBAL RULES at top of file):**
> - Every check uses taxonomy `[ACTOR-CAT-NNN.VER]` with verificability suffix (.LLM, .HUM, .MIX).
> - Every check is atomic: ONE action, ONE result, binary pass/fail.
> - The MECE audit is non-negotiable: overlaps are eliminated, gaps are filled.
> - ≥10 checks per actor, NO EXCEPTIONS.
> - ALL output vocabulary is domain-native (Lexicon Table). Zero software jargon in non-software domains.

<!-- TEMPLATE END -->
