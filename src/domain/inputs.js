// Inputs: what a person sends from the Inicio bar (MASTER-SPEC §1.1, §1.3, §2).
//
// Statuses of an input and allowed transitions (any other is a 409):
//   queued → extracting | analyzing | failed | cancelled
//   extracting → analyzing | queued (retry) | failed | cancelled
//   analyzing → proposed | queued (retry) | failed | cancelled
//   proposed → published | cancelled
//   failed, cancelled → queued (the same input sent again)
//   published → (final)

import { createHash } from 'node:crypto'
import { all, get, run } from '../db/index.js'
import { iso, parseJson } from '../db/util.js'
import { audit } from './audit.js'
import { badRequest, conflict, notFound, tooLarge } from './errors.js'

export const INPUT_STATUSES = ['queued', 'extracting', 'analyzing', 'proposed', 'published', 'failed', 'cancelled']

const TRANSITIONS = {
  queued: ['extracting', 'analyzing', 'failed', 'cancelled'],
  extracting: ['analyzing', 'queued', 'failed', 'cancelled'],
  analyzing: ['proposed', 'queued', 'failed', 'cancelled'],
  proposed: ['published', 'cancelled', 'queued'], // queued: the editor reprocesses the analysis
  failed: ['queued', 'cancelled'], // cancelled: the sender discards a failed analysis
  cancelled: ['queued', 'proposed', 'failed'], // proposed / failed: the sender undoes a discard (restoreInput)
  published: []
}

export const isTerminalInput = (status) => ['proposed', 'published', 'failed', 'cancelled'].includes(status)

/** Changes the status, checking the transition table. Inside a transaction. */
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
 * Content hash (§1.3): the same normalized text, the same attachments by hash and the same sender give the
 * same input. The sender goes into the hash because the input is theirs: two people who send the same screenshot
 * each have their own proposal and their own responsibility as senders. Without it, the second one would receive
 * someone else's input. Normalization: NFC, \n line breaks and no spaces at the ends. It does not interpret the text.
 */
export function contentHash ({ authorId, text, fileHashes, links }) {
  const normal = text.normalize('NFC').replaceAll('\r\n', '\n').trim()
  const canon = JSON.stringify({ v: 1, author: authorId, text: normal, files: [...fileHashes].sort(), links: [...links].sort() })
  return createHash('sha256').update(canon).digest('hex')
}

/**
 * Registers an input and enqueues its analysis. Idempotent by hash. `files` are already in the volume:
 * [{ kind, name, mime, size, sha256 }]; `links`, already-validated URLs.
 * Returns { input, jobId, created, restarted }.
 */
export function submitInput ({ db, queue, events, now = Date.now }, { authorId, text, files, links, keepDraft = false }) {
  const hash = contentHash({ authorId, text, fileHashes: files.map((f) => f.sha256), links })
  return events.transaction(() => {
    const existing = get(db, 'SELECT * FROM inputs WHERE content_hash = ?', hash)
    if (existing) {
      const jobRow = queue.latestJobForInput(existing.id)
      if (existing.status === 'failed' || existing.status === 'cancelled') {
        // The same content sent again after a failure or a cancellation: it is retried on the same row.
        transitionInput(db, existing.id, 'queued', { now })
        audit(db, { memberId: authorId, action: 'input.resubmit', entity: 'input', entityId: existing.id, now })
        const jobId = queue.enqueue('analyze', { input_id: existing.id }, { inputId: existing.id })
        events.publishForJob(jobId, { kind: 'progress', percent: 0, phrase: 'En cola' })
        return { input: get(db, 'SELECT * FROM inputs WHERE id = ?', existing.id), jobId, created: false, restarted: true }
      }
      return { input: existing, jobId: jobRow?.id ?? null, created: false, restarted: false }
    }
    const t = now()
    const r = run(db, 'INSERT INTO inputs (author_id, text, content_hash, status, keep_draft, created_at, updated_at) VALUES (?, ?, ?, \'queued\', ?, ?, ?)', authorId, text, hash, keepDraft ? 1 : 0, t, t)
    const inputId = Number(r.lastInsertRowid)
    for (const f of files) {
      run(db, 'INSERT INTO attachments (input_id, kind, name, path, mime, size, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)', inputId, f.kind, f.name, f.sha256, f.mime, f.size, f.sha256)
    }
    for (const url of links) {
      // For kind=link the `path` column stores the URL; the hash identifies the link.
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

/** Proposal ids as text: the API contract exposes every id as a string. */
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

/** View of an input for its sender: attachments, status, current job, units and proposal if one exists. */
export function getInputView ({ db, queue, events }, inputId, memberId) {
  const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
  // Someone else's input is indistinguishable from a nonexistent one.
  if (!input || input.author_id !== memberId) throw notFound('El input no existe.')
  return buildInputView({ db, queue, events }, input)
}

export function buildInputView ({ db, queue, events }, input) {
  const atts = all(db, 'SELECT * FROM attachments WHERE input_id = ? ORDER BY id', input.id)
  const jobRow = queue.latestJobForInput(input.id)
  const progressRow = jobRow ? events.lastProgress(jobRow.id) : null
  const proposalObj = get(db, 'SELECT * FROM proposals WHERE input_id = ?', input.id)
  const msgRows = input.status === 'published' ? all(db, 'SELECT id, title, area_id, status, edited_at FROM messages WHERE input_id = ? ORDER BY id', input.id) : []
  return {
    id: input.id,
    author_id: input.author_id,
    text: input.text,
    status: input.status,
    error: input.error,
    error_code: input.error_code,
    created_at: iso(input.created_at),
    updated_at: iso(input.updated_at),
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
    message_ids: msgRows.map((m) => m.id),
    // UD-071: what the sender sees in the history without one request per message.
    messages: msgRows.map((m) => ({ id: m.id, title: m.title, area_id: m.area_id, status: m.status, edited_at: iso(m.edited_at) }))
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
 * Queues the analysis of an input again (useful when a template changed, or to retry a failed analysis). The
 * extractions are kept: the job only extracts what is missing. The editor can do it on any input; a member only on
 * their own (for anybody else an input of another person does not exist). Not on a published or in-flight input.
 */
export function reprocessInput ({ db, queue, events, now = Date.now }, inputId, actor) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input || (actor.role !== 'editor' && input.author_id !== actor.id)) throw notFound('El input no existe.')
    if (!['proposed', 'failed', 'cancelled'].includes(input.status)) {
      throw conflict(`El input está «${input.status}»; sólo se reprocesa uno con propuesta, fallido o cancelado.`, 'not_reprocessable')
    }
    transitionInput(db, inputId, 'queued', { now })
    run(db, 'DELETE FROM proposals WHERE input_id = ?', inputId)
    const jobId = queue.enqueue('analyze', { input_id: inputId }, { inputId })
    events.publishForJob(jobId, { kind: 'progress', percent: 0, phrase: 'En cola' })
    audit(db, { memberId: actor.id, action: 'input.reprocess', entity: 'input', entityId: inputId, now })
    return { input_id: inputId, job_id: jobId }
  })
}

/**
 * Replaces the text of an own input that is waiting for review (`proposed`) or failed, and queues its analysis again
 * with the new text. The attachments and their extractions stay. The content hash is recomputed (§1.3): if another
 * input of the same author already has that content the edit is a 409, as sending it again would have been a duplicate.
 */
export function editInputText ({ db, config, queue, events, now = Date.now }, inputId, memberId, text) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input || input.author_id !== memberId) throw notFound('El input no existe.')
    if (!['proposed', 'failed'].includes(input.status)) {
      throw conflict(`El input está «${input.status}»; sólo se edita el texto de uno con propuesta o fallido.`, 'not_editable')
    }
    if (Buffer.byteLength(text) > config.uploads.maxTextBytes) throw tooLarge('El texto supera el tamaño máximo permitido.')
    const atts = all(db, 'SELECT kind, path, sha256 FROM attachments WHERE input_id = ?', inputId)
    if (text.trim() === '' && atts.length === 0) throw badRequest('El envío está vacío: falta texto, archivo o enlace.', 'input_empty')
    const hash = contentHash({
      authorId: memberId, text,
      fileHashes: atts.filter((a) => a.kind !== 'link').map((a) => a.sha256),
      links: atts.filter((a) => a.kind === 'link').map((a) => a.path)
    })
    if (get(db, 'SELECT 1 AS e FROM inputs WHERE content_hash = ? AND id != ?', hash, inputId)) {
      throw conflict('Envío duplicado: la misma persona ya envió ese contenido.', 'duplicate_input')
    }
    const t = now()
    run(db, 'UPDATE inputs SET text = ?, content_hash = ?, updated_at = ? WHERE id = ?', text, hash, t, inputId)
    transitionInput(db, inputId, 'queued', { now })
    run(db, 'DELETE FROM proposals WHERE input_id = ?', inputId)
    const jobId = queue.enqueue('analyze', { input_id: inputId }, { inputId })
    events.publishForJob(jobId, { kind: 'progress', percent: 0, phrase: 'En cola' })
    audit(db, { memberId, action: 'input.edit', entity: 'input', entityId: inputId, detail: { chars: text.length }, now })
    return buildInputView({ db, queue, events }, get(db, 'SELECT * FROM inputs WHERE id = ?', inputId))
  })
}

/**
 * Undoes a discard (J1-B-26): a cancelled input goes back to the state it was in. With its saved proposal it
 * is `proposed` again, with the edits it had; without one (the analysis had failed) it is `failed`.
 * Nothing is analyzed again. Only the sender, and only while the input is `cancelled`.
 */
export function restoreInput ({ db, events, now = Date.now }, inputId, memberId) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input || input.author_id !== memberId) throw notFound('El input no existe.')
    if (input.status !== 'cancelled') throw conflict(`El input está «${input.status}»; sólo se restaura uno cancelado.`, 'not_cancelled')
    const hasProposal = !!get(db, 'SELECT 1 AS x FROM proposals WHERE input_id = ?', inputId)
    const to = hasProposal ? 'proposed' : 'failed'
    transitionInput(db, inputId, to, { now, error: hasProposal ? null : 'Se descartó antes de terminar el análisis.', errorCode: null })
    audit(db, { memberId, action: 'input.restore', entity: 'input', entityId: inputId, now })
    return { input_id: inputId, status: to }
  })
}

/** Cancels the queued or running jobs of an input and tells their listeners. Inside a transaction. */
function cancelJobsOf ({ queue, events }, inputId) {
  const jobList = queue.cancelForInput(inputId)
  for (const jobId of jobList) {
    events.publishForJob(jobId, { kind: 'done', data: { status: 'cancelled' } })
  }
  return jobList
}

/** Cancels an input of one's own: cancels its jobs and marks it. A published input is not cancelled. */
export function cancelInput ({ db, queue, events, now = Date.now }, inputId, memberId) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input || input.author_id !== memberId) throw notFound('El input no existe.')
    if (input.status === 'published') throw conflict('El input ya se publicó; sus mensajes se cierran, no se cancelan.', 'already_published')
    if (input.status === 'cancelled') throw conflict('El input ya está cancelado.', 'already_cancelled')
    transitionInput(db, inputId, 'cancelled', { now })
    audit(db, { memberId, action: 'input.cancel', entity: 'input', entityId: inputId, now })
    const jobList = cancelJobsOf({ queue, events }, inputId)
    return { input_id: inputId, cancelled_jobs: jobList }
  })
}

/**
 * Deletes an input for real (UD-240): its attachments, jobs (the queued or running ones are cancelled first), events
 * and proposal. Its sender or an Editor; for anybody else it does not exist (404). The messages published from it stay
 * (`messages.input_id` becomes NULL) and keep their attachments: an attachment row some message references is not
 * deleted, it only loses its input (migration 0011). With `withMessages` those messages go too, with their replies.
 * Returns the counts and the sha256 of every file that may now be unreferenced; the caller frees the volume
 * (`freeBlobs`) once the transaction is committed, never inside it.
 */
export function deleteInput ({ db, queue, events, now = Date.now }, inputId, actor, { withMessages = false } = {}) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input || (actor.role !== 'editor' && input.author_id !== actor.id)) throw notFound('El input no existe.')
    const attachments = all(db, 'SELECT id, kind, sha256 FROM attachments WHERE input_id = ?', inputId)
    const messageIds = all(db, 'SELECT id FROM messages WHERE input_id = ? ORDER BY id', inputId).map((m) => m.id)
    const jobs = get(db, 'SELECT COUNT(*) AS n FROM jobs WHERE input_id = ?', inputId).n
    const cancelled = cancelJobsOf({ queue, events }, inputId)
    const hashes = attachments.filter((a) => a.kind !== 'link').map((a) => a.sha256)
    let deletedMessages = 0
    if (withMessages && messageIds.length > 0) {
      const marks = messageIds.map(() => '?').join(', ')
      for (const r of all(db, `SELECT ra.sha256 FROM reply_attachments ra JOIN replies r ON r.id = ra.reply_id WHERE r.message_id IN (${marks}) AND ra.kind <> 'link'`, ...messageIds)) hashes.push(r.sha256)
      deletedMessages = run(db, `DELETE FROM messages WHERE id IN (${marks})`, ...messageIds).changes
    }
    // Rows no message references go; the rest survive with input_id NULL (ON DELETE SET NULL) so the messages keep their files.
    const removedAttachments = run(db, 'DELETE FROM attachments WHERE input_id = ? AND id NOT IN (SELECT attachment_id FROM message_attachments)', inputId).changes
    const kept = attachments.length - removedAttachments
    // Rows an earlier deletion left to a message that no longer exists: nobody references them, so they go with their files.
    const orphans = all(db, "SELECT id, sha256 FROM attachments WHERE input_id IS NULL AND kind <> 'link' AND id NOT IN (SELECT attachment_id FROM message_attachments)")
    for (const o of orphans) hashes.push(o.sha256)
    run(db, 'DELETE FROM attachments WHERE input_id IS NULL AND id NOT IN (SELECT attachment_id FROM message_attachments)')
    // Written before the row goes, in the same transaction as the change (audit.js).
    audit(db, { memberId: actor.id, action: 'input.delete', entity: 'input', entityId: inputId, detail: { attachments: removedAttachments, kept_attachments: kept, jobs, cancelled_jobs: cancelled.length, messages: deletedMessages, with_messages: withMessages, author_id: input.author_id }, now })
    run(db, 'DELETE FROM inputs WHERE id = ?', inputId) // cascades jobs (with their events) and the proposal
    // The author learns it without a job: the job rows are gone with the input.
    events.publish({ kind: 'done', memberId: input.author_id, data: { input_id: inputId, status: 'deleted' } })
    return { input_id: inputId, deleted: { attachments: removedAttachments, jobs, messages: deletedMessages }, hashes: [...new Set(hashes)] }
  })
}
