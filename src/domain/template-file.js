// Plantillas como archivo markdown con frontmatter YAML (MASTER-SPEC §7.9). La lectura y validación son las
// del analizador (`src/analyze/templates.js`): una sola definición de qué es una plantilla válida, para que
// nada que se guarde acá falle después al analizar. Este módulo sólo traduce sus errores a 422 de la API y
// reescribe name y description cuando el editor los cambia por separado.

import { dump, load } from 'js-yaml'
import { TemplateError } from '../analyze/errors.js'
import { compileFieldsSchema, parseTemplate as parseDelAnalizador } from '../analyze/templates.js'
import { unprocessable } from './errors.js'

/** Valida y normaliza. Devuelve { name, description, fields:[{name,label,required}], body }. Lanza 422. */
export function parseTemplate (markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') throw unprocessable('La plantilla está vacía.', 'template_invalid')
  try {
    return parseDelAnalizador(markdown, { source: 'plantilla' })
  } catch (error) {
    if (error instanceof TemplateError) throw unprocessable(error.message, 'template_invalid')
    throw error
  }
}

/** Esquema JSON del objeto `fields` de un mensaje, con el que el analizador valida (obligatorio no vacío). */
export function fieldsSchema (fields) {
  return compileFieldsSchema(fields, { validation: true })
}

/** Reescribe name y description en el encabezado conservando el resto del archivo. */
export function withFrontmatter (markdown, { name, description }) {
  const texto = String(markdown).replace(/\r\n?/g, '\n')
  const lineas = texto.split('\n')
  if (lineas[0].trim() !== '---') throw unprocessable('La plantilla debe empezar con un encabezado --- con name y description.', 'template_invalid')
  const fin = lineas.findIndex((l, i) => i > 0 && l.trim() === '---')
  if (fin === -1) throw unprocessable('El encabezado de la plantilla no se cierra con ---.', 'template_invalid')
  let meta
  try { meta = load(lineas.slice(1, fin).join('\n')) } catch (error) { throw unprocessable(`El encabezado de la plantilla no es YAML válido: ${error.reason ?? error.message}`, 'template_invalid') }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw unprocessable('El encabezado de la plantilla debe ser un mapa.', 'template_invalid')
  if (name !== undefined) meta.name = name
  if (description !== undefined) meta.description = description
  return `---\n${dump(meta, { lineWidth: -1 }).trimEnd()}\n---\n${lineas.slice(fin + 1).join('\n')}`
}
