// Plantillas como archivo markdown con frontmatter YAML (MASTER-SPEC §7.9). Este módulo sólo lee y valida
// la FORMA del archivo; qué dice el cuerpo (el método de análisis) es asunto del analizador.

import YAML from 'yaml'
import { unprocessable } from './errors.js'

// §7.9: límites de la especificación Agent Skills; la primera llamada del analizador sólo ve estos dos campos.
export const NAME_MAX = 64
export const DESCRIPTION_MAX = 1024

const ENCABEZADO = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/** Separa frontmatter y cuerpo. `data` es null si el archivo no empieza con un bloque `---`. */
export function splitFrontmatter (markdown) {
  const m = ENCABEZADO.exec(markdown)
  if (!m) return { yamlText: null, data: null, body: markdown }
  let data
  try {
    data = YAML.parse(m[1])
  } catch (error) {
    throw unprocessable(`El encabezado de la plantilla no es YAML válido: ${error.message.split('\n')[0]}`, 'template_invalid')
  }
  return { yamlText: m[1], data, body: markdown.slice(m[0].length) }
}

const IDENTIFICADOR = /^[A-Za-z][A-Za-z0-9_]{0,63}$/ // clave de campo (un nombre de máquina, no texto de persona)

/**
 * Valida y normaliza una plantilla. Devuelve { name, description, fields:[{name,label,required}], body }.
 * Lanza 422 con el motivo si el archivo no cumple §7.9.
 */
export function parseTemplate (markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw unprocessable('La plantilla está vacía.', 'template_invalid')
  }
  const { data, body } = splitFrontmatter(markdown)
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw unprocessable('La plantilla debe empezar con un encabezado --- con name y description.', 'template_invalid')
  }
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  if (!name) throw unprocessable('El encabezado de la plantilla necesita «name».', 'template_invalid')
  if (!description) throw unprocessable('El encabezado de la plantilla necesita «description».', 'template_invalid')
  if (name.length > NAME_MAX) throw unprocessable(`«name» admite hasta ${NAME_MAX} caracteres.`, 'template_invalid')
  if (description.length > DESCRIPTION_MAX) throw unprocessable(`«description» admite hasta ${DESCRIPTION_MAX} caracteres.`, 'template_invalid')

  const crudos = data.fields ?? []
  if (!Array.isArray(crudos)) throw unprocessable('«fields» debe ser una lista.', 'template_invalid')
  const vistos = new Set()
  const fields = crudos.map((campo, i) => {
    if (!campo || typeof campo !== 'object' || Array.isArray(campo)) {
      throw unprocessable(`El campo ${i + 1} de «fields» debe tener name, label y required.`, 'template_invalid')
    }
    const { name: clave, label, required } = campo
    if (typeof clave !== 'string' || !IDENTIFICADOR.test(clave)) {
      throw unprocessable(`El campo ${i + 1} de «fields» necesita un «name» con letras, números y guion bajo.`, 'template_invalid')
    }
    if (vistos.has(clave)) throw unprocessable(`El campo «${clave}» está repetido.`, 'template_invalid')
    vistos.add(clave)
    if (typeof label !== 'string' || label.trim() === '') {
      throw unprocessable(`El campo «${clave}» necesita un «label».`, 'template_invalid')
    }
    if (required !== undefined && typeof required !== 'boolean') {
      throw unprocessable(`«required» del campo «${clave}» debe ser verdadero o falso.`, 'template_invalid')
    }
    return { name: clave, label: label.trim(), required: required === true }
  })
  return { name, description, fields, body }
}

/** Esquema JSON del objeto `fields` de un mensaje, derivado de la plantilla (§7.9). */
export function fieldsSchema (fields) {
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map((f) => [f.name, f.required ? { type: 'string', minLength: 1 } : { type: 'string' }])),
    required: fields.filter((f) => f.required).map((f) => f.name),
    additionalProperties: false
  }
}

/** Reescribe name y description en el encabezado conservando el resto del archivo. */
export function withFrontmatter (markdown, { name, description }) {
  const m = ENCABEZADO.exec(markdown)
  const doc = m ? YAML.parseDocument(m[1]) : new YAML.Document({})
  if (name !== undefined) doc.set('name', name)
  if (description !== undefined) doc.set('description', description)
  const cuerpo = m ? markdown.slice(m[0].length) : markdown
  return `---\n${String(doc).trimEnd()}\n---\n${cuerpo}`
}
