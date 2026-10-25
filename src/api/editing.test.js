// UD-017: in-place editing. PATCH /inputs/:id/proposal (the draft survives closing the tab) and PATCH /messages/:id.
// Every check is a prohibition and cites the decision or the HP row it protects. There is no version history table.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get, run } from '../db/index.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

const TEXT_FILE = (name) => ({ field: 'files', name, type: 'text/plain', content: 'contenido de prueba' })
const PNG_FILE = (name) => ({ field: 'files', name, type: 'image/png', content: 'PNG!' })

async function team (opts = {}) {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, ...opts })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  await addMember(env, { email: 'beto@x.org', name: 'Beto' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org'), beto: await login(env, 'beto@x.org') }
  // UD-071: editing a message carries the version it read. These tests are about what is edited, not about the
  // concurrency check (src/api/message-author-edit.test.js), so a patch without `version` reads the current one.
  env.api = (method, url, cookie, payload) => {
    const target = method === 'PATCH' ? /^\/messages\/(\d+)$/.exec(url) : null
    const row = target ? get(env.db, 'SELECT version FROM messages WHERE id = ?', Number(target[1])) : null
    const body = row && payload && payload.version === undefined ? { ...payload, version: row.version } : payload
    return env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload: body })
  }
  return env
}

/** An input of Ana with a proposal ready, plus the base message of that proposal and the areas. */
async function proposed (env, files = [TEXT_FILE('a.txt')]) {
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'algo que pasó' }, files)).json()
  const view = await until(async () => {
    const v = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
    if (v.status === 'failed') throw new Error(v.error)
    return v.status === 'proposed' ? v : null
  })
  const areas = (await env.api('GET', '/areas', env.c.ana)).json()
  return { id, view, base: view.proposal.messages[0], error: areas.find((a) => a.title === 'Error'), idea: areas.find((a) => a.title === 'Idea'), question: areas.find((a) => a.title === 'Pregunta') }
}

const ERROR_FIELDS = { steps: 'abrir', expected: 'guarda', actual: 'no guarda' }

// ---------------------------------------------------------------- PATCH /inputs/:id/proposal
test('UD-017 · the author saves the proposal as a draft that survives, and publishing without a body publishes it', async () => {
  const env = await team({ worker: true })
  const { id, view, base, error } = await proposed(env)
  const draft = { messages: [{ ...base, title: 'Guardar no responde', area_id: error.id, template_id: error.templates[0].id, fields: ERROR_FIELDS, assignee_ids: [3] }], discarded: [] }

  const saved = await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, draft)
  assert.equal(saved.statusCode, 200, saved.body)
  assert.equal(saved.json().messages[0].title, 'Guardar no responde')
  assert.deepEqual(saved.json().messages[0].assignee_ids, ['3']) // ids travel as text
  assert.equal(saved.json().messages[0].area_id, String(error.id))
  assert.deepEqual(saved.json().messages[0].fields, ERROR_FIELDS)

  // A new request, as after closing and reopening the tab: the saved draft is what the input shows.
  const again = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json()
  assert.deepEqual(again.proposal, saved.json())
  assert.equal(again.status, 'proposed') // saving a draft publishes nothing (HP-005)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM messages').n, 0)
  assert.notEqual(again.proposal.messages[0].title, view.proposal.messages[0].title)

  const published = await env.api('POST', `/inputs/${id}/publish`, env.c.ana) // no body
  assert.equal(published.statusCode, 200, published.body)
  assert.equal(published.json().messages[0].title, 'Guardar no responde')
  assert.equal(published.json().messages[0].area_id, String(error.id))
  assert.deepEqual(published.json().messages[0].assignee_ids, ['3'])
  await env.close()
})

test('UD-017 · publishing with a body still publishes that body and ignores the draft', async () => {
  const env = await team({ worker: true })
  const { id, base } = await proposed(env)
  await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, { messages: [{ ...base, title: 'borrador' }] })
  const r = await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [{ ...base, title: 'cuerpo enviado' }] })
  assert.equal(r.json().messages[0].title, 'cuerpo enviado')
  await env.close()
})

test('UD-017 · HP-005 · another member, even an editor, cannot patch someone else\'s proposal (403) and nothing changes', async () => {
  const env = await team({ worker: true })
  const { id, base } = await proposed(env)
  const before = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json().proposal
  for (const who of ['beto', 'ed']) {
    const r = await env.api('PATCH', `/inputs/${id}/proposal`, env.c[who], { messages: [{ ...base, title: 'robado' }] })
    assert.equal(r.statusCode, 403, `${who}: ${r.body}`)
    assert.equal(r.json().code, 'not_input_author')
  }
  assert.deepEqual((await env.api('GET', `/inputs/${id}`, env.c.ana)).json().proposal, before)
  assert.equal((await env.api('PATCH', '/inputs/9999/proposal', env.c.ana, { messages: [base] })).statusCode, 404)
  const anonymous = await env.app.inject({ method: 'PATCH', url: `/api/inputs/${id}/proposal`, headers: { 'x-team-request': 'panel' }, payload: { messages: [base] } })
  assert.equal(anonymous.statusCode, 401)
  await env.close()
})

test('UD-017 · a proposal cannot be patched after publish (409), nor before it exists', async () => {
  const env = await team({ worker: true })
  const { id, base } = await proposed(env)
  await env.api('POST', `/inputs/${id}/publish`, env.c.ana, { messages: [base] })
  const late = await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, { messages: [{ ...base, title: 'tarde' }] })
  assert.equal(late.statusCode, 409)
  assert.equal(late.json().code, 'already_published')
  assert.equal(get(env.db, 'SELECT title FROM messages').title, base.title)

  // An input still in the queue has no proposal to edit.
  const idle = await team()
  const queued = (await postInput(idle, idle.c.ana, { text: 'en cola' })).json().input_id
  const r = await idle.api('PATCH', `/inputs/${queued}/proposal`, idle.c.ana, { messages: [{ area_id: 1, title: 'x', body: 'y' }] })
  assert.equal(r.statusCode, 409)
  assert.equal(r.json().code, 'not_proposed')
  await idle.close()
  await env.close()
})

test('UD-017 · HP-014 · an invalid area, template, member, attachment or unit in a draft is 400 with a Spanish message, and nothing is saved', async () => {
  const env = await team({ worker: true })
  const { id, base, error, idea } = await proposed(env)
  const before = (await env.api('GET', `/inputs/${id}`, env.c.ana)).json().proposal
  const patchIt = (edits) => env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, { messages: [{ ...base, ...edits }] })
  const cases = [
    [{ area_id: 999 }, 'area_invalid', /área/],
    [{ template_id: 999 }, 'template_invalid', /plantilla/],
    [{ area_id: idea.id, template_id: error.templates[0].id }, 'template_invalid', /plantilla/], // template of another area
    [{ assignee_ids: [999] }, 'assignee_invalid', /miembro 999 no existe/],
    [{ attachment_ids: [999] }, 'attachment_invalid', /adjunto/],
    [{ unit_ids: [999] }, 'unit_invalid', /unidad 999/]
  ]
  for (const [edits, code, message] of cases) {
    const r = await patchIt(edits)
    assert.equal(r.statusCode, 400, `${code}: ${r.body}`)
    assert.equal(r.json().code, code)
    assert.match(r.json().message, message)
  }
  const discarded = await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, { messages: [base], discarded: [{ unit_ids: [999], reason: 'x' }] })
  assert.equal(discarded.json().code, 'unit_invalid')
  assert.equal((await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, { messages: [] })).statusCode, 400)
  assert.deepEqual((await env.api('GET', `/inputs/${id}`, env.c.ana)).json().proposal, before)
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'input.proposal.update'").n, 0)
  await env.close()
})

test('UD-017 · a draft with a title, a text or a required template field still empty is accepted and stored; publishing refuses it (422)', async () => {
  const env = await team({ worker: true })
  const { id, base, error } = await proposed(env)
  const incomplete = { messages: [{ ...base, title: '', body: '', area_id: error.id, template_id: error.templates[0].id, fields: { steps: 'abrir' } }], discarded: [] }
  const saved = await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, incomplete)
  assert.equal(saved.statusCode, 200, saved.body)
  assert.equal(saved.json().messages[0].title, '')
  assert.deepEqual(saved.json().messages[0].fields, { steps: 'abrir' })
  assert.deepEqual((await env.api('GET', `/inputs/${id}`, env.c.ana)).json().proposal, saved.json()) // stored, not just echoed

  const refused = await env.api('POST', `/inputs/${id}/publish`, env.c.ana) // publish enforces completeness
  assert.equal(refused.statusCode, 422)
  assert.equal(refused.json().code, 'message_invalid')
  const filled = { messages: [{ ...incomplete.messages[0], title: 'Listo', body: 'Con texto' }] }
  assert.equal((await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, filled)).statusCode, 200)
  const noFields = await env.api('POST', `/inputs/${id}/publish`, env.c.ana)
  assert.equal(noFields.statusCode, 422)
  assert.equal(noFields.json().code, 'fields_invalid')
  assert.match(noFields.json().message, /expected|actual/)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM messages').n, 0)
  await env.close()
})

test('UD-017 · a draft with an unknown field is 400, at the top level and inside a message', async () => {
  const env = await team({ worker: true })
  const { id, base } = await proposed(env)
  const top = await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, { messages: [base], extra: 1 })
  assert.equal(top.statusCode, 400)
  assert.equal(top.json().code, 'validation')
  assert.match(top.json().message, /extra/)
  const nested = await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, { messages: [{ ...base, priority: 'alta' }] })
  assert.equal(nested.statusCode, 400)
  assert.match(nested.json().message, /priority/)
  await env.close()
})

test('UD-017 · saving a draft leaves an audit row, and saving the same draft twice leaves the same state', async () => {
  const env = await team({ worker: true })
  const { id, base } = await proposed(env)
  const draft = { messages: [{ ...base, title: 'Una vez' }], discarded: [] }
  const first = await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, draft)
  const snapshot = () => ({
    proposal: get(env.db, 'SELECT payload_json FROM proposals WHERE input_id = ?', id).payload_json,
    input: (({ updated_at: _u, ...rest }) => ({ ...rest }))(get(env.db, 'SELECT * FROM inputs WHERE id = ?', id)),
    audit: all(env.db, "SELECT member_id, action, entity, entity_id FROM audit_log WHERE action = 'input.proposal.update'").map((r) => ({ ...r }))
  })
  const once = snapshot()
  assert.deepEqual(once.audit, [{ member_id: 2, action: 'input.proposal.update', entity: 'input', entity_id: Number(id) }])
  const second = await env.api('PATCH', `/inputs/${id}/proposal`, env.c.ana, draft)
  assert.equal(second.statusCode, 200)
  assert.deepEqual(second.json(), first.json())
  assert.deepEqual(snapshot(), once) // same stored draft, same audit rows
  await env.close()
})

// ---------------------------------------------------------------- PATCH /messages/:id
/** A published message of Ana (type Error, template with required fields), assigned to nobody. */
async function published (env, { files = [TEXT_FILE('a.txt')], edits = {} } = {}) {
  const ctx = await proposed(env, files)
  const r = await env.api('POST', `/inputs/${ctx.id}/publish`, env.c.ana, { messages: [{ ...ctx.base, area_id: ctx.error.id, template_id: ctx.error.templates[0].id, title: 'Original', body: 'Cuerpo original', fields: ERROR_FIELDS, assignee_ids: [], ...edits }] })
  assert.equal(r.statusCode, 200, r.body)
  return { ...ctx, messageId: r.json().message_ids[0], message: r.json().messages[0] }
}

test('UD-017 · the author edits title, body, fields and assignees of a published message and gets it back', async () => {
  const env = await team({ worker: true })
  const { messageId } = await published(env)
  const r = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { title: 'Nuevo título', body: 'Nuevo cuerpo', fields: { ...ERROR_FIELDS, actual: 'se cuelga' }, assignee_ids: [3, 1] })
  assert.equal(r.statusCode, 200, r.body)
  const m = r.json()
  assert.equal(m.title, 'Nuevo título')
  assert.equal(m.body, 'Nuevo cuerpo')
  assert.equal(m.fields.actual, 'se cuelga')
  assert.deepEqual(m.assignee_ids, ['1', '3'])
  assert.equal(m.status, 'open')
  assert.deepEqual((await env.api('GET', `/messages/${messageId}`, env.c.beto)).json().title, 'Nuevo título')
  await env.close()
})

test('UD-017 · a field the template no longer asks for stays on the message and does not fail an edit; a new unknown field is 400', async () => {
  const env = await team({ worker: true })
  const { messageId } = await published(env)
  const stored = { ...ERROR_FIELDS, value_missing: 'nadie' }
  run(env.db, 'UPDATE messages SET fields_json = ? WHERE id = ?', JSON.stringify(stored), messageId)
  const edited = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { fields: { ...stored, actual: 'se cuelga' } })
  assert.equal(edited.statusCode, 200, edited.body)
  assert.deepEqual(edited.json().fields, { ...stored, actual: 'se cuelga' }) // what it had under the retired name is kept
  const invented = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { fields: { ...stored, inventado: 'x' } })
  assert.equal(invented.statusCode, 400)
  assert.equal(invented.json().code, 'fields_invalid')
  assert.equal(JSON.parse(get(env.db, 'SELECT fields_json FROM messages WHERE id = ?', messageId).fields_json).inventado, undefined)
  await env.close()
})

test('UD-071 · only the sender edits a message: another member and an editor get 403 and nothing changes', async () => {
  const env = await team({ worker: true })
  const { messageId } = await published(env)
  for (const who of ['beto', 'ed']) {
    const denied = await env.api('PATCH', `/messages/${messageId}`, env.c[who], { title: 'ajeno' })
    assert.equal(denied.statusCode, 403, who)
    assert.equal(denied.json().code, 'not_message_author')
  }
  assert.equal(get(env.db, 'SELECT title FROM messages WHERE id = ?', messageId).title, 'Original')
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.update'").n, 0)
  assert.equal((await env.api('PATCH', '/messages/9999', env.c.ed, { version: 1, title: 'x' })).statusCode, 404)
  await env.close()
})

test('UD-017 · an answered or a closed message can still be edited, and its status and thread are untouched', async () => {
  const env = await team({ worker: true })
  const { messageId } = await published(env)
  await env.api('POST', `/messages/${messageId}/replies`, env.c.beto, { body: 'ya lo vi' })
  const answered = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { title: 'Respondido, editado' })
  assert.equal(answered.statusCode, 200)
  assert.equal(answered.json().status, 'answered')
  assert.equal(answered.json().replies.length, 1)
  await env.api('POST', `/messages/${messageId}/close`, env.c.beto)
  const closed = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { body: 'Cerrado, editado' })
  assert.equal(closed.statusCode, 200)
  assert.equal(closed.json().status, 'closed')
  assert.ok(closed.json().closed_at)
  assert.equal(closed.json().body, 'Cerrado, editado')
  await env.close()
})

test('UD-017 · changing the area requires a template of that area; with it, the fields are checked against the new template', async () => {
  const env = await team({ worker: true })
  const { messageId, idea, error } = await published(env)
  const noTemplate = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { area_id: idea.id })
  assert.equal(noTemplate.statusCode, 400)
  assert.equal(noTemplate.json().code, 'template_required')
  assert.match(noTemplate.json().message, /plantilla/)
  const wrongArea = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { area_id: idea.id, template_id: error.templates[0].id, fields: ERROR_FIELDS })
  assert.equal(wrongArea.json().code, 'template_invalid')
  const staleFields = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { area_id: idea.id, template_id: idea.templates[0].id })
  assert.equal(staleFields.statusCode, 400) // the old fields do not fit the new template
  assert.equal(staleFields.json().code, 'fields_invalid')
  assert.equal(get(env.db, 'SELECT area_id FROM messages WHERE id = ?', messageId).area_id, Number(error.id))

  const moved = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { area_id: idea.id, template_id: idea.templates[0].id, fields: { idea: 'una idea', motivation: 'porque sí' } })
  assert.equal(moved.statusCode, 200, moved.body)
  assert.equal(moved.json().area_id, String(idea.id))
  assert.equal(moved.json().template_id, String(idea.templates[0].id))
  assert.deepEqual(moved.json().fields, { idea: 'una idea', motivation: 'porque sí' })
  await env.close()
})

test('UD-017 · an invalid member, area or template id is 400 with a Spanish message; an unknown field is 400; nothing changes', async () => {
  const env = await team({ worker: true })
  const { messageId, idea } = await published(env)
  const before = get(env.db, 'SELECT * FROM messages WHERE id = ?', messageId)
  const cases = [
    [{ assignee_ids: [999] }, 'assignee_invalid', /miembro 999 no existe/],
    [{ area_id: 999, template_id: idea.templates[0].id }, 'area_invalid', /área/],
    [{ template_id: 999 }, 'template_invalid', /plantilla/],
    [{ title: '   ' }, 'message_invalid', /título/],
    [{ body: '' }, 'message_invalid', /texto/],
    [{ fields: { steps: 'a' } }, 'fields_invalid', /expected|actual/],
    [{ priority: 'alta' }, 'validation', /priority/],
    [{ status: 'closed' }, 'validation', /status/],
    [{ author_id: 1 }, 'validation', /author_id/],
    [{}, 'validation', /./]
  ]
  for (const [patch, code, message] of cases) {
    const r = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, patch)
    assert.equal(r.statusCode, 400, `${code}: ${r.body}`)
    assert.equal(r.json().code, code)
    assert.match(r.json().message, message)
  }
  assert.deepEqual(get(env.db, 'SELECT * FROM messages WHERE id = ?', messageId), before)
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.update'").n, 0)
  await env.close()
})

test('UD-017 · an edit leaves an audit row naming what changed, and updated_at moves; created_at does not', async () => {
  const env = await team({ worker: true })
  const { messageId, message } = await published(env)
  assert.equal(message.updated_at, message.created_at)
  run(env.db, 'UPDATE messages SET created_at = created_at - 60000, updated_at = updated_at - 60000 WHERE id = ?', messageId) // deterministic clock gap
  const created = (await env.api('GET', `/messages/${messageId}`, env.c.ana)).json().created_at
  await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { title: 'Otro', assignee_ids: [3] })
  const rows = all(env.db, "SELECT member_id, entity, entity_id, detail_json FROM audit_log WHERE action = 'message.update'")
  assert.equal(rows.length, 1)
  assert.equal(rows[0].member_id, 2)
  assert.equal(rows[0].entity, 'message')
  assert.equal(rows[0].entity_id, Number(messageId))
  assert.deepEqual(JSON.parse(rows[0].detail_json), { fields: ['title', 'assignee_ids'], version: 2 }) // the names, never the values
  const after = (await env.api('GET', `/messages/${messageId}`, env.c.ana)).json()
  assert.equal(after.created_at, created)
  assert.ok(Date.parse(after.updated_at) - Date.parse(after.created_at) >= 60000)
  const audit = (await env.api('GET', '/audit?entity=message', env.c.ed)).json()
  assert.ok(audit.items.some((a) => a.action === 'message.update'))
  await env.close()
})

test('UD-017 · the same PATCH twice yields the same state, one audit row and the same updated_at', async () => {
  const env = await team({ worker: true })
  const { messageId } = await published(env)
  const patch = { title: 'Idempotente', fields: { ...ERROR_FIELDS, where: 'login' }, assignee_ids: [1, 3] }
  const first = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, patch)
  const second = await env.api('PATCH', `/messages/${messageId}`, env.c.ana, { ...patch, assignee_ids: [3, 1, 3] })
  assert.equal(second.statusCode, 200)
  assert.deepEqual(second.json(), first.json())
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'message.update'").n, 1)
  assert.deepEqual(all(env.db, 'SELECT member_id FROM message_assignees WHERE message_id = ? ORDER BY member_id', messageId).map((r) => r.member_id), [1, 3])
  await env.close()
})

test('UD-017 · there is no version history: no table stores previous versions of a message or a proposal', async () => {
  const env = await team()
  const tables = all(env.db, "SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name)
  assert.deepEqual(tables.filter((n) => /version|history|revision|draft/i.test(n)), [])
  const columns = all(env.db, "SELECT name FROM pragma_table_info('messages')").map((c) => c.name)
  assert.ok(columns.includes('updated_at'))
  await env.close()
})

// ---------------------------------------------------------------- contract
test('UD-016 · messages expose attachment_kinds (distinct, in attachment order), reply_count and last_reply.attachment_kinds', async () => {
  const env = await team({ worker: true })
  const ctx = await proposed(env, [TEXT_FILE('a.txt'), PNG_FILE('b.png'), TEXT_FILE('c.txt')])
  const [doc1, image, doc2] = ctx.view.attachments
  const r = await env.api('POST', `/inputs/${ctx.id}/publish`, env.c.ana, { messages: [{ ...ctx.base, attachment_ids: [image.id, doc1.id, doc2.id] }] })
  const messageId = r.json().message_ids[0]
  assert.deepEqual(r.json().messages[0].attachment_kinds, ['image', 'document'])
  assert.equal(r.json().messages[0].last_reply, null)

  await env.api('POST', `/messages/${messageId}/replies`, env.c.beto, { body: 'visto' })
  const list = (await env.api('GET', '/messages', env.c.ed)).json().items[0]
  assert.deepEqual(list.attachment_kinds, ['image', 'document'])
  assert.equal(list.reply_count, 1)
  assert.deepEqual(list.last_reply.attachment_kinds, []) // replies carry no media yet
  const detail = (await env.api('GET', `/messages/${messageId}`, env.c.ed)).json()
  assert.deepEqual(detail.attachment_kinds, ['image', 'document'])
  assert.equal(detail.reply_count, 1)
  assert.deepEqual(detail.last_reply.attachment_kinds, [])
  assert.deepEqual(detail.replies[0].attachment_kinds, [])

  const bare = await published(env, { files: [] })
  assert.deepEqual(bare.message.attachment_kinds, [])
  await env.close()
})

test('UD-017 · both routes are in the OpenAPI contract with request and response schemas', async () => {
  const env = await makeEnv()
  const doc = (await env.app.inject({ url: '/api/openapi.json' })).json()
  const proposalRoute = doc.paths['/api/inputs/{id}/proposal'].patch
  assert.equal(proposalRoute.requestBody.content['application/json'].schema.additionalProperties, false)
  assert.ok(proposalRoute.requestBody.content['application/json'].schema.required.includes('messages'))
  assert.ok(proposalRoute.responses['200'])
  const messageRoute = doc.paths['/api/messages/{id}'].patch
  const body = messageRoute.requestBody.content['application/json'].schema
  assert.equal(body.additionalProperties, false)
  assert.deepEqual(Object.keys(body.properties).sort(), ['area_id', 'assignee_ids', 'attachment_ids', 'body', 'fields', 'template_id', 'title', 'version'])
  assert.deepEqual(body.required, ['version'])
  assert.ok(messageRoute.responses['200'])
  const card = doc.paths['/api/messages'].get.responses['200'].content['application/json'].schema.properties.items.items.properties
  assert.ok(card.attachment_kinds && card.updated_at && card.last_reply.properties.attachment_kinds)
  assert.ok(!doc.paths['/api/inputs/{id}/publish'].post.requestBody.content['application/json'].schema.required) // draft publish
  await env.close()
})
