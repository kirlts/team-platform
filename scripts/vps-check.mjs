#!/usr/bin/env node
// End-to-end check of a deployed instance (H-89): the page answers, the health endpoint answers, the page served is the
// panel compiled from this checkout, a short mixed text goes in, the proposal comes out, and the input is cancelled so the
// team's data is not left with a test message. It prints no credential.
//
//   node scripts/vps-check.mjs                                   reads URL, ADMIN_EMAIL and ADMIN_PASSWORD from ~/.config/team-platform/vps-admin
//   node scripts/vps-check.mjs --url http://127.0.0.1:3200 --credentials ./access --timeout 120
//   node scripts/vps-check.mjs --keep                            leave the input in the inbox
//   node scripts/vps-check.mjs --last                            only log in and describe your newest input (state, attachment kinds, units, messages), e.g. after sending a recording from a phone
//
// The credentials file is `KEY=value` lines (shell `source` format, optional quotes). Exit code 0 only when every step passes.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Parses `KEY=value` lines, with or without `export` and quotes. */
export function parseCredentials (text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line)
    if (!m) continue
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

/** The compiled asset paths a page references (`/assets/index-HASH.js`, `/assets/index-HASH.css`), sorted. */
export function assetsOf (html) {
  return [...new Set([...html.matchAll(/\/assets\/[\w.-]+\.(?:js|css)/g)].map((m) => m[0]))].sort()
}

async function main () {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      credentials: { type: 'string', default: join(homedir(), '.config/team-platform/vps-admin') },
      timeout: { type: 'string', default: '120' },
      keep: { type: 'boolean', default: false },
      last: { type: 'boolean', default: false }
    }
  })
  const creds = parseCredentials(readFileSync(values.credentials, 'utf8'))
  const url = (values.url ?? creds.URL ?? '').replace(/\/$/, '')
  if (!url || !creds.ADMIN_EMAIL || !creds.ADMIN_PASSWORD) throw new Error('Faltan URL, ADMIN_EMAIL o ADMIN_PASSWORD en el archivo de acceso')
  const steps = []
  const step = (name, ok, detail = '') => { steps.push(ok); console.log(`${ok ? 'OK    ' : 'FALLA '} ${name}${detail ? `: ${detail}` : ''}`) }

  const page = await fetch(`${url}/`)
  const html = await page.text()
  step('GET /', page.status === 200 && /<div id="root"/.test(html), `HTTP ${page.status}`)
  const health = await fetch(`${url}/health`)
  const body = await health.json().catch(() => ({}))
  step('GET /health', health.status === 200 && body.status === 'ok', `${health.status} ${JSON.stringify(body)}`)

  const served = assetsOf(html)
  const localIndex = join(root, 'panel/dist/index.html')
  if (existsSync(localIndex)) {
    const local = assetsOf(readFileSync(localIndex, 'utf8'))
    step('El panel servido es el de este árbol (mismos archivos compilados)', served.length > 0 && served.join() === local.join(), served.join(' '))
  } else {
    console.log(`AVISO  sin panel/dist local: no se compara (compilar con: cd panel && npx vite build). Servido: ${served.join(' ')}`)
  }

  const headers = { 'content-type': 'application/json', 'x-team-request': 'panel' }
  const login = await fetch(`${url}/api/auth/login`, { method: 'POST', headers, body: JSON.stringify({ email: creds.ADMIN_EMAIL, password: creds.ADMIN_PASSWORD }) })
  const cookie = login.headers.getSetCookie?.()[0]?.split(';')[0]
  step('Inicio de sesión', login.status === 200 && Boolean(cookie), `HTTP ${login.status}`)
  if (!cookie) return false
  const auth = { cookie, 'x-team-request': 'panel' }

  if (values.last) {
    const list = await (await fetch(`${url}/api/inputs?limit=1`, { headers: auth })).json()
    const newest = (list.items ?? [])[0]
    if (!newest) return step('Hay un envío', false, 'la bandeja está vacía')
    const one = await (await fetch(`${url}/api/inputs/${newest.id}`, { headers: auth })).json()
    const kinds = (one.attachments ?? []).map((a) => a.kind).join(', ') || 'ninguno'
    step('Último envío', one.status === 'proposed', `estado ${one.status}, adjuntos: ${kinds}, ${(one.units ?? []).length} unidades, ${(one.proposal?.messages ?? []).length} mensaje(s)${one.error_code ? `, error ${one.error_code}` : ''}`)
    return one.status === 'proposed'
  }

  const stamp = new Date().toISOString()
  const text = `Prueba de punta a punta ${stamp}. El botón Enviar no se ve bien en el teléfono, ¿se puede subir el contraste? Además sería útil poder filtrar los mensajes por persona.`
  const form = new FormData()
  form.append('text', text)
  form.append('auto_publish', 'false') // UD-072: the test input waits as a proposal and is cancelled; it is never published to the real team
  const sent = await fetch(`${url}/api/inputs`, { method: 'POST', headers: auth, body: form })
  const created = await sent.json().catch(() => ({}))
  step('Envío de un texto mixto', [200, 202].includes(sent.status) && Boolean(created.input_id), `HTTP ${sent.status}, input ${created.input_id ?? '?'}`)
  if (!created.input_id) return false

  const limit = Date.now() + Number(values.timeout) * 1000
  const started = Date.now()
  let view = null
  while (Date.now() < limit) {
    view = await (await fetch(`${url}/api/inputs/${created.input_id}`, { headers: auth })).json()
    if (['proposed', 'failed', 'cancelled'].includes(view.status)) break
    await new Promise((r) => setTimeout(r, 1000)) // declared courtesy: the server pushes progress only over SSE to the panel, so a script asks once per second
  }
  const messages = view?.proposal?.messages ?? []
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  step('La propuesta llega', view?.status === 'proposed' && messages.length > 0, `estado ${view?.status}, ${messages.length} mensaje(s) en ${seconds} s${view?.error_code ? `, error ${view.error_code}` : ''}`)
  if (messages.length) console.log(`       áreas: ${messages.map((m) => m.area_id ?? m.area ?? '?').join(', ')}`)

  if (!values.keep) {
    const cancelled = await fetch(`${url}/api/inputs/${created.input_id}/cancel`, { method: 'POST', headers: auth })
    step('El envío de prueba se descarta', cancelled.status === 200 || cancelled.status === 204, `HTTP ${cancelled.status}`)
  }
  return steps.every(Boolean)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((ok) => process.exit(ok ? 0 : 1), (e) => { console.error(`FALLA ${e.message}`); process.exit(1) })
}
