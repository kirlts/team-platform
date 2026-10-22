// Entry of an agent member (UD-255): an `onRequest` hook that runs before every route's `requireRole`. When the request
// carries the signed headers of an agent and the signature matches that agent's own secret, it sets `request.member`,
// which `requireRole` takes as the identity. Any other request goes on untouched to the configured provider (local or
// delegated). The signature is the `signed-header` one of `src/identity/delegated.js`, used as it exists, always bound to
// method and path, with the same timestamp tolerance (DELEGATED_TS_TOLERANCE_SECONDS).

import { timingSafeEqual } from 'node:crypto'
import { get } from '../db/index.js'
import { signHeader } from '../identity/delegated.js'
import { readAgentSecret } from './agent-credentials.js'

const equal = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

export function installAgentAuth (app, { db, config, vault, now = Date.now }) {
  const tolerance = config.identity.delegated.tsToleranceSeconds
  app.addHook('onRequest', async (request) => {
    const email = request.headers['x-team-user']
    const ts = request.headers['x-team-ts']
    const signature = request.headers['x-team-sig']
    if (!email || !ts || !signature || request.member) return
    const seconds = Number(ts)
    if (!Number.isFinite(seconds) || Math.abs(now() / 1000 - seconds) > tolerance) return
    const row = get(db, "SELECT id, email, name, role, active FROM members WHERE email = ? AND kind = 'agent'", String(email))
    if (!row || row.active !== 1) return
    let secret
    try { secret = readAgentSecret(db, vault, row.id) } catch { return }
    if (!secret) return
    const pathname = request.raw.url.split('?')[0]
    const expected = signHeader(secret, { ts: String(ts), method: request.method, pathname, email: String(email), bind: true })
    if (!equal(expected, signature)) return
    request.member = { id: row.id, role: row.role, email: row.email, name: row.name, token: null, source: 'agent' }
  })
}
