// Harness of the contract suite (`npm run e2e:contrato`): ONE process holds the real Team Platform server on an ephemeral port over a temporary SQLite
// database, the panel compiled once, and one headless Chromium. Nothing here touches the network, Docker or a real model: the analyzer is a script
// (`scriptedAnalyze`), the extractors are the repository's fakes, and the host that signs people in is a local HTTP server (`startFakeHost`).
//
// A test never shares state by order: it creates its own messages (unique titles) and reads them through the same API the panel uses.
// Run one file alone with `node --test e2e/contrato/V3-adjuntos-se-ven.e2e.test.mjs`; the suite runs them all in one process (see run.mjs).

import { execFileSync } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createMember } from '../../src/domain/members.js'
import { parseTemplate } from '../../src/domain/template-file.js'
import { all, get, run } from '../../src/db/index.js'
import { hashPassword } from '../../src/identity/password.js'
import { makeEnv, TEST_PASSWORD, until } from '../../src/testing/helpers.js'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const FIXTURES = path.join(ROOT, 'e2e/contrato/fixtures')
export { TEST_PASSWORD, until }
/** Waits for the page to be quiet by what it does (fonts, animations, two frames), never by a guessed pause. */
export { settled, watchRequests } from '../../panel/src/browser-support.mjs'

/** The files every media test uses: small real files a browser can decode (generated once with ffmpeg and committed). */
export const fixture = (name, type) => ({ name, type, buffer: readFileSync(path.join(FIXTURES, name)) })
export const FILES = {
  photo: (name = 'foto.png') => ({ ...fixture('foto.png', 'image/png'), name }),
  video: () => fixture('video.webm', 'video/webm'),
  audio: () => fixture('audio.wav', 'audio/wav'),
  pdf: () => fixture('documento.pdf', 'application/pdf')
}

/**
 * The analysis, scripted. `### Title` blocks in the text are one message each (areas rotate in order); text without blocks is one message titled with its
 * first line. Attachments: all of them go to the first message, unless a block names them with a line `adjuntos: 1,2`.
 * The required fields of the template get «dato»; an optional one is filled only when the text says so with `campo nombre=valor`.
 */
export const scriptedAnalyze = async (bundle, { onProgress } = {}) => {
  onProgress?.({ percent: 50, phrase: 'Analizando' })
  const blocks = [...bundle.text.matchAll(/^###\s+(.+)$([\s\S]*?)(?=^###\s|(?![\s\S]))/gm)]
  const parts = blocks.length > 0
    ? blocks.map((m) => ({ title: m[1].trim(), body: m[2].trim() || m[1].trim() }))
    : [{ title: bundle.text.trim().split('\n')[0].slice(0, 80) || 'Mensaje', body: bundle.text.trim() || 'Mensaje' }]
  const messages = parts.map((part, n) => {
    const area = bundle.areas[n % bundle.areas.length]
    const template = bundle.templates.find((t) => t.area_id === area.id)
    const declared = [...part.body.matchAll(/^campo (\w+)=(.+)$/gm)].map((m) => [m[1], m[2].trim()])
    const named = /^adjuntos:\s*([\d, ]+)$/m.exec(part.body)
    const picked = named ? named[1].split(',').map((x) => Number(x.trim()) - 1) : (n === 0 ? bundle.attachments.map((_, i) => i) : [])
    const parsed = parseTemplate(template.body_markdown).fields
    const fieldNames = new Set(parsed.map((f) => f.name))
    // The fields a template requires are filled (a message cannot be published without them); the optional ones stay empty unless the text names them.
    const required = Object.fromEntries(parsed.filter((f) => f.required).map((f) => [f.name, 'dato']))
    return {
      area_id: area.id,
      template_id: template.id,
      title: part.title,
      body: part.body.replace(/^campo \w+=.+$/gm, '').replace(/^adjuntos:.*$/gm, '').trim() || part.title,
      fields: { ...required, ...Object.fromEntries(declared.filter(([k]) => fieldNames.has(k))) },
      assignee_ids: [],
      attachment_ids: picked.map((i) => bundle.attachments[i]?.id).filter(Boolean),
      unit_ids: []
    }
  })
  return {
    status: 'ok',
    proposal: { messages, discarded: [] },
    units: [],
    calls: [{ step: 'classify', provider: 'doble', model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 10, cached_tokens: 0 }, duration_ms: 1, outcome: 'ok' }],
    stats: {}
  }
}

const quietExtract = async (attachment, { onProgress } = {}) => {
  onProgress?.(100, 'listo')
  return { text: `extraído de ${attachment.kind}`, meta: { kind: attachment.kind, calls: [] } }
}

/** Builds the panel once into a folder of this process. `vite build` takes about a second. */
function buildPanel () {
  const out = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'e2e-panel-'))
  execFileSync('npx', ['vite', 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: path.join(ROOT, 'panel'), stdio: ['ignore', 'ignore', 'inherit'] })
  return out
}

/** A running copy of the server: its own database, its own folder of files, the compiled panel, an ephemeral port. */
async function startServer (panelDist, { config = {}, modules = {}, autoPublish = true } = {}) {
  const env = await makeEnv({
    config: { identity: { login: { ipMax: 100000, ipWindowMs: 1000 } }, panelDist, ...config },
    modules: { analyze: scriptedAnalyze, extract: quietExtract, ...modules },
    worker: true,
    autoPublish
  })
  await env.app.listen({ host: '127.0.0.1', port: 0 })
  const origin = `http://127.0.0.1:${env.app.server.address().port}`
  env.baseUrl = origin
  return { env, origin, db: env.db, close: () => env.close() }
}

/** The people every test can use. The password is the same for all (TEST_PASSWORD). `claude` is an agent member: it has no password. */
async function seedPeople (server) {
  const { db, env } = server
  const people = {}
  const hash = await hashPassword(TEST_PASSWORD, env.config.identity.argon2)
  for (const [key, name, role] of [['ana', 'Ana Editora', 'editor'], ['bruno', 'Bruno Miembro', 'member'], ['carla', 'Carla Miembro', 'member'], ['diego', 'Diego Miembro', 'member']]) {
    const email = `${key}@e2e.invalid`
    const id = createMember(db, { email, name, role })
    run(db, 'INSERT INTO credentials (member_id, password_hash, updated_at) VALUES (?, ?, ?)', id, hash, Date.now())
    people[key] = { key, id, email, name, role }
  }
  const claudeId = createMember(db, { email: 'claude@e2e.invalid', name: 'Claude', role: 'member', kind: 'agent', profile: 'Soy Claude y trabajo los mensajes que me asignan.' })
  people.claude = { key: 'claude', id: claudeId, email: 'claude@e2e.invalid', name: 'Claude', role: 'member', agent: true }
  return people
}

let shared = null

/** The shared harness: the main server with its people, the browser and the helpers. Started on first use. */
export function harness () {
  shared ??= (async () => {
    const { chromium } = await import(path.join(ROOT, 'panel/node_modules/playwright/index.mjs'))
    const panelDist = buildPanel()
    const server = await startServer(panelDist)
    const people = await seedPeople(server)
    const browser = await chromium.launch({
      headless: true,
      args: ['--ozone-platform=headless', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
    })
    const extraServers = []
    const sessions = new Map()

    const h = {
      server, origin: server.origin, db: server.db, env: server.env, people, browser, panelDist,

      /** Another server of its own (another configuration, another database), closed with the suite. */
      async another (options) {
        const s = await startServer(panelDist, options)
        extraServers.push(s)
        s.people = await seedPeople(s)
        return s
      },

      /** The cookie header of a person, by the API (what the form does, without the form). */
      async cookie (who, origin = h.origin, email) {
        const key = `${origin}|${who}`
        if (!sessions.has(key)) {
          const res = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ email: email ?? `${who}@e2e.invalid`, password: TEST_PASSWORD }) })
          if (res.status !== 200) throw new Error(`login ${who}: ${res.status} ${await res.text()}`)
          const [pair] = res.headers.getSetCookie()[0].split(';')
          const [name, ...value] = pair.split('=')
          sessions.set(key, { name, value: value.join('=') })
        }
        return sessions.get(key)
      },

      /** The API as a person: `api('bruno').get('/messages')`. Same headers the panel sends. */
      api (who, origin = h.origin) {
        const call = async (method, url, { json, form } = {}) => {
          const c = await h.cookie(who, origin)
          const headers = { cookie: `${c.name}=${c.value}`, 'x-team-request': 'panel', origin }
          let body
          if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json) }
          if (form) body = form
          const res = await fetch(`${origin}/api${url}`, { method, headers, body })
          const text = await res.text()
          let data = null
          try { data = text ? JSON.parse(text) : null } catch { data = text }
          return { status: res.status, data }
        }
        return { get: (u) => call('GET', u), post: (u, json) => call('POST', u, { json }), patch: (u, json) => call('PATCH', u, { json }), del: (u) => call('DELETE', u), postForm: (u, form) => call('POST', u, { form }) }
      },

      /** A browser context already signed in as `who`, with its page. */
      async open (who = 'ana', { viewport = { width: 1440, height: 900 }, origin = h.origin, permissions = [], email } = {}) {
        const context = await browser.newContext({ viewport, locale: 'es-CL', colorScheme: 'light', permissions })
        // The context's own request client shares its cookie jar: the session cookie is set the way the browser would receive it.
        const login = await context.request.post(`${origin}/api/auth/login`, { data: { email: email ?? `${who}@e2e.invalid`, password: TEST_PASSWORD }, headers: { origin } })
        if (login.status() !== 200) throw new Error(`login ${who}: ${login.status()}`)
        const page = await context.newPage()
        return { context, page, origin }
      },

      /**
       * A send, through the API the panel uses, analyzed by the script and published; returns the ids of its messages.
       * `files` are `{ name, type, buffer }`; `recipients` are people keys.
       */
      async send (text, { as = 'ana', files = [], recipients = [], origin = h.origin, server: s = server } = {}) {
        const form = new FormData()
        form.append('text', text)
        for (const f of files) form.append('files', new Blob([f.buffer], { type: f.type }), f.name)
        for (const r of recipients) form.append('recipient_ids', String((s.people ?? people)[r].id))
        const res = await h.api(as, origin).postForm('/inputs', form)
        if (![200, 202].includes(res.status)) throw new Error(`send ${res.status}: ${JSON.stringify(res.data)}`)
        const inputId = res.data.input_id ?? res.data.id
        const view = await until(async () => {
          const v = (await h.api(as, origin).get(`/inputs/${inputId}`)).data
          if (v.status === 'failed') throw new Error(`the analysis failed: ${v.error}`)
          return v.status === 'published' ? v : null
        }, { timeoutMs: 20000, everyMs: 20 })
        const messages = all(s.db, 'SELECT id, title FROM messages WHERE input_id = ? ORDER BY id', inputId)
        return { inputId, view, ids: messages.map((m) => Number(m.id)), messages }
      },

      /** A message, published by `as`, with `files`; returns its id. The title is the first line of `text`. */
      async message (text, options = {}) {
        const { ids } = await h.send(text, options)
        return ids[0]
      },

      /** Unique text for a test: its code and a counter, so two tests never see each other's messages. */
      unique: ((n) => (code) => `${code} caso ${++n}-${randomBytes(2).toString('hex')}`)(0),

      row: (sql, ...args) => get(server.db, sql, ...args),
      rows: (sql, ...args) => all(server.db, sql, ...args),

      async close () {
        await browser.close().catch(() => {})
        for (const s of extraServers) await s.close().catch(() => {})
        await server.close().catch(() => {})
        rmSync(panelDist, { recursive: true, force: true })
      }
    }
    return h
  })()
  return shared
}

/** A fake host that signs people in (the SSO of the real host): `/entrada` checks the request, shows its own form and returns the signed payload. */
export async function startFakeHost ({ secret = 'secreto-del-anfitrion-falso', email, name = 'Persona del anfitrión', externalId = 'ext-1' } = {}) {
  const hits = []
  const sign = (value) => createHmac('sha256', secret).update(value).digest('hex')
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://host')
    hits.push(`${req.method} ${url.pathname}`)
    if (url.pathname !== '/entrada') { res.statusCode = 404; return res.end() }
    const sso = url.searchParams.get('sso') ?? ''
    if (sign(sso) !== url.searchParams.get('sig')) { res.statusCode = 400; return res.end('firma inválida') }
    const request = JSON.parse(Buffer.from(sso, 'base64url').toString('utf8'))
    const payload = Buffer.from(JSON.stringify({ nonce: request.nonce, email, name, external_id: externalId, email_verified: true })).toString('base64url')
    const back = new URL(request.return_sso_url)
    back.searchParams.set('sso', payload)
    back.searchParams.set('sig', sign(payload))
    res.statusCode = 302
    res.setHeader('location', back.toString())
    res.end()
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { origin: `http://127.0.0.1:${server.address().port}`, secret, hits, close: () => new Promise((resolve) => server.close(resolve)) }
}

/** The suite's single teardown. `run.mjs` sets E2E_SHARED and registers it once at the end; a file run alone registers its own. */
if (!process.env.E2E_SHARED) after(async () => { if (shared) await (await shared).close() })
export const stopHarness = async () => { if (shared) await (await shared).close() }
