// H-3722: progress phrases come from one catalogue, per language, and every progress event carries a stable code.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { test } from 'node:test'
import { all, run } from '../db/index.js'
import { toWire } from '../events/index.js'
import { codeFiles } from '../testing/language.js'
import { addMember, login, makeEnv, postInput, until } from '../testing/helpers.js'
import { codeOfPhrase, PROGRESS_CODES, PROGRESS_PHRASES, renderPhrase, step } from './progress-phrases.js'

test('every code has a text in both languages, and its variables are filled', () => {
  for (const code of PROGRESS_CODES) {
    for (const language of ['es-419', 'en']) {
      const text = renderPhrase(code, { n: 2, total: 3 }, language)
      assert.equal(typeof text, 'string', `${code} ${language}`)
      assert.ok(text.length > 0 && !/[{}]/.test(text), `${code} ${language}: ${text}`)
    }
  }
  assert.equal(renderPhrase('transcribeN', { n: 1 }, 'es-419'), 'Transcripción: 1 trozo')
  assert.equal(renderPhrase('transcribeN', { n: 4 }, 'en'), 'Transcription: 4 chunks')
  assert.equal(renderPhrase('done', {}, 'fr'), 'Listo', 'an unknown language falls back to the default')
  assert.throws(() => step('nonexistent'))
})

test('a phrase written before the codes gets its code back, in either language; any other text has none', () => {
  assert.deepEqual(codeOfPhrase('Clasificación'), { code: 'classify', vars: {} })
  assert.deepEqual(codeOfPhrase('Lectura de adjunto 2 de 3'), { code: 'attachmentN', vars: { n: 2, total: 3 } })
  assert.deepEqual(codeOfPhrase('Attempt 1 of 3 failed; retrying'), { code: 'retry', vars: { n: 1, total: 3 } })
  assert.deepEqual(codeOfPhrase('Transcripción: 1 trozo'), { code: 'transcribeN', vars: { n: 1 } })
  assert.equal(codeOfPhrase('leyendo'), null)
  assert.equal(codeOfPhrase(null), null)
  // Every text of the catalogue round-trips.
  for (const code of PROGRESS_CODES) for (const language of Object.keys(PROGRESS_PHRASES[code])) {
    assert.equal(codeOfPhrase(renderPhrase(code, { n: 5, total: 7 }, language))?.code, code, `${code} ${language}`)
  }
})

test('no emitter of the server writes a progress text by hand: they name a step of the catalogue', () => {
  const literal = /\b(?:report|advance|finish)\(\s*(['`])|phrase: (['`])|new Deferred\([^,]+,\s*(['`])/
  const files = codeFiles().map((f) => relative(process.cwd(), f))
  assert.ok(files.filter((f) => f.startsWith('src/extract/')).length > 3, 'the scan sees the extractors')
  const offenders = files
    .filter((f) => f.startsWith('src/') && f.endsWith('.js') && !f.endsWith('.test.js') && !f.startsWith('src/testing/'))
    .flatMap((f) => readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
    .filter(({ line }) => literal.test(line))
    .map(({ f, i, line }) => `${f}:${i + 1}: ${line.trim()}`)
  assert.deepEqual(offenders, [])
})

test('a progress event carries its code and the phrase in the author\'s language; an old row without code gets one', async () => {
  const env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, worker: true })
  const ana = await addMember(env, { email: 'ana@x.org' })
  const bob = await addMember(env, { email: 'bob@x.org' })
  run(env.db, "UPDATE members SET language = 'en' WHERE id = ?", bob)
  const submit = async (email) => (await postInput(env, await login(env, email), { text: 'La agenda no carga.' })).json()
  const es = await submit('ana@x.org')
  const en = await submit('bob@x.org')
  const rows = (jobId) => all(env.db, "SELECT * FROM job_events WHERE job_id = ? AND kind = 'progress' ORDER BY seq", jobId)
  await until(() => rows(es.job_id).some((r) => r.percent === 100) && rows(en.job_id).some((r) => r.percent === 100))

  const wire = (jobId) => rows(jobId).map((r) => toWire(r).data)
  for (const event of [...wire(es.job_id), ...wire(en.job_id)]) assert.equal(typeof event.code, 'string', JSON.stringify(event))
  assert.deepEqual(wire(es.job_id).map((e) => e.code).slice(0, 2), ['queued', 'analyzing'])
  assert.equal(wire(es.job_id)[0].phrase, 'En espera')
  assert.equal(wire(en.job_id)[0].phrase, 'Queued')
  assert.equal(wire(en.job_id).at(-1).phrase, 'Proposal ready')
  assert.ok(ana)

  // The tray carries the code of the last event too.
  const tray = await env.app.inject({ method: 'GET', url: `/api/inputs/${en.input_id}`, headers: { cookie: await login(env, 'bob@x.org'), 'x-team-request': 'panel' } })
  assert.equal(tray.json().code, 'proposalReady')
  assert.equal(tray.json().job.code, 'proposalReady')

  // A row written by an older version: phrase only.
  const legacy = toWire({ seq: 1, job_id: 1, kind: 'progress', percent: 10, phrase: 'Lectura de adjunto 1 de 2', data_json: '{}', at: Date.now() })
  assert.equal(legacy.data.code, 'attachmentN')
  assert.deepEqual(legacy.data.vars, { n: 1, total: 2 })
  await env.close()
})
