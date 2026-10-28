// A clean server for the tests of installation and backup (e2e/capacidades/instalacion-servidor-limpio.e2e.test.js and
// respaldo-y-restauracion.e2e.test.js): a privileged `docker:dind` container with its own Docker daemon, where there is no
// clone, no `.env`, no volume and no image of Team Platform. The tree under test goes in as a git clone made inside it (no
// GitHub), and everything after that is what docs/INSTALACION.md tells a person to type: `scripts/install.sh`, `docker compose`.
// The people (the first Editor, a reply with an attachment) act over the loopback of the application container, through
// `docker compose exec`, with the scripted providers of src/testing/walkthrough-providers-module.js.
// Test support: nothing here is imported from production code.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const CLONE = '/opt/team-platform'
export const ADMIN_EMAIL = 'ana@servidor-limpio.test'
const DIND_IMAGE = process.env.TEAM_DIND_IMAGE ?? 'docker:dind'

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()

export class CleanServer {
  constructor (label) { this.name = `team-clean-${label}-${process.pid}` }

  /** Starts the daemon, installs git and curl in it (a server has them) and puts a git clone of the tree under test in CLONE. */
  async start () {
    run('docker', ['info'])
    // The container is removed with the session even if this test is killed: claude-session on-end runs once, when the session ends.
    spawnSync('claude-session', ['on-end', this.name, '--', 'docker', 'rm', '-f', '-v', this.name], { stdio: 'ignore' })
    run('docker', ['run', '-d', '--privileged', '--name', this.name, '-e', 'DOCKER_TLS_CERTDIR=', DIND_IMAGE])
    for (let i = 0; ; i++) {
      try { this.sh('docker info >/dev/null 2>&1'); break } catch (error) {
        if (i > 60) throw new Error(`the inner Docker daemon did not start: ${run('docker', ['logs', '--tail', '20', this.name])}`, { cause: error })
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    this.sh('apk add --no-cache -q git curl')
    // The tree under test, committed or not: tracked and untracked files that git does not ignore, as a git repository, then cloned.
    const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, maxBuffer: 1 << 28 })
      .split('\0').filter(Boolean).filter((f) => { try { readFileSync(path.join(ROOT, f)); return true } catch { return false } })
    const tar = spawn('tar', ['-cf', '-', '-C', ROOT, '--null', '-T', '-'], { stdio: ['pipe', 'pipe', 'inherit'] })
    const receive = spawn('docker', ['exec', '-i', this.name, 'sh', '-ec', `mkdir /tree && tar -xf - -C /tree && cd /tree && git init -q && git add -A && git -c user.name=t -c user.email=t@t.invalid commit -qm tree && git clone -q /tree ${CLONE}`], { stdio: ['pipe', 'inherit', 'inherit'] })
    tar.stdin.end(files.join('\0') + '\0')
    tar.stdout.pipe(receive.stdin)
    const code = await new Promise((resolve) => receive.on('close', resolve))
    if (code !== 0) throw new Error(`the tree could not be cloned into the clean server (exit ${code})`)
  }

  /** Runs `sh -c script` in the clean server; with `cwd` set it runs in the clone. Returns stdout. */
  sh (script, { cwd, input, timeout = 600_000 } = {}) {
    const args = ['exec', '-i', ...(cwd ? ['-w', cwd] : []), this.name, 'sh', '-c', script]
    const r = spawnSync('docker', args, { encoding: 'utf8', input: input ?? '', timeout, maxBuffer: 1 << 28 })
    if (r.status !== 0) throw new Error(`in the clean server: ${script}\n${r.stdout}\n${r.stderr}`)
    return r.stdout.trim()
  }

  /** Runs in the clone, as a person at the server's shell would. */
  inClone (script, opts = {}) { return this.sh(script, { cwd: CLONE, ...opts }) }

  /** What the people do, as a script in the application container (node is in the image). The mode (MODE=seed|read) and MESSAGE_ID travel in `env`. */
  act (script, env = {}) {
    const flags = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]).map((x) => `'${x.replaceAll("'", "'\\''")}'`).join(' ')
    const out = this.inClone(`docker compose exec -T ${flags} team-platform node --input-type=module -`, { input: script, timeout: 300_000 })
    return JSON.parse(out.split('\n').at(-1))
  }

  /** Waits for the service to be `healthy` (the HEALTHCHECK of the image) and returns what /health said. */
  health () { return JSON.parse(this.inClone('docker compose exec -T team-platform wget -qO- http://127.0.0.1:3000/health')) }

  /** docs/INSTALACION.md, the way a person installs in a server: non-interactive (the answers come from the environment). */
  install () {
    // «Segunda instancia en el mismo servidor»: the first run writes .env and stops; PROVIDERS_MODULE joins it; the second builds and starts.
    this.inClone(`ADMIN_EMAIL=${ADMIN_EMAIL} scripts/install.sh --no-start`)
    this.inClone("echo 'PROVIDERS_MODULE=./testing/walkthrough-providers-module.js' >> .env && echo 'PROJECT_NAME=Servidor limpio' >> .env")
    return this.inClone('scripts/install.sh', { timeout: 1_800_000 })
  }

  /** The password that the log of a new database shows once, and how many times it showed. */
  editorPassword () {
    const log = this.inClone('docker compose logs --no-log-prefix team-platform 2>&1')
    const found = [...log.matchAll(/First editor created with password (\S+) \(shown only once/g)]
    return { count: found.length, password: found[0]?.[1] }
  }

  remove () { try { run('docker', ['rm', '-f', '-v', this.name]) } catch { /* it never started */ } }
}

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// The bytes of the attachment: every byte value several times, so that text handling would show.
export const ATTACHMENT_NAME = 'captura-de-la-reserva.png'
export const attachmentBytes = () => Buffer.from(Array.from({ length: 6000 }, (_, i) => (i * 7 + (i >> 8)) & 0xff))

// The script run in the application container. Mode `seed`: the first Editor signs in, sends a text, the analysis publishes it, a reply with the
// attachment goes in. Mode `read`: the first Editor signs in and reads all of it back. Prints one JSON line.
export const PEOPLE_SCRIPT = `
import { createHash } from 'node:crypto'
const mode = process.env.MODE
const base = 'http://127.0.0.1:3000'
const person = () => { const jar = new Map(); return async (path, init = {}) => {
  const headers = new Headers(init.headers); headers.set('x-team-request', 'panel')
  if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => k + '=' + v).join('; '))
  const res = await fetch(base + path, { ...init, headers })
  for (const line of res.headers.getSetCookie()) { const [p] = line.split(';'); const i = p.indexOf('='); if (p.slice(i + 1)) jar.set(p.slice(0, i), p.slice(i + 1)) }
  return res
} }
const call = person()
const json = async (res) => { const t = await res.text(); try { return { status: res.status, body: JSON.parse(t) } } catch { return { status: res.status, body: t } } }
const send = (path, body, who = call) => who(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const until = async (fn, ms = 90000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 200)) } }
const out = { mode }
const login = await json(await send('/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }))
out.login = login.status
if (login.status !== 200) throw new Error('login answered ' + login.status + ': ' + JSON.stringify(login.body))
const me = (await json(await call('/api/me'))).body
out.me = { email: me.email, role: me.role }
let messageId
if (mode === 'seed') {
  const form = new FormData(); form.append('text', 'La pantalla de reservas no guarda los cambios.')
  const sent = await json(await call('/api/inputs', { method: 'POST', body: form }))
  out.sent = sent.status
  const input = await until(async () => { const v = (await json(await call('/api/inputs/' + sent.body.input_id))).body; if (v.status === 'failed') throw new Error('analysis failed: ' + JSON.stringify(v)); return v.status === 'published' ? v : null })
  messageId = input.message_ids[0]
  // A message is answered by someone else: the Editor adds a second member, who signs in and replies with the attachment.
  out.member = (await json(await send('/api/members', { email: 'beto@servidor-limpio.test', name: 'Beto', password: process.env.ADMIN_PASSWORD }))).status
  const beto = person()
  await send('/api/auth/login', { email: 'beto@servidor-limpio.test', password: process.env.ADMIN_PASSWORD }, beto)
  const bytes = Buffer.from(process.env.ATTACHMENT_B64, 'base64')
  const reply = new FormData(); reply.append('body', 'Adjunto la captura de la reserva.'); reply.append('kind', 'clarification')
  reply.append('files', new Blob([bytes], { type: 'image/png' }), process.env.ATTACHMENT_NAME)
  out.reply = (await json(await beto('/api/messages/' + messageId + '/replies', { method: 'POST', body: reply }))).status
} else {
  messageId = Number(process.env.MESSAGE_ID)
}
out.messageId = messageId
const threadRes = await json(await call('/api/messages/' + messageId))
const thread = threadRes.body
if (!thread.replies) throw new Error('thread ' + messageId + ' answered ' + threadRes.status + ': ' + JSON.stringify(thread).slice(0, 400) + ' reply=' + out.reply)
out.thread = { title: thread.title, status: thread.status, replies: thread.replies.map((r) => ({ body: r.body, attachments: r.attachments.map((a) => ({ name: a.name, size: a.size })) })) }
const att = thread.replies.flatMap((r) => r.attachments)[0]
if (!att) throw new Error('no attachment in the thread: reply status ' + out.reply + ' ' + JSON.stringify(thread.replies).slice(0, 500))
const file = await call('/api/replies/attachments/' + att.id)
out.attachment = { status: file.status, type: file.headers.get('content-type'), sha256: createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex') }
out.health = (await json(await fetch(base + '/health'))).body.status
console.log(JSON.stringify(out))
`
