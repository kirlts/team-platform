// H-3723, UD-254 (5): a template with an `output` block that does not compile is refused with 422 and the reason, on
// create and on edit; the five seeded templates are stored with an output that compiles.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compileOutputSchema } from '../analyze/templates.js'
import { addMember, login, makeEnv } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  env.c = { ed: await login(env, 'ed@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

const file = (output) => `---
name: Plantilla con salida
description: Prueba de la salida declarada.
fields:
  - { name: steps, label: Pasos, required: true }
${output}
---
## Método
Leer el input.

## Formato de salida
Un mensaje por punto.
`

const GOOD = 'output:\n  - { name: cause, label: Causa, type: text, required: true }'

test('H-3723 · a template whose output does not compile is 422 with the reason, on create and on edit', async () => {
  const env = await team()
  const [area] = (await env.api('GET', '/areas', env.c.ed)).json()
  const cases = [
    ['output:\n  - { name: cause, label: Causa, type: tabla, required: true }', /type/],
    ['output:\n  - { name: summary, label: Resumen, type: text, required: true }', /campo fijo/],
    ['output:\n  - { name: cause, label: Causa, type: text, required: true, extra: 1 }', /claves desconocidas/],
    ['output: texto', /lista/]
  ]
  for (const [output, reason] of cases) {
    const res = await env.api('POST', `/areas/${area.id}/templates`, env.c.ed, { body_markdown: file(output) })
    assert.equal(res.statusCode, 422, output)
    assert.equal(res.json().code, 'template_invalid')
    assert.match(res.json().message, reason)
  }
  const created = await env.api('POST', `/areas/${area.id}/templates`, env.c.ed, { body_markdown: file(GOOD) })
  assert.equal(created.statusCode, 201, created.body)
  const id = created.json().id
  const bad = await env.api('PATCH', `/areas/${area.id}/templates/${id}`, env.c.ed, { body_markdown: file('output:\n  - { name: outcome, label: Resultado, type: text, required: true }') })
  assert.equal(bad.statusCode, 422)
  assert.match(bad.json().message, /campo fijo/)
  const kept = (await env.api('GET', `/areas/${area.id}/templates`, env.c.ed)).json().find((t) => t.id === id)
  assert.deepEqual(Object.keys(compileOutputSchema(kept.body_markdown).properties), ['cause', 'outcome', 'summary'])
})

test('H-3723 · the five seeded templates are stored with an output block that compiles', async () => {
  const env = await team()
  const areas = (await env.api('GET', '/areas', env.c.ed)).json()
  assert.equal(areas.length, 5)
  for (const area of areas) {
    const templates = (await env.api('GET', `/areas/${area.id}/templates`, env.c.ed)).json()
    assert.equal(templates.length, 1, area.title)
    const schema = compileOutputSchema(templates[0].body_markdown)
    assert.ok(schema, `${area.title}: no output`)
    assert.equal(schema.additionalProperties, false)
    assert.ok(schema.required.includes('summary') && schema.required.includes('outcome'), area.title)
  }
})
