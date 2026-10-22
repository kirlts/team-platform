// Data reset (UD-240, H-3704): empties the test data in one transaction and frees the files nobody references.
//   content     inputs, attachments, jobs, job events, proposals, messages (assignees, attachments, edits), replies
//               (attachments) and spans. Members, areas, templates, settings, provider connections and the audit log stay.
//   everything  also every member except the one who asks (credentials, sessions and identities go with them), and the
//               areas and templates go back to the initial set of `templates/` (deleted for real and seeded again).
// Children are deleted before their parents, so the order holds with PRAGMA foreign_keys = ON even without cascades.

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { all, get, run, tx } from '../db/index.js'
import { insertSeedSet } from '../db/seed.js'
import { audit } from './audit.js'
import { badRequest } from './errors.js'

export const SCOPES = ['content', 'everything']

/** Children first. `spans` has no foreign keys; `messages.input_id` is SET NULL, so inputs may go before or after messages. */
export const CONTENT_TABLES = [
  'job_events', 'jobs', 'proposals',
  'message_attachments', 'message_edits', 'message_assignees', 'reply_attachments', 'replies', 'messages',
  'attachments', 'inputs', 'spans'
]

const countOf = (db, table) => get(db, `SELECT COUNT(*) AS n FROM ${table}`).n

/** Files of the attachments volume: every one is unreferenced once the content tables are empty. */
function listBlobs (config) {
  if (!existsSync(config.attachmentsDir)) return []
  return readdirSync(config.attachmentsDir).map((name) => path.join(config.attachmentsDir, name)).filter((p) => statSync(p).isFile())
}

export function assertScope (scope) {
  if (!SCOPES.includes(scope)) throw badRequest(`El alcance debe ser uno de: ${SCOPES.join(', ')}.`, 'invalid_scope')
}

/** What a reset would delete, without deleting it (the command line prints it before asking for `--si`). */
export function previewReset (db, config, { scope, keepMemberId = null }) {
  assertScope(scope)
  const deleted = Object.fromEntries(CONTENT_TABLES.map((t) => [t, countOf(db, t)]))
  if (scope === 'everything') {
    deleted.members = get(db, 'SELECT COUNT(*) AS n FROM members WHERE id <> ?', keepMemberId ?? -1).n
    deleted.templates = countOf(db, 'templates')
    deleted.areas = countOf(db, 'areas')
  }
  const blobs = listBlobs(config)
  return { scope, deleted, files: blobs.length, bytes_freed: blobs.reduce((a, p) => a + statSync(p).size, 0) }
}

/**
 * Runs the reset. `seedSet` (areas and templates of `templates/`, from `readSeedSet`) is required for `everything`.
 * Returns the figures per table, the files removed and the bytes freed. The audit row `data.reset` carries the same figures.
 */
export function resetData (db, config, { scope, actorId = null, keepMemberId = null, seedSet = null, now = Date.now }) {
  assertScope(scope)
  if (scope === 'everything') {
    if (!keepMemberId || !get(db, 'SELECT 1 AS e FROM members WHERE id = ?', keepMemberId)) throw badRequest('Falta el miembro que se conserva.', 'keep_member_required')
    if (!seedSet) throw new Error('resetData: everything requires the seed set')
  }
  const blobs = listBlobs(config)
  const bytes = blobs.reduce((a, p) => a + statSync(p).size, 0)
  const result = tx(db, () => {
    const deleted = {}
    for (const table of CONTENT_TABLES) {
      deleted[table] = countOf(db, table)
      run(db, `DELETE FROM ${table}`)
    }
    if (scope === 'everything') {
      deleted.members = get(db, 'SELECT COUNT(*) AS n FROM members WHERE id <> ?', keepMemberId).n
      run(db, 'DELETE FROM members WHERE id <> ?', keepMemberId) // credentials, sessions and identity_links cascade
      deleted.templates = countOf(db, 'templates')
      deleted.areas = countOf(db, 'areas')
      run(db, 'DELETE FROM templates')
      run(db, 'DELETE FROM areas')
      insertSeedSet(db, seedSet, now())
    }
    const summary = { scope, deleted, files: blobs.length, bytes_freed: bytes }
    audit(db, { memberId: actorId, action: 'data.reset', entity: 'data', detail: summary, now })
    return summary
  })
  for (const p of blobs) rmSync(p, { force: true })
  if (scope === 'everything') rmSync(config.editedTemplatesDir, { recursive: true, force: true }) // the file mirror of the edited templates
  return result
}

/** Members that may be kept by `everything`: the editors, by email. */
export const findMemberByEmail = (db, email) => get(db, 'SELECT id, email, role FROM members WHERE email = ?', email) ?? null

export const listEditors = (db) => all(db, "SELECT id, email FROM members WHERE role = 'editor' ORDER BY id")
