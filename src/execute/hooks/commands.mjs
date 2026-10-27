// PreToolUse hook for Bash (`team hook commands`): refuses a command before it runs and answers with the reason, which names the command that does the job
// correctly. The list comes from the host (commands.builtin and commands.rules of the guards file); see common.mjs. Exit code 0 always: the refusal
// is the JSON `permissionDecision: deny`, so the model reads why and the session goes on.

import { allow, builtinRules, deny, readGuards, ruleRefuses } from './common.mjs'

/** The rules in force, in order: the named ones the host turned on, then its own. */
export function rulesOf (commands) {
  const named = builtinRules(commands?.protected_branches?.length ? commands.protected_branches : undefined)
  return [...(commands?.builtin ?? []).map((name) => named[name]).filter(Boolean), ...(commands?.rules ?? [])]
}

/** The reason to refuse `command`, or null. */
export function refusalOf (commands, command) {
  for (const rule of rulesOf(commands)) if (ruleRefuses(rule, command)) return rule.message
  return null
}

export function run ({ event, env = process.env }) {
  if (event?.tool_name !== 'Bash') return allow()
  const guards = readGuards(env)
  if (!guards?.commands) return allow()
  const reason = refusalOf(guards.commands, String(event.tool_input?.command ?? ''))
  return reason ? deny(reason) : allow()
}
