// UD-293: each template carries `progress_interval_min`, the minutes between two progress notices while Claude works. 20 by default (Martín, 2026-10-25),
// 0 turns the notices off, and the rows that existed before migration 0035 start at 20.
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { listMigrations, migrate, openDatabase } from '../db/index.js'
import { DEFAULT_PROGRESS_INTERVAL_MIN, MAX_PROGRESS_INTERVAL_MIN } from '../domain/progress-notes.js'
import { addMember, login, makeEnv, tempDir } from '../testing/helpers.js'

const MIGRATIONS = fileURLToPath(new URL('../db/migrations', import.meta.url))

const FILE = `---
name: Plantilla de avisos
description: Prueba del intervalo de avisos.
fields:
  - { name: steps, label: Pasos, required: true }
---
## Método
Leer el input.
`

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

test('the default is 20 and the rows that existed before the migration start at 20', () => {
  assert.equal(DEFAULT_PROGRESS_INTERVAL_MIN, 20)
  const dir = tempDir()
  const old = join(dir, 'old')
  mkdirSync(old)
  for (const m of listMigrations(MIGRATIONS).filter((f) => Number(f.filePath.slice(0, 4)) < 35)) copyFileSync(join(MIGRATIONS, m.filePath), join(old, m.filePath))
  const db = openDatabase(join(dir, 'team.db'))
  migrate(db, { dir: old })
  db.exec(`
    INSERT INTO areas (id, title, description) VALUES (1, 'Error', 'd');
    INSERT INTO templates (id, area_id, name, description, body_markdown, updated_at) VALUES (1, 1, 'Vieja', 'd', '---\nname: Vieja\ndescription: d\n---\n', 1);
  `)
  migrate(db, { dir: MIGRATIONS })
  assert.equal(db.prepare('SELECT progress_interval_min AS n FROM templates WHERE id = 1').get().n, 20)
  db.exec("INSERT INTO templates (id, area_id, name, description, body_markdown, updated_at) VALUES (2, 1, 'Nueva', 'd', 'x', 1)")
  assert.equal(db.prepare('SELECT progress_interval_min AS n FROM templates WHERE id = 2').get().n, 20, 'a template created without a value takes the default')
  assert.throws(() => db.exec('UPDATE templates SET progress_interval_min = -1 WHERE id = 1'), /CHECK/)
})

test('a template is created with 20, edited to 0 (off) and to another value, and a value out of range is a 400', async () => {
  const env = await team()
  try {
    const [area] = (await env.api('GET', '/areas', env.c.ed)).json()
    assert.ok(area.templates.length > 0 && area.templates.every((t) => t.progress_interval_min === 20), 'the seeded templates show 20 in the list of areas')

    const created = await env.api('POST', `/areas/${area.id}/templates`, env.c.ed, { body_markdown: FILE })
    assert.equal(created.statusCode, 201, created.body)
    assert.equal(created.json().progress_interval_min, 20)
    const id = created.json().id

    const off = await env.api('PATCH', `/areas/${area.id}/templates/${id}`, env.c.ed, { progress_interval_min: 0 })
    assert.equal(off.statusCode, 200, off.body)
    assert.equal(off.json().progress_interval_min, 0, '0 turns the notices off')
    assert.equal(env.db.prepare('SELECT progress_interval_min AS n FROM templates WHERE id = ?').get(id).n, 0)
    assert.equal(off.json().body_markdown, FILE, 'changing the interval leaves the file as it was')

    const other = await env.api('PATCH', `/areas/${area.id}/templates/${id}`, env.c.ed, { progress_interval_min: 7 })
    assert.equal(other.json().progress_interval_min, 7)
    const renamed = await env.api('PATCH', `/areas/${area.id}/templates/${id}`, env.c.ed, { name: 'Otro nombre' })
    assert.equal(renamed.json().progress_interval_min, 7, 'editing something else keeps the interval')

    for (const bad of [-1, MAX_PROGRESS_INTERVAL_MIN + 1, 2.5, 'veinte']) {
      const res = await env.api('PATCH', `/areas/${area.id}/templates/${id}`, env.c.ed, { progress_interval_min: bad })
      assert.equal(res.statusCode, 400, `${JSON.stringify(bad)}: ${res.body}`)
    }
    const withValue = await env.api('POST', `/areas/${area.id}/templates`, env.c.ed, { body_markdown: FILE.replace('Plantilla de avisos', 'Con intervalo'), progress_interval_min: 45 })
    assert.equal(withValue.json().progress_interval_min, 45)

    const read = (await env.api('GET', `/areas/${area.id}/templates`, env.c.ana)).json().find((t) => t.id === id)
    assert.equal(read.progress_interval_min, 7, 'any member reads it')
    const denied = await env.api('PATCH', `/areas/${area.id}/templates/${id}`, env.c.ana, { progress_interval_min: 1 })
    assert.equal(denied.statusCode, 403, 'only the Editor changes configured texts')
  } finally {
    await env.close()
  }
})
