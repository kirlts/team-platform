// Mensajes, respuestas y estados (MASTER-SPEC §1.1, §4.8).
//
// Estados de un mensaje: abierto (open) → respondido (answered) → cerrado (closed).
//   - Sólo un miembro distinto del emisor responde (403). Lo hace cumplir esta capa, no el panel.
//   - Cualquier miembro cierra o reabre.
//   - Reabrir devuelve a `answered` si el mensaje ya tiene respuestas, y a `open` si no.
// Tabla de transiciones de `status`; cualquier otra es 409.

import { all, get, run } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'
import { audit } from './audit.js'
import { badRequest, conflict, forbidden, notFound } from './errors.js'

export const MESSAGE_STATUSES = ['open', 'answered', 'closed']
export const REPLY_KINDS = ['answer', 'fix', 'clarification']

const TRANSICIONES = {
  reply: { open: 'answered', answered: 'answered' }, // un mensaje cerrado no recibe respuestas hasta reabrirse
  close: { open: 'closed', answered: 'closed' },
  reopen: { closed: null } // el destino depende de si tiene respuestas
}

const escaparLike = (q) => q.replace(/[\\%_]/g, (c) => `\\${c}`)

function adjuntosDe (db, ids) {
  if (ids.length === 0) return new Map()
  const marcas = ids.map(() => '?').join(',')
  const filas = all(db, `
    SELECT ma.message_id, a.id, a.input_id, a.kind, a.name, a.mime, a.size
      FROM message_attachments ma JOIN attachments a ON a.id = ma.attachment_id
     WHERE ma.message_id IN (${marcas}) ORDER BY ma.message_id, ma.position, a.id`, ...ids)
  const mapa = new Map()
  for (const f of filas) {
    if (!mapa.has(f.message_id)) mapa.set(f.message_id, [])
    mapa.get(f.message_id).push({ id: f.id, input_id: f.input_id, kind: f.kind, name: f.name, mime: f.mime, size: f.size })
  }
  return mapa
}

function asignadosDe (db, ids) {
  if (ids.length === 0) return new Map()
  const marcas = ids.map(() => '?').join(',')
  const filas = all(db, `SELECT message_id, member_id FROM message_assignees WHERE message_id IN (${marcas}) ORDER BY message_id, member_id`, ...ids)
  const mapa = new Map()
  for (const f of filas) {
    if (!mapa.has(f.message_id)) mapa.set(f.message_id, [])
    mapa.get(f.message_id).push(f.member_id)
  }
  return mapa
}

const toReply = (r) => ({ id: r.id, message_id: r.message_id, author_id: r.author_id, body: r.body, kind: r.kind, created_at: iso(r.created_at) })

function ultimasRespuestas (db, ids) {
  if (ids.length === 0) return new Map()
  const marcas = ids.map(() => '?').join(',')
  const filas = all(db, `
    SELECT r.* FROM replies r
     WHERE r.message_id IN (${marcas}) AND r.id = (SELECT MAX(x.id) FROM replies x WHERE x.message_id = r.message_id)`, ...ids)
  return new Map(filas.map((r) => [r.message_id, toReply(r)]))
}

/** Forma plana que consume el panel: referencias por id; los nombres salen de las listas de miembros y áreas. */
function hidratar (db, filas) {
  const ids = filas.map((f) => f.id)
  const adjuntos = adjuntosDe(db, ids)
  const asignados = asignadosDe(db, ids)
  const ultimas = ultimasRespuestas(db, ids)
  return filas.map((f) => ({
    id: f.id,
    input_id: f.input_id,
    area_id: f.area_id,
    template_id: f.template_id,
    author_id: f.author_id,
    title: f.title,
    body: f.body,
    fields: parseJson(f.fields_json, {}),
    status: f.status,
    assignee_ids: asignados.get(f.id) ?? [],
    attachments: adjuntos.get(f.id) ?? [],
    reply_count: f.reply_count,
    last_reply: ultimas.get(f.id) ?? null,
    created_at: iso(f.created_at),
    closed_at: iso(f.closed_at)
  }))
}

const SELECT_MENSAJE = `
  SELECT m.*, (SELECT COUNT(*) FROM replies r WHERE r.message_id = m.id) AS reply_count
    FROM messages m`

/**
 * Lista de mensajes del equipo (todos ven todos, §6). Filtros: `for` (me o id de miembro: asignado a),
 * `area`, `status`, `q` (subcadena en título o texto) y `replies` (sólo con respuestas; con `for`, los que
 * involucran a esa persona como emisor, asignada o autora de una respuesta). Devuelve { items, total }.
 */
export function listMessages (db, { viewerId, forMember = null, area = null, status = null, q = null, replies = false, limit, offset = 0 }) {
  const donde = []
  const params = []
  const miembro = forMember === 'me' ? viewerId : forMember
  if (miembro !== null && miembro !== undefined) {
    if (replies) {
      donde.push(`(m.author_id = ? OR EXISTS (SELECT 1 FROM message_assignees x WHERE x.message_id = m.id AND x.member_id = ?)
                   OR EXISTS (SELECT 1 FROM replies r WHERE r.message_id = m.id AND r.author_id = ?))`)
      params.push(miembro, miembro, miembro)
    } else {
      donde.push('EXISTS (SELECT 1 FROM message_assignees x WHERE x.message_id = m.id AND x.member_id = ?)')
      params.push(miembro)
    }
  }
  if (area !== null) { donde.push('m.area_id = ?'); params.push(area) }
  if (status !== null) { donde.push('m.status = ?'); params.push(status) }
  if (q) {
    donde.push("(m.title LIKE ? ESCAPE '\\' OR m.body LIKE ? ESCAPE '\\')")
    params.push(`%${escaparLike(q)}%`, `%${escaparLike(q)}%`)
  }
  if (replies) donde.push('EXISTS (SELECT 1 FROM replies r WHERE r.message_id = m.id)')
  const cond = donde.length ? `WHERE ${donde.join(' AND ')}` : ''

  const orden = replies
    ? '(SELECT MAX(r.created_at) FROM replies r WHERE r.message_id = m.id) DESC, m.id DESC'
    : 'm.created_at DESC, m.id DESC'
  const total = get(db, `SELECT COUNT(*) AS n FROM messages m ${cond}`, ...params).n
  const filas = all(db, `${SELECT_MENSAJE} ${cond} ORDER BY ${orden} LIMIT ? OFFSET ?`, ...params, limit, offset)
  return { items: hidratar(db, filas), total }
}

export function getMessage (db, id) {
  const fila = get(db, `${SELECT_MENSAJE} WHERE m.id = ?`, id)
  if (!fila) throw notFound('El mensaje no existe.')
  const [mensaje] = hidratar(db, [fila])
  const respuestas = all(db, 'SELECT * FROM replies WHERE message_id = ? ORDER BY id', id)
  return { ...mensaje, replies: respuestas.map(toReply) }
}

export function addReply ({ db, events, now = Date.now }, { messageId, authorId, body, kind = 'answer' }) {
  if (typeof body !== 'string' || body.trim() === '') throw badRequest('La respuesta no puede estar vacía.', 'reply_empty')
  if (!REPLY_KINDS.includes(kind)) throw badRequest('Tipo de respuesta desconocido.', 'reply_kind_invalid')
  const replyId = events.transaction(() => {
    const mensaje = get(db, 'SELECT id, author_id, status FROM messages WHERE id = ?', messageId)
    if (!mensaje) throw notFound('El mensaje no existe.')
    // §4.8: sólo un miembro distinto del emisor responde.
    if (mensaje.author_id === authorId) throw forbidden('El emisor de un mensaje no puede responderlo.', 'author_cannot_reply')
    const destino = TRANSICIONES.reply[mensaje.status]
    if (!destino) throw conflict('El mensaje está cerrado. Hay que reabrirlo para responder.', 'message_closed')
    const r = run(db, 'INSERT INTO replies (message_id, author_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?)', messageId, authorId, body, kind, now())
    run(db, 'UPDATE messages SET status = ? WHERE id = ?', destino, messageId)
    audit(db, { memberId: authorId, action: 'message.reply', entity: 'message', entityId: messageId, detail: { kind }, now })
    return Number(r.lastInsertRowid)
  })
  return { replyId, message: getMessage(db, messageId) }
}

export function closeMessage ({ db, events, now = Date.now }, messageId, actorId = null) {
  events.transaction(() => {
    const mensaje = get(db, 'SELECT status FROM messages WHERE id = ?', messageId)
    if (!mensaje) throw notFound('El mensaje no existe.')
    const destino = TRANSICIONES.close[mensaje.status]
    if (!destino) throw conflict('El mensaje ya está cerrado.', 'already_closed')
    run(db, 'UPDATE messages SET status = ?, closed_at = ? WHERE id = ?', destino, now(), messageId)
    audit(db, { memberId: actorId, action: 'message.close', entity: 'message', entityId: messageId, now })
  })
  return getMessage(db, messageId)
}

export function reopenMessage ({ db, events, now = Date.now }, messageId, actorId = null) {
  events.transaction(() => {
    const mensaje = get(db, 'SELECT status FROM messages WHERE id = ?', messageId)
    if (!mensaje) throw notFound('El mensaje no existe.')
    if (!(mensaje.status in TRANSICIONES.reopen)) throw conflict('El mensaje no está cerrado.', 'not_closed')
    const { n } = get(db, 'SELECT COUNT(*) AS n FROM replies WHERE message_id = ?', messageId)
    run(db, 'UPDATE messages SET status = ?, closed_at = NULL WHERE id = ?', n > 0 ? 'answered' : 'open', messageId)
    audit(db, { memberId: actorId, action: 'message.reopen', entity: 'message', entityId: messageId, now })
  })
  return getMessage(db, messageId)
}

/**
 * Control de acceso a un adjunto (§7.1: «archivo, con control de acceso»): lo lee el autor del input y, una
 * vez publicado en algún mensaje, todo el equipo (los mensajes son visibles para todos, §6).
 */
export function canReadAttachment (db, memberId, attachmentId) {
  const fila = get(db, `
    SELECT 1 AS ok FROM attachments a JOIN inputs i ON i.id = a.input_id
     WHERE a.id = ? AND (i.author_id = ? OR EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.attachment_id = a.id))`, attachmentId, memberId)
  return Boolean(fila)
}

