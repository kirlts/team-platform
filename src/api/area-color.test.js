// UD-045: each area carries one color chosen by the Editor. Every check is a prohibition.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addMember, login, makeEnv } from '../testing/helpers.js'

async function team () {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } } })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

test('UD-045 · the five initial areas come with a different color each', async () => {
  const env = await team()
  const areas = (await env.api('GET', '/areas', env.c.ana)).json()
  assert.equal(areas.length, 5)
  for (const a of areas) assert.match(a.color, /^#[0-9a-f]{6}$/, a.title)
  assert.equal(new Set(areas.map((a) => a.color)).size, 5, 'two initial areas share a color')
})

test('UD-045 · a new area without color gets the next one of the palette, and a different one from its neighbours', async () => {
  const env = await team()
  const first = (await env.api('POST', '/areas', env.c.ed, { title: 'Nueva A', description: 'd' })).json()
  const second = (await env.api('POST', '/areas', env.c.ed, { title: 'Nueva B', description: 'd' })).json()
  assert.match(first.color, /^#[0-9a-f]{6}$/)
  assert.notEqual(first.color, second.color)
})

test('UD-045 · only the editor changes the color, and a value that is not #rrggbb is refused', async () => {
  const env = await team()
  const [area] = (await env.api('GET', '/areas', env.c.ana)).json()
  const member = await env.api('PATCH', `/areas/${area.id}`, env.c.ana, { color: '#112233' })
  assert.equal(member.statusCode, 403)
  for (const bad of ['red', '#12345', '#GGGGGG', 'rgb(1,2,3)', '112233', '']) {
    const res = await env.api('PATCH', `/areas/${area.id}`, env.c.ed, { color: bad })
    assert.equal(res.statusCode, 400, `«${bad}» was accepted`)
  }
  const ok = await env.api('PATCH', `/areas/${area.id}`, env.c.ed, { color: '#ABCDEF' })
  assert.equal(ok.statusCode, 200, ok.body)
  assert.equal(ok.json().color, '#abcdef') // stored in lower case
  assert.equal((await env.api('GET', '/areas', env.c.ana)).json().find((a) => a.id === area.id).color, '#abcdef')
})

test('UD-045 · the migration palette and the one that new areas take are the same eight colors', async () => {
  const { readFileSync } = await import('node:fs')
  const { AREA_PALETTE } = await import('../domain/areas.js')
  const sql = readFileSync(new URL('../db/migrations/0006_area_color.sql', import.meta.url), 'utf8')
  const fallback = sql.slice(sql.indexOf('ELSE CASE'))
  assert.deepEqual([...fallback.matchAll(/#[0-9a-f]{6}/g)].map((m) => m[0]), AREA_PALETTE)
})
