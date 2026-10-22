#!/usr/bin/env node
// Seeds a test set against a running server, through the API, so every send goes through the real analysis (UD-240, H-3704).
//
//   node scripts/sembrar.mjs --url http://127.0.0.1:3000 --email ed@x.org --password … --carpeta ./mis-archivos
//   node scripts/sembrar.mjs --url … --token <session cookie> --ejemplo
//
// Folder: each loose file is one send (.md and .txt as the text, the rest as attachments); a subfolder is one send that
// combines every file in it. Options: --paralelo N (3 by default; 1 runs them one by one to tell a failure from a race),
// --limite N, --borrador (leave the proposals in review instead of publishing them). TEAM_EMAIL and TEAM_PASSWORD
// work as the credentials too. Prints one row per send: name, state, published messages, seconds.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { readExamples } from '../src/domain/seed-examples.js'

const args = process.argv.slice(2)
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback }
const base = (option('--url') ?? '').replace(/\/$/, '')
const email = option('--email', process.env.TEAM_EMAIL)
const password = option('--password', process.env.TEAM_PASSWORD)
const token = option('--token')
const folder = args.includes('--ejemplo') ? fileURLToPath(new URL('../ejemplos/', import.meta.url)) : option('--carpeta')
const parallel = Math.max(1, Number(option('--paralelo', 3)))
const limit = Number(option('--limite', Infinity))
const draft = args.includes('--borrador')
// How often a send is asked for its state while the analysis runs. Declared courtesy: the API has no push for a script.
const POLL_MS = Number(process.env.SEMBRAR_POLL_MS ?? 1000)

if (!base || !folder || !(token || (email && password))) {
  console.error('Uso: node scripts/sembrar.mjs --url <dirección> (--email <correo> --password <clave> | --token <cookie>) (--carpeta <ruta> | --ejemplo) [--paralelo N] [--limite N] [--borrador]')
  process.exit(2)
}

const sends = readExamples(folder, { limit, warn: (m) => console.error(m) })

// ---- session
let cookie
if (token) {
  cookie = token.includes('=') ? token : `${base.startsWith('https') ? '__Host-session' : 'session'}=${token}`
} else {
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-team-request': 'panel' }, body: JSON.stringify({ email, password }) })
  if (!login.ok) { console.error(`Inicio de sesión rechazado: HTTP ${login.status}`); process.exit(2) }
  cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}
const api = (method, path, body, headers = {}) => fetch(`${base}/api${path}`, { method, headers: { cookie, 'x-team-request': 'panel', ...headers }, body })

async function run (send) {
  const started = performance.now()
  const row = { name: send.name, status: '', messages: 0, seconds: 0 }
  try {
    const fd = new FormData()
    if (send.text) fd.append('text', send.text)
    for (const f of send.files) fd.append('files', new Blob([readFileSync(f.path)], { type: f.mime }), f.name)
    const posted = await api('POST', '/inputs', fd)
    if (!posted.ok) { row.status = `HTTP ${posted.status} ${(await posted.json().catch(() => ({}))).code ?? ''}`.trim(); return row }
    const { input_id: id, duplicate } = await posted.json()
    let view
    for (;;) {
      view = await (await api('GET', `/inputs/${id}`)).json()
      if (['proposed', 'published', 'failed', 'cancelled'].includes(view.status)) break
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    if (view.status === 'proposed' && view.error_code === 'publish_blocked') {
      view = { ...view, status: 'sin mensajes' } // the analysis found nothing actionable: there is nothing to publish
    } else if (view.status === 'proposed' && !draft) {
      const published = await api('POST', `/inputs/${id}/publish`, '{}', { 'content-type': 'application/json' })
      view = published.ok ? { ...view, status: 'published', messages: (await published.json()).messages } : { ...view, status: `publish HTTP ${published.status}` }
    }
    row.status = duplicate ? `${view.status} (duplicado)` : view.status === 'failed' ? `failed: ${view.error_code ?? view.error ?? ''}` : view.status
    row.messages = view.messages?.length ?? 0
  } catch (error) {
    row.status = `error: ${error.message}`
  } finally {
    row.seconds = Number(((performance.now() - started) / 1000).toFixed(1))
  }
  return row
}

// ---- bounded parallelism
const rows = []
const queue = [...sends]
await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
  while (queue.length) rows.push(await run(queue.shift()))
}))

rows.sort((a, b) => a.name.localeCompare(b.name))
const width = Math.max('envío'.length, ...rows.map((r) => r.name.length))
console.log(`${'envío'.padEnd(width)}  ${'estado'.padEnd(22)}  mensajes  segundos`)
for (const r of rows) console.log(`${r.name.padEnd(width)}  ${r.status.padEnd(22)}  ${String(r.messages).padStart(8)}  ${String(r.seconds).padStart(8)}`)
console.log(`${rows.length} envíos, ${rows.filter((r) => r.status.startsWith('published')).length} publicados, ${rows.reduce((a, r) => a + r.messages, 0)} mensajes`)
process.exitCode = rows.every((r) => /^(published|proposed|sin mensajes)/.test(r.status)) ? 0 : 1
