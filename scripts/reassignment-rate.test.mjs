import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { reassignmentRate } from './reassignment-rate.mjs'

// Third audit of the method (H-13): the rate at which people move a message to another area, read from the field names that each edit stores.
test('the rate counts a message once however many times it was moved, by the area it landed in, and ignores other edits', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE areas (id INTEGER PRIMARY KEY, title TEXT); CREATE TABLE messages (id INTEGER PRIMARY KEY, area_id INTEGER, created_at INTEGER, deleted_at INTEGER); CREATE TABLE message_edits (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER, fields_json TEXT)')
  db.exec("INSERT INTO areas VALUES (1, 'Pantallas'), (2, 'Datos')")
  for (let i = 1; i <= 10; i++) db.prepare('INSERT INTO messages VALUES (?, ?, ?, NULL)').run(i, i <= 6 ? 1 : 2, 1000 + i)
  db.exec(`INSERT INTO message_edits (message_id, fields_json) VALUES (1, '["area_id","template_id"]'), (1, '["area_id"]'), (7, '["area_id"]'), (2, '["title"]'), (3, 'dañado')`)
  const r = reassignmentRate(db)
  assert.deepEqual([r.messages, r.reassigned, r.rate], [10, 2, 0.2])
  assert.deepEqual(r.by_area, [{ area: 'Pantallas', reassigned_to: 1 }, { area: 'Datos', reassigned_to: 1 }])
  assert.ok(r.lower < 0.2 && r.upper > 0.2)
  assert.equal(reassignmentRate(db, { since: 1008 }).messages, 3, 'only the messages published since the date')
})
