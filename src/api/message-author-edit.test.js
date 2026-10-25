// UD-071: only the sender edits a published message; every edit leaves its history and bumps the version.
// Every check is a prohibition: another person, an Editor, a stale version or a trick cannot change a message.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { parseTemplate } from '../domain/template-file.js'
import { addMember, login, makeEnv, multipart, postInput, until } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, autoPublish: true, worker: true })
  env.ids = {
    ed: await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' }),
    ana: await addMember(env, { email: 'ana@x.org', name: 'Ana' }),
    beto: await addMember(env, { email: 'beto@x.org', name: 'Beto' }),
    carla: await addMember(env, { email: 'carla@x.org', name: 'Carla' })
  }
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org'), carla: await login(env, 'carla@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

/** A message of Ana's born from a published input with one attachment. Returns its detail and the input id. */
async function published (env, text = 'algo que pasó') {
  const file = { field: 'files', name: 'a.txt', type: 'text/plain', content: `contenido ${text}` }
  const { input_id: inputId } = (await postInput(env, env.c.ana, { text }, [file])).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${inputId}`, env.c.ana)).json()
    return v.status === 'published' ? v : null
  })
  return { inputId, message: (await env.api('GET', `/messages/${view.message_ids[0]}`, env.c.ana)).json() }
}

const fieldsOf = (env, templateId) => Object.fromEntries(parseTemplate(get(env.db, 'SELECT body_markdown FROM templates WHERE id = ?', templateId).body_markdown).fields.filter((f) => f.required).map((f) => [f.name, 'dato']))
const otherArea = (env, message) => {
  const area = get(env.db, 'SELECT a.id, t.id AS template_id FROM areas a JOIN templates t ON t.area_id = a.id WHERE a.id <> ? AND a.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY a.position, a.id', Number(message.area_id))
  return { area_id: area.id, template_id: area.template_id, fields: fieldsOf(env, area.template_id) }
}
const snapshot = (env, id) => JSON.stringify(get(env.db, 'SELECT * FROM messages WHERE id = ?', id)) + JSON.stringify(all(env.db, 'SELECT * FROM message_edits WHERE message_id = ?', id)) + JSON.stringify(all(env.db, 'SELECT * FROM message_assignees WHERE message_id = ? ORDER BY member_id', id))

test('UD-071 · the sender edits everything about their message and each edit leaves its history, its version and «edited»', async () => {
  const env = await team()
  const { message } = await published(env)
  assert.equal(message.version, 1)
  assert.equal(message.edited_at, null)
  assert.deepEqual(message.edits, [])
  const target = otherArea(env, message)

  const r = await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, title: 'Título nuevo', body: 'Texto nuevo', ...target, assignee_ids: [env.ids.beto], attachment_ids: [] })
  assert.equal(r.statusCode, 200, r.body)
  const edited = r.json()
  assert.equal(edited.title, 'Título nuevo')
  assert.equal(edited.body, 'Texto nuevo')
  assert.equal(edited.area_id, String(target.area_id)) // the message moved to the other area
  assert.deepEqual(edited.assignee_ids, [String(env.ids.beto)])
  assert.deepEqual(edited.attachments, [])
  assert.equal(edited.version, 2)
  assert.ok(edited.edited_at)
  assert.equal(edited.edits.length, 1)
  assert.equal(edited.edits[0].member_id, String(env.ids.ana))
  assert.equal(edited.edits[0].version, 2)
  for (const f of ['title', 'body', 'area_id', 'assignee_ids', 'attachment_ids']) assert.ok(edited.edits[0].fields.includes(f), f)
  // The message is now in the list of its new area.
  const list = (await env.api('GET', `/messages?area=${target.area_id}`, env.c.beto)).json()
  assert.ok(list.items.some((m) => m.id === message.id))
  assert.equal(list.items.find((m) => m.id === message.id).edited_at, edited.edited_at)
  await env.close()
})

test('UD-071 · nobody else edits a message: another member and the Editor get 403 not_message_author and nothing changes', async () => {
  const env = await team()
  const { message } = await published(env)
  const before = snapshot(env, message.id)
  for (const who of ['beto', 'ed', 'carla']) {
    for (const patch of [{ version: 1, title: 'robado' }, { version: 1, assignee_ids: [env.ids[who]] }, { version: 1, body: 'x', title: 'y' }]) {
      const r = await env.api('PATCH', `/messages/${message.id}`, env.c[who], patch)
      assert.equal(r.statusCode, 403, `${who}: ${r.body}`)
      assert.equal(r.json().code, 'not_message_author')
    }
  }
  assert.equal(snapshot(env, message.id), before)
  await env.close()
})

test('UD-071 · tricks fail: another id, a nonexistent one, a missing version, and fields that are not editable', async () => {
  const env = await team()
  const { message } = await published(env, 'primero')
  const { message: second } = await published(env, 'segundo')
  const before = snapshot(env, message.id)

  // Ana edits her own second message through its own id, and cannot reach Beto's.
  assert.equal((await env.api('PATCH', `/messages/${second.id}`, env.c.ana, { version: 1, title: 'mío' })).statusCode, 200)
  assert.equal((await env.api('PATCH', '/messages/999999', env.c.ana, { version: 1, title: 'x' })).statusCode, 404)
  assert.equal((await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { title: 'sin versión' })).statusCode, 400)
  assert.equal((await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1 })).statusCode, 400)
  for (const extra of [{ author_id: env.ids.beto }, { status: 'closed' }, { input_id: 1 }, { created_at: 'x' }, { version: 1, id: 7 }]) {
    const r = await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, title: 'x', ...extra })
    assert.equal(r.statusCode, 400, JSON.stringify(extra))
  }
  assert.equal(snapshot(env, message.id), before)
  await env.close()
})

test('UD-071 · a patch that changes nothing leaves the message, its version and its history as they were', async () => {
  const env = await team()
  const { message } = await published(env)
  const before = snapshot(env, message.id)
  const r = await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, title: message.title, body: message.body, assignee_ids: message.assignee_ids.map(Number) })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().version, 1)
  assert.equal(r.json().edited_at, null)
  assert.equal(snapshot(env, message.id), before)
  await env.close()
})

test('UD-071 · a stale version is a 409 edit_conflict with the current version and writes nothing', async () => {
  const env = await team()
  const { message } = await published(env)
  assert.equal((await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, title: 'primera' })).statusCode, 200)
  const before = snapshot(env, message.id)
  const stale = await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, title: 'desde la pestaña vieja' })
  assert.equal(stale.statusCode, 409)
  assert.equal(stale.json().code, 'edit_conflict')
  assert.equal(stale.json().version, 2)
  assert.equal(snapshot(env, message.id), before)
  assert.equal((await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 2, title: 'con la vigente' })).statusCode, 200)
  await env.close()
})

test('UD-071 · two simultaneous patches with the same version: exactly one wins, the other is a 409, and the history has one row', async () => {
  const env = await team()
  const { message } = await published(env)
  const results = await Promise.all([
    env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, title: 'A' }),
    env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, title: 'B' })
  ])
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409])
  const row = get(env.db, 'SELECT title, version FROM messages WHERE id = ?', message.id)
  assert.equal(row.version, 2)
  assert.equal(row.title, results.find((r) => r.statusCode === 200).json().title)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM message_edits WHERE message_id = ?', message.id).n, 1)
  await env.close()
})

test('UD-071 · changing the recipients notifies only the new ones, with a directed notice, and never the sender', async () => {
  const env = await team()
  const { message } = await published(env)
  const noticesBefore = all(env.db, "SELECT seq FROM job_events WHERE kind = 'message' AND json_extract(data_json, '$.reason') IS NOT 'changed'").length
  const r = await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, assignee_ids: [env.ids.ed, env.ids.beto] })
  assert.equal(r.statusCode, 200, r.body)
  const rows = all(env.db, "SELECT member_id, data_json FROM job_events WHERE kind = 'message' AND json_extract(data_json, '$.reason') IS NOT 'changed' ORDER BY seq").slice(noticesBefore)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].member_id, env.ids.beto)
  assert.equal(JSON.parse(rows[0].data_json).reason, 'assigned')
  assert.equal(JSON.parse(rows[0].data_json).message_id, Number(message.id))

  // Removing and re-adding the same person later notifies again; keeping the same set notifies nobody.
  const same = await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 2, assignee_ids: [env.ids.beto, env.ids.ed] })
  assert.equal(same.statusCode, 200)
  assert.equal(all(env.db, "SELECT seq FROM job_events WHERE kind = 'message' AND json_extract(data_json, '$.reason') IS NOT 'changed'").length, noticesBefore + 1)
  await env.close()
})

test('UD-071 · changing the area needs a template of that area, and the fields are checked against it', async () => {
  const env = await team()
  const { message } = await published(env)
  const target = otherArea(env, message)
  const noTemplate = await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, area_id: target.area_id })
  assert.equal(noTemplate.statusCode, 400)
  assert.equal(noTemplate.json().code, 'template_required')
  const wrongTemplate = await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, area_id: target.area_id, template_id: Number(message.template_id) === target.template_id ? 999999 : Number(message.template_id) })
  assert.equal(wrongTemplate.statusCode, 400)
  assert.equal(get(env.db, 'SELECT version FROM messages WHERE id = ?', message.id).version, 1)
  await env.close()
})

test('UD-071 · attachments are chosen only among those of the message\'s own input', async () => {
  const env = await team()
  const { message } = await published(env, 'uno')
  const { message: other } = await published(env, 'dos')
  const foreign = other.attachments[0].id
  const r = await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, attachment_ids: [Number(foreign)] })
  assert.equal(r.statusCode, 400)
  assert.equal(r.json().code, 'attachment_invalid')
  assert.equal(get(env.db, 'SELECT version FROM messages WHERE id = ?', message.id).version, 1)
  await env.close()
})

test('UD-071 · the sender still edits a closed message; replying, closing and reopening stay open to everybody (§1.1)', async () => {
  const env = await team()
  const { message } = await published(env)
  assert.equal((await env.api('POST', `/messages/${message.id}/replies`, env.c.beto, { body: 'hecho', kind: 'answer' })).statusCode, 201)
  assert.equal((await env.api('POST', `/messages/${message.id}/close`, env.c.ed)).statusCode, 200) // an Editor closes
  const closedEdit = await env.api('PATCH', `/messages/${message.id}`, env.c.ana, { version: 1, title: 'corregido tras cerrar' })
  assert.equal(closedEdit.statusCode, 200, closedEdit.body)
  assert.equal(closedEdit.json().status, 'closed') // an edit does not reopen it
  assert.equal((await env.api('POST', `/messages/${message.id}/reopen`, env.c.carla)).statusCode, 200)
  assert.equal((await env.api('POST', `/messages/${message.id}/replies`, env.c.ana, { body: 'yo no', kind: 'answer' })).statusCode, 403) // the sender still cannot reply to their own
  await env.close()
})

test('UD-071 · the sender adds files and links to a published message as one edit; nobody else does, and a stale version is refused', async () => {
  const env = await team()
  const { message } = await published(env)
  const upload = (cookie, version, links = []) => async () => {
    const { payload, headers } = await multipart({ version: String(version), links }, [{ field: 'files', name: 'nueva.png', type: 'image/png', content: 'PNG!' }])
    return env.app.inject({ method: 'POST', url: `/api/messages/${message.id}/attachments`, payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
  }
  const before = snapshot(env, message.id)
  for (const who of ['beto', 'ed']) {
    const r = await upload(env.c[who], 1)()
    assert.equal(r.statusCode, 403, who)
    assert.equal(r.json().code, 'not_message_author')
  }
  const stale = await upload(env.c.ana, 7)()
  assert.equal(stale.statusCode, 409)
  assert.equal(stale.json().code, 'edit_conflict')
  assert.equal(snapshot(env, message.id), before)

  const r = await upload(env.c.ana, 1, ['https://example.org/doc'])()
  assert.equal(r.statusCode, 201, r.body)
  const edited = r.json()
  assert.equal(edited.attachments.length, message.attachments.length + 2)
  assert.deepEqual(edited.attachments.slice(-2).map((a) => a.kind), ['image', 'link'])
  assert.equal(edited.version, 2)
  assert.deepEqual(edited.edits[0].fields, ['attachment_ids'])
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM jobs WHERE kind = 'extract'").n >= 2, true)
  await env.close()
})
