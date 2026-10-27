#!/usr/bin/env node
// Applies the load file that `scripts/area-method.mjs propose` writes to a database, with the functions of the domain (areas, guards, templates, member profiles).
//
//   node scripts/apply-load-file.mjs load.json [--db /data/team.db] [--only-confirmed] [--require-mechanism]
//
// It is idempotent: an area is found by its title, a template by its name inside the area, a guard by its text and a member by e-mail; what already holds the content of the file is not
// written again (and so leaves no line in the audit), and applying the same file twice leaves the same state. It adds and updates; it never deletes an area, a template or a guard that
// the file does not name. Everything is applied in one transaction: if anything fails, nothing changes.
//
// The team confirms before this runs: an area with `confirmed: false` is refused (or skipped with `--only-confirmed`). A guard that is not about a person and names no mechanism is
// applied and reported, because the product accepts it and the description already says «sin mecanismo declarado»; with `--require-mechanism` it is refused.
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { get, openDatabase, tx } from '../src/db/index.js'
import { loadConfig } from '../src/config.js'
import { audit } from '../src/domain/audit.js'
import { createArea, createTemplate, updateArea, updateTemplate } from '../src/domain/areas.js'
import { guardsOf } from '../src/domain/assessment.js'
import { updateMember } from '../src/domain/members.js'
import { loadWarnings, validateLoadFile } from './area-method.mjs'

const sameGuards = (current, wanted) => current.length === wanted.length && current.every((g, i) => g.text === wanted[i].text && g.mechanism === wanted[i].mechanism && g.person === wanted[i].person)

/**
 * Applies `spec` to `db`. Returns what it did: created, updated and unchanged counts per kind, the areas it skipped and the warnings.
 * Throws before changing anything when the file is invalid, an area is not confirmed (unless `onlyConfirmed`), a member does not exist or the actor is not an active person.
 */
export function applyLoadFile (db, spec, { onlyConfirmed = false, requireMechanism = false, now = Date.now } = {}) {
  validateLoadFile(spec)
  const actor = spec.actor ? get(db, "SELECT id, kind, active FROM members WHERE email = ? AND removed = 0", spec.actor) : null
  if (!actor || actor.kind !== 'person' || actor.active !== 1) throw new Error(`The load file needs an "actor" that is an active person of the team (the one who answers for the load): ${spec.actor ?? 'none'}.`)
  const unconfirmed = spec.areas.filter((a) => a.confirmed !== true)
  if (unconfirmed.length && !onlyConfirmed) throw new Error(`The team has not confirmed: ${unconfirmed.map((a) => a.title).join(', ')}. Set "confirmed": true (and "confirmed_by") after reading the clauses, or use --only-confirmed.`)
  const areas = spec.areas.filter((a) => a.confirmed === true)
  const warnings = loadWarnings({ areas })
  if (requireMechanism && warnings.length) throw new Error(`Guards without a mechanism: ${warnings.map((w) => `${w.guard} (${w.area})`).join('; ')}.`)
  const missing = (spec.members ?? []).filter((m) => !get(db, 'SELECT 1 AS ok FROM members WHERE email = ? AND removed = 0', m.email)).map((m) => m.email)
  if (missing.length) throw new Error(`Members that do not exist: ${missing.join(', ')}.`)
  const result = { created: { areas: 0, templates: 0 }, updated: { areas: 0, guards: 0, templates: 0, members: 0 }, unchanged: { areas: 0, templates: 0, members: 0 }, skipped: unconfirmed.map((a) => a.title), warnings }
  tx(db, () => {
    for (const a of areas) {
      let row = get(db, 'SELECT id, description, position FROM areas WHERE title = ? AND deleted_at IS NULL', a.title)
      let changed = false
      if (!row) {
        row = createArea(db, { title: a.title, description: a.description, position: a.position }, { actorId: actor.id })
        result.created.areas++
        changed = true
      } else if (row.description !== a.description || row.position !== a.position) {
        updateArea(db, row.id, { description: a.description, position: a.position }, { actorId: actor.id })
        result.updated.areas++
        changed = true
      } else result.unchanged.areas++
      // Guards: those of the file by text, then the ones the area already had that the file does not name (they stay).
      const current = guardsOf(db, row.id)
      const wanted = (a.guards ?? []).map((g) => ({ text: g.text.trim(), mechanism: g.mechanism.trim(), person: g.person }))
      const merged = [...wanted, ...current.filter((c) => !wanted.some((w) => w.text === c.text)).map((c) => ({ text: c.text, mechanism: c.mechanism, person: c.person === true }))]
      const normalized = current.map((c) => ({ text: c.text, mechanism: c.mechanism, person: c.person === true }))
      if (!sameGuards(normalized, merged)) {
        updateArea(db, row.id, { guards: merged.map((g) => ({ id: current.find((c) => c.text === g.text)?.id, ...g })) }, { actorId: actor.id })
        result.updated.guards++
        changed = true
      }
      for (const t of a.templates ?? []) {
        const name = t.name
        const existing = get(db, 'SELECT id, body_markdown FROM templates WHERE area_id = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL', row.id, name)
        if (!existing) { createTemplate(db, row.id, { body_markdown: t.body_markdown }, { actorId: actor.id }); result.created.templates++; changed = true } else if (existing.body_markdown !== t.body_markdown) { updateTemplate(db, row.id, existing.id, { body_markdown: t.body_markdown }, { actorId: actor.id }); result.updated.templates++; changed = true } else result.unchanged.templates++
      }
      if (changed) audit(db, { memberId: actor.id, action: 'area.method_load', entity: 'area', entityId: row.id, detail: { title: a.title, confirmed_by: a.confirmed_by ?? null }, now })
    }
    for (const m of spec.members ?? []) {
      const member = get(db, 'SELECT id, profile FROM members WHERE email = ? AND removed = 0', m.email)
      if (member.profile === m.profile) { result.unchanged.members++; continue }
      updateMember(db, member.id, { profile: m.profile }, { actorId: actor.id })
      result.updated.members++
    }
  })
  return result
}

function main (argv) {
  const [file, ...rest] = argv
  const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined }
  if (!file) { console.error('Uso: node scripts/apply-load-file.mjs load.json [--db /data/team.db] [--only-confirmed] [--require-mechanism]'); process.exit(2) }
  const db = openDatabase(option('--db') ?? process.env.DB_PATH ?? loadConfig(process.env).dbFile)
  try {
    const result = applyLoadFile(db, JSON.parse(readFileSync(file, 'utf8')), { onlyConfirmed: rest.includes('--only-confirmed'), requireMechanism: rest.includes('--require-mechanism') })
    for (const w of result.warnings) console.error(`Aviso: el límite «${w.guard}» del área ${w.area} no tiene mecanismo declarado.`)
    for (const t of result.skipped) console.error(`Omitida, sin confirmar: ${t}`)
    process.stdout.write(`${JSON.stringify({ created: result.created, updated: result.updated, unchanged: result.unchanged }, null, 2)}\n`)
  } catch (error) { console.error(error.message); process.exit(1) }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
