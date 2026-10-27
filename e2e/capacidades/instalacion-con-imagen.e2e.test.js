// Capability «Instalación con imagen Docker» (docs/CAPACIDADES-1.0.md): a new instance is installed with the Docker image and starts without network apart from the
// configured provider. The image is built from the Dockerfile of this checkout (once; TEAM_PLATFORM_IMAGE names one that already exists), started with `--network none`
// and only the variables that the installation asks for (the first Editor's email and password), and everything a person does happens INSIDE that container, over its own
// loopback: signs in as the first Editor, creates a second person, sends a message that the worker of the image analyzes (real analyzer, scripted providers), the second
// person replies, and the first one reads the thread. Without browser: the panel of the image is only checked to be served. Without Docker this test fails and says so.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { after, before, test } from 'node:test'

const CONTAINER = `team-platform-e2e-${process.pid}`
const PASSWORD = 'una clave larga para la instalación 1'
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
let image

// What the people do, as a script that runs inside the container (node is in the image). It prints one JSON line with what each of them read.
const IN_CONTAINER = `
const base = 'http://127.0.0.1:3000'
const jar = () => { const c = new Map(); return async (path, init = {}) => {
  const headers = new Headers(init.headers); headers.set('x-team-request', 'panel')
  if (c.size) headers.set('cookie', [...c].map(([k, v]) => k + '=' + v).join('; '))
  const res = await fetch(base + path, { ...init, headers })
  for (const line of res.headers.getSetCookie()) { const [p] = line.split(';'); const i = p.indexOf('='); if (p.slice(i + 1)) c.set(p.slice(0, i), p.slice(i + 1)) }
  return res
} }
const json = async (res) => { const t = await res.text(); try { return { status: res.status, body: JSON.parse(t) } } catch { return { status: res.status, body: t } } }
const post = (call, path, body) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const until = async (fn, ms = 60000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 100)) } }
const out = {}
const first = jar()
out.badLogin = (await post(first, '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: 'otra clave larga que no es la de nadie' })).status
await new Promise((r) => setTimeout(r, 2500)) // the server makes a failed attempt wait about a second
out.login = (await json(await post(first, '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }))).status
const me = await json(await first('/api/me'))
out.me = { email: me.body.email, role: me.body.role }
const created = await json(await post(first, '/api/members', { email: 'beto@instalacion.test', name: 'Beto', password: process.env.ADMIN_PASSWORD }))
out.created = created.status
const form = new FormData(); form.append('text', 'La pantalla de reservas no guarda los cambios.')
const sent = await json(await first('/api/inputs', { method: 'POST', body: form }))
out.sent = sent.status
const input = await until(async () => { const v = (await json(await first('/api/inputs/' + sent.body.input_id))).body; if (v.status === 'failed') throw new Error('analysis failed: ' + JSON.stringify(v)); return ['proposed', 'published'].includes(v.status) ? v : null })
let messageId = input.message_ids?.[0]
if (input.status === 'proposed') messageId = (await json(await post(first, '/api/inputs/' + sent.body.input_id + '/publish', { messages: input.proposal.messages }))).body.message_ids[0]
const second = jar()
await post(second, '/api/auth/login', { email: 'beto@instalacion.test', password: process.env.ADMIN_PASSWORD })
out.reply = (await json(await post(second, '/api/messages/' + messageId + '/replies', { body: 'Lo reviso esta tarde.' }))).status
const thread = (await json(await first('/api/messages/' + messageId))).body
out.thread = { title: thread.title, status: thread.status, replies: thread.replies.map((r) => r.body) }
out.health = (await json(await fetch(base + '/health'))).body.status
const page = await fetch(base + '/')
out.panel = { status: page.status, html: (await page.text()).includes('<div id="root">') }
console.log(JSON.stringify(out))
`

before(() => {
  try { docker('info') } catch { assert.fail('Docker does not answer (docker info failed): this test needs a Docker daemon and does not skip without one') }
  image = process.env.TEAM_PLATFORM_IMAGE
  if (image) return
  // The build is the heavy step of this test (the panel, the dependencies and a static ffmpeg, cached by layer): measured and printed.
  image = 'team-platform:e2e-capacidades'
  const started = Date.now()
  execFileSync('docker', ['build', '-q', '-t', image, '.'], { stdio: ['ignore', 'ignore', 'inherit'], timeout: 1_800_000 })
  console.log(`# image ${image} built in ${((Date.now() - started) / 1000).toFixed(0)} s`)
})
after(() => { try { docker('rm', '-f', '-v', CONTAINER) } catch { /* it never started */ } })

test('the image starts with no network, answers its health check, and the people of a new installation sign in, send, reply and read', async () => {
  docker('run', '-d', '--name', CONTAINER, '--network', 'none',
    '-e', 'ADMIN_EMAIL=ana@instalacion.test', '-e', `ADMIN_PASSWORD=${PASSWORD}`, '-e', 'PROJECT_NAME=Instalación',
    '-e', 'PROVIDERS_MODULE=./testing/walkthrough-providers-module.js', image)
  // The image declares a HEALTHCHECK against /health with a 1 s start interval: its verdict is the start of the installation.
  let status = 'starting'
  for (let i = 0; i < 90 && status === 'starting'; i++) {
    status = docker('inspect', '--format', '{{.State.Health.Status}}', CONTAINER)
    if (status === 'starting') await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  assert.equal(status, 'healthy', docker('logs', CONTAINER))
  assert.throws(() => docker('exec', CONTAINER, 'wget', '-q', '-T', '3', '-O', '/dev/null', 'http://1.1.1.1/'), /Network unreachable|can't connect|failed/i, 'the container reaches the network')

  const run = spawnSync('docker', ['exec', '-i', CONTAINER, 'node', '--input-type=module', '-'], { input: IN_CONTAINER, encoding: 'utf8', timeout: 120_000 })
  assert.equal(run.status, 0, `${run.stderr}\n--- container log ---\n${docker('logs', '--tail', '15', CONTAINER)}`)
  const seen = JSON.parse(run.stdout.trim().split('\n').at(-1))
  assert.equal(seen.badLogin, 401)
  assert.equal(seen.login, 200)
  assert.deepEqual(seen.me, { email: 'ana@instalacion.test', role: 'editor' })
  assert.equal(seen.created, 201)
  assert.equal(seen.sent, 202)
  assert.equal(seen.reply, 201)
  assert.equal(seen.thread.title, 'Walkthrough message')
  assert.deepEqual(seen.thread.replies, ['Lo reviso esta tarde.'])
  assert.equal(seen.thread.status, 'answered')
  assert.equal(seen.health, 'ok')
  assert.deepEqual(seen.panel, { status: 200, html: true })
})
