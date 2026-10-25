#!/usr/bin/env node
// Removes a member by email from the database in the container, the same operation as DELETE /members/:id (UD-292):
// what they published stays under «Miembro eliminado», unpublished sends go, and the email is retired so the host
// ingress does not create the member again.
//
//   docker exec <container> node scripts/remove-member.mjs member@example.org --by editor@example.org
//
// `--by` names the person the audit log records; `--db` defaults to DB_PATH or /data/team.db.

import { get, openDatabase } from '../src/db/index.js'
import { deleteMember } from '../src/domain/members.js'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] }
const email = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
if (!email) {
  console.error('Usage: remove-member.mjs EMAIL --by ACTOR_EMAIL [--db FILE]')
  process.exit(2)
}
const db = openDatabase(flag('--db') ?? process.env.DB_PATH ?? '/data/team.db')
const target = get(db, 'SELECT id FROM members WHERE email = ? AND removed = 0', email)
if (!target) {
  console.error(`No member with the email ${email}.`)
  process.exit(1)
}
const by = flag('--by') ? get(db, 'SELECT id FROM members WHERE email = ?', flag('--by'))?.id : null
if (flag('--by') && !by) {
  console.error(`No member with the email ${flag('--by')} to record as the actor.`)
  process.exit(1)
}
const { deleted, kept } = deleteMember(db, target.id, { actorId: by })
console.log(JSON.stringify({ email, deleted, kept }))
