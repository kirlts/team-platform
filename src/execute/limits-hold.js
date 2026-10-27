// What holds a limit that a person lifts (UD-313) and the wait of an idea (UD-307) in each of the two ways an instance delivers (amendment of UD-313, 2026-10-27).
//
//   deliver   EXECUTE_DELIVER_COMMAND is declared: the delivery is a job of the platform and the platform holds it (`deliver.js`), whatever the host decides.
//   hook      no delivery command, but the guards file of the host (EXECUTE_GUARDS_FILE) lists the orders that put work in production in `commands.deliveries`. While a limit of a person
//             is touched and not lifted, or an idea has not been released, the session is created with those orders refused (the same `PreToolUse` hook as every other refused command),
//             and what it leaves on the branch goes to a person instead of closing (`handler.js`). The platform does not know how the host delivers, so the host writes the list.
//   none      neither: the session delivers by the rules of the host and the platform cannot refuse it. The limit then only adds a person to the assignees, keeps the message from closing by
//             itself and reaches the session as an instruction. That is a degraded state and it is declared: `/health` turns `degraded` when an area has a limit of a person, and the worker
//             says it when it starts.
//
// Nothing here reads the words of anyone: it reads the host's configuration and the booleans and ids the analyzer left.
import { readFileSync } from 'node:fs'
import { all } from '../db/index.js'
import { deliveriesOf, parseGuards } from './hooks/guards.js'

export const HOLD_MODES = Object.freeze(['deliver', 'hook', 'none'])

/** Which of the three ways holds the limits in this instance. `guards` is the parsed guards file or null. */
export function holdMode ({ deliverCommand = '', guards = null } = {}) {
  if (deliverCommand) return 'deliver'
  return deliveriesOf(guards).length > 0 ? 'hook' : 'none'
}

/**
 * The guards of a session whose delivery orders are refused: the rules of `commands.deliveries` join `commands.rules`, each with `why` after the host's own message (which says the
 * correct order, not only that it is forbidden). The hook reads `rules`, so nothing in it changes. Returns a copy.
 */
export function withDeliveriesDenied (guards, why) {
  const refused = deliveriesOf(guards).map((rule) => ({ ...rule, message: `${rule.message} ${why}` }))
  return { ...guards, commands: { ...guards.commands, rules: [...(guards.commands.rules ?? []), ...refused] } }
}

/** The guards file as the worker reads it, or null when none is declared or it does not parse (a job with a file that does not parse fails on its own, `guards_file_invalid`). */
export function readGuardsFile (config) {
  const file = config.execute.guardsFile
  if (!file) return null
  try { return parseGuards(readFileSync(file, 'utf8')) } catch { return null }
}

/** Whether some current area declares a limit about a person. */
export function personLimitsDeclared (db) {
  return all(db, 'SELECT guards_json FROM areas WHERE deleted_at IS NULL').some((row) => {
    try { return JSON.parse(row.guards_json ?? '[]').some((g) => g?.person === true) } catch { return false }
  })
}

/**
 * The state `/health` and the start of the worker publish: `{ hold, person_limits, idea_hold, degraded, reason }`. `degraded` is true when an area has a limit of a person and nothing
 * can hold the delivery: the limit exists on paper and a session would deliver through it.
 */
export function limitsHoldState ({ db, config }) {
  const hold = holdMode({ deliverCommand: config.execute.deliverCommand, guards: readGuardsFile(config) })
  const personLimits = personLimitsDeclared(db)
  const degraded = hold === 'none' && personLimits
  return {
    hold, person_limits: personLimits, idea_hold: hold !== 'none', degraded,
    reason: hold !== 'none' ? null : `${personLimits ? 'A limit of a person is declared' : 'No limit of a person is declared yet'} and the instance declares neither EXECUTE_DELIVER_COMMAND nor commands.deliveries in EXECUTE_GUARDS_FILE: the retention of the delivery is not applied (the wait of an idea is an instruction to the session only).`
  }
}

/** Logs the state when the worker starts: a warning when it is degraded, an info line otherwise. */
export function announceLimitsHold ({ db, config, logger }) {
  const state = limitsHoldState({ db, config })
  const line = state.reason ?? `limits hold: by the ${state.hold === 'deliver' ? 'delivery job' : 'refused delivery orders of the guards file'}`
  if (state.degraded) logger.warn({ limits_hold: state }, line)
  else logger.info({ limits_hold: state.hold }, line)
  return state
}
