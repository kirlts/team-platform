// Test utilities: an ephemeral SQLite database on disk (WAL does not exist in :memory:), the full application with
// fake analyzer and extractors, and helpers to log in and upload files. This is test support:
// nothing here is imported from production code.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../api/index.js'
import { loadConfig } from '../config.js'
import { initializeDatabase, openInitialized } from '../db/index.js'
import { seedDefaults } from '../db/seed.js'
import { createMember } from '../domain/members.js'
import { createPipeline } from '../domain/pipeline.js'
import { parseTemplate } from '../domain/template-file.js'
import { createEvents } from '../events/index.js'
import { hashPassword } from '../identity/password.js'
import { createQueue } from '../queue/index.js'
import { createWorker } from '../worker.js'
import { initTelemetry } from '../domain/tracing.js'
import { run } from '../db/index.js'

export const TEST_PASSWORD = 'una clave larga de prueba 1' // 27 characters: meets the minimum of 15

/** Temporary directory owned by the test, inside TMPDIR (the session's, not /tmp). */
export function tempDir () {
  return mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-platform-test-'))
}

export function testConfig (dir, overrides = {}) {
  return loadConfig({ DATA_DIR: dir, LOG_LEVEL: "silent" }, overrides)
}

/**
 * Fake analyzer with the shape of the real contract: { status, proposal, units, calls, stats }. It picks the first
 * area with a template and returns one message with all the text and all the attachments.
 */
export const fakeAnalyze = async (bundle, { onProgress } = {}) => {
  onProgress?.({ percent: 50, phrase: 'Analizando' })
  const area = bundle.areas[0]
  const tpl = bundle.templates.find((t) => t.area_id === area.id)
  return {
    status: 'ok',
    proposal: {
      messages: [{
        area_id: area.id,
        template_id: tpl.id,
        title: 'Mensaje de prueba',
        body: `${bundle.text}${bundle.attachments.map((a) => `\n[${a.kind}] ${a.extracted}`).join('')}`,
        // The required fields of the chosen template, filled in the way the real analyzer would.
        fields: Object.fromEntries(parseTemplate(tpl.body_markdown).fields.filter((f) => f.required).map((f) => [f.name, 'dato'])),
        assignee_ids: bundle.members.slice(0, 1).map((m) => m.id),
        attachment_ids: bundle.attachments.map((a) => a.id),
        unit_ids: []
      }],
      discarded: []
    },
    units: [],
    calls: [{ step: 'classify', provider: 'doble', model: 'claude-haiku-5-5', usage: { input_tokens: 1000, output_tokens: 200, cached_tokens: 0 }, duration_ms: 12, outcome: 'ok' }],
    stats: {}
  }
}

/** Fake extractor: returns the text «extraído de <name>» and advances in steps. */
export const fakeExtract = async (attachment, { onProgress } = {}) => {
  onProgress?.(40, 'leyendo')
  onProgress?.(100, 'listo')
  return { text: `extraído de ${attachment.kind}`, meta: { kind: attachment.kind, calls: [] } }
}

/**
 * Full environment. `modules` replaces the fakes; `worker: true` starts a worker (off by default, so that
 * the test controls when it runs). Returns everything needed and a `close()`.
 */
export async function makeEnv ({ config: overrides = {}, modules = {}, worker = false, seed = true, clock = false, telemetry = false } = {}) {
  const dir = tempDir()
  const config = testConfig(dir, overrides)
  await initializeDatabase(config, { seed: seed ? seedDefaults : null })
  const db = openInitialized(config)
  const events = createEvents({ db })
  const queue = createQueue({ db, config, events })
  // Telemetry is process-global: only one test per file can start it (`telemetry: true`).
  const telemetryHandle = telemetry ? initTelemetry({ db, serviceVersion: config.version }) : null
  const mods = {
    analyze: fakeAnalyze, extract: fakeExtract, getProviders: () => ({ describe: () => [] }), getAnalyzer: () => 'api',
    buildProviders: () => ({}), audioBudget: null, estimateAudioSeconds: null, warmTemplate: null, ...modules
  }
  // `clock`: a controllable clock for identity (login waits, session expiry) without really sleeping.
  const clockObj = { t: Date.now() }
  const { app, domainEvents, identity } = await buildApp({ db, config, queue, events, modules: mods, telemetry: telemetryHandle, ...(clock ? { now: () => clockObj.t } : {}) })
  const handlers = createPipeline({ db, config, queue, events, modules: mods })
  const w = createWorker({ db, queue, events, config, handlers })
  if (worker) w.start()
  return {
    dir, config, db, events, queue, app, clock: clockObj, telemetry: telemetryHandle, domainEvents, identity, worker: w, modules: mods,
    async close () {
      await w.stop()
      events.stopPolling()
      await telemetryHandle?.shutdown()
      await app.close()
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/** Direct creation of a member with a password (bypassing the API). */
export async function addMember (env, { email, name = email.split('@')[0], role = 'member', password = TEST_PASSWORD } = {}) {
  const id = createMember(env.db, { email, name, role })
  const hash = await hashPassword(password, env.config.identity.argon2)
  run(env.db, 'INSERT INTO credentials (member_id, password_hash, updated_at) VALUES (?, ?, ?)', id, hash, Date.now())
  return id
}

/** Logs in through the API and returns the Cookie header ready to use. */
export async function login (env, email, password = TEST_PASSWORD) {
  const res = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode}: ${res.body}`)
  const c = res.cookies[0]
  return `${c.name}=${c.value}`
}

/** Multipart body for `inject`, built with Node's FormData. */
export async function multipart (fieldValues = {}, filePaths = []) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fieldValues)) for (const val of [].concat(v)) fd.append(k, val)
  for (const a of filePaths) fd.append(a.field ?? 'files', new Blob([a.content], { type: a.type }), a.name)
  const res = new Response(fd)
  return { payload: Buffer.from(await res.arrayBuffer()), headers: { 'content-type': res.headers.get('content-type') } }
}

export async function postInput (env, cookie, fieldValues, filePaths = []) {
  const { payload, headers } = await multipart(fieldValues, filePaths)
  return env.app.inject({ method: 'POST', url: '/api/inputs', payload, headers: { ...headers, cookie, 'x-team-request': 'panel' } })
}

/** Waits until `fn` returns a truthy value, retrying on a queue event (no fixed clock). */
export async function until (fn, { timeoutMs = 5000, everyMs = 10 } = {}) {
  const cap = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > cap) throw new Error('until: timed out waiting for the condition')
    await new Promise((r) => setTimeout(r, everyMs))
  }
}

/**
 * Minimal SSE client over `fetch` against a real server on an ephemeral port. `next(n)` waits for n events
 * (heartbeat comments accumulate in `comments`). `close()` cuts the connection.
 */
export async function openSse (env, url, { cookie, headers = {} } = {}) {
  if (!env.baseUrl) {
    await env.app.listen({ host: '127.0.0.1', port: 0 })
    env.baseUrl = `http://127.0.0.1:${env.app.server.address().port}`
  }
  const controller = new AbortController()
  const res = await fetch(`${env.baseUrl}${url}`, { headers: { accept: 'text/event-stream', cookie, ...headers }, signal: controller.signal })
  const eventList = []
  const comments = []
  let isClosed = false
  const waitUntil = []
  const notify = () => { for (const f of waitUntil.splice(0)) f() }
  if (res.status === 200) {
    ;(async () => {
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for await (const piece of res.body) {
          buffer += decoder.decode(piece, { stream: true })
          let cutPoint
          while ((cutPoint = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, cutPoint)
            buffer = buffer.slice(cutPoint + 2)
            const evt = { id: null, event: 'message', data: null }
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) comments.push(line.slice(1).trim())
              else if (line.startsWith('id: ')) evt.id = line.slice(4)
              else if (line.startsWith('event: ')) evt.event = line.slice(7)
              else if (line.startsWith('data: ')) evt.data = JSON.parse(line.slice(6))
            }
            if (evt.data !== null) eventList.push(evt)
          }
          notify()
        }
      } catch { /* connection cut */ }
      isClosed = true
      notify()
    })()
  } else {
    isClosed = true
  }
  return {
    status: res.status,
    headers: res.headers,
    eventList,
    comments,
    get isClosed () { return isClosed },
    async next (n, timeoutMs = 3000) {
      const cap = Date.now() + timeoutMs
      while (eventList.length < n && !isClosed && Date.now() < cap) {
        await new Promise((r) => { waitUntil.push(r); setTimeout(r, 25) })
      }
      return eventList.slice(0, n)
    },
    async untilClosed (timeoutMs = 3000) {
      const cap = Date.now() + timeoutMs
      while (!isClosed && Date.now() < cap) await new Promise((r) => { waitUntil.push(r); setTimeout(r, 25) })
      return isClosed
    },
    close () { controller.abort() }
  }
}
