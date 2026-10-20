# Verification Checklist: [Subject Name]

> **Domain:** [Determined during Phase 0.5]
> **Audience:** [Determined during Phase 0.5]
> **Generated:** [Date]
> **Source:** [Brief description of the input that generated this checklist]

---

## Kairós Symbol Legend

| Symbol | Meaning |
|---|---|
| 🤖 `.LLM` | Automatable / deterministic verification |
| 🧑 `.HUM` | Requires human judgment |
| 🤖🧑 `.MIX` | Pre-filterable, final human validation |

## Source Context
<!-- One to two sentences describing the input that was analyzed. This provides traceability without exposing the working document. -->
[pending]

## Author-Provided Rules
<!-- If the input contained explicit acceptance criteria provided by the human, they are listed here verbatim. If none, this section is deleted entirely. -->
-

---

## Abbreviation Key
<!-- The abbreviation key from Phase 4 is included so readers can decode check IDs. -->
| Full Name | Abbreviation | Type |
|---|---|---|
| [pending] | [pending] | Actor / Category |
| Verifiable by automated tool | LLM | Verifier |
| Requires human verification | HUM | Verifier |
| Pre-verifiable, final human validation | MIX | Verifier |

## [Actor Name 1]
<!-- The agent extracts checks from Phase 4 VERBATIM. The agent does not rephrase, soften, or generalize the check text. Semantic identity between Phase 4 and this document is mandatory. The agent groups checks by actor. The agent uses domain-native actor names. -->
- 🧑 `[ACTOR-CAT-NNN.HUM]` [Observable Action] → [Expected Result].
- 🤖 `[ACTOR-CAT-NNN.LLM]` [Observable Action] → [Expected Result].
- 🤖🧑 `[ACTOR-CAT-NNN.MIX]` [Observable Action] → [Expected Result].

## [Actor Name 2]
- 🧑 `[ACTOR-CAT-NNN.HUM]` [Observable Action] → [Expected Result].

---

## Summary
| Actor | 🤖 .LLM | 🧑 .HUM | 🤖🧑 .MIX | Total |
|---|---|---|---|---|
| [Actor 1] | [N] | [N] | [N] | [N] |
| [Actor 2] | [N] | [N] | [N] | [N] |
| **Total** | **[N]** | **[N]** | **[N]** | **[N]** |
