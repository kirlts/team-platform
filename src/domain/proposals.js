// Publication of a proposal (MASTER-SPEC §2 step 4, UD-003): the sender confirms the proposal, edited or not,
// and only then are the messages created. Each message brings its own area and template (one input can bring
// an error, an idea and a question). The system validates the FORM of each value against the database (the area
// exists, the template belongs to that area, the members exist, the attachments belong to the input, the
// template's required fields are present); it does not read the prose (MASTER-SPEC §4.2).

import { all, get, run } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { coverage } from '../analyze/validate.js'
import { audit } from './audit.js'
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from './errors.js'
import { transitionInput } from './inputs.js'
import { checkAssignees, checkFields, newValidatorCache, resolveAreaAndTemplate, withoutNulls } from './validation.js'
import { enqueueExecuteForAgents } from '../execute/enqueue.js'
import { isBloomLevel } from './bloom.js'
import { currentTraceparent, inTrace, traceIdOf, withSpan } from '../telemetry/api.js'

/**
 * Validates every message of a proposal against the database. Returns the normalised entries, in order:
 * { title, body, areaId, templateId, fields, assigneeIds, attachmentIds, unitIds, observed }. `fail(message, code)` builds the
 * error to throw (422 when publishing, 400 when saving a draft). With `draft: true` only shape and ids are checked
 * (area, template, members, attachments): a title, a text or a required template field still empty is accepted,
 * because the panel saves after every in-place edit; completeness is enforced when publishing.
 */
export function validateProposal (db, inputId, proposal, fail, { draft = false } = {}) {
  if (!Array.isArray(proposal.messages) || proposal.messages.length === 0) throw fail('La propuesta necesita al menos un mensaje.', 'messages_empty')
  const cache = newValidatorCache()
  const inputAttachmentIds = new Set(all(db, 'SELECT id FROM attachments WHERE input_id = ?', inputId).map((a) => a.id))
  return proposal.messages.map((m, i) => {
    const scope = `Mensaje ${i + 1}`
    if (!draft && (typeof m.title !== 'string' || m.title.trim() === '')) throw fail(`${scope}: el título es obligatorio.`, 'message_invalid')
    if (!draft && (typeof m.body !== 'string' || m.body.trim() === '')) throw fail(`${scope}: el texto es obligatorio.`, 'message_invalid')
    // Without a chosen template (the sender changed the area in the proposal) the area's first current one applies.
    const tpl = resolveAreaAndTemplate(db, { areaId: m.area_id, templateId: m.template_id }, { scope, fail })
    const fields = withoutNulls(m.fields)
    if (!draft) checkFields(tpl, fields, { scope, fail, cache })
    const assigneeIds = checkAssignees(db, m.assignee_ids, { scope, fail })
    const attachmentIds = [...new Set(m.attachment_ids ?? [])]
    for (const id of attachmentIds) if (!inputAttachmentIds.has(id)) throw fail(`${scope}: el adjunto ${id} no pertenece al input.`, 'attachment_invalid')
    return { title: m.title.trim(), body: m.body, areaId: m.area_id, templateId: tpl?.id ?? null, fields, assigneeIds, attachmentIds, bloomLevel: isBloomLevel(m.bloom_level) ? m.bloom_level : null, unitIds: (m.unit_ids ?? []).map(Number), observed: Array.isArray(m.observed) ? m.observed.filter((o) => typeof o === 'string' && o !== '') : [] }
  })
}

/**
 * Units (MASTER-SPEC §7.5, HP-014): every cited unit must be one the analysis numbered for this input. With
 * `complete: true` (publishing) the proposal must also cover each unit exactly once, in a message or in `discarded`,
 * with the same set arithmetic the analyzer applies to the model's output (`coverage`). A drafted proposal may be
 * incomplete: the panel moves the units of a deleted message to `discarded`, and publishing demands the result.
 */
function checkUnits (db, inputId, proposal, fail, { complete }) {
  const known = new Set(parseJson(get(db, 'SELECT units_json FROM proposals WHERE input_id = ?', inputId)?.units_json, []).map((u) => Number(u.id)))
  const messages = proposal.messages.map((m) => ({ unit_ids: (m.unit_ids ?? []).map(Number) }))
  const discarded = (proposal.discarded ?? []).map((d) => ({ unit_ids: (d.unit_ids ?? []).map(Number) }))
  messages.forEach((m, i) => m.unit_ids.forEach((u) => { if (!known.has(u)) throw fail(`Mensaje ${i + 1}: la unidad ${u} no existe en el input.`, 'unit_invalid') }))
  discarded.forEach((d) => d.unit_ids.forEach((u) => { if (!known.has(u)) throw fail(`Descartado: la unidad ${u} no existe en el input.`, 'unit_invalid') }))
  if (!complete) return
  const { overlaps, gaps } = coverage(messages, discarded, known)
  if (overlaps.length > 0) {
    throw fail(`${overlaps.map((o) => `La unidad ${o.unit_id} está en más de un lugar (${o.owners.join(' y ')})`).join('; ')}.`, 'units_overlap')
  }
  if (gaps.length > 0) {
    throw fail(`Las unidades ${gaps.join(', ')} no están en ningún mensaje ni entre los descartados.`, 'units_uncovered')
  }
}

/**
 * Saves the proposal as the input's current draft (UD-017: an edit must survive closing the tab). Only the author,
 * only while the input is `proposed`. Shape and ids only: an incomplete draft is stored, and publishing demands completeness. The draft replaces the analyzer's proposal: there is no version history.
 * Returns the stored proposal, or null when nothing changed (same draft saved twice).
 */
export function saveProposalDraft ({ db, events, now = Date.now }, { inputId, memberId, proposal }) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input) throw notFound('El input no existe.')
    if (input.author_id !== memberId) throw forbidden('Sólo quien envió el input puede editar su propuesta.', 'not_input_author')
    if (input.status === 'published') throw conflict('El input ya se publicó; sus mensajes se editan uno por uno.', 'already_published')
    if (input.status !== 'proposed') throw conflict(`El input está «${input.status}»; sólo se edita una propuesta lista.`, 'not_proposed')

    const entries = validateProposal(db, inputId, proposal, badRequest, { draft: true })
    checkUnits(db, inputId, proposal, badRequest, { complete: false })
    const draft = {
      messages: entries.map((e, i) => ({
        area_id: e.areaId, template_id: e.templateId, title: e.title, body: e.body, fields: e.fields,
        assignee_ids: e.assigneeIds, attachment_ids: e.attachmentIds, unit_ids: proposal.messages[i].unit_ids?.map(Number) ?? [],
        ...(proposal.messages[i].source === 'frame' ? { source: 'frame' } : {}),
        ...(e.bloomLevel ? { bloom_level: e.bloomLevel } : {}),
        ...(e.observed.length ? { observed: e.observed } : {})
      })),
      discarded: (proposal.discarded ?? []).map((d) => ({ unit_ids: (d.unit_ids ?? []).map(Number), reason: d.reason ?? '' }))
    }
    const payload = JSON.stringify(draft)
    const current = get(db, 'SELECT payload_json FROM proposals WHERE input_id = ?', inputId)
    if (current?.payload_json === payload) return draft // same draft twice: same state, no new audit row
    run(db, `INSERT INTO proposals (input_id, payload_json, created_at) VALUES (?, ?, ?)
             ON CONFLICT(input_id) DO UPDATE SET payload_json = excluded.payload_json`, inputId, payload, now())
    run(db, 'UPDATE inputs SET updated_at = ? WHERE id = ?', now(), inputId)
    audit(db, { memberId, action: 'input.proposal.update', entity: 'input', entityId: inputId, detail: { messages: draft.messages.length }, now })
    return draft
  })
}

/**
 * Writes the messages of a validated proposal and closes the input as `published`. The only place that creates
 * messages (HP-005). Inside a transaction. `via` is 'manual' (the sender confirmed) or 'auto' (UD-070).
 */
function insertMessages ({ db, events, now }, { input, entries, via }) {
  const memberId = input.author_id
  const inputId = input.id
  const t = now()
  const createdIds = []
  for (const e of entries) {
    // «Mensaje publicado» is a span of the input's trace (UD-262); its context is what the `execute` job continues.
    const messageId = inTrace(input.traceparent, () => withSpan('message.publish', { 'team.input_id': String(inputId), 'team.member_id': String(memberId), 'team.via': via }, (span) => {
    const r = run(db, `INSERT INTO messages (input_id, area_id, template_id, author_id, title, body, fields_json, observed_json, bloom_level, status, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    inputId, e.areaId, e.templateId, memberId, e.title, e.body, JSON.stringify(e.fields), e.observed.length ? JSON.stringify(e.observed) : null, e.bloomLevel, t, t)
    const messageId = Number(r.lastInsertRowid)
    const traceparent = currentTraceparent()
    span.setAttribute('team.message_id', String(messageId))
    if (traceparent) run(db, 'UPDATE messages SET trace_id = ?, traceparent = ? WHERE id = ?', traceIdOf(traceparent), traceparent, messageId)
    for (const id of e.assigneeIds) run(db, 'INSERT INTO message_assignees (message_id, member_id) VALUES (?, ?)', messageId, id)
    e.attachmentIds.forEach((id, ordinal) => run(db, 'INSERT INTO message_attachments (message_id, attachment_id, position) VALUES (?, ?, ?)', messageId, id, ordinal))
    enqueueExecuteForAgents(db, messageId, { memberIds: e.assigneeIds, now }) // an agent assignee gets its `execute` job (UD-254)
    return messageId
    }))
    createdIds.push(messageId)
  }
  transitionInput(db, inputId, 'published', { now })
  audit(db, { memberId, action: 'input.publish', entity: 'input', entityId: inputId, detail: { msgRows: createdIds, via }, now })
  // One notice per new message, in the shape the panel bell consumes.
  for (const [i, id] of createdIds.entries()) {
    events.publish({ kind: 'message', data: { message_id: id, title: entries[i].title, author_id: memberId, input_id: inputId } })
  }
  return createdIds
}

/** Validates and publishes. Without `proposal.messages` the saved draft is published. Returns the ids of the created messages. */
export function publishProposal ({ db, events, now = Date.now }, { inputId, memberId, proposal }) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input || input.author_id !== memberId) throw notFound('El input no existe.')
    if (input.status === 'published') throw conflict('El input ya se publicó.', 'already_published')
    if (input.status !== 'proposed') throw conflict(`El input está «${input.status}»; sólo se publica una propuesta lista.`, 'not_proposed')

    // UD-017: no body means "publish what is saved".
    const toPublish = proposal?.messages === undefined
      ? parseJson(get(db, 'SELECT payload_json FROM proposals WHERE input_id = ?', inputId)?.payload_json, {})
      : proposal
    const entries = validateProposal(db, inputId, toPublish, unprocessable)
    checkUnits(db, inputId, toPublish, unprocessable, { complete: true })
    return insertMessages({ db, events, now }, { input, entries, via: 'manual' })
  })
}

/**
 * Automatic publication (UD-070): called by the analysis in the transaction that closes its job, with the input
 * already `proposed`. It publishes the saved proposal with the same validation as the manual route. It never
 * throws for a proposal that does not validate (an empty one, a required field missing, a deleted area): the input
 * stays `proposed` with `error_code = 'publish_blocked'` and the reason, visible to its sender, who fixes it and
 * publishes by hand. Idempotent: an input that is not `proposed` (already published, cancelled) is left alone.
 * Returns { published, messageIds, reason }.
 */
export function autoPublishProposal ({ db, events, now = Date.now }, inputId) {
  const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
  if (!input || input.status !== 'proposed') return { published: false, messageIds: [], reason: 'not_proposed' }
  const saved = parseJson(get(db, 'SELECT payload_json FROM proposals WHERE input_id = ?', inputId)?.payload_json, {})
  let entries
  try {
    entries = validateProposal(db, inputId, saved, unprocessable)
    checkUnits(db, inputId, saved, unprocessable, { complete: true })
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    run(db, 'UPDATE inputs SET error = ?, error_code = ?, updated_at = ? WHERE id = ?', error.message, 'publish_blocked', now(), inputId)
    audit(db, { memberId: input.author_id, action: 'input.publish.blocked', entity: 'input', entityId: inputId, detail: { code: error.code }, now })
    return { published: false, messageIds: [], reason: error.code }
  }
  const messageIds = insertMessages({ db, events, now }, { input, entries, via: 'auto' })
  return { published: true, messageIds, reason: null }
}
