// The worker's side of the session hooks (UD-295 started them for the light model; this makes them the host's list, for every session). The host's lists
// are one JSON file, EXECUTE_GUARDS_FILE; this module validates it when a job starts, so a typo fails the job with its name instead of silently guarding nothing,
// and builds the `hooks` the session declares. The hooks themselves are the .mjs files of this folder, copied to the job directory (`bin/hooks/`) and
// started as `team hook <name>` (scripts/team.mjs). Shape of the file: docs/CONTRATO-DE-ANFITRION.md, «Guardias de la sesión».

import { BUILTIN_NAMES, expandPattern } from './common.mjs'
import { toolsOf } from './tools.mjs'

/** Name of the copy of the guards file in the job directory; run.sh points TEAM_GUARDS_FILE at it on a machine. */
export const GUARDS_COPY = 'guards.json'

/** The files of this folder that travel with `team.mjs` to the job directory. */
export const HOOK_MODULES = ['common.mjs', 'commands.mjs', 'tools.mjs', 'close.mjs']

// Seconds a hook may take before Claude Code lets the call through (`timeout` of a command hook, https://code.claude.com/docs/en/hooks, read 2026-10-26).
// Declared courtesy: a hook that hangs must not hold the session. The checks of the command and tool hooks only match text; the closing check runs `git` over the branch.
export const HOOK_TIMEOUT_SECONDS = { commands: 5, tools: 5, close: 20 }

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isText = (v) => typeof v === 'string' && v.trim() !== ''

function only (value, allowed, where) {
  if (!isObject(value)) throw new Error(`${where} must be an object`)
  const extra = Object.keys(value).filter((k) => !allowed.includes(k))
  if (extra.length) throw new Error(`${where} does not know «${extra[0]}» (allowed: ${allowed.join(', ')})`)
}

function pattern (value, where) {
  if (!isText(value)) throw new Error(`${where} must be a regular expression written as text`)
  try { new RegExp(expandPattern(value)) } catch (error) { throw new Error(`${where} is not a regular expression: ${error.message}`) }
}

function names (value, where) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isText)) throw new Error(`${where} must be a non-empty list of names`)
}

function commandsOf (value) {
  only(value, ['builtin', 'protected_branches', 'rules'], 'commands')
  if (value.builtin !== undefined) {
    if (!Array.isArray(value.builtin)) throw new Error('commands.builtin must be a list')
    for (const name of value.builtin) if (!BUILTIN_NAMES.includes(name)) throw new Error(`commands.builtin does not know «${name}» (known: ${BUILTIN_NAMES.join(', ')})`)
  }
  if (value.protected_branches !== undefined) names(value.protected_branches, 'commands.protected_branches')
  value.rules?.forEach?.((rule, i) => {
    const where = `commands.rules[${i}]${rule?.id ? ` («${rule.id}»)` : ''}`
    only(rule, ['id', 'match', 'unless', 'line_requires', 'args_required', 'message'], where)
    for (const source of [].concat(rule.match ?? [])) pattern(source, `${where}.match`)
    if (rule.match === undefined || [].concat(rule.match).length === 0) throw new Error(`${where}.match is required`)
    if (rule.unless !== undefined) pattern(rule.unless, `${where}.unless`)
    if (rule.line_requires !== undefined) pattern(rule.line_requires, `${where}.line_requires`)
    if (rule.args_required !== undefined && typeof rule.args_required !== 'boolean') throw new Error(`${where}.args_required must be true or false`)
    if (!isText(rule.message)) throw new Error(`${where}.message is required: it is what the model reads when the command is refused`)
  })
  if (value.rules !== undefined && !Array.isArray(value.rules)) throw new Error('commands.rules must be a list')
}

function toolsBlock (value) {
  only(value, ['deny', 'deny_background'], 'tools')
  for (const key of ['deny', 'deny_background']) {
    if (value[key] === undefined) continue
    if (!Array.isArray(value[key])) throw new Error(`tools.${key} must be a list`)
    value[key].forEach((entry, i) => {
      only(entry, ['tools', 'message'], `tools.${key}[${i}]`)
      names(entry.tools, `tools.${key}[${i}].tools`)
      if (!isText(entry.message)) throw new Error(`tools.${key}[${i}].message is required: it is what the model reads when the tool is refused`)
    })
  }
}

function closeBlock (value) {
  only(value, ['clean_tree', 'pushed_branch', 'base', 'review'], 'close')
  for (const key of ['clean_tree', 'pushed_branch']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`close.${key} must be true or false`)
  if (value.base !== undefined && !isText(value.base)) throw new Error('close.base must be a branch name, for example origin/main')
  if (value.review === undefined) return
  const review = value.review
  only(review, ['paths', 'except', 'only', 'only_except', 'trailer', 'not_by', 'message'], 'close.review')
  for (const key of ['paths', 'except', 'only', 'only_except']) if (review[key] !== undefined) pattern(review[key], `close.review.${key}`)
  if (review.paths === undefined && review.only === undefined) throw new Error('close.review needs «paths» or «only»: which changes need the mark')
  if (!isText(review.trailer)) throw new Error('close.review.trailer is required: the name of the commit trailer that carries the mark')
  if (review.not_by !== undefined) names(review.not_by, 'close.review.not_by')
  if (!isText(review.message)) throw new Error('close.review.message is required: it tells the session how to get the mark ({tree}, {job} and {branch} are replaced)')
}

/** Parses and validates the text of the guards file. Throws an Error whose message names what is wrong. Returns the object that goes to the job directory. */
export function parseGuards (text) {
  let guards
  try { guards = JSON.parse(text) } catch (error) { throw new Error(`it is not JSON (${error.message})`) }
  only(guards, ['commands', 'tools', 'close'], 'the file')
  if (guards.commands !== undefined) commandsOf(guards.commands)
  if (guards.tools !== undefined) toolsBlock(guards.tools)
  if (guards.close !== undefined) closeBlock(guards.close)
  return guards
}

/** What the session declares for these guards: the `hooks` to merge with the ones of `sessionSettings`. Nothing is declared for an empty block. */
export function guardHooks (guards) {
  const hooks = {}
  const command = (name) => ({ type: 'command', command: `team hook ${name}`, timeout: HOOK_TIMEOUT_SECONDS[name] })
  const commands = guards?.commands
  if ((commands?.builtin?.length ?? 0) + (commands?.rules?.length ?? 0) > 0) hooks.PreToolUse = [{ matcher: 'Bash', hooks: [command('commands')] }]
  const toolNames = toolsOf(guards?.tools)
  if (toolNames.length) hooks.PreToolUse = [...(hooks.PreToolUse ?? []), { matcher: toolNames.join('|'), hooks: [command('tools')] }]
  const close = guards?.close
  if (close?.clean_tree || close?.pushed_branch || close?.review) hooks.Stop = [{ hooks: [command('close')] }]
  return hooks
}
