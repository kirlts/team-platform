// Templates as a markdown file with YAML frontmatter (MASTER-SPEC §7.9). Reading and validation are those
// of the analyzer (`src/analyze/templates.js`): a single definition of what a valid template is, so that
// nothing saved here fails later during analysis. This module only translates its errors to API 422s and
// rewrites name and description when the editor changes them separately.

import { dump, load } from 'js-yaml'
import { TemplateError } from '../analyze/errors.js'
import { compileFieldsSchema, parseTemplate as parseFromAnalyzer } from '../analyze/templates.js'
import { unprocessable } from './errors.js'

/** Validates and normalizes. Returns { name, description, fields:[{name,label,required}], body }. Throws 422. */
export function parseTemplate (markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') throw unprocessable('La plantilla está vacía.', 'template_invalid')
  try {
    return parseFromAnalyzer(markdown, { source: 'plantilla' })
  } catch (error) {
    if (error instanceof TemplateError) throw unprocessable(error.message, 'template_invalid')
    throw error
  }
}

/** JSON schema of a message's `fields` object, with which the analyzer validates (required means non-empty). */
export function fieldsSchema (fields) {
  return compileFieldsSchema(fields, { validation: true })
}

/** Rewrites name and description in the header, keeping the rest of the file. */
export function withFrontmatter (markdown, { name, description }) {
  const textValue = String(markdown).replace(/\r\n?/g, '\n')
  const lines = textValue.split('\n')
  if (lines[0].trim() !== '---') throw unprocessable('La plantilla debe empezar con un encabezado --- con name y description.', 'template_invalid')
  const endSeq = lines.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (endSeq === -1) throw unprocessable('El encabezado de la plantilla no se cierra con ---.', 'template_invalid')
  let meta
  try { meta = load(lines.slice(1, endSeq).join('\n')) } catch (error) { throw unprocessable(`El encabezado de la plantilla no es YAML válido: ${error.reason ?? error.message}`, 'template_invalid') }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw unprocessable('El encabezado de la plantilla debe ser un mapa.', 'template_invalid')
  if (name !== undefined) meta.name = name
  if (description !== undefined) meta.description = description
  return `---\n${dump(meta, { lineWidth: -1 }).trimEnd()}\n---\n${lines.slice(endSeq + 1).join('\n')}`
}
