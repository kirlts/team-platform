// Áreas y plantillas (MASTER-SPEC §1.1, §7.9). Las gestiona el Editor.

import { all, get, run, tx } from '../db/index.js'
import { iso } from '../db/util.js'
import { conflict, notFound, unprocessable } from './errors.js'
import { parseTemplate, withFrontmatter } from './template-file.js'

const toTemplate = (f, conCuerpo) => ({
  id: f.id, area_id: f.area_id, name: f.name, description: f.description, updated_at: iso(f.updated_at),
  ...(conCuerpo ? { body_markdown: f.body_markdown } : {})
})

/** Áreas con su conteo de mensajes abiertos y sus plantillas (sin cuerpo). */
export function listAreas (db) {
  const areas = all(db, `
    SELECT a.id, a.title, a.description, a.position,
           (SELECT COUNT(*) FROM messages m WHERE m.area_id = a.id AND m.status = 'open') AS open_count,
           (SELECT COUNT(*) FROM messages m WHERE m.area_id = a.id AND m.status <> 'closed') AS unresolved_count
      FROM areas a ORDER BY a.position, a.id`)
  const plantillas = all(db, 'SELECT id, area_id, name, description, updated_at FROM templates ORDER BY id')
  return areas.map((a) => ({ ...a, templates: plantillas.filter((p) => p.area_id === a.id).map((p) => toTemplate(p, false)) }))
}

export function getArea (db, id) {
  const fila = get(db, 'SELECT id, title, description, position FROM areas WHERE id = ?', id)
  if (!fila) throw notFound('El área no existe.')
  return fila
}

function tituloLibre (db, title, exceptId = null) {
  const otra = get(db, 'SELECT id FROM areas WHERE title = ? AND id <> ?', title, exceptId ?? -1)
  if (otra) throw conflict('Ya existe un área con ese título.', 'area_title_taken')
}

export function createArea (db, { title, description, position }) {
  return tx(db, () => {
    tituloLibre(db, title)
    const siguiente = position ?? (get(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM areas').p)
    const r = run(db, 'INSERT INTO areas (title, description, position) VALUES (?, ?, ?)', title, description, siguiente)
    return getArea(db, Number(r.lastInsertRowid))
  })
}

export function updateArea (db, id, patch) {
  return tx(db, () => {
    getArea(db, id)
    if (patch.title !== undefined) tituloLibre(db, patch.title, id)
    const cambios = ['title', 'description', 'position'].filter((k) => patch[k] !== undefined)
    if (cambios.length > 0) run(db, `UPDATE areas SET ${cambios.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cambios.map((k) => patch[k]), id)
    return getArea(db, id)
  })
}

export function listTemplates (db, areaId) {
  getArea(db, areaId)
  return all(db, 'SELECT * FROM templates WHERE area_id = ? ORDER BY id', areaId).map((f) => toTemplate(f, true))
}

export function getTemplate (db, areaId, id) {
  const fila = get(db, 'SELECT * FROM templates WHERE id = ? AND area_id = ?', id, areaId)
  if (!fila) throw notFound('La plantilla no existe en esa área.')
  return fila
}

/**
 * Crea una plantilla. `body_markdown` es el archivo completo con su encabezado (§7.9); `name` y `description`
 * opcionales reescriben el encabezado. Las columnas `name` y `description` siempre salen del encabezado.
 */
export function createTemplate (db, areaId, { body_markdown: markdown, name, description }, now = Date.now) {
  getArea(db, areaId)
  const texto = name !== undefined || description !== undefined ? withFrontmatter(markdown, { name, description }) : markdown
  const t = parseTemplate(texto)
  const r = run(db, 'INSERT INTO templates (area_id, name, description, body_markdown, updated_at) VALUES (?, ?, ?, ?, ?)',
    areaId, t.name, t.description, texto, now())
  return toTemplate(getTemplate(db, areaId, Number(r.lastInsertRowid)), true)
}

export function updateTemplate (db, areaId, id, patch, now = Date.now) {
  return tx(db, () => {
    const actual = getTemplate(db, areaId, id)
    let texto = patch.body_markdown ?? actual.body_markdown
    if (patch.name !== undefined || patch.description !== undefined) {
      texto = withFrontmatter(texto, { name: patch.name, description: patch.description })
    }
    const t = parseTemplate(texto)
    run(db, 'UPDATE templates SET name = ?, description = ?, body_markdown = ?, updated_at = ? WHERE id = ?', t.name, t.description, texto, now(), id)
    return toTemplate(getTemplate(db, areaId, id), true)
  })
}

export function deleteTemplate (db, areaId, id) {
  getTemplate(db, areaId, id)
  run(db, 'DELETE FROM templates WHERE id = ?', id)
}

/** Plantilla con su archivo ya interpretado, para validar mensajes contra sus campos. */
export function loadTemplate (db, id) {
  const fila = get(db, 'SELECT * FROM templates WHERE id = ?', id)
  if (!fila) return null
  try {
    return { ...fila, parsed: parseTemplate(fila.body_markdown) }
  } catch (error) {
    throw unprocessable(`La plantilla «${fila.name}» no se puede leer: ${error.message}`, 'template_invalid')
  }
}
