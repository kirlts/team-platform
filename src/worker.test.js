import assert from 'node:assert/strict'
import { test } from 'node:test'
import { all, get, run } from './db/index.js'
import { Deferred } from './domain/pipeline.js'
import { setProjectDescription } from './domain/settings.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from './testing/helpers.js'

const fast = { identity: { login: { ipMax: 1000 } }, worker: { retryBaseMs: 5, retryMaxMs: 20 } }

async function envVars (opts = {}) {
  const env = await makeEnv({ config: fast, ...opts, config: { ...fast, ...(opts.config ?? {}), worker: { ...fast.worker, ...(opts.config?.worker ?? {}) } } })
  await addMember(env, { email: 'ana@x.org' })
  env.ana = await login(env, 'ana@x.org')
  env.submit = async (textValue, filePaths = []) => (await postInput(env, env.ana, { text: textValue }, filePaths)).json()
  env.input = (id) => get(env.db, 'SELECT * FROM inputs WHERE id = ?', id)
  env.statusOf = (id) => env.input(id).status
  return env
}
const textFile = (n = 'a.txt') => ({ field: 'files', name: n, type: 'text/plain', content: 'contenido' })

test('success: progress comes from completed steps and ends at 100 with done', async () => {
  const env = await envVars({ worker: true })
  const { input_id: id, job_id: jobId } = await env.submit('hola', [textFile('1.txt'), textFile('2.txt')].map((a, i) => ({ ...a, content: `c${i}` })))
  await until(() => env.statusOf(id) === 'proposed')
  const progressRows = all(env.db, "SELECT percent, phrase FROM job_events WHERE job_id = ? AND kind = 'progress' ORDER BY seq", jobId)
  const percents = progressRows.map((p) => p.percent)
  assert.deepEqual([...percents].sort((a, b) => a - b), percents) // never goes backwards
  assert.equal(percents.at(-1), 100)
  assert.ok(percents.every((p) => Number.isInteger(p) && p >= 0 && p <= 100))
  assert.ok(progressRows.some((p) => /Leyendo adjunto 2 de 2/.test(p.phrase)))
  assert.ok(progressRows.some((p) => p.phrase === 'Analizando' || p.phrase === 'Propuesta lista'))
  const doneRow = get(env.db, "SELECT * FROM job_events WHERE job_id = ? AND kind = 'done'", jobId)
  assert.equal(JSON.parse(doneRow.data_json).status, 'done')
  assert.equal(get(env.db, 'SELECT status FROM jobs WHERE id = ?', jobId).status, 'done')
  // The proposal keeps its messages and the units.
  assert.equal(JSON.parse(get(env.db, 'SELECT payload_json FROM proposals').payload_json).messages.length, 1)
  await env.close()
})

test('extractors and analysis receive the contract: attachment with an absolute path, without the application config', async () => {
  const seen = {}
  const env = await envVars({
    worker: true,
    modules: {
      extract: async (a, opts) => { seen.extract = { a, lookupKeys: Object.keys(opts).sort() }; return { text: 'x', meta: {} } },
      analyze: async (bundle, opts) => { seen.analyze = { bundle, lookupKeys: Object.keys(opts).sort() }; return fakeAnalyze(bundle, opts) },
      getAnalyzer: () => 'harness'
    }
  })
  const profile = 'Hago la API y la base de datos.\n\nNo toco la interfaz.'
  setProjectDescription(env.db, '# Atlas\n\nStack: Node.')
  run(env.db, "UPDATE members SET profile = ? WHERE email = 'ana@x.org'", profile)
  const { input_id: id } = await env.submit('texto', [textFile()])
  await until(() => env.statusOf(id) === 'proposed')
  assert.ok(seen.extract.a.path.startsWith('/'))
  assert.deepEqual(seen.extract.lookupKeys, ['onProgress', 'providers', 'signal'])
  assert.deepEqual(Object.keys(seen.extract.a).sort(), ['id', 'input_id', 'kind', 'mime', 'name', 'path', 'sha256', 'size'])
  assert.deepEqual(seen.analyze.lookupKeys, ['analyzer', 'onProgress', 'providers', 'redescribe', 'signal'])
  assert.equal(seen.analyze.bundle.templates[0].body_markdown.startsWith('---'), true)
  assert.ok(seen.analyze.bundle.areas.every((a) => a.position !== undefined))
  assert.deepEqual(seen.analyze.bundle.project, { name: env.config.projectName, description: '# Atlas\n\nStack: Node.' }) // UD-024
  assert.deepEqual(seen.analyze.bundle.members, [{ id: 1, name: 'ana', profile }]) // UD-023: the whole profile, nothing else
  await env.close()
})

test('a permanent ExtractError fails immediately, with its code and the attachment name, without retries', async () => {
  const env = await envVars({
    worker: true,
    modules: { extract: async () => { throw Object.assign(new Error('El video supera los 20 minutos.'), { name: 'ExtractError', code: 'video_too_long' }) } }
  })
  const { input_id: id, job_id: jobId } = await env.submit('x', [textFile('clase.txt')])
  await until(() => env.statusOf(id) === 'failed')
  const dbRow = env.input(id)
  assert.equal(dbRow.error_code, 'video_too_long')
  assert.match(dbRow.error, /«clase\.txt»: El video supera los 20 minutos\./)
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 1)
  const doneRow = JSON.parse(get(env.db, "SELECT data_json FROM job_events WHERE kind = 'done'").data_json)
  assert.equal(doneRow.status, 'failed')
  assert.equal(doneRow.error_code, 'video_too_long')
  const view = (await env.app.inject({ url: `/api/inputs/${id}`, headers: { cookie: env.ana } })).json()
  assert.equal(view.error_code, 'video_too_long') // the code reaches the client
  await env.close()
})

test('a transient failure is retried with backoff and ends well; the input goes back to «queued» while it waits', async () => {
  let callRows = 0
  const statusList = []
  const env = await envVars({
    worker: true,
    modules: { analyze: async (b, o) => { callRows++; statusList.push(callRows); if (callRows < 3) throw new Error('503 del proveedor'); return fakeAnalyze(b, o) } }
  })
  const { input_id: id, job_id: jobId } = await env.submit('x')
  await until(() => env.statusOf(id) === 'proposed')
  assert.equal(callRows, 3)
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 3)
  const phraseList = all(env.db, "SELECT phrase FROM job_events WHERE job_id = ? AND kind = 'progress'", jobId).map((f) => f.phrase)
  assert.ok(phraseList.some((f) => /Falló el intento 1 de 3; se reintenta/.test(f)))
  await env.close()
})

test('once the attempts are exhausted the input fails with the last reason', async () => {
  const env = await envVars({ worker: true, modules: { analyze: async () => { throw new Error('el proveedor no responde') } } })
  const { input_id: id, job_id: jobId } = await env.submit('x')
  await until(() => env.statusOf(id) === 'failed')
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 3)
  assert.equal(env.input(id).error, 'el proveedor no responde')
  await env.close()
})

test('provider and analyzer configuration errors are not retried', async () => {
  const env = await envVars({
    worker: true,
    modules: {
      analyze: async () => {
        throw Object.assign(new Error('Falta ANTHROPIC_API_KEY'), { code: 'config', calls: [{ step: 'classify', provider: 'anthropic', model: 'claude-haiku-5-5', usage: { input_tokens: 500, output_tokens: 0 }, duration_ms: 5 }] })
      }
    }
  })
  const { input_id: id, job_id: jobId } = await env.submit('x')
  await until(() => env.statusOf(id) === 'failed')
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 1)
  assert.equal(env.input(id).error_code, 'config')
  await env.close()
})

test('analyzer domain results that are not ok (refusal, max_tokens, invalid) fail with the reason, without a retry', async () => {
  const cases = [
    [{ status: 'refusal', explanation: 'política de contenido' }, /rechazó analizar el contenido: política de contenido/, 'refusal'],
    [{ status: 'max_tokens' }, /se cortó por tamaño/, 'max_tokens'],
    [{ status: 'invalid', reason: 'mece_conflict' }, /solapes ni huecos/, 'invalid'],
    [{ status: 'invalid', errors: ['falta area_id'] }, /salida inválida.*falta area_id/, 'invalid']
  ]
  for (const [result, reasonText, errorCodeValue] of cases) {
    const env = await envVars({ worker: true, modules: { analyze: async () => ({ ...result, units: [], calls: [{ provider: 'p', model: 'm', usage: { input_tokens: 1 } }] }) } })
    const { input_id: id, job_id: jobId } = await env.submit('x')
    await until(() => env.statusOf(id) === 'failed')
    assert.match(env.input(id).error, reasonText)
    assert.equal(env.input(id).error_code, errorCodeValue)
    assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 1)
    await env.close()
  }
})

test('an analyzer that still returns area and template at the root is normalized to one per message', async () => {
  const env = await envVars({
    worker: true,
    modules: {
      analyze: async (b) => {
        const r = await fakeAnalyze(b)
        const { area_id, template_id, ...m } = r.proposal.messages[0]
        return { ...r, proposal: { area_id, template_id, messages: [m], discarded: [] } }
      }
    }
  })
  const { input_id: id } = await env.submit('x')
  await until(() => env.statusOf(id) === 'proposed')
  const payload = JSON.parse(get(env.db, 'SELECT payload_json FROM proposals').payload_json)
  assert.ok(Number.isInteger(payload.messages[0].area_id) && Number.isInteger(payload.messages[0].template_id))
  assert.equal(payload.area_id, undefined)
  await env.close()
})

test('a proposal with an invalid shape fails with its own reason', async () => {
  const env = await envVars({ worker: true, modules: { analyze: async () => ({ status: 'ok', proposal: { messages: [{ title: 'sin área' }] }, calls: [] }) } })
  const { input_id: id } = await env.submit('x')
  await until(() => env.statusOf(id) === 'failed')
  assert.equal(env.input(id).error_code, 'proposal_invalid')
  await env.close()
})

test('the audio budget defers the job without spending the attempt and resumes it when there is room', async () => {
  let budgetOk = false
  const queries = []
  const env = await envVars({
    worker: true,
    modules: {
      estimateAudioSeconds: async (a) => (a.kind === 'audio' ? 600 : 0),
      audioBudget: { check: (s) => { queries.push(s); return budgetOk ? { allowed: true, waitMs: 0 } : { allowed: false, waitMs: 30, reason: 'window_full' } }, record: (s) => queries.push(`record ${s}`) }
    }
  })
  const { input_id: id, job_id: jobId } = await env.submit('x', [{ field: 'files', name: 'a.mp3', type: 'audio/mpeg', content: 'sonido' }])
  await until(() => get(env.db, "SELECT COUNT(*) AS n FROM job_events WHERE phrase = 'Esperando cupo de transcripción'").n > 0)
  assert.equal(env.statusOf(id), 'queued')
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 0) // attempt refunded
  budgetOk = true
  await until(() => env.statusOf(id) === 'proposed')
  assert.ok(queries.includes('record 600'))
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 1)
  await env.close()
})

test('audio that would never fit in the budget fails with its code', async () => {
  const env = await envVars({
    worker: true,
    modules: { estimateAudioSeconds: async () => 99999, audioBudget: { check: () => ({ allowed: false, waitMs: Infinity, reason: 'exceeds_budget' }), record () {} } }
  })
  const { input_id: id } = await env.submit('x', [{ field: 'files', name: 'a.mp3', type: 'audio/mpeg', content: 'sonido' }])
  await until(() => env.statusOf(id) === 'failed')
  assert.equal(env.input(id).error_code, 'audio_budget_exceeded')
  await env.close()
})

test('without an analysis module the job fails with module_unavailable and a clear message', async () => {
  const env = await envVars({ worker: true, modules: { analyze: null } })
  const { input_id: id } = await env.submit('x')
  await until(() => env.statusOf(id) === 'failed')
  assert.equal(env.input(id).error_code, 'module_unavailable')
  assert.match(env.input(id).error, /análisis no está disponible/)
  await env.close()
})

test('cancelling with the job in progress aborts it: no proposal is left and the state does not change', async () => {
  let unblock
  const stopped = new Promise((r) => { unblock = r })
  let wasAborted = false
  const env = await envVars({
    worker: true,
    modules: {
      analyze: async (b, o) => {
        o.signal.addEventListener('abort', () => { wasAborted = true })
        await stopped
        return fakeAnalyze(b, o)
      }
    }
  })
  const { input_id: id, job_id: jobId } = await env.submit('x')
  await until(() => env.statusOf(id) === 'analyzing')
  const r = await env.app.inject({ method: 'POST', url: `/api/inputs/${id}/cancel`, headers: { cookie: env.ana, 'x-team-request': 'panel' } })
  assert.equal(r.statusCode, 200)
  await until(() => wasAborted) // the signal arrives immediately, without waiting for the heartbeat
  unblock()
  await until(() => env.worker.active === 0)
  assert.equal(env.statusOf(id), 'cancelled')
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM proposals').n, 0)
  assert.equal(get(env.db, 'SELECT status FROM jobs WHERE id = ?', jobId).status, 'cancelled')
  await env.close()
})

test('shutting down with a job in progress returns it to the queue with the attempt refunded, without waiting for it', async () => {
  const env = await envVars({
    worker: true,
    modules: { analyze: (b, o) => new Promise((resolve, reject) => o.signal.addEventListener('abort', () => reject(o.signal.reason))) }
  })
  const { input_id: id, job_id: jobId } = await env.submit('x')
  await until(() => env.statusOf(id) === 'analyzing')
  const t0 = Date.now()
  await env.worker.stop()
  assert.ok(Date.now() - t0 < 1000)
  const jobRow = get(env.db, 'SELECT * FROM jobs WHERE id = ?', jobId)
  assert.equal(jobRow.status, 'queued')
  assert.equal(jobRow.attempts, 0)
  // A new worker picks the job up (as after restarting the process).
  let completed = false
  env.modules.analyze = async (b, o) => { completed = true; return fakeAnalyze(b, o) }
  const { createWorker } = await import('./worker.js')
  const { createPipeline } = await import('./domain/pipeline.js')
  const another = createWorker({ db: env.db, queue: env.queue, events: env.events, config: env.config, handlers: createPipeline({ db: env.db, config: env.config, queue: env.queue, events: env.events, modules: env.modules }) })
  another.start()
  await until(() => env.statusOf(id) === 'proposed')
  assert.ok(completed)
  await another.stop()
  await env.close()
})

test('a worker that dies holding a claimed job: the lease expires and another one recovers it', async () => {
  const env = await envVars({ config: { worker: { leaseMs: 60, heartbeatMs: 20 } } })
  const { input_id: id, job_id: jobId } = await env.submit('x')
  const claimed = env.queue.claim('worker-dead') // claims and «dies»: it will never heartbeat or close
  assert.equal(String(claimed.id), jobId)
  const { createWorker } = await import('./worker.js')
  const { createPipeline } = await import('./domain/pipeline.js')
  const alive = createWorker({ db: env.db, queue: env.queue, events: env.events, config: env.config, handlers: createPipeline({ db: env.db, config: env.config, queue: env.queue, events: env.events, modules: env.modules }) })
  alive.start()
  await until(() => env.statusOf(id) === 'proposed', { timeoutMs: 4000 })
  assert.equal(get(env.db, 'SELECT attempts FROM jobs WHERE id = ?', jobId).attempts, 2)
  await alive.stop()
  await env.close()
})

test('per-job time limit: it is aborted and fails with the reason', async () => {
  const env = await envVars({
    worker: true,
    config: { worker: { maxRuntimeMs: 40, maxAttempts: 1 } },
    modules: { analyze: (b, o) => new Promise((resolve, reject) => o.signal.addEventListener('abort', () => reject(new Error('aborted')))) }
  })
  const { input_id: id } = await env.submit('x')
  await until(() => env.statusOf(id) === 'failed')
  assert.match(env.input(id).error, /superó el tiempo máximo/)
  await env.close()
})

test('the configured concurrency bounds simultaneous jobs', async () => {
  let inFlight = 0
  let peak = 0
  const env = await envVars({
    worker: true,
    config: { worker: { concurrency: 2 } },
    modules: { analyze: async (b, o) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 60)); inFlight--; return fakeAnalyze(b, o) } }
  })
  const ids = []
  for (let i = 0; i < 5; i++) ids.push((await env.submit(`texto ${i}`)).input_id)
  await until(() => ids.every((id) => env.statusOf(id) === 'proposed'))
  assert.equal(peak, 2)
  await env.close()
})

test('Deferred is the internal deferral signal', () => {
  const d = new Deferred(100, 'x')
  assert.equal(d.deferMs, 100)
})

test('reprocess: the editor enqueues the analysis again, keeping the extractions', async () => {
  let extractions = 0
  const env = await envVars({ worker: true, modules: { extract: async () => { extractions++; return { text: 'x', meta: {} } } } })
  await addMember(env, { email: 'ed@x.org', role: 'editor' })
  const editor = await login(env, 'ed@x.org')
  const { input_id: id } = await env.submit('x', [textFile()])
  await until(() => env.statusOf(id) === 'proposed')
  const req = (cookie, url) => env.app.inject({ method: 'POST', url: `/api/inputs/${id}${url}`, headers: { cookie, 'x-team-request': 'panel' } })
  await addMember(env, { email: 'beto@x.org' })
  assert.equal((await req(await login(env, 'beto@x.org'), '/reprocess')).statusCode, 404) // an input of someone else does not exist for a member
  const r = await req(editor, '/reprocess')
  assert.equal(r.statusCode, 202)
  assert.equal(get(env.db, 'SELECT COUNT(*) AS n FROM proposals').n, 0)
  await until(() => env.statusOf(id) === 'proposed' && get(env.db, 'SELECT COUNT(*) AS n FROM proposals').n === 1)
  assert.equal(extractions, 1) // nothing was extracted again
  assert.equal(get(env.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'input.reprocess'").n, 1)
  // A published input is not reprocessed.
  const v = (await env.app.inject({ url: `/api/inputs/${id}`, headers: { cookie: env.ana } })).json()
  await env.app.inject({ method: 'POST', url: `/api/inputs/${id}/publish`, headers: { cookie: env.ana, 'x-team-request': 'panel' }, payload: { messages: v.proposal.messages } })
  assert.equal((await req(editor, '/reprocess')).statusCode, 409)
  await env.close()
})
