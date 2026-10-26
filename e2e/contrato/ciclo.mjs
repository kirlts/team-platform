// The whole cycle of a message to Claude in one process, for the contract suite (e2e/contrato/C*.e2e.test.mjs):
//   input -> analysis (fake provider) -> publication -> `execute` job (fake session) -> `deliver` job (fake delivery order) -> thread.
// Nothing real: a temporary SQLite, an ephemeral port, the fake `claude` of src/execute/testing, shell snippets as the delivery order.
// What a test asserts is what a person sees: the thread (`GET /api/messages/:id`) and the state of the message.
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../../src/config.js'
import { createPipeline } from '../../src/domain/pipeline.js'
import { updateMember } from '../../src/domain/members.js'
import { createVault, loadMasterKey } from '../../src/domain/vault.js'
import { resumeInfraFailures } from '../../src/execute/resume.js'
import { createDeliverHandler } from '../../src/execute/deliver.js'
import { createExecuteHandler } from '../../src/execute/handler.js'
import { addMember, fakeAnalyze, login, makeEnv, postInput, until } from '../../src/testing/helpers.js'
import { createWorker } from '../../src/worker.js'

const FAKE_CLAUDE = fileURLToPath(new URL('../../src/execute/testing/fake-claude-stream.mjs', import.meta.url))
const SESSION_BIN = fileURLToPath(new URL('./sesion.sh', import.meta.url))
chmodSync(SESSION_BIN, 0o755)
process.env.FAKE_CLAUDE = FAKE_CLAUDE
process.env.FAKE_JUDGE = 'off' // the judgement of the work has its own test; it is not part of this contract
const FAKE_ENV = ['FAKE_EXECUTE_MODE', 'FAKE_EXECUTE_REPLY', 'FAKE_EXECUTE_EXTRA', 'FAKE_EXECUTE_CAPTURE_FILES', 'FAKE_EXECUTE_ATTACHMENT_FILES', 'FAKE_EXECUTE_START_CAPTURES', 'FAKE_EXECUTE_START_ZONE', 'FAKE_EXECUTE_SLEEP_MS', 'FAKE_EXECUTE_GIT', 'FAKE_EXECUTE_FAIL_FIRST', 'FAKE_EXECUTE_FAIL_MODE', 'FAKE_EXECUTE_MULTI', 'FAKE_EXECUTE_GATE']

/** The sessions of the suite run as the first reply and the final output of a normal job unless a test says otherwise. */
export function resetSession () {
  for (const name of FAKE_ENV) delete process.env[name]
  process.env.FAKE_EXECUTE_MODE = 'ok'
  process.env.FAKE_EXECUTE_REPLY = '1'
}

/** Delivery orders of the host, as shell snippets: what the platform reads is the exit code and the lines, never what the snippet is. */
export const ORDEN = {
  pasa: "echo '##team phase verify'; echo '##team phase deploy'; echo abc1234",
  fallaPrueba: (nombre = 'src/agenda.test.js › la agenda carga con datos') => `echo '##team phase verify'; echo 'FALLA prueba: ${nombre}' >&2; exit 1`,
  inexistente: '/ruta/que/no/existe/entregar.sh',
  // Fails the first `n` times with a named test, then delivers (a flaky or someone else's test that the next pass fixes).
  fallaYLuegoPasa: (archivo, n, nombre = 'src/ajena.test.js › una prueba que no es del cambio') => `c=$(cat ${archivo} 2>/dev/null || echo 0); c=$((c+1)); echo $c > ${archivo}; if [ $c -le ${n} ]; then echo 'FALLA prueba: ${nombre} ('$c')' >&2; exit 1; fi; echo '##team phase deploy'; echo abc1234`
}

/**
 * Starts the instance. `execute` overrides the EXECUTE_* configuration; `estimates` is what the fake analyzer says about each message;
 * `progressUnitMs` shortens the «minute» of the progress notices. Returns the handle every test of the suite uses.
 */
export async function iniciarCiclo ({ execute = {}, estimates = null, martinProfile = 'Trátame de tú.', progressUnitMs = 60_000, config: extraConfig = {} } = {}) {
  resetSession()
  let currentEstimates = estimates
  let assignee = 'Claude'
  const analyze = async (bundle, opts) => {
    const r = await fakeAnalyze(bundle, opts)
    const message = r.proposal.messages[0]
    if (currentEstimates) Object.assign(message, { understand_vs_create: 0.9, irreversibility: 0.1, value_holder: 'model', certainty: 0.9, estimate_reason: 'razón', ...currentEstimates })
    message.assignee_ids = bundle.members.filter((m) => m.name === assignee).map((m) => m.id)
    return r
  }
  const env = await makeEnv({ modules: { analyze }, config: extraConfig })
  const state = join(env.dir, 'fake-state')
  mkdirSync(state)
  process.env.FAKE_EXECUTE_STATE = state
  const vault = createVault(loadMasterKey({ dataDir: env.dir }))
  const panel = (cookie) => ({ cookie, 'x-team-request': 'panel' })
  await addMember(env, { email: 'ed@x.org', role: 'editor', name: 'Ed' })
  const editor = await login(env, 'ed@x.org')
  const created = await env.app.inject({ method: 'POST', url: '/api/members', headers: panel(editor), payload: { email: 'claude@x.org', name: 'Claude', kind: 'agent', profile: 'Arreglo pantallas del producto.' } })
  assert.equal(created.statusCode, 201, created.body)
  const agentId = Number(created.json().id)
  const martinId = await addMember(env, { email: 'martin@x.org', name: 'Martín' })
  updateMember(env.db, martinId, { profile: martinProfile })
  const martin = await login(env, 'martin@x.org')
  await env.app.listen({ host: '127.0.0.1', port: 0 }) // an ephemeral port: the session calls back with `team`
  const teamUrl = `http://127.0.0.1:${env.app.server.address().port}`
  const baseExecute = structuredClone(env.config.execute) // the product's own defaults

  let worker = null
  let cases = 0
  let lastConfig = null
  const c = {
    env, state, agentId, martinId, editor, martin, panel, teamUrl,
    get config () { return lastConfig },
    set estimates (v) { currentEstimates = v },
    /** Who the fake analyzer assigns the next messages to: `Claude` (omission) or the name of a person (`Ed`). */
    set asignado (name) { assignee = name },
    /** Starts a worker (a new «deploy» of the service). `over` overrides the EXECUTE_* of this start. */
    iniciar (over = {}, { unitMs = progressUnitMs, progressClock = null } = {}) {
      // One configuration for the API and the worker (`POST /messages/:id/deliver` needs the order declared): the EXECUTE_* of the instance are rewritten in place, from its defaults.
      lastConfig = env.config
      for (const key of Object.keys(lastConfig.execute)) delete lastConfig.execute[key]
      Object.assign(lastConfig.execute, structuredClone(baseExecute), { bin: SESSION_BIN, machineBin: SESSION_BIN, teamUrl, killGraceMs: 200, dailyBudgetUsd: 1000, infraRetryWaitMs: 50, capacityWaitMs: 300 }, execute, over)
      const handlers = {
        ...createPipeline({ db: env.db, config: lastConfig, queue: env.queue, events: env.events, modules: env.modules }),
        execute: createExecuteHandler({ db: env.db, config: lastConfig, queue: env.queue, events: env.events, vault, progressUnitMs: unitMs, progressClock }),
        deliver: createDeliverHandler({ db: env.db, config: lastConfig, queue: env.queue, events: env.events })
      }
      worker = createWorker({ db: env.db, queue: env.queue, events: env.events, config: lastConfig, handlers, resume: (trigger) => resumeInfraFailures({ db: env.db, config: lastConfig, events: env.events }, { trigger }) })
      worker.start()
      return worker
    },
    async detener () { await worker?.stop(); worker = null },
    /** A message of Martín, through the API as the panel does: input, analysis, publication. Returns the message id. */
    async enviar (text, { cookie = martin } = {}) {
      // The platform sends the same text only once (idempotent by hash): each case of the suite is its own message.
      const res = await postInput(env, cookie, { text: `${text} (caso ${++cases})` })
      assert.equal(res.statusCode, 202, res.body)
      const inputId = res.json().input_id
      await until(() => env.db.prepare('SELECT status FROM inputs WHERE id = ?').get(inputId).status === 'proposed', { timeoutMs: 15000 })
      const pub = await env.app.inject({ method: 'POST', url: `/api/inputs/${inputId}/publish`, headers: { ...panel(cookie), 'content-type': 'application/json' }, payload: '{}' })
      assert.equal(pub.statusCode, 200, pub.body)
      return env.db.prepare('SELECT id FROM messages WHERE input_id = ?').get(inputId).id
    },
    /** What the person sees: the thread of the message as the API serves it. */
    async hilo (id, cookie = martin) {
      const res = await env.app.inject({ method: 'GET', url: `/api/messages/${id}`, headers: { cookie } })
      assert.equal(res.statusCode, 200, res.body)
      return res.json()
    },
    /** Another person of the team, with their own profile; returns their cookie. */
    async personaNueva (email, name, profile) {
      const id = await addMember(env, { email, name })
      updateMember(env.db, id, { profile })
      return login(env, email)
    },
    async post (url, cookie, payload) {
      return env.app.inject({ method: 'POST', url, headers: { ...panel(cookie), 'content-type': 'application/json' }, payload: JSON.stringify(payload ?? {}) })
    },
    trabajos (id, kind) { return env.db.prepare('SELECT * FROM jobs WHERE kind = ? AND message_id = ? ORDER BY id').all(kind, id) },
    estado (id) { return env.db.prepare('SELECT status FROM messages WHERE id = ?').get(id).status },
    /** Waits until every `execute` and `deliver` job of the message ended and none is queued, and some existed. */
    esperar (id, { timeoutMs = 60000 } = {}) {
      return until(() => {
        const jobs = env.db.prepare("SELECT status FROM jobs WHERE message_id = ? AND kind IN ('execute', 'deliver')").all(id)
        return jobs.length > 0 && jobs.every((j) => ['done', 'failed', 'cancelled'].includes(j.status))
      }, { timeoutMs })
    },
    /** The replies of Claude in the thread, in order. */
    async respuestasDeClaude (id) { return (await c.hilo(id)).replies.filter((r) => String(r.author_id) === String(agentId)) },
    /** The calls the fake session received (arguments, prompt, TEAM_* variables). */
    llamadas () { try { return readFileSync(join(state, 'calls.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } },
    /** The complete environment of the session of a call (what the worker handed to it). */
    entornoDe (call) {
      const text = readFileSync(join(state, `env-${call.pid}.txt`), 'utf8')
      return Object.fromEntries(text.split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
    },
    argumentosDe (call) { return call.args },
    /** The hour of the thread a person reads: the closing reply of Claude, the last one. */
    async ultimaDeClaude (id) { return (await c.respuestasDeClaude(id)).at(-1) },
    async cerrar () { await c.detener(); await env.close() }
  }
  return c
}

/** Peak number of sessions alive at once, from the start and end marks the fake session leaves. */
export function picoDeSesiones (state) {
  const read = (name) => { try { return readFileSync(join(state, name), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) } catch { return [] } }
  const starts = read('calls.jsonl').map((c) => ({ t: c.t0, d: 1 }))
  const ends = read('ends.jsonl').map((e) => ({ t: e.t1, d: -1 }))
  let live = 0
  let peak = 0
  for (const e of [...starts, ...ends].sort((a, b) => a.t - b.t || a.d - b.d)) { live += e.d; peak = Math.max(peak, live) }
  return peak
}

/** The body text of every reply and note a person reads in the thread, in order, as one list. */
export function textos (hilo) {
  return [...hilo.replies.map((r) => r.body), ...(hilo.progress_notes ?? hilo.notes ?? []).map((n) => n.body)]
}

export { until, readdirSync, writeFileSync }
