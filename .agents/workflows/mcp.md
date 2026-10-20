---
description: /mcp - Onboards and manages the MCP (Model Context Protocol) configurations for the current repository. Standardizes memory routing and tool access.
---

# Kairós MCP Management

This workflow automates the onboarding and management of Model Context Protocol (MCP) servers (like Hindsight and Composio) within the project's governance.

## Step 1: Governance Detection

The AI agent verifies the existence of the `docs/RULES.md` file.

- **If `docs/RULES.md` does not exist:** The agent aborts the workflow, notifies the user, and suggests executing `/document` first to initialize the repository's governance structure.
- **If `docs/RULES.md` exists:** The agent proceeds to Phase A.

## Phase A: Rule Injection

The AI agent checks if `docs/RULES.md` contains the specific text defined in `.agents/templates/mcp.md`.

- **If the rules are absent:** The agent injects the contents of `.agents/templates/mcp.md` into `docs/RULES.md`. It is placed at the beginning of the rules section, or immediately after any high-priority rules.
- **If the rules are already present:** The agent acknowledges the correct governance state and proceeds seamlessly to Phase B.

## Phase B: Configuration Management

The agent actively manages the MCP configurations for the project's memory.

1. **Discovery:** The agent identifies the active harness and locates its corresponding global MCP configuration file (e.g., `~/.gemini/config/mcp_config.json`, `~/.config/kilo/kilo.jsonc`, `~/.gemini/antigravity/mcp_config.json`).
2. **Dynamic Routing Verification (Hindsight):** The agent automatically checks if the `hindsight-<project_name>` server is configured for the current repository.
   - **If missing:** The agent automatically edits the configuration file to inject the `hindsight-<project_name>` server, pointing it exclusively to the bank matching the current repository's exact name.

## Phase C: Organic Interaction

**Condition:** This phase triggers only if both Phase A and Phase B required ZERO changes (i.e., the rules were already present in `docs/RULES.md` and the Hindsight server was already correctly configured).

- If the condition is met, the agent initiates an interactive session, asking the user if they wish to add, remove, or modify any other required MCP servers (like Composio). If the user provides instructions, the agent edits the global configuration files accordingly.
- If the condition is not met (changes were made in A or B), this phase is skipped entirely.

## Conclusion

The agent finalizes the workflow. If this resulted in "non-minor changes" in `docs/` (such as the injection in Phase A), the agent executes `retain` on the project's Hindsight bank before closing.
