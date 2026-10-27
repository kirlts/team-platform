// PreToolUse hook for the tools of the session (`team hook tools`): refuses a tool, or a tool used in the background, with the reason the host wrote.
// A subagent in the background forces the session to wait for it with empty turns (read notices, list agents, watch), and each turn reads the whole context
// again; the host decides which tools it takes away. The list is tools.deny and tools.deny_background of the guards file; see common.mjs.

import { allow, deny, readGuards } from './common.mjs'

/** The reason to refuse the call of `tool` with `input`, or null. */
export function refusalOf (tools, tool, input) {
  for (const entry of tools?.deny ?? []) if (entry.tools.includes(tool)) return entry.message
  if (input?.run_in_background) for (const entry of tools?.deny_background ?? []) if (entry.tools.includes(tool)) return entry.message
  return null
}

/** The tool names the hook has to listen to (the `matcher` of the hook), or an empty list. */
export function toolsOf (tools) {
  return [...new Set([...(tools?.deny ?? []), ...(tools?.deny_background ?? [])].flatMap((entry) => entry.tools))]
}

export function run ({ event, env = process.env }) {
  const guards = readGuards(env)
  if (!guards?.tools) return allow()
  const reason = refusalOf(guards.tools, String(event?.tool_name ?? ''), event?.tool_input ?? {})
  return reason ? deny(reason) : allow()
}
