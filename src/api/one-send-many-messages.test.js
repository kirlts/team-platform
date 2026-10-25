// UD-293: one send becomes between one and several messages, each with its own area, template, fields and attachments, and the
// publication keeps all of that. Exercised through the API with a scripted analysis (the analyzer itself is measured by bench/envios).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get } from '../db/index.js'
import { parseTemplate } from '../domain/template-file.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'

test('a send with five requests of three areas publishes five messages, each in its area and template, with its own attachment', async () => {
  const analyze = async (bundle) => {
    const picks = [0, 1, 2, 0, 1].map((i) => bundle.areas[i % bundle.areas.length])
    const [first, second] = bundle.attachments.map((a) => a.id)
    const message = (area, n) => {
      const template = bundle.templates.find((t) => t.area_id === area.id)
      const fields = Object.fromEntries(parseTemplate(template.body_markdown).fields.filter((f) => f.required).map((f) => [f.name, 'dato']))
      const attachment_ids = n === 0 ? [first] : n === 3 ? [second] : []
      return { area_id: area.id, template_id: template.id, title: `Pedido ${n + 1}`, body: `Cuerpo ${n + 1}`, fields, assignee_ids: [], attachment_ids, unit_ids: [] }
    }
    return { status: 'ok', proposal: { messages: picks.map(message), discarded: [] }, units: [], calls: [], stats: {} }
  }
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, worker: true, modules: { analyze } })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  const cookie = await login(env, 'ana@x.org')
  const api = (method, url, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  const { input_id: id } = (await postInput(env, cookie, { text: 'cinco pedidos en un solo texto' }, [
    { field: 'files', name: 'uno.png', type: 'image/png', content: 'PNG1' },
    { field: 'files', name: 'dos.png', type: 'image/png', content: 'PNG2' }
  ])).json()
  const view = await until(async () => {
    const v = (await api('GET', `/inputs/${id}`)).json()
    if (v.status === 'failed') throw new Error(v.error)
    return v.status === 'proposed' ? v : null
  })
  assert.equal(view.proposal.messages.length, 5)

  const published = await api('POST', `/inputs/${id}/publish`, { messages: view.proposal.messages })
  assert.equal(published.statusCode, 200, published.body)
  const ids = published.json().message_ids
  assert.equal(ids.length, 5)
  assert.equal(new Set(ids).size, 5)
  const rows = ids.map((messageId) => get(env.db, 'SELECT id, area_id, template_id, title FROM messages WHERE id = ?', messageId))
  assert.deepEqual(rows.map((r) => r.title), ['Pedido 1', 'Pedido 2', 'Pedido 3', 'Pedido 4', 'Pedido 5'], 'the order of the proposal is kept')
  assert.deepEqual(rows.map((r) => r.area_id), view.proposal.messages.map((m) => Number(m.area_id)))
  assert.deepEqual(rows.map((r) => r.template_id), view.proposal.messages.map((m) => Number(m.template_id)))
  assert.ok(new Set(rows.map((r) => r.area_id)).size >= 2, 'more than one area in a single send')
  const links = all(env.db, 'SELECT message_id, attachment_id FROM message_attachments WHERE message_id IN (' + ids.join(',') + ') ORDER BY message_id')
  assert.deepEqual(links.map((l) => l.message_id), [Number(ids[0]), Number(ids[3])], 'each attachment goes only with the message that owns it')
  assert.notEqual(links[0].attachment_id, links[1].attachment_id)
  await env.close()
})
