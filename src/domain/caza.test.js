// Hunt for the failures of the path of a send from its extracted text to its message (2026-10-24): every case is a way an input was left in a
// state nobody works on, or failed with a reason its author could not read, reproduced with the real worker, the real analyzer over the fake
// provider and an ephemeral database. The rule they share: an input never waits in queued, extracting or analyzing without a job alive for it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { analyze } from '../analyze/index.js'
import { all, get, run } from '../db/index.js'
import { createArea } from './areas.js'
import { createAnthropicClient, createFakeProviders, ProviderHttpError } from '../providers/index.js'
import { createWorker } from '../worker.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../testing/helpers.js'

const fast = { identity: { login: { ipMax: 1000 } }, worker: { retryBaseMs: 5, retryMaxMs: 20, heartbeatMs: 20, leaseMs: 5000 } } // the lease is far from the heartbeat: a machine stalled for a second does not expire a healthy job
const envs = []

async function team (opts = {}) {
  const env = await makeEnv({ ...opts, config: { ...fast, ...(opts.config ?? {}), worker: { ...fast.worker, ...(opts.config?.worker ?? {}) } } })
  envs.push(env)
  await addMember(env, { email: 'ana@x.org', name: 'Ana' })
  env.ana = await login(env, 'ana@x.org')
  env.submit = async (text) => (await postInput(env, env.ana, { text })).json()
  env.input = (id) => get(env.db, 'SELECT * FROM inputs WHERE id = ?', id)
  env.statusOf = (id) => env.input(id).status
  return env
}
after(async () => { for (const env of envs) await env.close() })

describe('an input is never left in an intermediate state without a job alive', () => {
  it('a job that failed for good while the input still says «analyzing» (the process died before its handler heard of it) fails the input with the reason', async () => {
    const env = await team()
    const { input_id: id, job_id: jobId } = await env.submit('Un envío cuyo trabajo murió.')
    const job = env.queue.claim('worker-dead')
    assert.equal(String(job.id), jobId)
    run(env.db, "UPDATE inputs SET status = 'analyzing' WHERE id = ?", id)
    // the queue closes the job as failed, and the process dies before `onFailure` writes it on the input
    assert.equal(env.queue.fail(job, new Error('El servicio del modelo no contestó.'), { permanent: true }).state, 'failed')
    assert.equal(env.statusOf(id), 'analyzing')
    env.worker.start()
    await until(() => env.statusOf(id) === 'failed', { timeoutMs: 30000 })
    assert.equal(env.input(id).error, 'El servicio del modelo no contestó.')
    const done = all(env.db, "SELECT data_json FROM job_events WHERE job_id = ? AND kind = 'done'", Number(jobId)).map((e) => JSON.parse(e.data_json))
    assert.deepEqual(done.map((d) => d.status), ['failed'], 'whoever listens to the job hears how it ended')
  })

  it('an input with no job at all (it was lost with a purge) is queued again and ends as a proposal', async () => {
    const env = await team()
    const { input_id: id, job_id: jobId } = await env.submit('Un envío sin trabajo.')
    run(env.db, "UPDATE inputs SET status = 'extracting' WHERE id = ?", id)
    run(env.db, 'DELETE FROM jobs WHERE id = ?', Number(jobId))
    env.worker.start()
    await until(() => env.statusOf(id) === 'proposed', { timeoutMs: 30000 })
    assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM jobs WHERE input_id = ? AND kind = 'analyze'", id).n, 1)
  })

  it('an input whose job is alive is left alone, and so is one whose job has just failed: its handler is about to run', async () => {
    const env = await team({ config: { worker: { heartbeatMs: 600_000, leaseMs: 1_200_000 } } }) // the grace of the sweep is the heartbeat: no clock decides this case
    const { input_id: alive } = await env.submit('Uno con su trabajo en cola.')
    const { input_id: justFailed, job_id: failedJob } = await env.submit('Uno cuyo trabajo acaba de fallar.')
    run(env.db, "UPDATE jobs SET status = 'failed', finished_at = ?, last_error = 'acaba de fallar' WHERE id = ?", Date.now(), Number(failedJob))
    run(env.db, "UPDATE inputs SET status = 'analyzing' WHERE id = ?", justFailed)
    const { createPipeline } = await import('./pipeline.js')
    const pipeline = createPipeline({ db: env.db, config: env.config, queue: env.queue, events: env.events, modules: env.modules })
    assert.equal(pipeline.analyze.sweep(), 0)
    assert.equal(env.statusOf(alive), 'queued')
    assert.equal(env.statusOf(justFailed), 'analyzing')
    assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM jobs WHERE input_id = ? AND kind = 'analyze'", alive).n, 1, 'no second job for an input that has one')
  })
})

describe('a worker that cannot write the end of a job', () => {
  it('a database that refuses the failure of a job does not take the process down: the job keeps its lease to expire and is recovered', async () => {
    const env = await team({ config: { worker: { leaseMs: 200 } } }) // this case is the expiry of a lease
    const unhandled = []
    const record = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', record)
    try {
      let refused = 0
      const queue = { ...env.queue, fail: (...args) => { refused += 1; if (refused === 1) throw new Error('database is locked'); return env.queue.fail(...args) } }
      const { createPipeline } = await import('./pipeline.js')
      const modules = { ...env.modules, analyze: async () => { throw new Error('el proveedor no contesta') } }
      const handlers = createPipeline({ db: env.db, config: env.config, queue, events: env.events, modules })
      const worker = createWorker({ db: env.db, queue, events: env.events, config: env.config, handlers })
      const { input_id: id } = await env.submit('Un envío con una base ocupada.')
      worker.start()
      await until(() => refused >= 2, { timeoutMs: 30000 }) // the lease expires, the job is recovered and fails again, this time written
      await worker.stop()
      assert.deepEqual(unhandled.map(String), [], 'nothing escaped the worker')
      assert.ok(['queued', 'failed'].includes(env.statusOf(id)))
    } finally {
      process.off('unhandledRejection', record)
    }
  })
})

describe('what the analysis is offered', () => {
  it('an area with no active template is not offered: a group placed there could not be published and the input would end as an invalid output', async () => {
    let offered
    const env = await team({ worker: true, modules: { analyze: async (bundle, opts) => { offered = bundle; return fakeAnalyze(bundle, opts) } } })
    const empty = createArea(env.db, { title: 'Sin plantilla', description: 'Un área recién creada, todavía sin su plantilla' })
    const gone = createArea(env.db, { title: 'Plantilla borrada', description: 'Un área cuya única plantilla se borró' })
    const { createTemplate, deleteTemplate } = await import('./areas.js')
    const tpl = createTemplate(env.db, Number(gone.id), { name: 'Provisoria', description: 'Se borra enseguida', body_markdown: '---\nname: Provisoria\nfields: []\n---\nCuerpo.' })
    deleteTemplate(env.db, Number(gone.id), Number(tpl.id))
    const { input_id: id } = await env.submit('Algo que contar.')
    await until(() => env.statusOf(id) === 'proposed')
    const offeredIds = offered.areas.map((a) => a.id)
    assert.ok(!offeredIds.includes(Number(empty.id)) && !offeredIds.includes(Number(gone.id)), `areas offered: ${offeredIds}`)
    for (const a of offered.areas) assert.ok(offered.templates.some((t) => t.area_id === a.id), `area ${a.id} has a template`)
  })
})

describe('a provider that makes the analysis wait', () => {
  it('a Retry-After of an hour does not hold the job past its time limit: the limit ends the wait, the input fails with its reason and nothing is sent after', async () => {
    const providers = createFakeProviders({ text: () => { throw new ProviderHttpError('anthropic: Overloaded', { status: 529, retryable: true, retryAfterMs: 3_600_000 }) } })
    const env = await team({
      worker: true,
      config: { worker: { maxRuntimeMs: 3000, maxAttempts: 1 } }, // the cap ends the wait of an hour; it is far from the time the first call needs
      modules: { analyze, getProviders: () => providers }
    })
    const { input_id: id } = await env.submit('El proveedor está saturado.')
    await until(() => env.statusOf(id) === 'failed', { timeoutMs: 30000 })
    assert.match(env.input(id).error, /superó el tiempo máximo/)
    await until(() => env.worker.active === 0, { timeoutMs: 30000 })
    assert.equal(providers.calls.text.length, 1, 'one call, and the wait for the second ended with the job')
  })
})

describe('what the author reads when the analysis fails', () => {
  const catalog = (file) => readFileSync(join(fileURLToPath(new URL('../../panel/src/i18n', import.meta.url)), file), 'utf8')

  it('a worker that died twice leaves the input failed with a code the panel has a sentence for, in both languages', async () => {
    const env = await team({ config: { worker: { maxAttempts: 2 } } })
    const { input_id: id, job_id: jobId } = await env.submit('Un envío cuyo trabajador murió dos veces.')
    for (const dead of ['worker-dead-1', 'worker-dead-2']) {
      assert.equal(String(env.queue.claim(dead).id), jobId)
      run(env.db, 'UPDATE jobs SET lease_until = 1 WHERE id = ?', Number(jobId))
      env.queue.recoverExpiredLeases({ spare: 'nobody' })
    }
    env.worker.start()
    await until(() => env.statusOf(id) === 'failed', { timeoutMs: 30000 })
    const { error_code: code } = env.input(id)
    assert.equal(code, 'lease_expired')
    for (const file of ['es-419.ts', 'en.ts']) assert.ok(catalog(file).includes(`'analysis.error.${code}':`), `${file} has no sentence for ${code}`)
  })

  it('a send with nothing readable (a silent recording, a blank page) says so, instead of «datos inválidos»', async () => {
    const providers = createFakeProviders({ text: () => { throw new Error('nothing to ask the model') } })
    const env = await team({ worker: true, modules: { analyze, getProviders: () => providers, extract: async () => ({ text: '', meta: {} }) } })
    const { input_id: id } = (await postInput(env, env.ana, { text: '' }, [{ field: 'files', name: 'voz.txt', type: 'text/plain', content: 'x' }])).json()
    await until(() => env.statusOf(id) === 'failed', { timeoutMs: 30000 })
    assert.equal(env.input(id).error_code, 'nothing_readable')
    assert.equal(get(env.db, "SELECT attempts FROM jobs WHERE input_id = ? AND kind = 'analyze'", id).attempts, 1, 'reading nothing again reads nothing')
    assert.equal(providers.calls.text.length, 0)
    for (const file of ['es-419.ts', 'en.ts']) assert.ok(catalog(file).includes("'analysis.error.nothing_readable':"))
  })
})

describe('an input reprocessed after it was published', () => {
  it('the agent that was working on its messages stops with them: the messages go to the trash and the session on them is cancelled', async () => {
    const env = await team({
      autoPublish: true,
      modules: { analyze: async (bundle, opts) => { const r = await fakeAnalyze(bundle, opts); r.proposal.messages[0].assignee_ids = bundle.members.filter((m) => m.name === 'Claude').map((m) => m.id); return r } }
    })
    await addMember(env, { email: 'ed@x.org', name: 'Ed', role: 'editor' })
    const editor = await login(env, 'ed@x.org')
    const headers = (cookie) => ({ cookie, 'x-team-request': 'panel' })
    const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: headers(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Arreglo pantallas.' } })
    assert.equal(created.statusCode, 201, created.body)
    // A session that works until it is told to stop: the runner of the agent is not what is under test.
    let session = null
    const { createPipeline } = await import('./pipeline.js')
    const handlers = {
      ...createPipeline({ db: env.db, config: env.config, queue: env.queue, events: env.events, modules: env.modules }),
      execute: { run: (job, ctx) => new Promise((resolve, reject) => { session = { job, stopped: false }; ctx.signal.addEventListener('abort', () => { session.stopped = true; reject(new Error('detenida')) }) }) }
    }
    const worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config: env.config, handlers })
    worker.start()
    const { input_id: id } = await env.submit('Algo que Claude debe arreglar.')
    await until(() => env.statusOf(id) === 'published' && session, { timeoutMs: 30000 })
    const messageId = get(env.db, 'SELECT id FROM messages WHERE input_id = ?', id).id
    assert.equal(session.job.message_id, messageId)
    const res = await env.app.inject({ method: 'POST', url: `/api/inputs/${id}/reprocess`, headers: headers(editor) })
    assert.equal(res.statusCode, 202, res.body)
    assert.ok(get(env.db, 'SELECT deleted_at FROM messages WHERE id = ?', messageId).deleted_at, 'the message went to the trash')
    assert.equal(get(env.db, 'SELECT status FROM jobs WHERE id = ?', session.job.id).status, 'cancelled', 'and the session on it does not go on')
    await until(() => session.stopped, { timeoutMs: 30000 })
    await worker.stop()
  })
})

describe('a shutdown while the model is thinking', () => {
  it('the request in flight goes with the job: the worker stops without waiting for the request and the job returns to the queue with its attempt refunded', { timeout: 60000 }, async () => {
    // A provider whose request never answers until it is cut: what a classification at high effort looks like to a shutdown.
    let cut = 0
    const fetchImpl = (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => { cut += 1; reject(init.signal.reason) }) })
    const client = createAnthropicClient({ apiKey: 'clave-de-prueba', fetchImpl, cacheWarmup: false })
    const providers = { text: { name: client.name, model: client.model, schemaProfile: client.schemaProfile, complete: client.complete } }
    const env = await team({ worker: true, modules: { analyze, getProviders: () => providers } })
    const { input_id: id, job_id: jobId } = await env.submit('Un envío cuando el servicio se reinicia.')
    await until(() => env.statusOf(id) === 'analyzing', { timeoutMs: 30000 })
    await until(() => env.worker.active === 1)
    const started = Date.now()
    await env.worker.stop()
    assert.ok(Date.now() - started < 10000, `${Date.now() - started} ms to stop`) // it never waits for the request: without the fix it hangs until the provider answers
    assert.equal(cut, 1, 'the request was cut, not left to finish')
    const job = get(env.db, 'SELECT status, attempts FROM jobs WHERE id = ?', Number(jobId))
    assert.deepEqual([job.status, job.attempts], ['queued', 0])
  })
})
