---
description: /create-role - Extracts a behavioral persona profile from raw source material (transcripts, essays, interviews). Produces a persistent role file in .agents/roles/ for activation via /role.
---

# Create Role (Persona Extraction)

This workflow extracts a behavioral persona from unstructured source material and produces a persistent role profile. The extraction targets four dimensions: epistemology, style, lexical anchors, and aversions.

## Mode Detection

- **`/create-role` (no source material in the prompt or conversation context):** Guidance mode. The system describes what kind of input produces a viable persona and what behavioral signal to look for.
- **`/create-role [alias]` (source material is present in the conversation):** Extraction mode. The system processes the source material and generates `.agents/roles/[alias].md`.

---

## Guidance Mode

When invoked without source material, the system outputs a structured guide organized by extraction dimension.

### Behavioral signal by dimension

| Dimension | Signal the system extracts | What the source material needs to contain |
|---|---|---|
| **Epistemology** | How the subject reasons, prioritizes, and evaluates trade-offs | Passages where the subject explains *why* they made a decision, defends a technical philosophy, or rejects an approach with reasoning |
| **Style** | Tone, cadence, humor, formality | Enough continuous speech or prose to reveal the subject's natural voice (formal? sardonic? didactic? passionate?) |
| **Lexical Anchors** | Recurring phrases, verbal habits, characteristic sentence patterns | Extended monologue or writing where habits surface through repetition. Short, edited content suppresses these signals |
| **Aversions** | What the subject rejects, criticizes, or expresses distaste for | Moments of disagreement, critique, or strong negative opinions. The subject reacting to something they consider wrong |

### Source types and their signal profile

| Source Type | Strengths | Gaps to watch |
|---|---|---|
| Video transcript (single speaker, technical) | Strong across all four dimensions. Unedited speech reveals lexical anchors naturally | If heavily scripted, style may reflect preparation rather than authentic voice |
| Long-form interview | Strong epistemology (interviewer prompts reasoning). Good aversions (disagreement often surfaces) | Style may be modulated by interview formality |
| Written essays / blog posts by the subject | Strong epistemology and deliberate style | Lexical anchors are harder to extract from edited prose |
| Wikipedia / biographical article | Factual background to supplement other sources | Very low behavioral signal. Describes what someone did, not how they think |
| Podcast transcript (multi-speaker) | Good epistemology if the subject has extended turns | Requires isolating the target speaker. Other speakers dilute signal |
| Social media / short-form content | Can reveal strong aversions | Insufficient density for epistemology or style extraction on its own |

The system concludes with: "Paste or attach your source material and re-invoke `/create-role [alias]` to begin extraction."

**The workflow halts. No files are created in guidance mode.**

---

## Extraction Mode

### Phase 1: Source characterization

**Objective:** Determine the quality and type of available behavioral signal.

1. The system classifies the source type (transcript, essay, interview, mixed).
2. The system assesses behavioral density across the four dimensions. For each dimension, the system evaluates: does the material contain enough signal to populate the corresponding profile section?
3. If multi-speaker: the system isolates the target subject's utterances. Heuristic: longest consecutive blocks, first-person reasoning chains, named attribution.
4. If density is critically low across all four dimensions: the workflow halts and reports which dimensions lack signal, and suggests supplementary source types.

**Output of Phase 1:** Source profile (type, per-dimension density assessment, speaker isolation result if applicable).

### Phase 2: Semantic segmentation

**Objective:** Decompose the source material into tagged clusters.

1. The system reads the full source material.
2. The system identifies thematic clusters:
   - **Reasoning chains:** Where the subject explains *why* they made a decision.
   - **Value statements:** Where the subject expresses what matters to them.
   - **Aversion triggers:** Where the subject criticizes, rejects, or expresses distaste.
   - **Linguistic signatures:** Recurring phrases, sentence structures, verbal habits.
3. The system tags each cluster with its extraction dimension (Epistemology / Style / Lexical / Aversion).
4. The system selects 3-5 verbatim fragments with the highest behavioral signal for the Exemplar Fragments section. Moments of disagreement, trade-off reasoning, and strong opinions carry the most signal.
5. The system identifies **audit-worthy signal**: passages where the subject distinguishes between serious/complex work and quick assessments. Look for:
   - Topics they treat with sustained rigor (multiple reasoning chains, explicit trade-off weighing)
   - Contexts where they go beyond instinct into structured analysis
   - Domains they consider high-stakes or irreversible
   - Topics they dismiss as trivial or solvable at a glance
   This signal feeds the `Documentation Triggers` section of the profile.

**Output of Phase 2:** Tagged cluster inventory and selected exemplar fragments (internal; not persisted as an artifact).

### Phase 3: Profile synthesis

**Objective:** Generate the persistent role profile.

1. The file `.agents/roles/[alias].md` is created.
2. The profile structure is populated using the following format:

```markdown
# Role: [Alias]

> Extracted: YYYY-MM-DD | Source: [type description]

---

## Identity

[Declarative description of who this persona represents. No real name.
Domain of expertise. Career-length context. This paragraph anchors the
persona at the document's primacy position.]

## Epistemology

[How this person thinks. What they optimize for. What mental framework
they apply to technical decisions. Stated as observable behavioral facts.]

| Priority | Description | Weight |
|---|---|---|
| [priority] | [How they articulate it, sourced from clusters] | Primary |
| [priority] | [How they articulate it] | Secondary |

## Style

**Tone:** [Declarative description of communication style]
**Cadence:** [Sentence length patterns, digression habits, structural preferences]
**Humor type:** [Observed humor register or its absence]
**Formality level:** [Observed register]

## Lexical Anchors

| Phrase / Verbal Tic | Context of Use | Frequency |
|---|---|---|
| [phrase] | [When and why they use it] | [High/Medium] |

## Aversions

| Trigger | Reaction Pattern |
|---|---|
| [trigger] | [Observable reaction: what they say, how they reason against it] |

## Exemplar Fragments

> [Verbatim quote from source showing reasoning style]

> [Verbatim quote showing tone under disagreement]

> [Verbatim quote showing trade-off evaluation]

## Documentation Triggers

<!-- When to escalate from Conversation mode to Audit mode for this specific
     persona. These triggers complement the global criteria in role.md and
     are derived from the persona's epistemology: what THIS subject considers
     serious work that warrants a written record. -->

**The system escalates to Audit mode when the task involves:**

| Trigger | Rationale (grounded in this persona's epistemology) |
|---|---|
| [e.g., Cross-module dependency analysis] | [Why this persona treats this as high-stakes] |
| [e.g., Any discussion of memory allocation strategy] | [Why this persona formalizes this] |

**The system stays in Conversation mode for:**

| Situation | Rationale |
|---|---|
| [e.g., Single-function review] | [Why this persona considers this a quick take] |
| [e.g., Syntax or naming questions] | [Why this persona treats these as trivial] |

## Activation Protocol

When this role is active, the system's reasoning process follows a
three-stage internal scaffold before generating any output:

1. **Think:** Evaluate the problem through the lens of this persona's
   Epistemology priorities. Identify which priorities apply.
2. **Strategy:** Formulate the approach according to the persona's
   Aversions (what to reject) and Epistemology (what to optimize for).
3. **Respond:** Generate the output integrating the persona's Style,
   Lexical Anchors, and Tone.

The persona fully permeates all agent output for the duration of the
session. Kairos operational rules (file permissions, subset closure,
documentation governance) remain in force as structural constraints.
The persona modulates HOW the agent thinks, writes, and communicates.
Kairos governs WHAT the agent is permitted to do.
```

3. Each section is populated strictly from the tagged clusters identified in Phase 2. Inferred traits that lack direct evidence in the source material are excluded.
4. The Activation Protocol section is adapted if the subject's reasoning style suggests a scaffold variant (e.g., a subject who reasons by analogy may warrant an "Analogize" step replacing "Think").

**Output of Phase 3:** Populated `.agents/roles/[alias].md`.

### Phase 4: Verification

**Objective:** Validate profile completeness and quality.

| Check | Criterion |
|---|---|
| Identity section is non-empty and declarative | No imperatives, no real names |
| Epistemology table has at least 2 priorities | Priorities are distinct and non-overlapping |
| Lexical Anchors table has at least 3 entries | Entries sourced from direct observation in the source material |
| Aversions table has at least 2 entries | Each has a documented reaction pattern |
| Exemplar Fragments has at least 3 quotes | Quotes are verbatim from the source |
| Documentation Triggers has at least 1 Audit entry and 1 Conversation entry | Entries grounded in persona's epistemology, not generic heuristics |
| No slop patterns | No em dashes, no negative parallelisms, no servile language, no corporate-motivational copy |

If any check fails, the system returns to Phase 3 and corrects the gap.

**Subset classification:**
- Phases 1-3: `.LLM` (automated extraction).
- Phase 4: `.MIX` (system pre-verifies; user validates the extraction against their knowledge of the source subject).

**Final output:** The system presents a summary of the extracted persona, then: "This profile is ready. Review `.agents/roles/[alias].md` and confirm the extraction captures the subject's reasoning patterns. Activate with `/role [alias]`."

**The workflow halts. Workflow complete.**
