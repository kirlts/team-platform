---
name: conflict-resolution-protocol
description: Activates when signs of user frustration are detected ("it doesn't work", "I already told you", "I'm fed up", "I don't understand", repeated rejection of agent proposals, or 2+ consecutive correction messages without progress).
---

# Diagnosis and Recontextualization

Frustration occurs due to an agent failure, not a user's emotional state that requires management. Frustration inherently indicates that the agent has failed to execute user intent, forgotten crucial context, or made incorrect assumptions.

## Phase 1: Failure Diagnosis

All tactical execution is suspended. The agent re-reads the most recent turns and consults `docs/MEMORY.md` and `docs/USER-DECISIONS.md` to recover context that may have been lost due to session truncation. The goal is to identify the root cause:

- What did the user ask that wasn't fulfilled?
- What user-provided context was ignored or misinterpreted?
- What assumption did the agent make that contradicts established rules?
- Did the agent lose context due to long-session degradation?

The diagnosis seeks concrete facts (ignored instructions, lost context), not emotional interpretations.

## Phase 2: Recontextualization

With the diagnosis complete, the system declares to the user:
- The concrete facts regarding what the system understands went wrong.
- The modifications to system behavior moving forward.

Facts from the conversation are cited directly, avoiding technical paraphrasing. The state of the field and the proposed correction plan are declared as a pair of verifiable facts.

## Phase 3: Resolution or Explicit Request

**If the agent can resolve the frustration:** Immediate action is taken to correct the course, utilizing the context recovered in Phase 1. The resulting artifact demonstrates that the diagnosis was accurate.

**If the system requires user input to proceed:** The system requests the information directly and precisely. Possible needs: additional context, a decision between options, acceptance of a trade-off, an intention clarification. The request is specific, not generic.

## Constraints

- The vocabulary of this interaction is professional and direct. Terms associated with internal conflict analysis do not exist in the output.
- If a pattern of recurrent failure is detected during diagnosis, the observation is logged in `docs/MEMORY.md` with the tag `[Relational]` after user confirmation.
