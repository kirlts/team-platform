// Shape validation shared by publishing a proposal, saving a proposal draft and editing a published message
// (MASTER-SPEC §7.5, UD-017). The system checks the SHAPE of every value against the database (the area exists,
// the template belongs to that area, the members exist, the attachments belong to the input, the template's
// required fields are present); it never reads the prose (MASTER-SPEC §4.2).
//
// Every check takes `fail(message, code)`, which returns the error to throw: publishing answers 422, the edit
// routes answer 400. The messages are in Spanish because a person reads them (UD-015).

import Ajv from 'ajv'
import { get } from '../db/index.js'
import { defaultTemplateOf, loadTemplate } from './areas.js'
import { fieldsSchema } from './template-file.js'

// Own strict Ajv instance: Fastify's response schemas coerce types and drop properties, so they cannot validate
// what comes from a person or a model (report 03 §7.1).
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

/** Compiled field validators, one per template, for the duration of one operation. */
export const newValidatorCache = () => new Map()

/** Optional fields without data may arrive as null (that is how the analyzer delivers them): they equal absent. */
export const withoutNulls = (fields) => Object.fromEntries(Object.entries(fields ?? {}).filter(([, v]) => v !== null))

/** Checks the area exists and resolves the template (null or undefined means the area's first current one). */
export function resolveAreaAndTemplate (db, { areaId, templateId }, { scope, fail }) {
  const prefix = scope ? `${scope}: ` : ''
  const area = get(db, 'SELECT id FROM areas WHERE id = ? AND deleted_at IS NULL', areaId)
  if (!area) throw fail(`${prefix}el área elegida no existe.`, 'area_invalid')
  const noTemplate = templateId === null || templateId === undefined
  const tpl = noTemplate ? defaultTemplateOf(db, areaId) : loadTemplate(db, templateId)
  if ((!noTemplate && !tpl) || (tpl && tpl.area_id !== areaId)) throw fail(`${prefix}la plantilla elegida no existe en esa área.`, 'template_invalid')
  return tpl
}

/** Checks `values` (nulls already removed) against the template's fields: required present, no unknown field. */
export function checkFields (tpl, values, { scope, fail, cache }) {
  if (!tpl) return
  if (!cache.has(tpl.id)) cache.set(tpl.id, ajv.compile(fieldsSchema(tpl.parsed.fields)))
  const validate = cache.get(tpl.id)
  if (!validate(values)) {
    const prefix = scope ? `${scope}: ` : ''
    throw fail(`${prefix}${validate.errors.map(errorText).join('; ')}.`, 'fields_invalid')
  }
}

/** Deduplicated member ids, all of which must exist. */
export function checkAssignees (db, ids, { scope, fail }) {
  const prefix = scope ? `${scope}: ` : ''
  const unique = [...new Set(ids ?? [])]
  for (const id of unique) {
    if (!get(db, 'SELECT 1 AS e FROM members WHERE id = ?', id)) throw fail(`${prefix}el miembro ${id} no existe.`, 'assignee_invalid')
  }
  return unique
}
