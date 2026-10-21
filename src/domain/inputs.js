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
import { conflict, notFound } from './errors.js'

export const INPUT_STATUSES = ['queued', 'extracting', 'analyzing', 'proposed', 'published', 'failed', 'cancelled']

const TRANSITIONS = {
  queued: ['extracting', 'analyzing', 'failed', 'cancelled'],
  extracting: ['analyzing', 'queued', 'failed', 'cancelled'],
  analyzing: ['proposed', 'queued', 'failed', 'cancelled'],
  proposed: ['published', 'cancelled', 'queued'], // queued: the editor reprocesses the analysis
  failed: ['queued'],
  cancelled: ['queued'],
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
export function submitInput ({ db, queue, events, now = Date.now }, { authorId, text, files, links }) {
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
    const r = run(db, 'INSERT INTO inputs (author_id, text, content_hash, status, created_at, updated_at) VALUES (?, ?, ?, \'queued\', ?, ?)', authorId, text, hash, t, t)
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
function proposalView (payload) {
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
    attachments: atts.map(attachmentView),
    job: jobRow
      ? { id: jobRow.id, status: jobRow.status, attempts: jobRow.attempts, percent: progressRow?.percent ?? null, phrase: progressRow?.phrase ?? null, last_error: jobRow.last_error }
      : null,
    units: proposalObj ? parseJson(proposalObj.units_json, []).map((u) => ({ id: String(u.id), text: u.text })) : [],
    proposal: proposalObj ? proposalView(parseJson(proposalObj.payload_json, {})) : null,
    message_ids: msgRows
  }
}

/** Paginated list of one's own inputs (the sender sees theirs), with an optional status filter. */
export function listInputs (ctx, memberId, { status = null, limit, offset }) {
  const { db } = ctx
  const cond = status ? 'WHERE author_id = ? AND status = ?' : 'WHERE author_id = ?'
  const params = status ? [memberId, status] : [memberId]
  const total = get(db, `SELECT COUNT(*) AS n FROM inputs ${cond}`, ...params).n
  const rows = all(db, `SELECT * FROM inputs ${cond} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
  return { total, items: rows.map((i) => buildInputView(ctx, i)) }
}

/**
 * Re-enqueues the analysis of an already-extracted input (useful when a template changed). Extractions are
 * kept: the job only extracts what is missing. Editor only; not on a published or in-progress input.
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

/** Cancels one's own input: cancels its jobs and marks it. A published input is not cancelled. */
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
