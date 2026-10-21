// Áreas y plantillas (MASTER-SPEC §1.1, §7.9). Las gestiona el Editor. Se borran en blando (`deleted_at`):
// ningún mensaje que las referencie se pierde, y `restore` las devuelve. La unicidad (título del área, nombre
// de la plantilla dentro de un área) rige entre las vigentes y su choque es 409.

import { all, get, run, tx } from '../db/index.js'
import { iso } from '../db/util.js'
import { audit } from './audit.js'
import { conflict, notFound, unprocessable } from './errors.js'
import { parseTemplate, withFrontmatter } from './template-file.js'

const toTemplate = (f, withBody) => ({
  id: f.id, area_id: f.area_id, name: f.name, description: f.description, updated_at: iso(f.updated_at), deleted_at: iso(f.deleted_at),
  ...(withBody ? { body_markdown: f.body_markdown } : {})
})

/** Áreas con sus conteos y plantillas (sin cuerpo). `includeDeleted`: también las borradas (para restaurar). */
export function listAreas (db, { includeDeleted = false } = {}) {
  const areas = all(db, `
    SELECT a.id, a.title, a.description, a.position, a.deleted_at,
           (SELECT COUNT(*) FROM messages m WHERE m.area_id = a.id AND m.status = 'open') AS open_count,
           (SELECT COUNT(*) FROM messages m WHERE m.area_id = a.id AND m.status <> 'closed') AS unresolved_count,
           (SELECT COUNT(*) FROM templates t WHERE t.area_id = a.id AND t.deleted_at IS NULL) AS template_count
      FROM areas a ${includeDeleted ? '' : 'WHERE a.deleted_at IS NULL'} ORDER BY a.position, a.id`)
  const tpls = all(db, `SELECT id, area_id, name, description, updated_at, deleted_at FROM templates ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY id`)
  return areas.map((a) => ({ ...a, deleted_at: iso(a.deleted_at), templates: tpls.filter((p) => p.area_id === a.id).map((p) => toTemplate(p, false)) }))
}

export function getArea (db, id, { includeDeleted = false } = {}) {
  const dbRow = get(db, `SELECT id, title, description, position, deleted_at FROM areas WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`, id)
  if (!dbRow) throw notFound('El área no existe.')
  return dbRow
}

const view = (db, id) => {
  const a = listAreas(db, { includeDeleted: true }).find((x) => x.id === id)
  return a
}

function titleIsFree (db, title, exceptId = null) {
  const other = get(db, 'SELECT id FROM areas WHERE title = ? AND id <> ? AND deleted_at IS NULL', title, exceptId ?? -1)
  if (other) throw conflict('Ya existe un área con ese título.', 'area_title_taken')
}

export function createArea (db, { title, description, position }, { actorId = null, now = Date.now } = {}) {
  return tx(db, () => {
    titleIsFree(db, title)
    const nextPos = position ?? (get(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM areas').p)
    const r = run(db, 'INSERT INTO areas (title, description, position) VALUES (?, ?, ?)', title, description, nextPos)
    const id = Number(r.lastInsertRowid)
    audit(db, { memberId: actorId, action: 'area.create', entity: 'area', entityId: id, detail: { title }, now })
    return view(db, id)
  })
}

export function updateArea (db, id, patch, { actorId = null, now = Date.now } = {}) {
  return tx(db, () => {
    getArea(db, id)
    if (patch.title !== undefined) titleIsFree(db, patch.title, id)
    const edits = ['title', 'description', 'position'].filter((k) => patch[k] !== undefined)
    if (edits.length > 0) {
      run(db, `UPDATE areas SET ${edits.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...edits.map((k) => patch[k]), id)
      audit(db, { memberId: actorId, action: 'area.update', entity: 'area', entityId: id, detail: { fieldValues: edits }, now })
    }
    return view(db, id)
  })
}

export function deleteArea (db, id, { actorId = null, now = Date.now } = {}) {
  return tx(db, () => {
    getArea(db, id)
    run(db, 'UPDATE areas SET deleted_at = ? WHERE id = ?', now(), id)
    audit(db, { memberId: actorId, action: 'area.delete', entity: 'area', entityId: id, now })
  })
}

export function restoreArea (db, id, { actorId = null, now = Date.now } = {}) {
  return tx(db, () => {
    const dbRow = getArea(db, id, { includeDeleted: true })
    if (dbRow.deleted_at === null) throw conflict('El área no está borrada.', 'not_deleted')
    titleIsFree(db, dbRow.title, id) // otra área vigente pudo tomar el título mientras tanto
    run(db, 'UPDATE areas SET deleted_at = NULL WHERE id = ?', id)
    audit(db, { memberId: actorId, action: 'area.restore', entity: 'area', entityId: id, now })
    return view(db, id)
  })
}

export function listTemplates (db, areaId, { includeDeleted = false } = {}) {
  getArea(db, areaId, { includeDeleted })
  return all(db, `SELECT * FROM templates WHERE area_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY id`, areaId).map((f) => toTemplate(f, true))
}

export function getTemplate (db, areaId, id, { includeDeleted = false } = {}) {
  const dbRow = get(db, `SELECT * FROM templates WHERE id = ? AND area_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`, id, areaId)
  if (!dbRow) throw notFound('La plantilla no existe en esa área.')
  return dbRow
}

function nameIsFree (db, areaId, name, exceptId = null) {
  const other = get(db, 'SELECT id FROM templates WHERE area_id = ? AND name = ? COLLATE NOCASE AND id <> ? AND deleted_at IS NULL', areaId, name, exceptId ?? -1)
  if (other) throw conflict('Ya existe una plantilla con ese nombre en el área.', 'template_name_taken')
}

/**
 * Crea una plantilla. `body_markdown` es el archivo completo con su encabezado (§7.9); `name` y `description`
 * opcionales reescriben el encabezado. Las columnas `name` y `description` siempre salen del encabezado.
 */
export function createTemplate (db, areaId, { body_markdown: markdown, name, description }, { actorId = null, now = Date.now } = {}) {
  return tx(db, () => {
    getArea(db, areaId)
    const textValue = name !== undefined || description !== undefined ? withFrontmatter(markdown, { name, description }) : markdown
    const t = parseTemplate(textValue)
    nameIsFree(db, areaId, t.name)
    const r = run(db, 'INSERT INTO templates (area_id, name, description, body_markdown, updated_at) VALUES (?, ?, ?, ?, ?)',
      areaId, t.name, t.description, textValue, now())
    const id = Number(r.lastInsertRowid)
    audit(db, { memberId: actorId, action: 'template.create', entity: 'template', entityId: id, detail: { area_id: areaId, name: t.name }, now })
    return toTemplate(getTemplate(db, areaId, id), true)
  })
}

export function updateTemplate (db, areaId, id, patch, { actorId = null, now = Date.now } = {}) {
  return tx(db, () => {
    const current = getTemplate(db, areaId, id)
    let textValue = patch.body_markdown ?? current.body_markdown
    if (patch.name !== undefined || patch.description !== undefined) {
      textValue = withFrontmatter(textValue, { name: patch.name, description: patch.description })
    }
    const t = parseTemplate(textValue)
    nameIsFree(db, areaId, t.name, id)
    run(db, 'UPDATE templates SET name = ?, description = ?, body_markdown = ?, updated_at = ? WHERE id = ?', t.name, t.description, textValue, now(), id)
    audit(db, { memberId: actorId, action: 'template.update', entity: 'template', entityId: id, detail: { area_id: areaId, name: t.name }, now })
    return toTemplate(getTemplate(db, areaId, id), true)
  })
}

export function deleteTemplate (db, areaId, id, { actorId = null, now = Date.now } = {}) {
  tx(db, () => {
    getTemplate(db, areaId, id)
    run(db, 'UPDATE templates SET deleted_at = ? WHERE id = ?', now(), id)
    audit(db, { memberId: actorId, action: 'template.delete', entity: 'template', entityId: id, detail: { area_id: areaId }, now })
  })
}

/** Restaura una plantilla borrada. La ruta es /templates/:id/restore: el área sale de la propia plantilla. */
export function restoreTemplate (db, id, { actorId = null, now = Date.now } = {}) {
  return tx(db, () => {
    const dbRow = get(db, 'SELECT * FROM templates WHERE id = ?', id)
    if (!dbRow) throw notFound('La plantilla no existe.')
    if (dbRow.deleted_at === null) throw conflict('La plantilla no está borrada.', 'not_deleted')
    nameIsFree(db, dbRow.area_id, dbRow.name, id)
    run(db, 'UPDATE templates SET deleted_at = NULL WHERE id = ?', id)
    audit(db, { memberId: actorId, action: 'template.restore', entity: 'template', entityId: id, detail: { area_id: dbRow.area_id }, now })
    return toTemplate(get(db, 'SELECT * FROM templates WHERE id = ?', id), true)
  })
}

/** Plantilla vigente con su archivo ya interpretado, para validar mensajes contra sus campos. */
export function loadTemplate (db, id) {
  const dbRow = get(db, 'SELECT * FROM templates WHERE id = ? AND deleted_at IS NULL', id)
  if (!dbRow) return null
  try {
    return { ...dbRow, parsed: parseTemplate(dbRow.body_markdown) }
  } catch (error) {
    throw unprocessable(`La plantilla «${dbRow.name}» no se puede leer: ${error.message}`, 'template_invalid')
  }
}

/** La plantilla vigente de menor id de un área: la que se usa cuando una propuesta cambia de área sin elegir plantilla. */
export function defaultTemplateOf (db, areaId) {
  const dbRow = get(db, 'SELECT id FROM templates WHERE area_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1', areaId)
  return dbRow ? loadTemplate(db, dbRow.id) : null
}
