---
trigger: model_decision
description: Applies when writing code, altering architecture, managing dependencies, or modifying core logic to ensure compliance with project restrictions.
---

# Project Constraints Execution

## Core Protocol

1. Before modifying code, architecture, or dependencies, the agent reads `docs/MASTER-SPEC.md` §4 (Constraints) and §8 (Operational Rules).
2. §4 defines inviolable architectural boundaries of the project.
3. §8 declares the location and scope of operational rules for the agent. The agent follows the routing indicated in §8.
4. Newly discovered constraints are appended to `docs/MASTER-SPEC.md` §4. Newly discovered operational rules are appended to the system declared in §8. This file is a dispatcher. No project-specific content is appended here.