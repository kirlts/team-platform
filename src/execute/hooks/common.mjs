// What the three session hooks share (commands.mjs, tools.mjs, close.mjs). They run inside the unattended session, possibly on a machine the worker
// created, so they are standalone: Node built-ins only, and the worker copies this folder to the job directory (`bin/hooks/`, see handler.js).
//
// The hooks are the host's limits made impossible to forget: a rule written as a paragraph of the instructions depends on the model remembering it, a hook
// refuses the call whether it remembers or not. The core owns the mechanism; the host owns the list. The list is the file named by EXECUTE_GUARDS_FILE
// (docs/CONTRATO-DE-ANFITRION.md, «Guardias de la sesión»); the worker validates it when the job starts, copies it to the job directory and points the
// session at the copy with TEAM_GUARDS_FILE. Without that variable, or when the copy cannot be read, every hook lets the call through: a guard that
// breaks must not stop the session (the same choice as `team guard`).

import { readFileSync } from 'node:fs'

/** Start of a simple command: beginning of the text, after `; & | (` or a new line, or after `then`, `do`, `else`. The placeholder `{START}` of a rule stands for it. */
export const COMMAND_START = String.raw`(?:^|[;&|(\n]\s*|\b(?:then|do|else)\s+)`

export const expandPattern = (source) => source.replaceAll('{START}', COMMAND_START)

/** The guard configuration of this session, or null when there is none (or it cannot be read). */
export function readGuards (env) {
  const file = env?.TEAM_GUARDS_FILE
  if (!file) return null
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

/** The answer of a PreToolUse hook that refuses the call. The reason goes back to the model, which then does what the reason says. */
export const deny = (reason) => ({
  code: 0,
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
  stderr: ''
})

export const allow = () => ({ code: 0, stdout: '', stderr: '' })

/** The answer of a Stop hook that sends the session back to work with the reason. */
export const hold = (reason) => ({ code: 0, stdout: JSON.stringify({ decision: 'block', reason }), stderr: '' })

const wordsOf = (text) => String(text ?? '').split(/\s+/).filter(Boolean)

/**
 * Whether one rule of the host refuses `command`. A rule is { match, unless?, line_requires?, args_required?, message }:
 *   match          a regular expression, or a list of them that must all match somewhere in the command; `{START}` is the start of a simple command
 *   unless         the rule does not apply when this one matches anywhere in the command
 *   line_requires  for each match of the first expression: the text of its line before the match must match this one, or the command is refused
 *   args_required  for each match of the first expression: its first capture group must hold a positional word (not a flag, not a number), or the command is refused
 * Without the last two the command is refused as soon as `match` matches.
 */
export function ruleRefuses (rule, command) {
  const patterns = [].concat(rule.match).map((source) => expandPattern(source))
  if (!patterns.every((source) => new RegExp(source).test(command))) return false
  if (rule.unless && new RegExp(expandPattern(rule.unless)).test(command)) return false
  if (rule.line_requires === undefined && !rule.args_required) return true
  const lineOk = rule.line_requires === undefined ? null : new RegExp(expandPattern(rule.line_requires))
  for (const found of command.matchAll(new RegExp(patterns[0], 'g'))) {
    if (lineOk && !lineOk.test(command.slice(0, found.index).split('\n').at(-1))) return true
    if (rule.args_required && !wordsOf(found[1]).some((word) => !word.startsWith('-') && !/^\d+$/.test(word))) return true
  }
  return false
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The rules the core knows by name, for what every host repeats. A host turns on the ones it wants (`commands.builtin`); none is on by default, so a host
 * that declares nothing keeps the behaviour it had. `protected` is the list of branches nobody pushes to (`commands.protected_branches`, default main and master).
 */
export function builtinRules (protectedBranches = ['main', 'master']) {
  const branches = protectedBranches.map(escapeRegExp).join('|')
  return {
    'forced-push': {
      match: String.raw`\bgit\s+push\b[^;&|\n]*(?:\s--force\b|\s-f\b|\s--force-with-lease\b|\s\+\S)`,
      message: 'A forced push rewrites a branch that others read. Add a new commit and push without forcing.'
    },
    'protected-push': {
      match: String.raw`\bgit\s+push\b[^;&|\n]*(?:\s|:|\+)(?:refs/heads/)?(?:${branches})(?=\s|$|;|&|\|)`,
      message: `Pushing to ${protectedBranches.join(' or ')} is not allowed from this session. Push the branch of the job: \`git push -u origin HEAD\`.`
    },
    'no-verify': {
      match: String.raw`\bgit\s+(?:commit|push)\b[^;&|\n]*\s--no-verify\b`,
      message: '`--no-verify` skips the checks of the repository. Fix what the check names and run the command again without the flag.'
    },
    amend: {
      match: String.raw`\bgit\s+commit\b[^;&|\n]*\s--amend\b`,
      message: 'An amended commit changes what was already reviewed. Add a new commit.'
    },
    'add-all': {
      match: String.raw`\bgit\s+add\s+(?:[^;&|\n]*\s)?(?:-A|--all|\.)(?=\s|$|;|&|\|)`,
      message: '`git add -A` and `git add .` stage files that are not part of the change. Add by path: `git add <file> …`.'
    },
    stash: {
      match: String.raw`{START}git\s+stash\b`,
      message: '`git stash` hides work that the next session does not see. Commit by path, or discard a file with `git restore <file>`.'
    },
    waiting: {
      match: String.raw`{START}(?:sleep\s+\d|watch\s)|\b(?:until|while)\b[^\n]*\bdo\b[^\n]*\bsleep\b`,
      message: 'Waiting with sleep, watch or a polling loop spends a turn of the session for every wait. Run the command that takes time in the foreground (`timeout <seconds> <command>`) and wait for its end.'
    }
  }
}

export const BUILTIN_NAMES = Object.keys(builtinRules())
