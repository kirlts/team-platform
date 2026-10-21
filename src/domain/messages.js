// Messages, replies and statuses (MASTER-SPEC §1.1, §4.8).
//
// Statuses of a message: open → answered → closed.
//   - Only a member other than the sender replies (403). This layer enforces it, not the panel.
//   - Any member closes or reopens.
//   - Reopening returns to `answered` if the message already has replies, and to `open` if not.
// Table of `status` transitions; any other is a 409.

import { all, get, run } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'
import { audit } from './audit.js'
import { badRequest, conflict, forbidden, notFound } from './errors.js'

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
    SELECT ma.message_id, a.id, a.input_id, a.kind, a.name, a.mime, a.size
      FROM message_attachments ma JOIN attachments a ON a.id = ma.attachment_id
     WHERE ma.message_id IN (${placeholders}) ORDER BY ma.message_id, ma.position, a.id`, ...ids)
  const table = new Map()
  for (const f of rows) {
    if (!table.has(f.message_id)) table.set(f.message_id, [])
    table.get(f.message_id).push({ id: f.id, input_id: f.input_id, kind: f.kind, name: f.name, mime: f.mime, size: f.size })
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

const toReply = (r) => ({ id: r.id, message_id: r.message_id, author_id: r.author_id, body: r.body, kind: r.kind, created_at: iso(r.created_at) })

function lastRepliesOf (db, ids) {
  if (ids.length === 0) return new Map()
  const placeholders = ids.map(() => '?').join(',')
  const rows = all(db, `
    SELECT r.* FROM replies r
     WHERE r.message_id IN (${placeholders}) AND r.id = (SELECT MAX(x.id) FROM replies x WHERE x.message_id = r.message_id)`, ...ids)
  return new Map(rows.map((r) => [r.message_id, toReply(r)]))
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
    reply_count: f.reply_count,
    last_reply: lastReplies.get(f.id) ?? null,
    created_at: iso(f.created_at),
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

export function getMessage (db, id) {
  const dbRow = get(db, `${SELECT_MESSAGE} WHERE m.id = ?`, id)
  if (!dbRow) throw notFound('El mensaje no existe.')
  const [msgRow] = hydrate(db, [dbRow])
  const replyRows = all(db, 'SELECT * FROM replies WHERE message_id = ? ORDER BY id', id)
  return { ...msgRow, replies: replyRows.map(toReply) }
}

export function addReply ({ db, events, now = Date.now }, { messageId, authorId, body, kind = 'answer' }) {
  if (typeof body !== 'string' || body.trim() === '') throw badRequest('La respuesta no puede estar vacía.', 'reply_empty')
  if (!REPLY_KINDS.includes(kind)) throw badRequest('Tipo de respuesta desconocido.', 'reply_kind_invalid')
  const replyId = events.transaction(() => {
    const msgRow = get(db, 'SELECT id, author_id, status FROM messages WHERE id = ?', messageId)
    if (!msgRow) throw notFound('El mensaje no existe.')
    // §4.8: only a member other than the sender replies.
    if (msgRow.author_id === authorId) throw forbidden('El emisor de un mensaje no puede responderlo.', 'author_cannot_reply')
    const target = TRANSITIONS.reply[msgRow.status]
    if (!target) throw conflict('El mensaje está cerrado. Hay que reabrirlo para responder.', 'message_closed')
    const r = run(db, 'INSERT INTO replies (message_id, author_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?)', messageId, authorId, body, kind, now())
    run(db, 'UPDATE messages SET status = ? WHERE id = ?', target, messageId)
    audit(db, { memberId: authorId, action: 'message.reply', entity: 'message', entityId: messageId, detail: { kind }, now })
    return Number(r.lastInsertRowid)
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

