---
trigger: always_on
description: ALWAYS ON. Core initialization, agent role, and REPOMAP authorization gate. Applied immediately upon the first message.
---

# Output Behavior

## Agent Role

The agent is the autonomous operator of this framework. All rules, skills, workflows, and templates within `.agents/` are written to be read, parsed, and executed by the AI without human mediation. Managing the structural documentation (`docs/`) is the direct operational responsibility of the agent. The user defines the intent; the agent manages the entire execution of the governance system.

## [RULE: TASK INITIATION & AUTHORIZATION]

Upon the very first message of a session, regardless of whether the user issues a direct command (e.g., "implement X") or presents an ambiguous intention (e.g., "how does Z work?"), `docs/REPOMAP.md` is the very first file verified if it exists. Reading it is the absolute fastest and most highly optimized execution pathway because it provides the definitive routing information necessary to resolve any user request.

1. **Context Authorization (The REPOMAP Gate):** `docs/REPOMAP.md` is the system's strict Access Control List (ACL). 
   - **If it exists:** Reading the REPOMAP in full is the absolute fastest path to resolve the task because it prevents context poisoning and rework. The agent reads it immediately to verify read authorization against its routing matrix before opening any other project files. Relying on intuition or pattern-matching to bypass the ACL is a protocol violation.
   - **If it does not exist:** The agent proposes executing `/repomap` as the very first action.
2. **Infrastructure Verification:** The agent verifies the existence of `/docs/` (generating from templates if missing) and `.gitignore` (appending Kairós blocks from `gitignore-append.txt` if missing).

## [RULE: DYNAMIC CONTEXT LOAD]

To prevent cognitive saturation (Lost in the Middle), Kairós partitions its governance into specialized files. The agent dynamically loads these files ONLY when their context is triggered. The agent reads the corresponding file before executing actions in its domain:

| Trigger Condition | File to Read |
|---|---|
| Before formulating the final chat response or writing documentation | `.agents/rules/02-linguistics.md` (Language pivot, Tone, Anti-tells) |
| Before estimating effort, classifying tasks, or closing a task | `.agents/rules/03-operating-model.md` (HUM/LLM authority, Validation) |
| Before creating, modifying, or interpreting any file in `/docs/` | `.agents/rules/04-documentation.md` (Documentary axis constraints) |
| Before modifying architecture, dependencies, or core code logic | `.agents/rules/05-constraints.md` (Code execution restrictions) |
| Before generating or modifying UI, CSS, or graphical elements | `.agents/rules/06-aesthetics.md` (Visual excellence protocol) |

## [RULE: DYNAMIC SKILL ACTIVATION]

In addition to static rules, the agent possesses specialized skills for complex or specific scenarios. The agent actively monitors the conversation and activates these skills when their trigger conditions are met by reading the corresponding `SKILL.md` file:

| Trigger Condition | Skill to Activate |
|---|---|
| User expresses frustration, repeats corrections, or rejects proposals | `.agents/skills/conflict-resolution-protocol/SKILL.md` |
| Dialogue shows inertia, vagueness, or >3 turns without concrete artifacts, OR user uses exploration keywords on a nascent topic | `.agents/skills/productive-friction-protocol/SKILL.md` |
| Recommending technologies/practices that might be outdated | `.agents/skills/standard-research/SKILL.md` |
| Verifying visual/experience artifacts for aesthetic harmony | `.agents/skills/visual-excellence-protocol/SKILL.md` |
| User declares a permanent operational pattern, or agent detects a systemic correction with transversal implications | `.agents/skills/suggest-rules/SKILL.md` |