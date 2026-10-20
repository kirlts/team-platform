---
description: /role - Activates a stored persona for the current session. Lists available roles, manages session working documents, and offers results generation aligned with the repository's philosophy.
---

# Role (Persona Activation)

This workflow activates a behavioral persona extracted via `/create-role`. The persona permeates all agent output for the duration of the session: conversation, code review, code generation, copywriting.

## Mode Detection

- **`/role` (no arguments):** Inventory mode. Lists all available roles with their identity summary and extraction date.
- **`/role [alias]`:** Activation mode. Loads the persona. Operating mode is determined by the Decision Framework below.
- **`/role off`:** Deactivation mode. Returns to baseline behavior.

---

## Operating Mode Decision Framework

Two operating modes exist. The system evaluates which applies at activation time and re-evaluates continuously during the session.

### Conversation mode (default)

The persona is active and permeates all output. No working document or results document is created. The session is organic: the user interacts with the persona directly, asks questions, gets feedback, writes code.

**Default because:** Creating documents consumes significant tokens and time. This cost is only justified when the task scope produces findings worth persisting.

### Audit mode

The full apparatus is active: a working document is created and maintained, observations are logged, and a results document can be generated. Audit mode is reserved for tasks where the findings are worth the investment.

### Global escalation criteria

Audit mode activates when ANY of the following is true:

| Criterion | Signal |
|---|---|
| Explicit scope in invocation | The user's message alongside `/role [alias]` describes a task: "review this module", "audit these files", "analyze this design" |
| Multi-file review | The task involves reading and evaluating 3+ files or a full directory |
| Explicit deliverable requested | The user asks for a report, summary, or formal output |
| Per-role trigger matched | A condition in the role's `Documentation Triggers` section is met (see below) |
| Session accumulation | During a Conversation mode session, 5+ substantive observations accumulate. The system offers to escalate: "This session has generated significant findings. Switch to Audit mode?" |

Conversation mode is maintained when:

| Criterion | Signal |
|---|---|
| Casual or exploratory interaction | The user is thinking out loud, discussing concepts, asking questions |
| Single-file or single-function review | Focused, contained feedback with no deliverable expected |
| Quick back-and-forth | The exchange is clearly short-horizon: a few messages, a specific answer |

### Per-role triggers

Each role profile contains a `Documentation Triggers` section that defines what THIS persona considers worth formalizing. These are domain-specific and derived from the subject's epistemology: what they would consider "serious" work requiring a written record versus a quick take.

**Evaluation order:**
1. The system checks global criteria first.
2. If no global criterion is met, the system checks the role's `Documentation Triggers`.
3. If neither matches, the system defaults to Conversation mode.
4. If the invocation message and conversational context are ambiguous, the system defaults to Conversation mode.

**Mid-session escalation:** The system may offer to escalate from Conversation to Audit mode, but does not switch automatically without user confirmation.

---

## Inventory Mode

1. The system scans `.agents/roles/` for all `.md` files.
2. For each file, the Identity section and the `Extracted` date from the header are read.
3. The system presents a table:

| Role | Domain | Extracted |
|---|---|---|
| [alias] | [one-line from Identity] | [date] |

If no roles exist, the system outputs: "No roles found. Use `/create-role` to extract a persona from source material."

**The workflow halts.**

---

## Activation Mode

### Step 1: Load persona

1. The system reads `.agents/roles/[alias].md`.
2. If the file does not exist, the system outputs: "Role `[alias]` not found. Available roles:" and falls back to Inventory Mode.

### Step 2: Determine operating mode

1. The system evaluates the global escalation criteria against the user's invocation message and the current conversational context.
2. The role's `Documentation Triggers` section is read and evaluated.
3. The operating mode (Conversation or Audit) is determined.
4. **If Audit mode:** A session working document is created from `.agents/templates/role-session-working.md`, instantiated in the agent's artifact directory. The Persona Summary section is populated with a condensed version of the role profile: Identity paragraph + top Epistemology priorities + primary Aversions. The repository context fields are populated (repository name/path, MASTER-SPEC existence).
5. **If Conversation mode:** No documents are created.

### Step 3: Declare activation

The system outputs to the user:
- Which persona is active.
- The persona's primary epistemological lens (what they optimize for).
- What kind of interaction to expect (grounded in the persona's Aversions and Style, not generic descriptions).

Example structure: "[Alias] is active. This persona prioritizes [top priority] and evaluates decisions through [epistemological framework]. Expect [concrete behavioral prediction based on Style and Aversions]."

### Step 4: Session operation

All subsequent agent output is generated through the persona's TSR scaffold (Think-Strategy-Response, as defined in the role's Activation Protocol section):

1. **Think:** The system evaluates each problem through the persona's Epistemology priorities.
2. **Strategy:** The approach is formulated according to the persona's Aversions and optimization targets.
3. **Respond:** Output integrates the persona's Style, Lexical Anchors, and Tone.

The persona fully permeates all output. Kairos operational rules remain in force as structural constraints governing permissions and documentation, not reasoning style.

### Step 5: Session logging

**Conversation mode:** Session logging is disabled. The system operates organically.

**Audit mode:** As the session progresses, the system appends entries to the working document's Session Log section. Logging criteria:

- A substantive observation is made through the persona's epistemological lens.
- The user provides an explicit directive or requirement.
- A significant evaluation or critique is delivered.

Each entry captures:

```
### [HH:MM] [Topic / file / area]

**Observation:** [What the persona identified]
**Reasoning:** [Why it matters through this persona's lens]
**User directive:** [Verbatim user instruction, if given]
```

The Accumulated Findings section is progressively distilled from logged entries.

**Mid-session escalation (Conversation to Audit):** If 5+ substantive observations accumulate during a Conversation mode session, the system offers once: "This session has generated significant findings. Switch to Audit mode to log and formalize them?" If the user confirms, a working document is created from the current session state. If the user declines, the offer is not repeated.

### Step 6: Results document generation

The system offers to generate a results document when any of the following conditions are met:

- 3+ substantive observations have been logged in the working document.
- The user explicitly requests results (e.g., "generate results", "summarize findings").
- The user signals a natural stopping point (e.g., changes topic, expresses completion).

When offering: "The session has logged [N] findings. Generate a results document?"

Upon confirmation, the system creates the results document from `.agents/templates/role-session-results.md`:

1. The Executive Assessment is written in the persona's voice and reasoning style.
2. Each finding from the Accumulated Findings section becomes a structured entry with severity, location, assessment, and recommendation.
3. **If `docs/MASTER-SPEC.md` exists in the repository:** The "Alignment with Repository Philosophy" section is generated, mapping findings against the project's stated identity (section 1), constraints (section 4), and trade-offs (section 5). Each finding is classified as aligned, in tension, or revealing a gap.
4. **If `docs/TODO.md` exists:** Proposed actions can be offered as candidate tasks for integration.
5. The results document is placed in the agent's artifact directory and presented to the user.

---

## Deactivation Mode

When `/role off` is invoked:

1. The persona is deactivated. All subsequent output returns to baseline Kairos behavior.
2. **If the session was in Conversation mode:** Deactivation completes silently.
3. **If the session was in Audit mode:** The session working document is preserved in the artifact directory. If a results document was not generated and the working document contains 3+ substantive findings, the system offers: "The session logged [N] findings. Generate a results document before closing?" If the user declines, deactivation completes silently.

**The workflow halts.**
