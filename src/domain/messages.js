// Messages, replies and statuses (MASTER-SPEC §1.1, §4.8).
//
// Statuses of a message: open → answered → closed.
//   - Only a member other than the sender replies (403). This layer enforces it, not the panel.
//   - Any member closes or reopens.
//   - Reopening returns to `answered` if the message already has replies, and to `open` if not.
// Table of `status` transitions; any other is a 409.
//
// Messages and replies are soft-deleted (`deleted_at`, UD-240) and restored. Every read here ignores a deleted row:
// lists, counts, the thread, the search, the last reply of a card and the access to attachments. A deleted message is a
// 404 for everybody except an Editor who asks for it with `includeDeleted`.

import { createHash } from 'node:crypto'
import { all, get, run } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'
import { audit } from './audit.js'
import { AppError, badRequest, conflict, forbidden, notFound } from './errors.js'
import { checkAssignees, checkFields, newValidatorCache, resolveAreaAndTemplate, withoutNulls } from './validation.js'
import { loadTemplate } from './areas.js'
import { cancelAgentJobs, enqueueExecuteForAgents } from '../execute/enqueue.js'
import { SPOKEN_KINDS, enqueueReplyExtract } from './reply-extract.js'
import { checkMentions, mentionsOf, recordMentions } from './mentions.js'

export const MESSAGE_STATUSES = ['open', 'answered', 'closed']
export const REPLY_KINDS = ['answer', 'fix', 'clarification', 'forward']
/** The kinds a reply route or a session writes: `forward` is written by `forwardMessage` only (UD-272), which is what gives it a recipient. */
export const WRITABLE_REPLY_KINDS = REPLY_KINDS.filter((k) => k !== 'forward')

const TRANSITIONS = {
  reply: { open: 'answered', answered: 'answered' }, // a closed message receives no replies until it is reopened
  close: { open: 'closed', answered: 'closed' },
  reopen: { closed: null } // the destination depends on whether it has replies
}

const escapeLike = (q) => q.replace(/[\\%_]/g, (c) => `\\${c}`)

/** The form of a message number as the panel draws it: digits, with or without the `#` (as «#115» in a tracker). It is an identifier, not language. */
const MESSAGE_NUMBER = /^#?([0-9]{1,15})$/

function attachmentsOf (db, ids) {
  if (ids.length === 0) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const rows = all(db, `
    SELECT ma.message_id, a.id, a.input_id, a.kind, a.name, a.mime, a.size, a.extracted_at
      FROM message_attachments ma JOIN attachments a ON a.id = ma.attachment_id
     WHERE ma.message_id IN (${placeholders}) ORDER BY ma.message_id, ma.position, a.id`, ...ids)
  const table = new Map()
  for (const f of rows) {
    if (!table.has(f.message_id)) table.set(f.message_id, [])
    table.get(f.message_id).push({ id: f.id, input_id: f.input_id, kind: f.kind, name: f.name, mime: f.mime, size: f.size, extracted: f.extracted_at !== null && f.extracted_at !== undefined })
  }
  return table
}

function assigneesOf (db, ids) {
  if (ids.length === 0) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const rows = all(db, `SELECT message_id, member_id FROM message_assignees WHERE message_id IN (${placeholders}) ORDER BY message_id, member_id`, ...ids)
  const table = new Map()
  for (const f of rows) {
    if (!table.has(f.message_id)) table.set(f.message_id, [])
    table.get(f.message_id).push(f.member_id)
  }
  return table
}

/** Files and links attached to replies, by reply id. A reply is stored and served only; it is never analyzed. */
function replyAttachmentsOf (db, replyIds) {
  const table = new Map()
  if (replyIds.length === 0) return table
  const rows = all(db, `SELECT id, reply_id, kind, name, mime, size, extracted_at FROM reply_attachments
                         WHERE reply_id IN (${replyIds.map(() => '?').join(',')}) ORDER BY reply_id, position, id`, ...replyIds)
  for (const f of rows) {
    if (!table.has(f.reply_id)) table.set(f.reply_id, [])
    table.get(f.reply_id).push({ id: f.id, reply_id: f.reply_id, kind: f.kind, name: f.name, mime: f.mime, size: f.size, extracted: f.extracted_at !== null && f.extracted_at !== undefined })
  }
  return table
}

const toReply = (r, atts = [], mentions = []) => ({
  id: r.id, message_id: r.message_id, author_id: r.author_id, body: r.body, kind: r.kind, forwarded_to: r.forwarded_to ?? null, mentions, // UD-277: the members picked from the list when the reply was written
  attachments: atts, attachment_kinds: [...new Set(atts.map((a) => a.kind))], // one icon per media kind (UD-016)
  created_at: iso(r.created_at), version: r.version, edited_at: iso(r.edited_at)
})

function lastRepliesOf (db, ids) {
  if (ids.length === 0) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const rows = all(db, `
    SELECT r.* FROM replies r
     WHERE r.message_id IN (${placeholders}) AND r.deleted_at IS NULL
       AND r.id = (SELECT MAX(x.id) FROM replies x WHERE x.message_id = r.message_id AND x.deleted_at IS NULL)`, ...ids)
  const atts = replyAttachmentsOf(db, rows.map((r) => r.id))
  const mentions = mentionsOf(db, rows.map((r) => r.id))
  return new Map(rows.map((r) => [r.message_id, toReply(r, atts.get(r.id), mentions.get(r.id))]))
}

/** Flat shape the panel consumes: references by id; names come from the member and area lists. */
function hydrate (db, rows) {
  const ids = rows.map((f) => f.id)
  const atts = attachmentsOf(db, ids)
  const assigned = assigneesOf(db, ids)
  const lastReplies = lastRepliesOf(db, ids)
  return rows.map((f) => ({
    id: f.id,
    input_id: f.input_id,
    area_id: f.area_id,
    template_id: f.template_id,
    author_id: f.author_id,
    sent_by_id: f.sent_by_id ?? null, // UD-255: who sent it in the name of the author
    title: f.title,
    body: f.body,
    fields: parseJson(f.fields_json, {}),
    status: f.status,
    assignee_ids: assigned.get(f.id) ?? [],
    attachments: atts.get(f.id) ?? [],
    attachment_kinds: [...new Set((atts.get(f.id) ?? []).map((a) => a.kind))], // distinct, in attachment order (UD-016)
    reply_count: f.reply_count,
    last_reply: lastReplies.get(f.id) ?? null,
    created_at: iso(f.created_at),
    updated_at: iso(f.updated_at ?? f.created_at),
    version: f.version,
    edited_at: iso(f.edited_at),
    closed_at: iso(f.closed_at),
    deleted_at: iso(f.deleted_at)
  }))
}

const SELECT_MESSAGE = `
  SELECT m.*, (SELECT COUNT(*) FROM replies r WHERE r.message_id = m.id AND r.deleted_at IS NULL) AS reply_count,
         (SELECT i.sent_by_member_id FROM inputs i WHERE i.id = m.input_id) AS sent_by_id
    FROM messages m`

/** A reply still in the thread: the only kind the reads count. Used as a subquery condition on alias `r`. */
const LIVE_REPLY = 'r.deleted_at IS NULL'

/**
 * List of the team's messages (everyone sees everything, §6). Filters: `for` (me or a member id: assigned to),
 * `area`, `status`, `q` (substring in title or text) and `replies` (only with replies; with `for`, those
 * that involve that person as sender, assignee or author of a reply) and `deleted` (only the deleted ones: the viewer's own, all for an Editor).
 * Returns { items, total }.
 */
export function listMessages (db, { viewerId, viewerRole = 'member', forMember = null, involved = false, area = null, status = null, q = null, replies = false, deleted = false, limit, offset = 0 }) {
  // `deleted`: only the deleted ones, to restore them (UD-250): the viewer's own, or every one for an Editor.
  const scope = [deleted ? 'm.deleted_at IS NOT NULL' : 'm.deleted_at IS NULL']
  const params = []
  if (deleted && viewerRole !== 'editor') { scope.push('m.author_id = ?'); params.push(viewerId) }
  const memberRow = forMember === 'me' ? viewerId : forMember
  if (memberRow !== null && memberRow !== undefined) {
    if (replies) {
      scope.push(`(m.author_id = ? OR EXISTS (SELECT 1 FROM message_assignees x WHERE x.message_id = m.id AND x.member_id = ?)
                   OR EXISTS (SELECT 1 FROM replies r WHERE r.message_id = m.id AND r.author_id = ? AND ${LIVE_REPLY}))`)
      params.push(memberRow, memberRow, memberRow)
    } else {
      scope.push('EXISTS (SELECT 1 FROM message_assignees x WHERE x.message_id = m.id AND x.member_id = ?)')
      params.push(memberRow)
    }
  }
  if (involved) {
    // The same rule as messageSummary and the closed count of the bar: assigned to the viewer, or sent by the viewer once it is answered or closed.
    scope.push("(EXISTS (SELECT 1 FROM message_assignees x WHERE x.message_id = m.id AND x.member_id = ?) OR (m.author_id = ? AND m.status <> 'open'))")
    params.push(viewerId, viewerId)
  }
  if (area !== null) { scope.push('m.area_id = ?'); params.push(area) }
  if (status !== null) { scope.push('m.status = ?'); params.push(status) }
  if (q) {
    // Title, body, the values of the template fields (not their names) and the text of the replies (idea.md).
    // The replies search goes through `replies_message`; the fields through `json_each` of that row. Cost measured in H-3603.
    // A query with the form of a message number (`115`, `#115`) also finds that message, besides the text that contains it.
    scope.push(`(m.id = ? OR m.title LIKE ? ESCAPE '\\' OR m.body LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM replies r WHERE r.message_id = m.id AND ${LIVE_REPLY} AND r.body LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM json_each(m.fields_json) f WHERE f.value LIKE ? ESCAPE '\\'))`)
    const like = `%${escapeLike(q)}%`
    params.push(MESSAGE_NUMBER.exec(q.trim())?.[1] ?? null, like, like, like, like)
  }
  if (replies) scope.push(`EXISTS (SELECT 1 FROM replies r WHERE r.message_id = m.id AND ${LIVE_REPLY})`)
  const cond = `WHERE ${scope.join(' AND ')}`

  const orderBy = replies
    ? `(SELECT MAX(r.created_at) FROM replies r WHERE r.message_id = m.id AND ${LIVE_REPLY}) DESC, m.id DESC`
    : deleted ? 'm.deleted_at DESC, m.id DESC' : 'm.created_at DESC, m.id DESC'
  const total = get(db, `SELECT COUNT(*) AS n FROM messages m ${cond}`, ...params).n
  const rows = all(db, `${SELECT_MESSAGE} ${cond} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, ...params, limit, offset)
  return { items: hydrate(db, rows), total }
}

/**
 * What affects a member, with its priority (UD-028). Counts only messages that are not closed.
 *   red: assigned to the member and still open (nobody replied; it needs their action).
 *   yellow: assigned to the member and already answered, not closed (waiting to be closed).
 *   blue: issuer of the message, not assigned, with replies and not closed (informational).
 * A message falls into a single priority. `areas` lists the open ones per area and how many are red for the member.
 */
export function messageSummary (db, memberId) {
  const rows = all(db, `
    SELECT m.id AS id, m.title AS title, m.created_at AS created_at, m.status AS status,
           EXISTS (SELECT 1 FROM message_assignees x WHERE x.message_id = m.id AND x.member_id = ?) AS assigned,
           (m.author_id = ?) AS authored
      FROM messages m WHERE m.status <> 'closed' AND m.deleted_at IS NULL`, memberId, memberId)
  const mine = { open: 0, answered: 0, total: 0 }
  // The same messages that are counted, one by one: the panel lists exactly what adds up (J2-A-43).
  const items = []
  for (const r of rows) {
    const status = r.assigned || (r.authored && r.status === 'answered') ? r.status : null
    if (status) { mine[status]++; mine.total++; items.push({ message_id: String(r.id), title: r.title, status, at: r.created_at }) }
  }
  const rank = { open: 0, answered: 1 }
  items.sort((a, b) => rank[a.status] - rank[b.status] || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const count = (status) => `(SELECT COUNT(*) FROM messages m WHERE m.area_id = a.id AND m.status = '${status}' AND m.deleted_at IS NULL)`
  const areas = all(db, `
    SELECT a.id AS area_id, ${count('open')} AS open, ${count('answered')} AS answered, ${count('closed')} AS closed,
           (SELECT COUNT(*) FROM messages m WHERE m.area_id = a.id AND m.status = 'open' AND m.deleted_at IS NULL
               AND EXISTS (SELECT 1 FROM message_assignees x WHERE x.message_id = m.id AND x.member_id = ?)) AS mine_open
      FROM areas a WHERE a.deleted_at IS NULL ORDER BY a.position, a.id`, memberId)
  return { mine, items, areas }
}

/** The message with its thread. A deleted one is a 404 unless `includeDeleted` (an Editor restoring it). */
export function getMessage (db, id, { includeDeleted = false } = {}) {
  const dbRow = get(db, `${SELECT_MESSAGE} WHERE m.id = ?${includeDeleted ? '' : ' AND m.deleted_at IS NULL'}`, id)
  if (!dbRow) throw notFound('El mensaje no existe.')
  const [msgRow] = hydrate(db, [dbRow])
  const observed = parseJson(dbRow.observed_json, []) // what a video frame shows and nobody says; outside the body
  const replyRows = all(db, 'SELECT * FROM replies WHERE message_id = ? AND deleted_at IS NULL ORDER BY id', id)
  const atts = replyAttachmentsOf(db, replyRows.map((r) => r.id))
  const mentions = mentionsOf(db, replyRows.map((r) => r.id))
  const edits = all(db, 'SELECT * FROM message_edits WHERE message_id = ? ORDER BY id', id)
    .map((e) => ({ id: e.id, member_id: e.member_id, at: iso(e.at), version: e.version, fields: parseJson(e.fields_json, []) }))
  return { ...msgRow, trace_id: dbRow.trace_id ?? null, observed: Array.isArray(observed) ? observed : [], replies: replyRows.map((r) => toReply(r, atts.get(r.id), mentions.get(r.id))), edits }
}

/**
 * In-place edit of a published message by its author (UD-071, which narrows UD-017): title, body, fields,
 * assignees, area (a change of area needs a `template_id` of the new area), template and attachments (a subset or
 * reordering of the attachments of the input the message came from). ONLY the author edits: an Editor does not
 * (403 `not_message_author`); closing, reopening and replying stay open to everybody (§1.1). A message in any
 * status can be edited, closed ones included.
 *
 * Optimistic concurrency: `patch.version` is the version the client read. If another edit landed in between it is a
 * 409 `edit_conflict` carrying the current `version`, and nothing is written. The check and the write share one
 * transaction (BEGIN IMMEDIATE), so two simultaneous patches cannot both pass it.
 *
 * Idempotent: a patch that changes nothing leaves the message, its version and its history as they were. Every
 * real edit bumps `version`, sets `edited_at` and adds a `message_edits` row (who, when, which fields; never the
 * values). New assignees receive a directed notice. Returns the message as `getMessage` shows it.
 */
export function updateMessage ({ db, events, now = Date.now }, { messageId, actor, patch }) {
  events.transaction(() => {
    const row = get(db, 'SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
    if (!row) throw notFound('El mensaje no existe.')
    if (row.author_id !== actor.id) throw forbidden('Sólo quien envió el mensaje puede editarlo.', 'not_message_author')
    if (patch.version !== row.version) {
      throw new AppError(409, 'edit_conflict', 'El mensaje cambió desde que lo abriste; vuelve a cargarlo.', { version: row.version })
    }

    const fail = badRequest
    const next = {}
    if (patch.title !== undefined) {
      if (patch.title.trim() === '') throw fail('El título es obligatorio.', 'message_invalid')
      next.title = patch.title.trim()
    }
    if (patch.body !== undefined) {
      if (patch.body.trim() === '') throw fail('El texto es obligatorio.', 'message_invalid')
      next.body = patch.body
    }

    const areaChanges = patch.area_id !== undefined && patch.area_id !== row.area_id
    if (areaChanges && (patch.template_id === undefined || patch.template_id === null)) {
      throw fail('Para cambiar el área hay que elegir también una plantilla de esa área.', 'template_required')
    }
    const areaId = patch.area_id ?? row.area_id
    const templateChanges = areaChanges || (patch.template_id !== undefined && patch.template_id !== row.template_id)
    let tpl
    if (templateChanges) {
      tpl = resolveAreaAndTemplate(db, { areaId, templateId: patch.template_id }, { fail })
      next.area_id = areaId
      next.template_id = tpl?.id ?? null
    } else {
      tpl = row.template_id === null ? null : loadTemplate(db, row.template_id)
    }
    // Fields are checked whenever they or their template change, because the template defines which are required.
    if (patch.fields !== undefined || templateChanges) {
      const fields = withoutNulls(patch.fields ?? parseJson(row.fields_json, {}))
      checkFields(tpl, fields, { fail, cache: newValidatorCache() })
      next.fields_json = JSON.stringify(fields)
    }

    const currentAssignees = all(db, 'SELECT member_id FROM message_assignees WHERE message_id = ? ORDER BY member_id', messageId).map((a) => a.member_id)
    const assigneeIds = patch.assignee_ids === undefined ? null : checkAssignees(db, patch.assignee_ids, { fail, keep: new Set(currentAssignees) })
    const sameAssignees = assigneeIds === null || (assigneeIds.length === currentAssignees.length && [...assigneeIds].sort((a, b) => a - b).every((id, i) => id === currentAssignees[i]))

    // Attachments: only those of the input the message came from, in the order given.
    const currentAttachments = all(db, 'SELECT attachment_id FROM message_attachments WHERE message_id = ? ORDER BY position, attachment_id', messageId).map((a) => a.attachment_id)
    let attachmentIds = null
    if (patch.attachment_ids !== undefined) {
      attachmentIds = [...new Set(patch.attachment_ids)]
      const own = new Set(row.input_id === null ? [] : all(db, 'SELECT id FROM attachments WHERE input_id = ?', row.input_id).map((a) => a.id))
      for (const id of attachmentIds) if (!own.has(id)) throw fail(`El adjunto ${id} no pertenece al envío de este mensaje.`, 'attachment_invalid')
    }
    const sameAttachments = attachmentIds === null || (attachmentIds.length === currentAttachments.length && attachmentIds.every((id, i) => id === currentAttachments[i]))

    const changed = Object.entries(next).filter(([k, v]) => row[k] !== v).map(([k]) => k)
    if (changed.length === 0 && sameAssignees && sameAttachments) return
    const t = now()
    const version = row.version + 1
    const setClause = [...changed.map((k) => `${k} = ?`), 'updated_at = ?', 'edited_at = ?', 'version = ?'].join(', ')
    run(db, `UPDATE messages SET ${setClause} WHERE id = ?`, ...changed.map((k) => next[k]), t, t, version, messageId)
    if (!sameAssignees) {
      run(db, 'DELETE FROM message_assignees WHERE message_id = ?', messageId)
      for (const id of assigneeIds) run(db, 'INSERT INTO message_assignees (message_id, member_id) VALUES (?, ?)', messageId, id)
      // The new assignees learn it (directed notice); whoever edits does not notify themselves.
      for (const id of assigneeIds) {
        if (currentAssignees.includes(id) || id === actor.id) continue
        events.publish({ kind: 'message', memberId: id, data: { message_id: messageId, title: next.title ?? row.title, author_id: actor.id, input_id: row.input_id, reason: 'assigned' } })
      }
      // A newly assigned agent member gets its `execute` job (UD-254); one that was taken out stops working the message.
      enqueueExecuteForAgents(db, messageId, { memberIds: assigneeIds.filter((id) => !currentAssignees.includes(id)), now })
      cancelAgentJobs(db, { messageId, memberIds: currentAssignees.filter((id) => !assigneeIds.includes(id)), now })
    }
    if (!sameAttachments) {
      run(db, 'DELETE FROM message_attachments WHERE message_id = ?', messageId)
      attachmentIds.forEach((id, ordinal) => run(db, 'INSERT INTO message_attachments (message_id, attachment_id, position) VALUES (?, ?, ?)', messageId, id, ordinal))
    }
    const names = [...changed.map((k) => (k === 'fields_json' ? 'fields' : k)), ...(sameAssignees ? [] : ['assignee_ids']), ...(sameAttachments ? [] : ['attachment_ids'])]
    run(db, 'INSERT INTO message_edits (message_id, member_id, at, version, fields_json) VALUES (?, ?, ?, ?, ?)', messageId, actor.id, t, version, JSON.stringify(names))
    audit(db, { memberId: actor.id, action: 'message.update', entity: 'message', entityId: messageId, detail: { fields: names, version }, now })
  })
  return getMessage(db, messageId)
}

/** The rules for adding attachments, checked on their own so a route can refuse before it stores an upload. */
export function assertCanAddAttachments (db, messageId, actorId, version) {
  const row = get(db, 'SELECT * FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
  if (!row) throw notFound('El mensaje no existe.')
  if (row.author_id !== actorId) throw forbidden('Sólo quien envió el mensaje puede editarlo.', 'not_message_author')
  if (version === undefined) return row // the route's early check, before the upload is stored
  if (!Number.isInteger(version) || version < 1) throw badRequest('Falta la versión del mensaje.', 'version_required')
  if (version !== row.version) throw new AppError(409, 'edit_conflict', 'El mensaje cambió desde que lo abriste; vuelve a cargarlo.', { version: row.version })
  if (row.input_id === null) throw conflict('El envío de origen de este mensaje ya no existe.', 'input_missing')
  return row
}

/**
 * Adds new files and links to a published message (UD-071): the author only, with the version read. They are stored
 * as attachments of the message's input and linked after the ones it already has; their extraction is queued like
 * any other. It counts as one edit (version, `edited_at`, history row `attachment_ids`).
 */
export function addMessageAttachments ({ db, queue, events, now = Date.now }, { messageId, actor, version, files = [], links = [] }) {
  if (files.length + links.length === 0) throw badRequest('Falta un archivo o un enlace.', 'attachments_empty')
  events.transaction(() => {
    const row = assertCanAddAttachments(db, messageId, actor.id, version)
    const t = now()
    let position = get(db, 'SELECT COALESCE(MAX(position), -1) AS p FROM message_attachments WHERE message_id = ?', messageId).p + 1
    const link = (attachmentId) => run(db, 'INSERT INTO message_attachments (message_id, attachment_id, position) VALUES (?, ?, ?)', messageId, attachmentId, position++)
    for (const f of files) {
      const r = run(db, 'INSERT INTO attachments (input_id, kind, name, path, mime, size, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)', row.input_id, f.kind, f.name, f.sha256, f.mime, f.size, f.sha256)
      link(Number(r.lastInsertRowid))
      queue.enqueue('extract', { attachment_id: Number(r.lastInsertRowid) })
    }
    for (const url of links) {
      const r = run(db, "INSERT INTO attachments (input_id, kind, name, path, mime, size, sha256) VALUES (?, 'link', ?, ?, 'text/uri-list', 0, ?)", row.input_id, url, url, createHash('sha256').update(url).digest('hex'))
      link(Number(r.lastInsertRowid))
      queue.enqueue('extract', { attachment_id: Number(r.lastInsertRowid) })
    }
    const next = row.version + 1
    run(db, 'UPDATE messages SET updated_at = ?, edited_at = ?, version = ? WHERE id = ?', t, t, next, messageId)
    run(db, 'INSERT INTO message_edits (message_id, member_id, at, version, fields_json) VALUES (?, ?, ?, ?, ?)', messageId, actor.id, t, next, JSON.stringify(['attachment_ids']))
    audit(db, { memberId: actor.id, action: 'message.update', entity: 'message', entityId: messageId, detail: { fields: ['attachment_ids'], version: next, added: files.length + links.length }, now })
  })
  return getMessage(db, messageId)
}

/**
 * Whether `memberId` holds a question of an agent (UD-269): it is assigned to the message and the last live reply is a `clarification`
 * from an agent member, which is what a handoff leaves. Once they answer, the question is no longer pending and the rule of §4.8 applies again.
 */
export function holdsPendingQuestion (db, messageId, memberId) {
  if (!get(db, 'SELECT 1 AS ok FROM message_assignees WHERE message_id = ? AND member_id = ?', messageId, memberId)) return false
  const last = get(db, `SELECT r.kind AS kind, m.kind AS member_kind FROM replies r JOIN members m ON m.id = r.author_id
                         WHERE r.message_id = ? AND r.deleted_at IS NULL ORDER BY r.id DESC LIMIT 1`, messageId)
  return last?.kind === 'clarification' && last.member_kind === 'agent'
}

/**
 * The rules for replying, checked on their own so a route can refuse before it stores an upload. Returns the status the message takes.
 * `mentions`: the reply mentions someone (UD-277). The sender of a message does not answer it (§4.8), but may write in its thread to call a member: a
 * reply of the sender that mentions someone is a request, not an answer, so it does not count as one and the message goes back to `open`.
 */
export function assertCanReply (db, messageId, authorId, { mentions = false } = {}) {
  const msgRow = get(db, 'SELECT id, author_id, status FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
  if (!msgRow) throw notFound('El mensaje no existe.')
  // §4.8: only a member other than the sender replies; the exceptions are the sender who received the handoff of a session (UD-269) and the sender who mentions someone (UD-277).
  const sender = msgRow.author_id === authorId
  const asksOnly = sender && !holdsPendingQuestion(db, messageId, authorId)
  if (asksOnly && !mentions) throw forbidden('El emisor de un mensaje no puede responderlo.', 'author_cannot_reply')
  const target = TRANSITIONS.reply[msgRow.status]
  if (!target) throw conflict('El mensaje está cerrado. Hay que reabrirlo para responder.', 'message_closed')
  return asksOnly ? 'open' : target
}

/**
 * Adds a reply. `files` ([{ kind, name, mime, size, sha256 }], already in the volume) and `links` (validated URLs)
 * are attached to the reply; a reply with media may have no text.
 */
export function addReply ({ db, events, now = Date.now }, { messageId, authorId, body = '', kind = 'answer', files = [], links = [], mentionIds = [] }) {
  if (typeof body !== 'string' || (body.trim() === '' && files.length + links.length === 0)) throw badRequest('La respuesta no puede estar vacía.', 'reply_empty')
  if (!WRITABLE_REPLY_KINDS.includes(kind)) throw badRequest('Tipo de respuesta desconocido.', 'reply_kind_invalid')
  const replyId = events.transaction(() => {
    const mentions = checkMentions(db, { authorId, ids: mentionIds }) // UD-277: picked from the list, validated here; nothing reads the text
    const target = assertCanReply(db, messageId, authorId, { mentions: mentions.length > 0 })
    const r = run(db, 'INSERT INTO replies (message_id, author_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?)', messageId, authorId, body, kind, now())
    const id = Number(r.lastInsertRowid)
    let position = 0
    for (const f of files) {
      const a = run(db, 'INSERT INTO reply_attachments (reply_id, kind, name, path, mime, size, sha256, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, f.kind, f.name, f.sha256, f.mime, f.size, f.sha256, position++)
      if (SPOKEN_KINDS.includes(f.kind)) enqueueReplyExtract(db, { messageId, replyAttachmentId: Number(a.lastInsertRowid), now }) // UD-278: the speech becomes text, without holding up the reply
    }
    for (const url of links) {
      // For kind = link, `path` holds the URL and the hash identifies it, as in `attachments`.
      run(db, "INSERT INTO reply_attachments (reply_id, kind, name, path, mime, size, sha256, position) VALUES (?, 'link', ?, ?, 'text/uri-list', 0, ?, ?)", id, url, url, createHash('sha256').update(url).digest('hex'), position++)
    }
    run(db, 'UPDATE messages SET status = ? WHERE id = ?', target, messageId)
    audit(db, { memberId: authorId, action: 'message.reply', entity: 'message', entityId: messageId, detail: { kind, attachments: files.length + links.length }, now })
    recordMentions({ db, events, now }, { messageId, replyId: id, authorId, mentions })
    return id
  })
  return { replyId, message: getMessage(db, messageId) }
}

export function closeMessage ({ db, events, now = Date.now }, messageId, actorId = null) {
  events.transaction(() => {
    const msgRow = get(db, 'SELECT status FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
    if (!msgRow) throw notFound('El mensaje no existe.')
    const target = TRANSITIONS.close[msgRow.status]
    if (!target) throw conflict('El mensaje ya está cerrado.', 'already_closed')
    run(db, 'UPDATE messages SET status = ?, closed_at = ? WHERE id = ?', target, now(), messageId)
    audit(db, { memberId: actorId, action: 'message.close', entity: 'message', entityId: messageId, now })
  })
  return getMessage(db, messageId)
}

export function reopenMessage ({ db, events, now = Date.now }, messageId, actorId = null) {
  events.transaction(() => {
    const msgRow = get(db, 'SELECT status FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
    if (!msgRow) throw notFound('El mensaje no existe.')
    if (!(msgRow.status in TRANSITIONS.reopen)) throw conflict('El mensaje no está cerrado.', 'not_closed')
    run(db, 'UPDATE messages SET status = ?, closed_at = NULL WHERE id = ?', liveReplyCount(db, messageId) > 0 ? 'answered' : 'open', messageId)
    audit(db, { memberId: actorId, action: 'message.reopen', entity: 'message', entityId: messageId, now })
  })
  return getMessage(db, messageId)
}

/**
 * Access control for an attachment (§7.1: «file, with access control»): the input's author reads it and, once
 * published in some message, the whole team does (messages are visible to everyone, §6).
 */
export function canReadAttachment (db, memberId, attachmentId) {
  // A message that was deleted no longer publishes its attachments to the team; the input's author still reads them.
  const dbRow = get(db, `
    SELECT 1 AS ok FROM attachments a LEFT JOIN inputs i ON i.id = a.input_id
     WHERE a.id = ? AND (i.author_id = ? OR EXISTS (SELECT 1 FROM message_attachments ma JOIN messages m ON m.id = ma.message_id
                                                     WHERE ma.attachment_id = a.id AND m.deleted_at IS NULL))`, attachmentId, memberId)
  return Boolean(dbRow)
}

/**
 * A reply attachment is readable by every member with a session: messages and their threads are visible to the whole
 * team (§6). Once the reply or its message is deleted, nobody reads it (UD-240).
 */
export const canReadReplyAttachment = (db, attachmentId) => Boolean(get(db, `
  SELECT 1 AS ok FROM reply_attachments ra JOIN replies r ON r.id = ra.reply_id JOIN messages m ON m.id = r.message_id
   WHERE ra.id = ? AND r.deleted_at IS NULL AND m.deleted_at IS NULL`, attachmentId))

// ---------------------------------------------------------------- deletion and restoration (UD-240)

const liveReplyCount = (db, messageId) => get(db, 'SELECT COUNT(*) AS n FROM replies WHERE message_id = ? AND deleted_at IS NULL', messageId).n

/**
 * The state a message must have from its live replies and its closing mark (UD-042): a closed one stays closed; otherwise
 * `answered` with one live reply or more and `open` without any. Deleting or restoring a reply calls it.
 */
function recomputeStatus (db, messageId) {
  const msgRow = get(db, 'SELECT status, closed_at FROM messages WHERE id = ?', messageId)
  if (!msgRow || msgRow.closed_at !== null) return
  const target = liveReplyCount(db, messageId) > 0 ? 'answered' : 'open'
  if (target !== msgRow.status) run(db, 'UPDATE messages SET status = ? WHERE id = ?', target, messageId)
}

/** Who may delete and restore a message: its sender or an Editor (UD-240). */
function assertMessageOwner (row, actor) {
  if (row.author_id !== actor.id && actor.role !== 'editor') throw forbidden('Sólo quien envió el mensaje o un Editor puede borrarlo.', 'not_message_author')
}

/** Soft-deletes a message. 404 when it does not exist or is already deleted; 403 `not_message_author` for anyone else. */
export function deleteMessage ({ db, events, now = Date.now }, { messageId, actor }) {
  events.transaction(() => {
    const row = get(db, 'SELECT id, author_id FROM messages WHERE id = ? AND deleted_at IS NULL', messageId)
    if (!row) throw notFound('El mensaje no existe.')
    assertMessageOwner(row, actor)
    run(db, 'UPDATE messages SET deleted_at = ? WHERE id = ?', now(), messageId)
    audit(db, { memberId: actor.id, action: 'message.delete', entity: 'message', entityId: messageId, now })
  })
}

/** Brings a deleted message back, with its thread as it was. 409 `not_deleted` if it is not deleted. Returns the detail. */
export function restoreMessage ({ db, events, now = Date.now }, { messageId, actor }) {
  events.transaction(() => {
    const row = get(db, 'SELECT id, author_id, deleted_at FROM messages WHERE id = ?', messageId)
    if (!row) throw notFound('El mensaje no existe.')
    assertMessageOwner(row, actor)
    if (row.deleted_at === null) throw conflict('El mensaje no está borrado.', 'not_deleted')
    run(db, 'UPDATE messages SET deleted_at = NULL WHERE id = ?', messageId)
    audit(db, { memberId: actor.id, action: 'message.restore', entity: 'message', entityId: messageId, now })
  })
  return getMessage(db, messageId)
}

/**
 * The rows of `ids` for a bulk operation (UD-253), all or nothing: 403 `not_message_author` with the ids the actor may not touch,
 * then 404 with the ids that do not exist (or, when `deleted` is false, are already deleted). Duplicates count once.
 */
function bulkRows (db, ids, actor, { deleted }) {
  const unique = [...new Set(ids.map(Number))]
  const rows = unique.map((id) => get(db, 'SELECT id, author_id, deleted_at FROM messages WHERE id = ?', id) ?? { id, missing: true })
  const refused = rows.filter((r) => !r.missing && r.author_id !== actor.id && actor.role !== 'editor').map((r) => String(r.id))
  if (refused.length) throw new AppError(403, 'not_message_author', 'Sólo quien envió el mensaje o un Editor puede borrarlo.', { ids: refused })
  const missing = rows.filter((r) => r.missing || (!deleted && r.deleted_at !== null)).map((r) => String(r.id))
  if (missing.length) throw new AppError(404, 'not_found', 'Algunos mensajes no existen.', { ids: missing })
  if (deleted) {
    const live = rows.filter((r) => r.deleted_at === null).map((r) => String(r.id))
    if (live.length) throw conflict('Algunos mensajes no están borrados.', 'not_deleted', { ids: live })
  }
  return unique
}

/** Soft-deletes several messages in one transaction (UD-253): every one or none. One `message.delete` audit row per message. */
export function deleteMessages ({ db, events, now = Date.now }, { ids, actor }) {
  return events.transaction(() => {
    const unique = bulkRows(db, ids, actor, { deleted: false })
    const at = now()
    for (const id of unique) {
      run(db, 'UPDATE messages SET deleted_at = ? WHERE id = ?', at, id)
      audit(db, { memberId: actor.id, action: 'message.delete', entity: 'message', entityId: id, detail: { bulk: unique.length }, now })
    }
    return unique.map(String)
  })
}

/** Brings several deleted messages back in one transaction (UD-253): every one or none. One `message.restore` audit row per message. */
export function restoreMessages ({ db, events, now = Date.now }, { ids, actor }) {
  return events.transaction(() => {
    const unique = bulkRows(db, ids, actor, { deleted: true })
    for (const id of unique) {
      run(db, 'UPDATE messages SET deleted_at = NULL WHERE id = ?', id)
      audit(db, { memberId: actor.id, action: 'message.restore', entity: 'message', entityId: id, detail: { bulk: unique.length }, now })
    }
    return unique.map(String)
  })
}

/** Who may delete and restore a reply: its author or an Editor (UD-240). */
function assertReplyOwner (row, actor) {
  if (row.author_id !== actor.id && actor.role !== 'editor') throw forbidden('Sólo quien escribió la respuesta o un Editor puede borrarla.', 'not_reply_author')
}

/**
 * Soft-deletes a reply of a message and recomputes the message's state: `answered` goes back to `open` when no live
 * reply remains and the message is not closed. 404 when the message or the reply does not exist, is deleted, or the
 * reply belongs to another message. Returns the message detail.
 */
export function deleteReply ({ db, events, now = Date.now }, { messageId, replyId, actor }) {
  events.transaction(() => {
    const row = get(db, `
      SELECT r.id, r.author_id FROM replies r JOIN messages m ON m.id = r.message_id
       WHERE r.id = ? AND r.message_id = ? AND r.deleted_at IS NULL AND m.deleted_at IS NULL`, replyId, messageId)
    if (!row) throw notFound('La respuesta no existe.')
    assertReplyOwner(row, actor)
    run(db, 'UPDATE replies SET deleted_at = ? WHERE id = ?', now(), replyId)
    recomputeStatus(db, messageId)
    audit(db, { memberId: actor.id, action: 'reply.delete', entity: 'reply', entityId: replyId, detail: { message_id: messageId }, now })
  })
  return getMessage(db, messageId)
}

/**
 * In-place edit of the text of a reply by its author (UD-253, H-3714), modeled on `updateMessage`: ONLY the author
 * edits, not an Editor (403 `not_reply_author`). `version` is the version the client read; a stale one is a 409
 * `edit_conflict` carrying the current `version`. The attachments stay as they are; a reply with attachments may be
 * left without text, one without them may not (400 `reply_empty`). The same text again changes nothing. A real edit
 * bumps `version`, sets `edited_at` and leaves a `reply.edit` audit row. 404 when the message or the reply does not
 * exist, is deleted, or the reply belongs to another message. Returns the message detail.
 */
export function updateReply ({ db, events, now = Date.now }, { messageId, replyId, actor, body, version, mentionIds = [], removeAttachmentIds = [], onRemoved = null }) {
  events.transaction(() => {
    const row = get(db, `
      SELECT r.id, r.author_id, r.body, r.version FROM replies r JOIN messages m ON m.id = r.message_id
       WHERE r.id = ? AND r.message_id = ? AND r.deleted_at IS NULL AND m.deleted_at IS NULL`, replyId, messageId)
    if (!row) throw notFound('La respuesta no existe.')
    if (row.author_id !== actor.id) throw forbidden('Sólo quien escribió la respuesta puede editarla.', 'not_reply_author')
    if (version !== row.version) {
      throw new AppError(409, 'edit_conflict', 'La respuesta cambió desde que la abriste; vuelve a cargarla.', { version: row.version })
    }
    const fields = []
    const nextBody = body === undefined ? row.body : body
    if (nextBody !== row.body) fields.push('body')
    // UD-278: the author takes attachments off their reply; the rows go and the files that nothing else references are freed after the transaction.
    const removed = []
    for (const raw of removeAttachmentIds) {
      const att = get(db, 'SELECT id, sha256, kind FROM reply_attachments WHERE id = ? AND reply_id = ?', raw, replyId)
      if (!att) throw notFound('El adjunto no existe en esta respuesta.')
      if (removed.some((x) => x.id === att.id)) continue
      removed.push(att)
    }
    if (removed.length) fields.push('attachment_ids')
    // UD-278: a mention added by editing has the effects of a mention at writing, only for the member who was not mentioned yet.
    const already = new Set(all(db, 'SELECT member_id FROM reply_mentions WHERE reply_id = ?', replyId).map((r) => r.member_id))
    const fresh = checkMentions(db, { authorId: actor.id, ids: mentionIds }).filter((m) => !already.has(m.id))
    if (fresh.length) fields.push('mentions')
    if (fields.length === 0) return
    const left = get(db, 'SELECT COUNT(*) AS n FROM reply_attachments WHERE reply_id = ?', replyId).n - removed.length
    if (nextBody.trim() === '' && left === 0) throw badRequest('La respuesta no puede estar vacía.', 'reply_empty')
    for (const a of removed) run(db, 'DELETE FROM reply_attachments WHERE id = ?', a.id)
    const next = row.version + 1
    run(db, 'UPDATE replies SET body = ?, edited_at = ?, version = ? WHERE id = ?', nextBody, now(), next, replyId)
    audit(db, { memberId: actor.id, action: 'reply.edit', entity: 'reply', entityId: replyId, detail: { message_id: messageId, version: next, fields }, now })
    if (fresh.length) recordMentions({ db, events, now }, { messageId, replyId, authorId: actor.id, mentions: fresh })
    if (removed.length) onRemoved?.(removed.map((a) => a.sha256))
  })
  return getMessage(db, messageId)
}

/**
 * Adds files and links to a reply that already exists (UD-278): only its author, with the version read. Audio and video go to be read like at writing.
 * It counts as one edit of the reply (version, `edited_at`, `reply.edit` with `fields: ['attachment_ids']`).
 */
export function addReplyAttachments ({ db, events, now = Date.now }, { messageId, replyId, actor, version, files = [], links = [] }) {
  if (files.length + links.length === 0) throw badRequest('Falta un archivo o un enlace.', 'attachments_empty')
  events.transaction(() => {
    const row = get(db, `
      SELECT r.id, r.author_id, r.version FROM replies r JOIN messages m ON m.id = r.message_id
       WHERE r.id = ? AND r.message_id = ? AND r.deleted_at IS NULL AND m.deleted_at IS NULL`, replyId, messageId)
    if (!row) throw notFound('La respuesta no existe.')
    if (row.author_id !== actor.id) throw forbidden('Sólo quien escribió la respuesta puede editarla.', 'not_reply_author')
    if (version !== row.version) throw new AppError(409, 'edit_conflict', 'La respuesta cambió desde que la abriste; vuelve a cargarla.', { version: row.version })
    let position = get(db, 'SELECT COALESCE(MAX(position), -1) AS p FROM reply_attachments WHERE reply_id = ?', replyId).p + 1
    for (const f of files) {
      const a = run(db, 'INSERT INTO reply_attachments (reply_id, kind, name, path, mime, size, sha256, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', replyId, f.kind, f.name, f.sha256, f.mime, f.size, f.sha256, position++)
      if (SPOKEN_KINDS.includes(f.kind)) enqueueReplyExtract(db, { messageId, replyAttachmentId: Number(a.lastInsertRowid), now })
    }
    for (const url of links) {
      run(db, "INSERT INTO reply_attachments (reply_id, kind, name, path, mime, size, sha256, position) VALUES (?, 'link', ?, ?, 'text/uri-list', 0, ?, ?)", replyId, url, url, createHash('sha256').update(url).digest('hex'), position++)
    }
    const next = row.version + 1
    run(db, 'UPDATE replies SET edited_at = ?, version = ? WHERE id = ?', now(), next, replyId)
    audit(db, { memberId: actor.id, action: 'reply.edit', entity: 'reply', entityId: replyId, detail: { message_id: messageId, version: next, fields: ['attachment_ids'], added: files.length + links.length }, now })
  })
  return getMessage(db, messageId)
}

/** Brings a deleted reply back and recomputes the state of its message. 409 `not_deleted` if it is not deleted. Returns the message detail. */
export function restoreReply ({ db, events, now = Date.now }, { replyId, actor }) {
  const messageId = events.transaction(() => {
    const row = get(db, `
      SELECT r.id, r.author_id, r.message_id, r.deleted_at FROM replies r JOIN messages m ON m.id = r.message_id
       WHERE r.id = ? AND m.deleted_at IS NULL`, replyId)
    if (!row) throw notFound('La respuesta no existe.')
    assertReplyOwner(row, actor)
    if (row.deleted_at === null) throw conflict('La respuesta no está borrada.', 'not_deleted')
    run(db, 'UPDATE replies SET deleted_at = NULL WHERE id = ?', replyId)
    recomputeStatus(db, row.message_id)
    audit(db, { memberId: actor.id, action: 'reply.restore', entity: 'reply', entityId: replyId, detail: { message_id: row.message_id }, now })
    return row.message_id
  })
  return getMessage(db, messageId)
}
