// Messages, replies and statuses (MASTER-SPEC §1.1, §4.8).
//
// Statuses of a message: open → answered → closed.
//   - Only a member other than the sender replies (403). This layer enforces it, not the panel.
//   - Any member closes or reopens.
//   - Reopening returns to `answered` if the message already has replies, and to `open` if not.
// Table of `status` transitions; any other is a 409.

import { createHash } from 'node:crypto'
import { all, get, run } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'
import { audit } from './audit.js'
import { AppError, badRequest, conflict, forbidden, notFound } from './errors.js'
import { checkAssignees, checkFields, newValidatorCache, resolveAreaAndTemplate, withoutNulls } from './validation.js'
import { loadTemplate } from './areas.js'

export const MESSAGE_STATUSES = ['open', 'answered', 'closed']
export const REPLY_KINDS = ['answer', 'fix', 'clarification']

const TRANSITIONS = {
  reply: { open: 'answered', answered: 'answered' }, // a closed message receives no replies until it is reopened
  close: { open: 'closed', answered: 'closed' },
  reopen: { closed: null } // the destination depends on whether it has replies
}

const escapeLike = (q) => q.replace(/[\\%_]/g, (c) => `\\${c}`)

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
  const rows = all(db, `SELECT id, reply_id, kind, name, mime, size FROM reply_attachments
                         WHERE reply_id IN (${replyIds.map(() => '?').join(',')}) ORDER BY reply_id, position, id`, ...replyIds)
  for (const f of rows) {
    if (!table.has(f.reply_id)) table.set(f.reply_id, [])
    table.get(f.reply_id).push({ id: f.id, reply_id: f.reply_id, kind: f.kind, name: f.name, mime: f.mime, size: f.size, extracted: f.extracted_at !== null && f.extracted_at !== undefined })
  }
  return table
}

const toReply = (r, atts = []) => ({
  id: r.id, message_id: r.message_id, author_id: r.author_id, body: r.body, kind: r.kind,
  attachments: atts, attachment_kinds: [...new Set(atts.map((a) => a.kind))], // one icon per media kind (UD-016)
  created_at: iso(r.created_at)
})

function lastRepliesOf (db, ids) {
  if (ids.length === 0) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const rows = all(db, `
    SELECT r.* FROM replies r
     WHERE r.message_id IN (${placeholders}) AND r.id = (SELECT MAX(x.id) FROM replies x WHERE x.message_id = r.message_id)`, ...ids)
  const atts = replyAttachmentsOf(db, rows.map((r) => r.id))
  return new Map(rows.map((r) => [r.message_id, toReply(r, atts.get(r.id))]))
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
    closed_at: iso(f.closed_at)
  }))
}

const SELECT_MESSAGE = `
  SELECT m.*, (SELECT COUNT(*) FROM replies r WHERE r.message_id = m.id) AS reply_count
    FROM messages m`

/**
 * List of the team's messages (everyone sees everything, §6). Filters: `for` (me or a member id: assigned to),
 * `area`, `status`, `q` (substring in title or text) and `replies` (only with replies; with `for`, those
 * that involve that person as sender, assignee or author of a reply). Returns { items, total }.
 */
export function listMessages (db, { viewerId, forMember = null, area = null, status = null, q = null, replies = false, limit, offset = 0 }) {
  const scope = []
  const params = []
  const memberRow = forMember === 'me' ? viewerId : forMember
  if (memberRow !== null && memberRow !== undefined) {
    if (replies) {
      scope.push(`(m.author_id = ? OR EXISTS (SELECT 1 FROM message_assignees x WHERE x.message_id = m.id AND x.member_id = ?)
                   OR EXISTS (SELECT 1 FROM replies r WHERE r.message_id = m.id AND r.author_id = ?))`)
      params.push(memberRow, memberRow, memberRow)
    } else {
      scope.push('EXISTS (SELECT 1 FROM message_assignees x WHERE x.message_id = m.id AND x.member_id = ?)')
      params.push(memberRow)
    }
  }
  if (area !== null) { scope.push('m.area_id = ?'); params.push(area) }
  if (status !== null) { scope.push('m.status = ?'); params.push(status) }
  if (q) {
    scope.push("(m.title LIKE ? ESCAPE '\\' OR m.body LIKE ? ESCAPE '\\')")
    params.push(`%${escapeLike(q)}%`, `%${escapeLike(q)}%`)
  }
  if (replies) scope.push('EXISTS (SELECT 1 FROM replies r WHERE r.message_id = m.id)')
  const cond = scope.length ? `WHERE ${scope.join(' AND ')}` : ''

  const orderBy = replies
    ? '(SELECT MAX(r.created_at) FROM replies r WHERE r.message_id = m.id) DESC, m.id DESC'
    : 'm.created_at DESC, m.id DESC'
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
      FROM messages m WHERE m.status <> 'closed'`, memberId, memberId)
  const mine = { open: 0, answered: 0, total: 0 }
  // The same messages that are counted, one by one: the panel lists exactly what adds up (J2-A-43).
  const items = []
  for (const r of rows) {
    const status = r.assigned || (r.authored && r.status === 'answered') ? r.status : null
    if (status) { mine[status]++; mine.total++; items.push({ message_id: String(r.id), title: r.title, status, at: r.created_at }) }
  }
  const rank = { open: 0, answered: 1 }
  items.sort((a, b) => rank[a.status] - rank[b.status] || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  const count = (status) => `(SELECT COUNT(*) FROM messages m WHERE m.area_id = a.id AND m.status = '${status}')`
  const areas = all(db, `
    SELECT a.id AS area_id, ${count('open')} AS open, ${count('answered')} AS answered, ${count('closed')} AS closed,
           (SELECT COUNT(*) FROM messages m WHERE m.area_id = a.id AND m.status = 'open'
               AND EXISTS (SELECT 1 FROM message_assignees x WHERE x.message_id = m.id AND x.member_id = ?)) AS mine_open
      FROM areas a WHERE a.deleted_at IS NULL ORDER BY a.position, a.id`, memberId)
  return { mine, items, areas }
}

export function getMessage (db, id) {
  const dbRow = get(db, `${SELECT_MESSAGE} WHERE m.id = ?`, id)
  if (!dbRow) throw notFound('El mensaje no existe.')
  const [msgRow] = hydrate(db, [dbRow])
  const replyRows = all(db, 'SELECT * FROM replies WHERE message_id = ? ORDER BY id', id)
  const atts = replyAttachmentsOf(db, replyRows.map((r) => r.id))
  const edits = all(db, 'SELECT * FROM message_edits WHERE message_id = ? ORDER BY id', id)
    .map((e) => ({ id: e.id, member_id: e.member_id, at: iso(e.at), version: e.version, fields: parseJson(e.fields_json, []) }))
  return { ...msgRow, replies: replyRows.map((r) => toReply(r, atts.get(r.id))), edits }
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
    const row = get(db, 'SELECT * FROM messages WHERE id = ?', messageId)
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

/** The rules for replying, checked on their own so a route can refuse before it stores an upload. */
export function assertCanReply (db, messageId, authorId) {
  const msgRow = get(db, 'SELECT id, author_id, status FROM messages WHERE id = ?', messageId)
  if (!msgRow) throw notFound('El mensaje no existe.')
  // §4.8: only a member other than the sender replies.
  if (msgRow.author_id === authorId) throw forbidden('El emisor de un mensaje no puede responderlo.', 'author_cannot_reply')
  const target = TRANSITIONS.reply[msgRow.status]
  if (!target) throw conflict('El mensaje está cerrado. Hay que reabrirlo para responder.', 'message_closed')
  return target
}

/**
 * Adds a reply. `files` ([{ kind, name, mime, size, sha256 }], already in the volume) and `links` (validated URLs)
 * are attached to the reply; a reply with media may have no text.
 */
export function addReply ({ db, events, now = Date.now }, { messageId, authorId, body = '', kind = 'answer', files = [], links = [] }) {
  if (typeof body !== 'string' || (body.trim() === '' && files.length + links.length === 0)) throw badRequest('La respuesta no puede estar vacía.', 'reply_empty')
  if (!REPLY_KINDS.includes(kind)) throw badRequest('Tipo de respuesta desconocido.', 'reply_kind_invalid')
  const replyId = events.transaction(() => {
    const target = assertCanReply(db, messageId, authorId)
    const r = run(db, 'INSERT INTO replies (message_id, author_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?)', messageId, authorId, body, kind, now())
    const id = Number(r.lastInsertRowid)
    let position = 0
    for (const f of files) {
      run(db, 'INSERT INTO reply_attachments (reply_id, kind, name, path, mime, size, sha256, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, f.kind, f.name, f.sha256, f.mime, f.size, f.sha256, position++)
    }
    for (const url of links) {
      // For kind = link, `path` holds the URL and the hash identifies it, as in `attachments`.
      run(db, "INSERT INTO reply_attachments (reply_id, kind, name, path, mime, size, sha256, position) VALUES (?, 'link', ?, ?, 'text/uri-list', 0, ?, ?)", id, url, url, createHash('sha256').update(url).digest('hex'), position++)
    }
    run(db, 'UPDATE messages SET status = ? WHERE id = ?', target, messageId)
    audit(db, { memberId: authorId, action: 'message.reply', entity: 'message', entityId: messageId, detail: { kind, attachments: files.length + links.length }, now })
    return id
  })
  return { replyId, message: getMessage(db, messageId) }
}

export function closeMessage ({ db, events, now = Date.now }, messageId, actorId = null) {
  events.transaction(() => {
    const msgRow = get(db, 'SELECT status FROM messages WHERE id = ?', messageId)
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
    const msgRow = get(db, 'SELECT status FROM messages WHERE id = ?', messageId)
    if (!msgRow) throw notFound('El mensaje no existe.')
    if (!(msgRow.status in TRANSITIONS.reopen)) throw conflict('El mensaje no está cerrado.', 'not_closed')
    const { n } = get(db, 'SELECT COUNT(*) AS n FROM replies WHERE message_id = ?', messageId)
    run(db, 'UPDATE messages SET status = ?, closed_at = NULL WHERE id = ?', n > 0 ? 'answered' : 'open', messageId)
    audit(db, { memberId: actorId, action: 'message.reopen', entity: 'message', entityId: messageId, now })
  })
  return getMessage(db, messageId)
}

/**
 * Access control for an attachment (§7.1: «file, with access control»): the input's author reads it and, once
 * published in some message, the whole team does (messages are visible to everyone, §6).
 */
export function canReadAttachment (db, memberId, attachmentId) {
  const dbRow = get(db, `
    SELECT 1 AS ok FROM attachments a JOIN inputs i ON i.id = a.input_id
     WHERE a.id = ? AND (i.author_id = ? OR EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id = a.id))`, attachmentId, memberId)
  return Boolean(dbRow)
}


/** A reply attachment is readable by every member with a session: messages and their threads are visible to the whole team (§6). */
export const canReadReplyAttachment = (db, attachmentId) => Boolean(get(db, 'SELECT 1 AS ok FROM reply_attachments WHERE id = ?', attachmentId))
