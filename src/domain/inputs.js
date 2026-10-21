// Inputs: lo que una persona envía desde la barra de Inicio (MASTER-SPEC §1.1, §1.3, §2).
//
// Estados de un input y transiciones permitidas (cualquier otra es 409):
//   queued → extracting | analyzing | failed | cancelled
//   extracting → analyzing | queued (reintento) | failed | cancelled
//   analyzing → proposed | queued (reintento) | failed | cancelled
//   proposed → published | cancelled
//   failed, cancelled → queued (el mismo input enviado de nuevo)
//   published → (final)

import { createHash } from 'node:crypto'
import { all, get, run } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'
import { audit } from './audit.js'
import { badRequest, conflict, notFound } from './errors.js'

export const INPUT_STATUSES = ['queued', 'extracting', 'analyzing', 'proposed', 'published', 'failed', 'cancelled']

const TRANSITIONS = {
  queued: ['extracting', 'analyzing', 'failed', 'cancelled'],
  extracting: ['analyzing', 'queued', 'failed', 'cancelled'],
  analyzing: ['proposed', 'queued', 'failed', 'cancelled'],
  proposed: ['published', 'cancelled', 'queued'], // queued: el editor reprocesa el análisis
  failed: ['queued'],
  cancelled: ['queued'],
  published: []
}

export const isTerminalInput = (status) => ['proposed', 'published', 'failed', 'cancelled'].includes(status)

/** Cambia el estado verificando la tabla de transiciones. Dentro de una transacción. */
export function transitionInput (db, id, to, { error = null, errorCode = null, now = Date.now } = {}) {
  const current = get(db, 'SELECT status FROM inputs WHERE id = ?', id)
  if (!current) throw notFound('El input no existe.')
  if (current.status === to) return false
  if (!TRANSITIONS[current.status].includes(to)) {
    throw conflict(`El input está «${current.status}» y no puede pasar a «${to}».`, 'invalid_transition')
  }
  run(db, 'UPDATE inputs SET status = ?, error = ?, error_code = ?, updated_at = ? WHERE id = ?', to, error, errorCode, now(), id)
  return true
}

/**
 * Hash de contenido (§1.3): el mismo texto normalizado, los mismos adjuntos por hash y el mismo emisor dan el
 * mismo input. El emisor entra en el hash porque el input es suyo: dos personas que mandan la misma captura
 * tienen cada una su propuesta y su responsabilidad como emisoras. Sin él, la segunda recibiría un input ajeno.
 * Normalización: NFC, saltos de línea \n y sin espacios en los extremos. No interpreta el texto.
 */
export function contentHash ({ authorId, text, fileHashes, links }) {
  const normal = text.normalize('NFC').replaceAll('\r\n', '\n').trim()
  const canon = JSON.stringify({ v: 1, author: authorId, text: normal, files: [...fileHashes].sort(), links: [...links].sort() })
  return createHash('sha256').update(canon).digest('hex')
}

/**
 * Registra un input y encola su análisis. Idempotente por hash. `files` ya están en el volumen:
 * [{ kind, name, mime, size, sha256 }]; `links`, URL ya validadas.
 * Devuelve { input, jobId, created, restarted }.
 */
export function submitInput ({ db, queue, events, now = Date.now }, { authorId, text, files, links }) {
  const hash = contentHash({ authorId, text, fileHashes: files.map((f) => f.sha256), links })
  return events.transaction(() => {
    const existing = get(db, 'SELECT * FROM inputs WHERE content_hash = ?', hash)
    if (existing) {
      const jobRow = queue.latestJobForInput(existing.id)
      if (existing.status === 'failed' || existing.status === 'cancelled') {
        // El mismo contenido enviado otra vez tras un fallo o una cancelación: se reintenta sobre la misma fila.
        transitionInput(db, existing.id, 'queued', { now })
        audit(db, { memberId: authorId, action: 'input.resubmit', entity: 'input', entityId: existing.id, now })
        const jobId = queue.enqueue('analyze', { input_id: existing.id }, { inputId: existing.id })
        events.publishForJob(jobId, { kind: 'progress', percent: 0, phrase: 'En cola' })
        return { input: get(db, 'SELECT * FROM inputs WHERE id = ?', existing.id), jobId, created: false, restarted: true }
      }
      return { input: existing, jobId: jobRow?.id ?? null, created: false, restarted: false }
    }
    const t = now()
    const r = run(db, 'INSERT INTO inputs (author_id, text, content_hash, status, created_at, updated_at) VALUES (?, ?, ?, \'queued\', ?, ?)', authorId, text, hash, t, t)
    const inputId = Number(r.lastInsertRowid)
    for (const f of files) {
      run(db, 'INSERT INTO attachments (input_id, kind, name, path, mime, size, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)', inputId, f.kind, f.name, f.sha256, f.mime, f.size, f.sha256)
    }
    for (const url of links) {
      // Para kind=link la columna `path` guarda la URL; el hash identifica el enlace.
      run(db, 'INSERT INTO attachments (input_id, kind, name, path, mime, size, sha256) VALUES (?, \'link\', ?, ?, \'text/uri-list\', 0, ?)',
        inputId, url, url, createHash('sha256').update(url).digest('hex'))
    }
    audit(db, { memberId: authorId, action: 'input.create', entity: 'input', entityId: inputId, detail: { atts: files.length + links.length }, now })
    const jobId = queue.enqueue('analyze', { input_id: inputId }, { inputId })
    events.publishForJob(jobId, { kind: 'progress', percent: 0, phrase: 'En cola' })
    return { input: get(db, 'SELECT * FROM inputs WHERE id = ?', inputId), jobId, created: true, restarted: false }
  })
}

const attachmentView = (a) => ({ id: a.id, input_id: a.input_id, kind: a.kind, name: a.name, mime: a.mime, size: a.size, sha256: a.sha256, extracted: a.extracted_at !== null && a.extracted_at !== undefined })

/** Ids de la propuesta como texto: el contrato de la API expone todo id como cadena. */
export function proposalView (payload) {
  const id = (v) => (v === null || v === undefined ? null : String(v))
  const listValue = (v) => (Array.isArray(v) ? v.map(String) : [])
  return {
    messages: (payload.messages ?? []).map((m) => ({
      ...m,
      area_id: id(m.area_id),
      template_id: id(m.template_id),
      assignee_ids: listValue(m.assignee_ids),
      attachment_ids: listValue(m.attachment_ids),
      unit_ids: listValue(m.unit_ids)
    })),
    discarded: (payload.discarded ?? []).map((d) => ({ unit_ids: listValue(d.unit_ids), reason: d.reason ?? '' }))
  }
}

/** Vista de un input para su emisor: adjuntos, estado, trabajo vigente, unidades y propuesta si existe. */
export function getInputView ({ db, queue, events }, inputId, memberId) {
  const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
  // Un input ajeno no se distingue de uno inexistente.
  if (!input || input.author_id !== memberId) throw notFound('El input no existe.')
  return buildInputView({ db, queue, events }, input)
}

export function buildInputView ({ db, queue, events }, input) {
  const atts = all(db, 'SELECT * FROM attachments WHERE input_id = ? ORDER BY id', input.id)
  const jobRow = queue.latestJobForInput(input.id)
  const progressRow = jobRow ? events.lastProgress(jobRow.id) : null
  const proposalObj = get(db, 'SELECT * FROM proposals WHERE input_id = ?', input.id)
  const msgRows = input.status === 'published' ? all(db, 'SELECT id FROM messages WHERE input_id = ? ORDER BY id', input.id).map((m) => m.id) : []
  return {
    id: input.id,
    author_id: input.author_id,
    text: input.text,
    status: input.status,
    error: input.error,
    error_code: input.error_code,
    created_at: iso(input.created_at),
    job_id: jobRow?.id ?? null,
    // Flat copy of the job's progress and of the proposal's size, for the tray of in-flight inputs (UD-025).
    percent: progressRow?.percent ?? null,
    phrase: progressRow?.phrase ?? null,
    proposed_count: proposalObj ? (parseJson(proposalObj.payload_json, {}).messages ?? []).length : 0,
    attachments: atts.map(attachmentView),
    job: jobRow
      ? { id: jobRow.id, status: jobRow.status, attempts: jobRow.attempts, percent: progressRow?.percent ?? null, phrase: progressRow?.phrase ?? null, last_error: jobRow.last_error }
      : null,
    units: proposalObj ? parseJson(proposalObj.units_json, []).map((u) => ({ id: String(u.id), text: u.text })) : [],
    proposal: proposalObj ? proposalView(parseJson(proposalObj.payload_json, {})) : null,
    message_ids: msgRows
  }
}

const LIST_STATUSES = new Set(INPUT_STATUSES)

/** `?status=` accepts one status or a comma-separated list; an unknown name is a 400. */
export function parseStatusFilter (raw) {
  if (raw === null || raw === undefined || raw === '') return []
  const names = [...new Set(String(raw).split(',').map((n) => n.trim()).filter(Boolean))]
  const unknown = names.filter((n) => !LIST_STATUSES.has(n))
  if (unknown.length > 0) throw badRequest(`Estado desconocido: ${unknown.join(', ')}.`, 'invalid_status')
  return names
}

/**
 * Own inputs, paginated, filtered by one or several statuses. `order` is 'desc' (newest first, the history) or
 * 'asc' (creation order, the tray of in-flight inputs where each new send lands after the previous one).
 */
export function listInputs (ctx, memberId, { status = null, limit, offset, order = 'desc' }) {
  const { db } = ctx
  const statuses = Array.isArray(status) ? status : parseStatusFilter(status)
  const cond = statuses.length > 0 ? `WHERE author_id = ? AND status IN (${statuses.map(() => '?').join(', ')})` : 'WHERE author_id = ?'
  const params = [memberId, ...statuses]
  const direction = order === 'asc' ? 'ASC' : 'DESC'
  const total = get(db, `SELECT COUNT(*) AS n FROM inputs ${cond}`, ...params).n
  const rows = all(db, `SELECT * FROM inputs ${cond} ORDER BY created_at ${direction}, id ${direction} LIMIT ? OFFSET ?`, ...params, limit, offset)
  return { total, items: rows.map((i) => buildInputView(ctx, i)) }
}

/** First `maxChars` characters of `text` without cutting a surrogate pair in half. */
function excerptOf (text, maxChars) {
  if (text.length <= maxChars) return text
  const last = text.charCodeAt(maxChars - 1)
  return text.slice(0, last >= 0xD800 && last <= 0xDBFF ? maxChars - 1 : maxChars)
}

/**
 * UD-025: the author's other inputs that are still in flight or waiting for review (`analyzing` or `proposed`, never
 * published), newest first, for the analysis of `input` to know what the person already said. It is context for the
 * model: no similarity and no deduplication is computed here. Capped by count and age (`config.recentInputs`).
 * Each item: { id, created_at, text_excerpt, proposed_titles }; the excerpt is the start of the extracted text of
 * the input (what the person wrote followed by what each attachment yielded).
 */
export function recentInputsFor ({ db, config, now = Date.now }, input) {
  const { max, maxAgeMinutes, excerptChars } = config.recentInputs
  if (max === 0) return []
  const since = now() - maxAgeMinutes * 60 * 1000
  const rows = all(db,
    `SELECT id, text, created_at FROM inputs
      WHERE author_id = ? AND id != ? AND status IN ('analyzing', 'proposed') AND created_at >= ?
      ORDER BY created_at DESC, id DESC LIMIT ?`, input.author_id, input.id, since, max)
  return rows.map((r) => {
    const extracted = all(db, 'SELECT extracted_text FROM attachments WHERE input_id = ? AND extracted_text IS NOT NULL ORDER BY id', r.id).map((a) => a.extracted_text)
    const whole = [r.text, ...extracted].filter((part) => part.trim() !== '').join('\n\n')
    const proposalRow = get(db, 'SELECT payload_json FROM proposals WHERE input_id = ?', r.id)
    const titles = (parseJson(proposalRow?.payload_json, {}).messages ?? []).map((m) => m.title).filter((t) => typeof t === 'string' && t !== '')
    return { id: r.id, created_at: iso(r.created_at), text_excerpt: excerptOf(whole, excerptChars), proposed_titles: titles }
  })
}

/**
 * Vuelve a encolar el análisis de un input ya extraído (útil cuando cambió una plantilla). Las extracciones se
 * conservan: el trabajo sólo extrae lo que falte. Sólo del editor; no sobre un input publicado ni en curso.
 */
export function reprocessInput ({ db, queue, events, now = Date.now }, inputId, actorId) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input) throw notFound('El input no existe.')
    if (!['proposed', 'failed', 'cancelled'].includes(input.status)) {
      throw conflict(`El input está «${input.status}»; sólo se reprocesa uno con propuesta, fallido o cancelado.`, 'not_reprocessable')
    }
    transitionInput(db, inputId, 'queued', { now })
    run(db, 'DELETE FROM proposals WHERE input_id = ?', inputId)
    const jobId = queue.enqueue('analyze', { input_id: inputId }, { inputId })
    events.publishForJob(jobId, { kind: 'progress', percent: 0, phrase: 'En cola' })
    audit(db, { memberId: actorId, action: 'input.reprocess', entity: 'input', entityId: inputId, now })
    return { input_id: inputId, job_id: jobId }
  })
}

/** Cancela un input propio: cancela sus trabajos y lo marca. Un input publicado no se cancela. */
export function cancelInput ({ db, queue, events, now = Date.now }, inputId, memberId) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input || input.author_id !== memberId) throw notFound('El input no existe.')
    if (input.status === 'published') throw conflict('El input ya se publicó; sus mensajes se cierran, no se cancelan.', 'already_published')
    if (input.status === 'cancelled') throw conflict('El input ya está cancelado.', 'already_cancelled')
    const jobList = queue.cancelForInput(inputId)
    transitionInput(db, inputId, 'cancelled', { now })
    audit(db, { memberId, action: 'input.cancel', entity: 'input', entityId: inputId, now })
    for (const jobId of jobList) {
      events.publishForJob(jobId, { kind: 'done', data: { status: 'cancelled' } })
    }
    return { input_id: inputId, cancelled_jobs: jobList }
  })
}
