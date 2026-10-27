// Capability «Roles de equipo» (docs/CAPACIDADES-1.0.md): the Editor changes only configured texts; every other action is any person's.
// It starts from what people do through the API: a member sends, another member replies, edits and forwards (all allowed), then the same member
// tries each configured text and gets 403 with nothing changed in what the Editor reads; the Editor changes the same texts and the member reads the result.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { equipo } from './apoyo.mjs'

const TEMPLATE = `---
name: Plantilla nueva
description: Para probar el rol
fields:
  - name: detalle
    type: text
    required: true
---
Cuerpo de la plantilla nueva.
`

const members = (res) => { const body = res.json(); return Array.isArray(body) ? body : body.items }

test('a member does everything that is not a configured text and is refused 403 on each configured text; the Editor changes them and the member reads the result', async () => {
  const env = await equipo()
  const { ana, beto, ed } = env.c
  const { ana: anaId, beto: betoId, ed: edId } = env.ids

  // What a member does: send, reply in the thread, edit the reply, forward, close.
  const messageId = await env.enviar(ana, 'el botón de guardar no responde', [betoId])
  const reply = await env.api('POST', `/messages/${messageId}/replies`, beto, { body: 'ya lo reviso' })
  assert.equal(reply.statusCode, 201, reply.body)
  const replyId = reply.json().replies.at(-1).id
  const edited = await env.api('PATCH', `/messages/${messageId}/replies/${replyId}`, beto, { body: 'ya lo revisé', version: 1 })
  assert.equal(edited.statusCode, 200, edited.body)
  const forwarded = await env.api('POST', `/messages/${messageId}/forward`, beto, { member_id: String(edId), comment: 'Revísalo tú, por favor.' })
  assert.equal(forwarded.statusCode, 201, forwarded.body)
  // What the people read in the thread.
  const thread = await env.hilo(messageId, ana)
  assert.deepEqual(thread.replies.map((r) => [r.author_id, r.body]), [[String(betoId), 'ya lo revisé'], [String(betoId), 'Revísalo tú, por favor.']])
  assert.deepEqual(thread.assignee_ids.sort(), [String(betoId), String(edId)].sort())
  assert.equal((await env.api('POST', `/messages/${messageId}/close`, ana)).json().status, 'closed')

  // What a member cannot do: change a configured text. Each attempt is 403 and the Editor still reads the same texts.
  const area = (await env.api('POST', '/areas', ed, { title: 'Ideas', description: 'Lo que se le ocurre al equipo' })).json()
  const template = (await env.api('GET', `/areas/${area.id}/templates`, ed)).json()
  const templateId = template[0]?.id ?? (await env.api('POST', `/areas/${area.id}/templates`, ed, { body_markdown: TEMPLATE })).json().id
  const readTexts = async (cookie) => ({
    areas: (await env.api('GET', '/areas', cookie)).json().map((a) => [a.id, a.title, a.description, a.execute_model, a.execute_model_light]),
    project: (await env.api('GET', '/settings/project', cookie)).json(),
    analysis: (await env.api('GET', '/settings/analysis', ana)).json().framing,
    templates: (await env.api('GET', `/areas/${area.id}/templates`, ed)).json().map((t) => [t.id, t.body_markdown])
  })
  const before = await readTexts(ed)
  const attempts = [
    ['POST', '/areas', { title: 'Otra', description: 'x' }],
    ['PATCH', `/areas/${area.id}`, { description: 'y' }],
    ['PATCH', `/areas/${area.id}`, { execute_model: 'claude-haiku-5-5' }],
    ['DELETE', `/areas/${area.id}?confirm=true`, undefined],
    ['POST', `/areas/${area.id}/restore`, undefined],
    ['POST', `/areas/${area.id}/templates`, { body_markdown: TEMPLATE }],
    ['PATCH', `/areas/${area.id}/templates/${templateId}`, { description: 'otra' }],
    ['DELETE', `/areas/${area.id}/templates/${templateId}?confirm=true`, undefined],
    ['POST', `/templates/${templateId}/restore`, undefined],
    ['PATCH', '/settings/project', { description: 'texto del miembro' }],
    ['PATCH', '/settings/project', { name: 'Nombre del miembro' }],
    ['PATCH', '/settings/analysis', { framing: { en: 'text of the member' } }],
    ['POST', '/members', { email: 'agente@x.org', name: 'Agente', kind: 'agent', profile: 'Perfil escrito por un miembro' }]
  ]
  for (const [method, url, payload] of attempts) {
    for (const who of [ana, beto]) {
      const r = await env.api(method, url, who, payload)
      assert.equal(r.statusCode, 403, `${method} ${url} answered ${r.statusCode} to a member: ${r.body}`)
    }
  }
  assert.deepEqual(await readTexts(ed), before, 'a refused attempt changed a configured text')
  assert.equal(members(await env.api('GET', '/members', ed)).some((m) => m.email === 'agente@x.org'), false, 'a member created an agent with a profile')

  // The Editor changes them and a member reads the new text.
  assert.equal((await env.api('PATCH', '/settings/project', ed, { description: 'texto del editor' })).statusCode, 200)
  assert.equal((await env.api('PATCH', `/areas/${area.id}`, ed, { description: 'descripción del editor' })).statusCode, 200)
  assert.equal((await env.api('GET', '/settings/project', beto)).json().description, 'texto del editor')
  assert.equal((await env.api('GET', '/areas', beto)).json().find((a) => a.id === area.id).description, 'descripción del editor')
  const agent = await env.api('POST', '/members', ed, { email: 'agente@x.org', name: 'Agente', kind: 'agent', profile: 'Perfil del editor' })
  assert.equal(agent.statusCode, 201, agent.body)
  // The profile of an agent is the Editor's even after it exists; the rest of the member is anyone's.
  assert.equal((await env.api('PATCH', `/members/${agent.json().id}`, ana, { profile: 'Perfil de Ana' })).statusCode, 403)
  assert.equal((await env.api('PATCH', `/members/${agent.json().id}`, ana, { name: 'Agente B' })).statusCode, 200)
  assert.equal(members(await env.api('GET', '/members', beto)).find((m) => m.email === 'agente@x.org').profile, 'Perfil del editor')
  assert.ok(anaId)
  await env.close()
})
