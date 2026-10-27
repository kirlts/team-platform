#!/usr/bin/env node
// The rate at which a person moves a message to another area after it was published: the cheapest signal that the descriptions of the areas split the work the way the team does
// (docs/METODO-DE-REPARTO.md, section 9; third audit of the method, 2026-10-27, H-13). Every edit of a message stores the names of the fields it changed (`message_edits.fields_json`,
// src/domain/messages.js); a change of area carries `area_id`. The old value is not stored, so the rate says where reassigned messages landed and not where they came from.
//
//   node scripts/reassignment-rate.mjs --db /data/team.db [--since 2026-10-01]
import { all, openDatabase } from '../src/db/index.js'
import { pathToFileURL } from 'node:url'
import { wilson } from './area-method.mjs'

/** `{ messages, reassigned, rate, lower, upper, by_area }` over the messages published since `since` (ms), from an open database. */
export function reassignmentRate (db, { since = 0 } = {}) {
  const moved = new Set(all(db, 'SELECT message_id, fields_json FROM message_edits').filter((e) => {
    try { return JSON.parse(e.fields_json).includes('area_id') } catch { return false }
  }).map((e) => e.message_id))
  const messages = all(db, 'SELECT m.id, m.area_id, a.title FROM messages m LEFT JOIN areas a ON a.id = m.area_id WHERE m.deleted_at IS NULL AND m.created_at >= ?', since)
  const total = messages.length
  const hit = messages.filter((m) => moved.has(m.id))
  const w = wilson(hit.length, total)
  const by = new Map()
  for (const m of hit) by.set(m.title ?? '(sin área)', (by.get(m.title ?? '(sin área)') ?? 0) + 1)
  return { messages: total, reassigned: hit.length, rate: Math.round(w.p * 1000) / 1000, lower: Math.round(w.lower * 1000) / 1000, upper: Math.round(w.upper * 1000) / 1000, by_area: [...by].map(([area, n]) => ({ area, reassigned_to: n })).sort((a, b) => b.reassigned_to - a.reassigned_to) }
}

function main (argv) {
  const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
  const db = openDatabase(flag('--db') ?? process.env.DB_PATH ?? '/data/team.db')
  const since = flag('--since') ? Date.parse(flag('--since')) : 0
  if (Number.isNaN(since)) { console.error('Uso: node scripts/reassignment-rate.mjs --db FILE [--since AAAA-MM-DD]'); process.exit(2) }
  process.stdout.write(`${JSON.stringify(reassignmentRate(db, { since }), null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2))
