// scripts/canary.mjs against a listening Team Platform, the fake `claude` of the `execute` tests and a real worker: green with a reply that says OK,
// and red, naming the leg, for an area that does not exist, a session that fails, a reply that does not say OK and a session that outlives its deadline.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, beforeEach, describe, it } from 'node:test'
import { loadConfig } from '../src/config.js'
import { createPipeline } from '../src/domain/pipeline.js'
import { createVault, loadMasterKey } from '../src/domain/vault.js'
import { createExecuteHandler } from '../src/execute/handler.js'
import { addMember, fakeAnalyze, login, makeEnv, until } from '../src/testing/helpers.js'
import { createWorker } from '../src/worker.js'
import { main, RED, USAGE } from './canary.mjs'

const FAKE = fileURLToPath(new URL('./testing/fake-claude-canary.mjs', import.meta.url))
let PORT = 0 // ephemeral, set after listen

describe('scripts/canary.mjs', () => {
  let env, worker, vault, editor
  const cookieHeaders = (cookie) => ({ cookie, 'x-team-request': 'panel' })

  function startWorker () {
    const config = loadConfig({ DATA_DIR: env.dir, LOG_LEVEL: 'silent', PORT: String(PORT) }, {
      execute: { bin: FAKE, machineBin: FAKE, teamUrl: `http://127.0.0.1:${PORT}`, killGraceMs: 200, dailyBudgetUsd: 1000, infraRetryWaitMs: 0, maxAttempts: 1 }
    })
    const handlers = {
      ...createPipeline({ db: env.db, config, queue: env.queue, events: env.events, modules: env.modules }),
      execute: createExecuteHandler({ db: env.db, config, queue: env.queue, events: env.events, vault, getProviders: env.modules.getProviders })
    }
    worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config, handlers })
    worker.start()
  }
  const baseEnv = () => ({ TEAM_URL: `http://127.0.0.1:${PORT}`, TEAM_EMAIL: 'ed@x.org', TEAM_PASSWORD: 'una clave larga de prueba 1', CANARY_AREA: 'Canary' })
  const run = async (extra = {}, options = {}) => {
    const out = []; const err = []
    const code = await main({ ...baseEnv(), ...extra }, { out: (l) => out.push(l), err: (l) => err.push(l), ...options })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }
  const message = () => env.db.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT 1').get()

  before(async () => {
    env = await makeEnv({ config: { identity: { login: { ipMax: 1000 } } }, modules: { analyze: async (bundle, opts) => fakeAnalyze(bundle, opts) } })
    vault = createVault(loadMasterKey({ dataDir: env.dir }))
    await addMember(env, { email: 'ed@x.org', role: 'editor' })
    editor = await login(env, 'ed@x.org')
    const agent = await env.app.inject({ method: 'POST', url: '/api/members', headers: cookieHeaders(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Perfil del agente: responde pruebas.' } })
    assert.equal(agent.statusCode, 201, agent.body)
    const area = await env.app.inject({ method: 'POST', url: '/api/areas', headers: cookieHeaders(editor), payload: { title: 'Canary', description: 'Mensajes de prueba del canario.' } })
    assert.equal(area.statusCode, 201, area.body)
    await env.app.listen({ host: '127.0.0.1', port: 0 }); PORT = env.app.server.address().port
  })
  beforeEach(async () => {
    await worker?.stop()
    process.env.FAKE_CANARY_MODE = 'ok'
    delete process.env.FAKE_CANARY_SLEEP_MS
    startWorker()
  })
  after(async () => { await worker?.stop(); await env.close() })

  it('green: the agent replies OK, the message ends closed, the state file says ok, and CANARY_DELETE=1 sends it to the trash', async () => {
    const file = join(env.dir, 'canary-state.json')
    const r = await run({ CANARY_STATE: file, CANARY_DELETE: '1', CANARY_MAX_COST_USD: '100' })
    assert.equal(r.code, 0, r.err)
    assert.match(r.out, /^CANARY OK: the agent replied in [\d.]+ s/)
    const m = message()
    assert.equal(m.status, 'closed')
    assert.ok(m.deleted_at, 'CANARY_DELETE=1 deleted it (restorable)')
    const state = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(state.ok, true)
    assert.equal(String(state.message_id), String(m.id))
    assert.equal(typeof state.total_ms, 'number')
  })

  it('red at «area» when the declared area does not exist, before anything is sent', async () => {
    const before = env.db.prepare('SELECT COUNT(*) AS n FROM inputs').get().n
    const r = await run({ CANARY_AREA: 'No such area' })
    assert.equal(r.code, RED)
    assert.match(r.err, /CANARY FAILED at «area»: no area titled or numbered «No such area»/)
    assert.equal(env.db.prepare('SELECT COUNT(*) AS n FROM inputs').get().n, before)
  })

  it('red at «session» when the session fails, and the message stays closed', async () => {
    process.env.FAKE_CANARY_MODE = 'exit'
    const r = await run({}, {})
    assert.equal(r.code, RED)
    assert.match(r.err, /CANARY FAILED at «session»: the job failed/)
    assert.match(r.err, /stays closed for diagnosis/)
    assert.equal(message().status, 'closed')
  })

  it('red at «reply» when the agent answers without OK', async () => {
    process.env.FAKE_CANARY_MODE = 'no-ok'
    const r = await run()
    assert.equal(r.code, RED)
    assert.match(r.err, /CANARY FAILED at «reply»: the agent's reply does not say OK/)
  })

  it('red at «session» when the session outlives its deadline, with the last notice of the job', async () => {
    process.env.FAKE_CANARY_SLEEP_MS = '4000'
    const r = await run({}, { deadlines: { analysis: 30_000, session: 1500 } })
    assert.equal(r.code, RED)
    assert.match(r.err, /CANARY FAILED at «session»: no answer in \d+ s; /)
    assert.equal(message().status, 'closed')
  })

  it('red at «cost» when the declared maximum is below what the session cost', async () => {
    const r = await run({ CANARY_MAX_COST_USD: '0.0001' })
    assert.equal(r.code, RED)
    assert.match(r.err, /CANARY FAILED at «cost»: the run cost /)
  })

  it('usage: 2 without the instance, the area or an identity, or with a deadline that is not a number', async () => {
    assert.equal((await run({ TEAM_URL: '' })).code, USAGE)
    assert.equal((await run({ CANARY_AREA: '' })).code, USAGE)
    assert.equal((await run({ TEAM_PASSWORD: '' })).code, USAGE)
    assert.equal((await run({ CANARY_SESSION_TIMEOUT_MS: 'soon' })).code, USAGE)
  })

  it('red at «identity» with a wrong password, and as a process: node scripts/canary.mjs exits with the same code', async () => {
    // Asynchronous on purpose: the server lives in this process, and a synchronous wait would stop it.
    const proc = await new Promise((resolve) => execFile(process.execPath, [fileURLToPath(new URL('./canary.mjs', import.meta.url))], { env: { ...process.env, ...baseEnv(), CANARY_AREA: 'No such area' }, encoding: 'utf8' }, (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stderr })))
    assert.equal(proc.status, RED)
    assert.match(proc.stderr, /CANARY FAILED at «area»/)
    // Last: a failed login makes the instance wait before the next one of that person.
    const bad = await run({ TEAM_PASSWORD: 'otra clave que no es' })
    assert.equal(bad.code, RED)
    assert.match(bad.err, /CANARY FAILED at «identity»: login answered 401/)
  })
})
