// Interface report (UD-061): how the panel is used, from the spans the panel itself sends.
//
//   TEAM_EMAIL=… TEAM_PASSWORD=… node scripts/ui-report.mjs https://host:port [--days 7] [--json]
//   node scripts/ui-report.mjs --db /data/team.db [--days 7] [--json]
//
// With an address it logs in as an Editor and reads GET /api/telemetry/ui-summary. With --db it reads the database
// directly, without the server (the server may be down, and the Editor's password is not needed). --json prints the
// summary as the API returns it; without it, a table per question.
import { DatabaseSync } from 'node:sqlite'
import { renderReport } from '../src/telemetry/ui-report.js'
import { uiSummary } from '../src/telemetry/ui.js'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null }
const base = args.find((a) => /^https?:\/\//.test(a))?.replace(/\/$/, '')
const dbFile = flag('--db')
const days = Number(flag('--days') ?? 7) // the span retention (RETENTION_DAYS)
const { TEAM_EMAIL: email, TEAM_PASSWORD: password } = process.env

if (!base && !dbFile) {
  console.error('uso: TEAM_EMAIL=… TEAM_PASSWORD=… node scripts/ui-report.mjs <dirección> [--days 7] [--json]\n     node scripts/ui-report.mjs --db <archivo> [--days 7] [--json]')
  process.exit(2)
}

let summary
if (dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true })
  const now = Date.now()
  summary = { ...uiSummary(db, { sinceMs: now - days * 86400000, untilMs: now + 1 }), days }
  db.close()
} else {
  if (!email || !password) { console.error('faltan TEAM_EMAIL y TEAM_PASSWORD'); process.exit(2) }
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
  if (!login.ok) { console.error(`la entrada falló: HTTP ${login.status}`); process.exit(2) }
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  const res = await fetch(`${base}/api/telemetry/ui-summary?days=${days}`, { headers: { cookie } })
  if (!res.ok) { console.error(`el informe falló: HTTP ${res.status} ${await res.text()}`); process.exit(2) }
  summary = await res.json()
}
console.log(args.includes('--json') ? JSON.stringify(summary, null, 2) : renderReport(summary))
