// Publicación de una propuesta (MASTER-SPEC §2 paso 4, UD-003): el emisor confirma la propuesta, editada o no,
// y recién entonces se crean los mensajes. Cada mensaje trae su propia área y plantilla (un input puede traer
// un error, una idea y una pregunta). El sistema valida la FORMA de cada valor contra la base (el área existe,
// la plantilla es de esa área, los miembros existen, los adjuntos son del input, los campos obligatorios de
// la plantilla están); no lee la prosa (MASTER-SPEC §4.2).

import { all, get, run } from '../db/index.js'
import { parseJson } from '../db/util.js'
import { audit } from './audit.js'
import { badRequest, conflict, forbidden, notFound, unprocessable } from './errors.js'
import { transitionInput } from './inputs.js'
import { checkAssignees, checkFields, newValidatorCache, resolveAreaAndTemplate, withoutNulls } from './validation.js'

/**
 * Validates every message of a proposal against the database. Returns the normalised entries, in order:
 * { title, body, areaId, templateId, fields, assigneeIds, attachmentIds, unitIds }. `fail(message, code)` builds the
 * error to throw (422 when publishing, 400 when saving a draft).
 */
export function validateProposal (db, inputId, proposal, fail) {
  if (!Array.isArray(proposal.messages) || proposal.messages.length === 0) throw fail('La propuesta necesita al menos un mensaje.', 'messages_empty')
  const cache = newValidatorCache()
  const inputAttachmentIds = new Set(all(db, 'SELECT id FROM attachments WHERE input_id = ?', inputId).map((a) => a.id))
  return proposal.messages.map((m, i) => {
    const scope = `Mensaje ${i + 1}`
    if (typeof m.title !== 'string' || m.title.trim() === '') throw fail(`${scope}: el título es obligatorio.`, 'message_invalid')
    if (typeof m.body !== 'string' || m.body.trim() === '') throw fail(`${scope}: el texto es obligatorio.`, 'message_invalid')
    // Without a chosen template (the sender changed the area in the proposal) the area's first current one applies.
    const tpl = resolveAreaAndTemplate(db, { areaId: m.area_id, templateId: m.template_id }, { scope, fail })
    const fields = withoutNulls(m.fields)
    checkFields(tpl, fields, { scope, fail, cache })
    const assigneeIds = checkAssignees(db, m.assignee_ids, { scope, fail })
    const attachmentIds = [...new Set(m.attachment_ids ?? [])]
    for (const id of attachmentIds) if (!inputAttachmentIds.has(id)) throw fail(`${scope}: el adjunto ${id} no pertenece al input.`, 'attachment_invalid')
    return { title: m.title.trim(), body: m.body, areaId: m.area_id, templateId: tpl?.id ?? null, fields, assigneeIds, attachmentIds, unitIds: (m.unit_ids ?? []).map(Number) }
  })
}

/**
 * Saves the proposal as the input's current draft (UD-017: an edit must survive closing the tab). Only the author,
 * only while the input is `proposed`. The draft replaces the analyzer's proposal: there is no version history.
 * Returns the stored proposal, or null when nothing changed (same draft saved twice).
 */
export function saveProposalDraft ({ db, events, now = Date.now }, { inputId, memberId, proposal }) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input) throw notFound('El input no existe.')
    if (input.author_id !== memberId) throw forbidden('Sólo quien envió el input puede editar su propuesta.', 'not_input_author')
    if (input.status === 'published') throw conflict('El input ya se publicó; sus mensajes se editan uno por uno.', 'already_published')
    if (input.status !== 'proposed') throw conflict(`El input está «${input.status}»; sólo se edita una propuesta lista.`, 'not_proposed')

    const entries = validateProposal(db, inputId, proposal, badRequest)
    const draft = {
      messages: entries.map((e, i) => ({
        area_id: e.areaId, template_id: e.templateId, title: e.title, body: e.body, fields: e.fields,
        assignee_ids: e.assigneeIds, attachment_ids: e.attachmentIds, unit_ids: proposal.messages[i].unit_ids?.map(Number) ?? []
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
    const t = now()
    const createdIds = []

    for (const e of entries) {
      const r = run(db, `INSERT INTO messages (input_id, area_id, template_id, author_id, title, body, fields_json, status, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      inputId, e.areaId, e.templateId, memberId, e.title, e.body, JSON.stringify(e.fields), t, t)
      const messageId = Number(r.lastInsertRowid)
      for (const id of e.assigneeIds) run(db, 'INSERT INTO message_assignees (message_id, member_id) VALUES (?, ?)', messageId, id)
      e.attachmentIds.forEach((id, ordinal) => run(db, 'INSERT INTO message_attachments (message_id, attachment_id, position) VALUES (?, ?, ?)', messageId, id, ordinal))
      createdIds.push(messageId)
    }

    transitionInput(db, inputId, 'published', { now })
    audit(db, { memberId, action: 'input.publish', entity: 'input', entityId: inputId, detail: { msgRows: createdIds }, now })
    // One notice per new message, in the shape the panel bell consumes.
    for (const [i, id] of createdIds.entries()) {
      events.publish({ kind: 'message', data: { message_id: id, title: entries[i].title, author_id: memberId, input_id: inputId } })
    }
    return createdIds
  })
}
