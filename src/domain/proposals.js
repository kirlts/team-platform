// Publicación de una propuesta (MASTER-SPEC §2 paso 4, UD-003): el emisor confirma la propuesta, editada o no,
// y recién entonces se crean los mensajes. Cada mensaje trae su propia área y plantilla (un input puede traer
// un error, una idea y una pregunta). El sistema valida la FORMA de cada valor contra la base (el área existe,
// la plantilla es de esa área, los miembros existen, los adjuntos son del input, los campos obligatorios de
// la plantilla están); no lee la prosa (MASTER-SPEC §4.2).

import Ajv from 'ajv'
import { all, get, run } from '../db/index.js'
import { loadTemplate } from './areas.js'
import { conflict, notFound, unprocessable } from './errors.js'
import { transitionInput } from './inputs.js'
import { fieldsSchema } from './template-file.js'

// Instancia propia de Ajv, estricta: los esquemas de respuesta de Fastify convierten tipos y descartan
// propiedades, así que no sirven para validar lo que viene de una persona o de un modelo (informe 03 §7.1).
const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: true })

const nombreCampo = (error) => error.instancePath.replace(/^\//, '') || error.params?.missingProperty || error.params?.additionalProperty || 'campo'

function textoDeError (error) {
  const campo = nombreCampo(error)
  if (error.keyword === 'required') return `falta el campo «${error.params.missingProperty}»`
  if (error.keyword === 'minLength') return `el campo «${campo}» es obligatorio`
  if (error.keyword === 'additionalProperties') return `el campo «${error.params.additionalProperty}» no existe en la plantilla`
  if (error.keyword === 'type') return `el campo «${campo}» debe ser texto`
  return `el campo «${campo}» no es válido`
}

/** Valida y publica. Devuelve los ids de los mensajes creados. */
export function publishProposal ({ db, events, now = Date.now }, { inputId, memberId, proposal }) {
  return events.transaction(() => {
    const input = get(db, 'SELECT * FROM inputs WHERE id = ?', inputId)
    if (!input || input.author_id !== memberId) throw notFound('El input no existe.')
    if (input.status === 'published') throw conflict('El input ya se publicó.', 'already_published')
    if (input.status !== 'proposed') throw conflict(`El input está «${input.status}»; sólo se publica una propuesta lista.`, 'not_proposed')

    if (!Array.isArray(proposal.messages) || proposal.messages.length === 0) throw unprocessable('La propuesta necesita al menos un mensaje.', 'messages_empty')

    const validadores = new Map() // plantilla → validador de sus campos, compilado una vez por publicación
    const adjuntosDelInput = new Set(all(db, 'SELECT id FROM attachments WHERE input_id = ?', inputId).map((a) => a.id))
    const miembros = new Set(all(db, 'SELECT id FROM members').map((m) => m.id))
    const t = now()
    const creados = []

    proposal.messages.forEach((m, i) => {
      const donde = `Mensaje ${i + 1}`
      if (typeof m.title !== 'string' || m.title.trim() === '') throw unprocessable(`${donde}: el título es obligatorio.`, 'message_invalid')
      if (typeof m.body !== 'string' || m.body.trim() === '') throw unprocessable(`${donde}: el texto es obligatorio.`, 'message_invalid')
      const area = get(db, 'SELECT id FROM areas WHERE id = ?', m.area_id)
      if (!area) throw unprocessable(`${donde}: el área elegida no existe.`, 'area_invalid')
      const plantilla = loadTemplate(db, m.template_id)
      if (!plantilla || plantilla.area_id !== m.area_id) throw unprocessable(`${donde}: la plantilla elegida no existe en esa área.`, 'template_invalid')
      if (!validadores.has(plantilla.id)) validadores.set(plantilla.id, ajv.compile(fieldsSchema(plantilla.parsed.fields)))
      const validarCampos = validadores.get(plantilla.id)
      // Los campos opcionales sin dato pueden venir como null (así los entrega el analizador): equivalen a ausentes.
      const campos = Object.fromEntries(Object.entries(m.fields ?? {}).filter(([, v]) => v !== null))
      if (!validarCampos(campos)) {
        throw unprocessable(`${donde}: ${validarCampos.errors.map(textoDeError).join('; ')}.`, 'fields_invalid')
      }
      const asignados = [...new Set(m.assignee_ids ?? [])]
      for (const id of asignados) if (!miembros.has(id)) throw unprocessable(`${donde}: el miembro ${id} no existe.`, 'assignee_invalid')
      const adjuntos = [...new Set(m.attachment_ids ?? [])]
      for (const id of adjuntos) if (!adjuntosDelInput.has(id)) throw unprocessable(`${donde}: el adjunto ${id} no pertenece al input.`, 'attachment_invalid')

      const r = run(db, `INSERT INTO messages (input_id, area_id, template_id, author_id, title, body, fields_json, status, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      inputId, m.area_id, m.template_id, memberId, m.title.trim(), m.body, JSON.stringify(campos), t)
      const messageId = Number(r.lastInsertRowid)
      for (const id of asignados) run(db, 'INSERT INTO message_assignees (message_id, member_id) VALUES (?, ?)', messageId, id)
      adjuntos.forEach((id, posicion) => run(db, 'INSERT INTO message_attachments (message_id, attachment_id, position) VALUES (?, ?, ?)', messageId, id, posicion))
      creados.push(messageId)
    })

    transitionInput(db, inputId, 'published', { now })
    events.publish({ kind: 'message', data: { change: 'created', message_ids: creados, input_id: inputId } })
    return creados
  })
}
