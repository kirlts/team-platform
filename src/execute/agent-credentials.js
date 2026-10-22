// Credentials of an agent member (UD-254, UD-255, H-3724). An agent never has a password: it enters with a signed
// header (`X-Team-User`, `X-Team-Ts`, `X-Team-Sig`, the HMAC of `src/identity/delegated.js`, always bound to method and
// path) keyed with a secret of its own. The secret is sealed with the vault (HMAC needs the secret itself, so it cannot
// be a hash) and the API shows it once, when the agent is created or its secret is replaced.

import { randomBytes } from 'node:crypto'
import { get, run } from '../db/index.js'
import { conflict } from '../domain/errors.js'

const SECRET_BYTES = 32 // RFC 2104 §3: a key at least as long as the hash output (SHA-256, 32 bytes)
const sealName = (memberId) => `agent:${memberId}` // additional authenticated data: the sealed value cannot move to another row

/** Creates (or replaces) the secret of an agent member and returns it in clear, the only time it is seen. */
export function issueAgentSecret (db, vault, memberId, { now = Date.now } = {}) {
  if (!vault) throw conflict('La bóveda de secretos no está disponible en este proceso.', 'vault_unavailable')
  const member = get(db, 'SELECT kind FROM members WHERE id = ?', memberId)
  if (member?.kind !== 'agent') throw conflict('Sólo un miembro de tipo agente tiene secreto propio.', 'not_an_agent')
  const secret = randomBytes(SECRET_BYTES).toString('base64url')
  run(db, `INSERT INTO members_agent_credentials (member_id, sealed_value, last4, created_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(member_id) DO UPDATE SET sealed_value = excluded.sealed_value, last4 = excluded.last4, rotated_at = excluded.created_at`,
  memberId, vault.seal(secret, sealName(memberId)), secret.slice(-4), now())
  return secret
}

/** The secret of an agent in clear, for the worker that hands it to the unattended session, or null. */
export function readAgentSecret (db, vault, memberId) {
  const row = get(db, 'SELECT sealed_value FROM members_agent_credentials WHERE member_id = ?', memberId)
  if (!row || !vault) return null
  return vault.open(row.sealed_value, sealName(memberId))
}
