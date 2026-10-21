// UD-025: the author's other unpublished inputs travel in the bundle as context for the model.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { get, run } from '../db/index.js'
import { recentInputsFor } from './inputs.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'

const MINUTE = 60 * 1000 // unit conversion only

async function setup (config = {}) {
  const env = await makeEnv({ config })
  const ana = await addMember(env, { email: 'ana@x.org' })
  const beto = await addMember(env, { email: 'beto@x.org' })
  let counter = 0
  const T0 = 10_000_000_000
  env.now = T0
  env.ana = ana
  env.beto = beto
  env.add = ({ author = ana, status = 'proposed', text = 'texto', ageMin = 1, titles = null, attachments = [] }) => {
    const t = T0 - ageMin * MINUTE
    const id = Number(run(env.db, 'INSERT INTO inputs (author_id, text, content_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', author, text, `h${counter++}`, status, t, t).lastInsertRowid)
    for (const a of attachments) run(env.db, "INSERT INTO attachments (input_id, kind, name, path, sha256, extracted_text, extracted_at) VALUES (?, 'document', 'a.txt', 'p', ?, ?, ?)", id, `s${counter++}`, a, t)
    if (titles) run(env.db, 'INSERT INTO proposals (input_id, payload_json, created_at) VALUES (?, ?, ?)', id, JSON.stringify({ messages: titles.map((title) => ({ title, area_id: 1, template_id: 1 })), discarded: [] }), t)
    return id
  }
  env.recent = (inputId) => recentInputsFor({ db: env.db, config: env.config, now: () => env.now }, get(env.db, 'SELECT * FROM inputs WHERE id = ?', inputId))
  return env
}

test('recent_inputs: each item has the declared shape, newest first', async () => {
  const env = await setup()
  const older = env.add({ text: 'primero', ageMin: 10, titles: ['Primer título', 'Segundo título'] })
  const newer = env.add({ text: 'segundo', ageMin: 5, status: 'analyzing' })
  const current = env.add({ text: 'actual', ageMin: 1, status: 'analyzing' })
  const items = env.recent(current)
  assert.deepEqual(items.map((i) => i.id), [newer, older])
  assert.deepEqual(Object.keys(items[0]).sort(), ['created_at', 'id', 'proposed_titles', 'text_excerpt'])
  assert.equal(items[0].created_at, new Date(env.now - 5 * MINUTE).toISOString())
  assert.deepEqual(items[0].proposed_titles, [])
  assert.deepEqual(items[1].proposed_titles, ['Primer título', 'Segundo título'])
  assert.equal(items[1].text_excerpt, 'primero')
  await env.close()
})

test('recent_inputs: only the same author, only analyzing or proposed, never the input itself', async () => {
  const env = await setup()
  const mine = env.add({ status: 'proposed' })
  for (const status of ['queued', 'extracting', 'published', 'failed', 'cancelled']) env.add({ status })
  env.add({ author: env.beto, status: 'proposed' })
  const current = env.add({ status: 'analyzing' })
  assert.deepEqual(env.recent(current).map((i) => i.id), [mine])
  await env.close()
})

test('recent_inputs: the excerpt is the start of the extracted text, written text first, cut to the knob', async () => {
  const env = await setup({ recentInputs: { excerptChars: 20 } })
  const withFile = env.add({ text: 'dictado a mano', attachments: ['contenido extraído del archivo'] })
  const onlyFile = env.add({ text: '', attachments: ['solo el archivo'] })
  const current = env.add({ status: 'analyzing' })
  const byId = Object.fromEntries(env.recent(current).map((i) => [i.id, i]))
  assert.equal(byId[withFile].text_excerpt, 'dictado a mano\n\ncont')
  assert.equal(byId[onlyFile].text_excerpt, 'solo el archivo')
  await env.close()
})

test('recent_inputs: the excerpt does not cut a character in half', async () => {
  const env = await setup({ recentInputs: { excerptChars: 3 } })
  env.add({ text: 'ab😀cd' }) // the emoji is two UTF-16 units: position 3 would split it
  const current = env.add({ status: 'analyzing' })
  assert.equal(env.recent(current)[0].text_excerpt, 'ab')
  await env.close()
})

test('recent_inputs: capped by count (newest kept) and by age', async () => {
  const env = await setup({ recentInputs: { max: 2, maxAgeMinutes: 30 } })
  env.add({ ageMin: 40, text: 'viejo' })
  env.add({ ageMin: 20, text: 'a' })
  const b = env.add({ ageMin: 10, text: 'b' })
  const c = env.add({ ageMin: 5, text: 'c' })
  const current = env.add({ status: 'analyzing' })
  assert.deepEqual(env.recent(current).map((i) => i.id), [c, b])
  await env.close()
  const none = await setup({ recentInputs: { max: 0 } })
  none.add({})
  assert.deepEqual(none.recent(none.add({ status: 'analyzing' })), [])
  await none.close()
})

test('the analyzer receives bundle.recent_inputs with the earlier proposal of the same person', async () => {
  const bundles = []
  const env = await makeEnv({ worker: true, config: { identity: { login: { ipMax: 1000 } } }, modules: { analyze: async (bundle, opts) => { bundles.push(bundle); return fakeAnalyze(bundle, opts) } } })
  await addMember(env, { email: 'ana@x.org' })
  const cookie = await login(env, 'ana@x.org')
  const first = (await postInput(env, cookie, { text: 'primer envío sobre el mapa' })).json()
  await until(() => get(env.db, 'SELECT status FROM inputs WHERE id = ?', first.input_id).status === 'proposed')
  const second = (await postInput(env, cookie, { text: 'segundo envío' })).json()
  await until(() => get(env.db, 'SELECT status FROM inputs WHERE id = ?', second.input_id).status === 'proposed')
  assert.deepEqual(bundles[0].recent_inputs, [])
  assert.equal(bundles[1].recent_inputs.length, 1)
  assert.equal(bundles[1].recent_inputs[0].id, Number(first.input_id))
  assert.equal(bundles[1].recent_inputs[0].text_excerpt, 'primer envío sobre el mapa')
  assert.deepEqual(bundles[1].recent_inputs[0].proposed_titles, ['Mensaje de prueba'])
  await env.close()
})
