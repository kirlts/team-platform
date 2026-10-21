// HP-001 (docs/TEST.md): nothing leaves the container except to the configured provider (MASTER-SPEC section 4.1).
// The whole application runs (API, worker, real analyzer, real extractors) with fake providers while the process
// network doors are intercepted (src/testing/egress.js); a complete flow with one attachment of every kind must
// reach only 127.0.0.1, the base URL of a configured provider and, when defined, the OTLP collector.

import assert from 'node:assert/strict'
import dns from 'node:dns'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Agent, fetch as undiciFetch } from 'undici'
import { all, get, openDatabase } from './db/index.js'
import { makeAudio, makeDocx, makeImage, makePdf, makeVideo } from './extract/test/helpers.js'
import { allowedHostsFor, installEgressGuard } from './testing/egress.js'
import { fakeState } from './testing/fake-providers-module.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const PASSWORD = 'a long password for the test 1'
// A directory of its own inside TMPDIR (the session's, not /tmp). Not taken from testing/helpers.js: that module
// imports the queue, and the flow test needs to import the application after the guard is installed.
const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'team-platform-egress-'))
after(() => rmSync(dir, { recursive: true, force: true }))

// ---------------------------------------------------------------- the guard itself
const blockedError = (error) => /egress blocked/.test(`${error} ${error?.cause}`)

test('HP-001: the guard refuses and records a destination outside the allowed set, through every door', async () => {
  const guard = installEgressGuard({ allowedHosts: allowedHostsFor({}) })
  try {
    await assert.rejects(fetch('http://203.0.113.9/'), blockedError)
    await assert.rejects(undiciFetch('https://example.org/', { dispatcher: new Agent() }), blockedError)
    await assert.rejects(new Promise((resolve, reject) => {
      const socket = net.connect({ host: '203.0.113.9', port: 80 })
      socket.on('error', reject)
      socket.on('connect', resolve)
    }), blockedError)
    await assert.rejects(new Promise((resolve, reject) => dns.lookup('example.net', (error, address) => (error ? reject(error) : resolve(address)))), blockedError)
    await assert.rejects(import('node:dns/promises').then((m) => m.lookup('example.com')), blockedError)
  } finally {
    guard.uninstall()
  }
  assert.deepEqual(guard.violations.map((v) => v.via).sort(), ['dns.lookup', 'dns.promises.lookup', 'fetch', 'net.connect', 'undici.Agent'])
})

test('HP-001: the allowed set is loopback, the configured providers and the OTLP collector only when it is defined', () => {
  const bare = allowedHostsFor({})
  assert.deepEqual([...bare].sort(), ['127.0.0.1', '::1', 'localhost'])
  assert.equal(bare.has('collector.example.test'), false)
  const configured = allowedHostsFor({ TEXT_BASE_URL: 'https://llm.example.test/v1', SPEECH_BASE_URL: 'https://stt.example.test', OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.example.test:4318' })
  assert.ok(configured.has('llm.example.test') && configured.has('stt.example.test') && configured.has('collector.example.test'))
  assert.equal(configured.has('evil.example.test'), false)
})

test('HP-001: the modules that run in the document worker thread (not covered by the guard) import nothing that reaches the network', () => {
  const forbidden = /from ['"](?:node:)?(?:net|tls|http|https|http2|dns|dgram|child_process|undici)(?:\/promises)?['"]|\bfetch\(/
  for (const file of ['extract/document-worker.js', 'extract/document-core.js', 'extract/errors.js', 'extract/lib/pdf-pages.js']) {
    assert.doesNotMatch(readFileSync(path.join(here, file), 'utf8'), forbidden, `${file} must not reach the network`)
  }
})

// ---------------------------------------------------------------- the whole flow
async function startCollector () {
  const received = []
  const server = http.createServer((request, response) => {
    request.resume()
    request.on('end', () => { received.push(request.url); response.writeHead(200, { 'content-type': 'application/json' }).end('{}') })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { received, port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) }
}

async function until (fn, { timeoutMs = 60_000 } = {}) {
  const cap = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() > cap) throw new Error('timed out waiting for the flow')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

test('HP-001: a complete flow with an attachment of every kind reaches only allowed destinations', async () => {
  const collector = await startCollector()
  const env = {
    DATA_DIR: path.join(dir, 'data'),
    HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'silent',
    ADMIN_EMAIL: 'ed@x.org',
    ADMIN_PASSWORD: PASSWORD,
    PROVIDERS_MODULE: './testing/fake-providers-module.js',
    TEXT_BASE_URL: 'https://llm.example.test/v1',
    SPEECH_BASE_URL: 'https://stt.example.test',
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.port}`
  }
  // Telemetry reads the process environment. The batch delay is not set here: it is TELEMETRY_FLUSH_MS (default
  // 5 s), and the test does not wait for it; the spans are written when the system shuts down (see below).
  Object.assign(process.env, { OTEL_EXPORTER_OTLP_ENDPOINT: env.OTEL_EXPORTER_OTLP_ENDPOINT })
  const guard = installEgressGuard({ allowedHosts: allowedHostsFor(env) })
  let system
  try {
    // Imported after the guard is installed so that a connection opened while a module loads is seen too.
    const { loadConfig } = await import('./config.js')
    const { start } = await import('./server.js')
    system = await start(loadConfig(env), { env })
    const base = `http://127.0.0.1:${system.app.server.address().port}`
    const area = get(system.db, 'SELECT a.id AS area_id, t.id AS template_id FROM templates t JOIN areas a ON a.id = t.area_id ORDER BY a.id, t.id LIMIT 1')
    fakeState.areaId = area.area_id
    fakeState.templateId = area.template_id

    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-team-request': 'panel' }, body: JSON.stringify({ email: 'ed@x.org', password: PASSWORD }) })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie').split(';')[0]
    const call = (method, url, body) => fetch(`${base}/api${url}`, { method, headers: { cookie, 'x-team-request': 'panel', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })

    // One attachment of every kind: image, pdf, docx, audio and video. Links are covered below.
    const files = { image: path.join(dir, 'a.png'), pdf: path.join(dir, 'b.pdf'), docx: path.join(dir, 'c.docx'), audio: path.join(dir, 'd.m4a'), video: path.join(dir, 'e.mp4') }
    await makeImage(files.image)
    await makePdf(files.pdf, 3)
    await makeDocx(files.docx, 3)
    await makeAudio(files.audio, 3)
    await makeVideo(files.video, { screens: 2, secondsPerScreen: 2 })
    const form = new FormData()
    form.append('text', 'The save button does not respond. See the attachments.')
    const types = { image: 'image/png', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', audio: 'audio/mp4', video: 'video/mp4' }
    for (const [kind, file] of Object.entries(files)) form.append('files', new Blob([await readFile(file)], { type: types[kind] }), path.basename(file))
    const sent = await fetch(`${base}/api/inputs`, { method: 'POST', headers: { cookie, 'x-team-request': 'panel' }, body: form })
    assert.equal(sent.status, 202, await sent.clone().text())
    const { input_id: inputId } = await sent.json()

    const view = await until(async () => {
      const v = await (await call('GET', `/inputs/${inputId}`)).json()
      if (v.status === 'failed') throw new Error(`the input failed: ${v.error}`)
      return v.status === 'proposed' ? v : null
    })
    assert.equal(view.attachments.length, 5)
    assert.ok(view.attachments.every((a) => a.extracted), 'every attachment was extracted')
    const published = await call('POST', `/inputs/${inputId}/publish`, view.proposal)
    assert.equal(published.status, 200, await published.clone().text())

    // The blocked-link door: a link to the loopback and one to the cloud metadata service never connect.
    const blocked = new FormData()
    blocked.append('text', 'Look at this page')
    blocked.append('links', 'http://127.0.0.1:9/internal')
    blocked.append('links', 'http://169.254.169.254/latest/meta-data/')
    const blockedSent = await fetch(`${base}/api/inputs`, { method: 'POST', headers: { cookie, 'x-team-request': 'panel' }, body: blocked })
    assert.equal(blockedSent.status, 202)
    const blockedId = (await blockedSent.json()).input_id
    const blockedView = await until(async () => {
      const v = await (await call('GET', `/inputs/${blockedId}`)).json()
      return ['proposed', 'failed'].includes(v.status) ? v : null
    })
    assert.equal(blockedView.status, 'failed')
    assert.equal(blockedView.error_code, 'link_blocked')

    assert.deepEqual(['vision', 'speech', 'text'].filter((slot) => !fakeState.calls.includes(slot)), [], 'every provider slot was exercised')
  } finally {
    await system?.shutDown('test')
    guard.uninstall()
    await collector.close()
  }
  // The spans are checked after the shutdown, which stops the worker and flushes both span queues: the event
  // «the spans were written» is the end of the shutdown, not the 5 s timer of the batch processor (HALLAZGOS H-75:
  // waiting on the first batch that reached the collector failed under load when the analyze span was in a later one).
  // The collector is the only extra destination, and only because it is defined.
  assert.ok(collector.received.length > 0, 'the spans reached the collector')
  assert.ok(collector.received.every((u) => u === '/v1/traces'))
  const db = openDatabase(path.join(env.DATA_DIR, 'team.db'))
  try {
    assert.ok(all(db, "SELECT 1 FROM spans WHERE name = 'analyze' LIMIT 1").length > 0, 'the analysis ran through the real analyzer')
  } finally {
    db.close()
  }
  assert.deepEqual(guard.violations, [])
  assert.ok(guard.attempts.length > 0, 'the client itself connected to the API on loopback')
  assert.ok(guard.attempts.every((a) => allowedHostsFor({ TEXT_BASE_URL: 'https://llm.example.test/v1', SPEECH_BASE_URL: 'https://stt.example.test' }, ['127.0.0.1']).has(a.host)))
})
