// H-3722: the framing of the analysis is a setting of the installation. The Editor writes it per language in
// Configuración, the pipeline puts it in the bundle, and it opens the system prompt of every call of the analyzer.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all } from '../db/index.js'
import { createFakeProviders } from '../providers/index.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { analyze as analyzeAll } from './index.js'
import { classifySystem, decomposeSystem, defaultFraming, harnessPrompt } from './prompts.js'
import { CLASSIFY_ERRORS, firstReadingOnly, goodDecomposition, makeBundle } from './testing/fixtures.js'

const FRAMING = 'Esta es la bandeja de entrada de una clínica dental. Un mismo input puede traer una falla de agenda, un pedido de un paciente y una duda de facturación.'
const OLD_FRAME = /equipo de software pequeño|small software team/

async function team (opts = {}) {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, ...opts })
  await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.c = { ed: await login(env, 'ed@x.org'), ana: await login(env, 'ana@x.org') }
  env.api = (method, url, cookie, payload) => env.app.inject({ method, url: `/api${url}`, headers: { cookie, 'x-team-request': 'panel' }, payload })
  return env
}

test('the default framing is the one the prompts had, one per language, and only once in each system prompt', () => {
  assert.match(defaultFraming('es-419'), /equipo de software pequeño/)
  assert.match(defaultFraming('en'), /small software team/)
  for (const language of ['es-419', 'en']) {
    const system = classifySystem({ areas: [], templates: [], language }).join('\n')
    assert.ok(system.startsWith(defaultFraming(language)))
    assert.equal(system.split(defaultFraming(language)).length, 2)
  }
})

test('a saved framing opens the system prompt of classification, decomposition and the harness, and the default is gone', () => {
  const template = { name: 't', description: '', fields: [], body: '' }
  for (const text of [
    classifySystem({ areas: [], templates: [], language: 'es-419', framing: FRAMING }).join('\n'),
    decomposeSystem(template, undefined, 'es-419', FRAMING).join('\n'),
    harnessPrompt({ unitCount: 2, retryErrors: [], language: 'es-419', framing: FRAMING })
  ]) {
    assert.ok(text.startsWith(FRAMING))
    assert.equal(OLD_FRAME.test(text), false)
  }
  // A blank framing is no framing: the default of the set.
  assert.ok(classifySystem({ areas: [], templates: [], language: 'en', framing: '  ' }).join('\n').startsWith(defaultFraming('en')))
})

test('GET and PATCH /settings/analysis: editor only, per language, capped, and blank goes back to the default', async () => {
  const env = await team({ config: { identity: { login: { ipMax: 1000 } }, analysis: { framingMaxChars: 200 } } })
  assert.equal((await env.api('GET', '/settings/analysis', env.c.ana)).statusCode, 403)
  assert.equal((await env.api('PATCH', '/settings/analysis', env.c.ana, { framing: { 'es-419': FRAMING } })).statusCode, 403)
  const start = (await env.api('GET', '/settings/analysis', env.c.ed)).json()
  assert.deepEqual(start.framing['es-419'], { value: defaultFraming('es-419'), default: defaultFraming('es-419'), custom: false })
  assert.equal(start.max_chars, 200)

  const saved = await env.api('PATCH', '/settings/analysis', env.c.ed, { framing: { 'es-419': FRAMING } })
  assert.equal(saved.statusCode, 200)
  assert.deepEqual(saved.json().framing['es-419'], { value: FRAMING, default: defaultFraming('es-419'), custom: true })
  assert.equal(saved.json().framing.en.custom, false, 'the other language keeps its default')
  assert.equal(all(env.db, "SELECT id FROM audit_log WHERE action = 'settings.analysis.framing'").length, 1)

  const over = await env.api('PATCH', '/settings/analysis', env.c.ed, { framing: { en: 'a'.repeat(201) } })
  assert.equal(over.statusCode, 413)
  assert.equal(over.json().code, 'too_large')
  assert.equal((await env.api('PATCH', '/settings/analysis', env.c.ed, { framing: { fr: 'x' } })).statusCode, 400)

  await env.api('PATCH', '/settings/analysis', env.c.ed, { framing: { 'es-419': '' } })
  assert.equal((await env.api('GET', '/settings/analysis', env.c.ed)).json().framing['es-419'].custom, false)
  await env.close()
})

test('the framing saved in Configuración reaches the model: the pipeline puts it in the bundle and the analyzer sends it', async () => {
  const bundles = []
  const env = await team({ worker: true, modules: { analyze: async (bundle, opts) => { bundles.push(bundle); return fakeAnalyze(bundle, opts) } } })
  await env.api('PATCH', '/settings/analysis', env.c.ed, { framing: { 'es-419': FRAMING } })
  const { input_id: id } = (await postInput(env, env.c.ana, { text: 'La agenda no carga.' })).json()
  await until(() => bundles.length === 1)
  await until(() => ['proposed', 'published'].includes(env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(id).status))
  assert.equal(bundles[0].framing, FRAMING)
  await env.close()

  // The bundle as the pipeline built it, through the real analyzer with a fake provider: both calls carry it.
  const fake = createFakeProviders({ text: [CLASSIFY_ERRORS, goodDecomposition()] })
  await firstReadingOnly(analyzeAll)({ ...(await makeBundle()), framing: bundles[0].framing }, { providers: fake })
  assert.equal(fake.calls.text.length, 2)
  for (const call of fake.calls.text) {
    const system = call.system.join('\n')
    assert.ok(system.startsWith(FRAMING))
    assert.equal(OLD_FRAME.test(system), false)
  }
})
