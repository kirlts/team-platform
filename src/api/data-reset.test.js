// UD-240, H-3704: POST /ops/reset empties the test data in both scopes, keeps who asks, seeds the areas again and frees the blobs.
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { setProjectDescription } from '../domain/settings.js'
import { loadSeed } from '../analyze/seed.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

async function populated () {
  const env = await makeEnv({ worker: true, autoPublish: true, config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  const sent = await postInput(env, env.c.ana, { text: 'el botón no responde' }, [{ name: 'foto.png', type: 'image/png', content: 'PNG-bytes-1' }])
  assert.equal(sent.statusCode, 202, sent.body)
  await until(() => (get(env.db, 'SELECT status FROM inputs WHERE id = ?', sent.json().input_id)?.status === 'published'))
  const message = get(env.db, 'SELECT id FROM messages')
  const reply = await env.api('POST', `/messages/${message.id}/replies`, env.c.ed, { body: 'revisado', kind: 'answer' })
  assert.equal(reply.statusCode, 201, reply.body)
  setProjectDescription(env.db, 'Proyecto de prueba')
  env.db.exec("INSERT INTO provider_connections (name, label, kind, created_at, updated_at) VALUES ('deepseek', 'DeepSeek', 'openai-compatible', 1, 1)")
  env.areaExtra = (await env.api('POST', '/areas', env.c.ed, { title: 'Extra', description: 'Área de prueba' })).json().id
  return env
}

const blobs = (env) => existsSync(env.config.attachmentsDir) ? readdirSync(env.config.attachmentsDir) : []

test('without confirm=true it is a 400 and nothing is deleted; a member receives 403; an unknown scope is a 400', async () => {
  const env = await populated()
  try {
    const without = await env.api('POST', '/ops/reset', env.c.ed, { scope: 'content' })
    assert.equal(without.statusCode, 400)
    assert.equal(without.json().code, 'confirm_required')
    assert.equal((await env.api('POST', '/ops/reset?confirm=true', env.c.ana, { scope: 'content' })).statusCode, 403)
    assert.equal((await env.api('POST', '/ops/reset?confirm=true', env.c.ed, { scope: 'all' })).statusCode, 400)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM messages').n, 1)
    assert.equal(blobs(env).length, 1)
  } finally { await env.close() }
})

test('content: empties the content tables and the blobs, returns the figures, keeps members, areas, settings, connections and the audit history', async () => {
  const env = await populated()
  try {
    const auditBefore = get(env.db, 'SELECT COUNT(*) AS n FROM audit_log').n
    assert.ok(auditBefore > 0)
    const r = await env.api('POST', '/ops/reset?confirm=true', env.c.ed, { scope: 'content' })
    assert.equal(r.statusCode, 200, r.body)
    const body = r.json()
    assert.equal(body.scope, 'content')
    assert.equal(body.deleted.inputs, 1)
    assert.equal(body.deleted.messages, 1)
    assert.equal(body.deleted.replies, 1)
    assert.equal(body.deleted.attachments, 1)
    assert.ok(body.deleted.jobs >= 1)
    assert.equal(body.files, 1)
    assert.ok(body.bytes_freed > 0)
    assert.equal(body.deleted.members, undefined)
    for (const t of ['inputs', 'attachments', 'jobs', 'job_events', 'proposals', 'messages', 'message_assignees', 'message_attachments', 'replies', 'spans']) {
      assert.equal(get(env.db, `SELECT COUNT(*) AS n FROM ${t}`).n, 0, t)
    }
    assert.equal(blobs(env).length, 0)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM members').n, 2)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM areas').n, 6)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM provider_connections').n, 1)
    assert.ok(get(env.db, "SELECT value_json FROM settings WHERE key = 'project_description'"))
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM audit_log').n, auditBefore + 1)
    const row = get(env.db, "SELECT * FROM audit_log WHERE action = 'data.reset'")
    assert.deepEqual(JSON.parse(row.detail_json).deleted, body.deleted)
    assert.equal((await env.api('GET', '/me', env.c.ana)).statusCode, 200) // sessions stay
  } finally { await env.close() }
})

test('everything: only who asks remains, areas and templates go back to the initial set, settings and connections stay', async () => {
  const env = await populated()
  try {
    const r = await env.api('POST', '/ops/reset?confirm=true', env.c.ed, { scope: 'everything' })
    assert.equal(r.statusCode, 200, r.body)
    const body = r.json()
    assert.equal(body.deleted.members, 1)
    assert.equal(body.deleted.areas, 6)
    assert.equal(body.deleted.templates, 5)
    assert.deepEqual(all(env.db, 'SELECT email FROM members').map((m) => m.email), ['ed@x.org'])
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM credentials').n, 1)
    assert.equal((await env.api('GET', '/me', env.c.ana)).statusCode, 401) // her session went with her
    assert.equal((await env.api('GET', '/me', env.c.ed)).statusCode, 200)
    const seed = await loadSeed(env.config.templatesDir)
    assert.deepEqual(all(env.db, 'SELECT title FROM areas ORDER BY id').map((a) => a.title), seed.areas.map((a) => a.title))
    assert.deepEqual(all(env.db, 'SELECT name FROM templates ORDER BY id').map((t) => t.name), seed.templates.map((t) => t.name))
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM areas WHERE deleted_at IS NOT NULL').n, 0)
    assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM provider_connections').n, 1)
    assert.ok(get(env.db, "SELECT value_json FROM settings WHERE key = 'project_description'"))
    assert.equal(blobs(env).length, 0)
    // The panel reads the areas through the API as a fresh installation would.
    const areas = (await env.api('GET', '/areas', env.c.ed)).json()
    assert.equal(areas.length, seed.areas.length)
  } finally { await env.close() }
})
