// Publication of a proposal (MASTER-SPEC §2 step 4, UD-003): the sender confirms the proposal, edited or not,
// and only then are the messages created. Each message brings its own area and template (one input can bring
// an error, an idea and a question). The system validates the FORM of each value against the database (the area
// exists, the template belongs to that area, the members exist, the attachments belong to the input, the
// template's required fields are present); it does not read the prose (MASTER-SPEC §4.2).

import Ajv from 'ajv'
import { all, get, run } from '../db/index.js'
import { defaultTemplateOf, loadTemplate } from './areas.js'
import { audit } from './audit.js'
import { conflict, notFound, unprocessable } from './errors.js'
import { transitionInput } from './inputs.js'
import { fieldsSchema } from './template-file.js'

// Own Ajv instance, strict: Fastify's response schemas coerce types and drop properties, so they are
// no use for validating what comes from a person or a model (report 03 §7.1).
const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true })

const fieldNameOf = (error) => error.instancePath.replace(/^\//, '') || error.params?.missingProperty || error.params?.additionalProperty || 'campo'

function errorText (error) {
  const fieldName = fieldNameOf(error)
  if (error.keyword === 'required') return `falta el campo «${error.params.missingProperty}»`
  if (error.keyword === 'minLength') return `el campo «${fieldName}» es obligatorio`
  if (error.keyword === 'additionalProperties') return `el campo «${error.params.additionalProperty}» no existe en la plantilla`
  if (error.keyword === 'type') return `el campo «${fieldName}» debe ser texto`
  return `el campo «${fieldName}» no es válido`
}

/** Validates and publishes. Returns the ids of the created messages. */
export function publishProposal ({ db, events, now = Date.now }, { inputId, memberId, proposal }) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input || input.author_id !== memberId) throw notFound('El input no existe.')
    if (input.status === 'published') throw conflict('El input ya se publicó.', 'already_published')
    if (input.status !== 'proposed') throw conflict(`El input está «${input.status}»; sólo se publica una propuesta lista.`, 'not_proposed')

    if (!Array.isArray(proposal.messages) || proposal.messages.length === 0) throw unprocessable('La propuesta necesita al menos un mensaje.', 'messages_empty')

    const validators = new Map() // template → validator of its fields, compiled once per publication
    const inputAttachmentIds = new Set(all(db, 'SELECT id FROM attachments WHERE input_id = ?', inputId).map((a) => a.id))
    const memberRows = new Set(all(db, 'SELECT id FROM members').map((m) => m.id))
    const t = now()
    const createdIds = []

    proposal.messages.forEach((m, i) => {
      const scope = `Mensaje ${i + 1}`
      if (typeof m.title !== 'string' || m.title.trim() === '') throw unprocessable(`${scope}: el título es obligatorio.`, 'message_invalid')
      if (typeof m.body !== 'string' || m.body.trim() === '') throw unprocessable(`${scope}: el texto es obligatorio.`, 'message_invalid')
      const area = get(db, 'SELECT id FROM areas WHERE id = ? AND deleted_at IS NULL', m.area_id)
      if (!area) throw unprocessable(`${scope}: el área elegida no existe.`, 'area_invalid')
      // With no template chosen (the sender changed the area in the proposal), the first current one of the area is used.
      const tpl = m.template_id === null || m.template_id === undefined ? defaultTemplateOf(db, m.area_id) : loadTemplate(db, m.template_id)
      if ((m.template_id !== null && m.template_id !== undefined && !tpl) || (tpl && tpl.area_id !== m.area_id)) {
        throw unprocessable(`${scope}: la plantilla elegida no existe en esa área.`, 'template_invalid')
      }
      // Optional fields with no data may come as null (that is how the analyzer delivers them): they are equivalent to absent.
      const fieldValues = Object.fromEntries(Object.entries(m.fields ?? {}).filter(([, v]) => v !== null))
      if (tpl) {
        if (!validators.has(tpl.id)) validators.set(tpl.id, ajv.compile(fieldsSchema(tpl.parsed.fields)))
        const validateFields = validators.get(tpl.id)
        if (!validateFields(fieldValues)) {
          throw unprocessable(`${scope}: ${validateFields.errors.map(errorText).join('; ')}.`, 'fields_invalid')
        }
      }
      const assigned = [...new Set(m.assignee_ids ?? [])]
      for (const id of assigned) if (!memberRows.has(id)) throw unprocessable(`${scope}: el miembro ${id} no existe.`, 'assignee_invalid')
      const atts = [...new Set(m.attachment_ids ?? [])]
      for (const id of atts) if (!inputAttachmentIds.has(id)) throw unprocessable(`${scope}: el adjunto ${id} no pertenece al input.`, 'attachment_invalid')

      const r = run(db, `INSERT INTO messages (input_id, area_id, template_id, author_id, title, body, fields_json, status, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      inputId, m.area_id, tpl?.id ?? null, memberId, m.title.trim(), m.body, JSON.stringify(fieldValues), t)
      const messageId = Number(r.lastInsertRowid)
      for (const id of assigned) run(db, 'INSERT INTO message_assignees (message_id, member_id) VALUES (?, ?)', messageId, id)
      atts.forEach((id, ordinal) => run(db, 'INSERT INTO message_attachments (message_id, attachment_id, position) VALUES (?, ?, ?)', messageId, id, ordinal))
      createdIds.push(messageId)
    })

    transitionInput(db, inputId, 'published', { now })
    audit(db, { memberId, action: 'input.publish', entity: 'input', entityId: inputId, detail: { msgRows: createdIds }, now })
    // One notice per new message, in the shape the panel's bell consumes.
    for (const [i, id] of createdIds.entries()) {
      events.publish({ kind: 'message', data: { message_id: id, title: proposal.messages[i].title.trim(), author_id: memberId, input_id: inputId } })
    }
    return createdIds
  })
}
