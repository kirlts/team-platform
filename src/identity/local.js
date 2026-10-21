// `local` provider: email and password (MASTER-SPEC §7.7, UD-002). Session in a table, `__Host-` cookie.

import { get, run } from '../db/index.js'
import { createMember } from '../domain/members.js'
import { forbidden, tooMany, unauthenticated } from '../domain/errors.js'
import { dummyVerify, hashPassword, verifyPassword } from './password.js'
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies.js'

const BAD_CREDENTIALS_MESSAGE = 'Correo o contraseña incorrectos.' // identical for a nonexistent email, a wrong password and a locked account (OWASP)

export const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 254 },
      password: { type: 'string', minLength: 1, maxLength: 4096 } // the policy maximum is applied on creation; here it only bounds the work
    }
  }
}

export function createLocalProvider ({ db, config, sessions, now = Date.now }) {
  const { login: caps, argon2: params } = config.identity
  // Exponential wait for emails without an account: without this, the 429 would reveal which emails exist.
  const unknownEmails = new Map()

  function pruneUnknown (t) {
    for (const [lookupKey, v] of unknownEmails) if (v.toVersion + caps.backoffMaxSeconds * 1000 <= t) unknownEmails.delete(lookupKey)
  }

  const backoffWaitMs = (failures) => Math.min(caps.backoffMaxSeconds, caps.backoffBaseSeconds * 2 ** (failures - 1)) * 1000

  function identify (request) {
    const token = readSessionCookie(request, config)
    const memberRow = sessions.lookup(token)
    return memberRow ? { member_id: memberRow.id, role: memberRow.role, email: memberRow.email, name: memberRow.name, token } : null
  }

  async function login (email, password) {
    const t = now()
    const memberRow = get(db, `SELECT m.id, m.email, m.name, m.role, m.active, c.password_hash, c.failed_count, c.next_attempt_at
                              FROM members m JOIN credentials c ON c.member_id = m.id WHERE m.email = ?`, email)
    const lookupKey = email.toLowerCase()

    // 1. Current wait per account (existing or not).
    const waitUntil = memberRow ? memberRow.next_attempt_at : (unknownEmails.get(lookupKey)?.toVersion ?? 0)
    if (waitUntil > t) {
      const secondsCount = Math.ceil((waitUntil - t) / 1000)
      throw tooMany(`Demasiados intentos. Se puede reintentar en ${secondsCount} s.`, secondsCount)
    }

    // 2. Verification. Without an account a filler hash is still computed to equalize the time.
    if (!memberRow) {
      await dummyVerify(password, params)
      pruneUnknown(t)
      const n = (unknownEmails.get(lookupKey)?.failures ?? 0) + 1
      unknownEmails.set(lookupKey, { failures: n, toVersion: t + backoffWaitMs(n) })
      throw unauthenticated(BAD_CREDENTIALS_MESSAGE)
    }
    if (memberRow.failed_count >= caps.hardCap) {
      // NIST SP 800-63B-4 3.2.2: hard cap; it still computes the hash so it cannot be told apart by timing.
      await dummyVerify(password, params)
      throw unauthenticated(BAD_CREDENTIALS_MESSAGE)
    }
    const { ok, rehash } = await verifyPassword(password, memberRow.password_hash, params)
    if (!ok) {
      const failures = memberRow.failed_count + 1
      run(db, 'UPDATE credentials SET failed_count = ?, next_attempt_at = ? WHERE member_id = ?', failures, t + backoffWaitMs(failures), memberRow.id)
      throw unauthenticated(BAD_CREDENTIALS_MESSAGE)
    }
    // Only after the password verified, so the message does not reveal which emails have an account.
    if (!memberRow.active) throw forbidden('La cuenta está desactivada. Un editor puede reactivarla.', 'account_inactive')
    unknownEmails.delete(lookupKey)
    if (rehash) {
      // The parameters changed since the hash was stored (report 04 §10): it is hashed again on login.
      run(db, 'UPDATE credentials SET password_hash = ?, updated_at = ? WHERE member_id = ?', await hashPassword(password, params), now(), memberRow.id)
    }
    run(db, 'UPDATE credentials SET failed_count = 0, next_attempt_at = 0 WHERE member_id = ?', memberRow.id)
    return memberRow
  }

  function routes (app) {
    app.post('/auth/login', {
      config: { public: true, rateLimit: { max: caps.ipMax, timeWindow: caps.ipWindowMs } },
      schema: {
        ...loginSchema,
        response: { 200: { type: 'object', properties: { member: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } } } } }
      }
    }, async (request, reply) => {
      const previous = readSessionCookie(request, config)
      const memberRow = await login(request.body.email.trim(), request.body.password)
      if (previous) sessions.destroy(previous)
      const { token } = sessions.create(memberRow.id) // regenerated on every login
      setSessionCookie(reply, config, token)
      return { member: { id: memberRow.id, email: memberRow.email, name: memberRow.name, role: memberRow.role } }
    })

    // Development only (NODE_ENV=development): logs in as any email without a password, creating the member if
    // it does not exist, to try the panel without seeding credentials. It does not exist in production.
    if (config.nodeEnv === 'development') {
      app.post('/auth/dev-login', {
        config: { public: true },
        schema: {
          summary: 'Inicio de sesión de desarrollo, sin contraseña (sólo con NODE_ENV=development)',
          body: {
            type: 'object', required: ['email'], additionalProperties: false,
            properties: { email: { type: 'string', minLength: 3, maxLength: 254 }, name: { type: 'string', minLength: 1 }, role: { type: 'string', enum: ['member', 'editor'] } }
          },
          response: { 200: { type: 'object', properties: { member: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } } } } }
        }
      }, async (request, reply) => {
        const { email, name, role } = request.body
        let memberRow = get(db, 'SELECT id, email, name, role, active FROM members WHERE email = ?', email)
        if (memberRow && !memberRow.active) throw forbidden('La cuenta está desactivada. Un editor puede reactivarla.', 'account_inactive')
        if (!memberRow) {
          const id = createMember(db, { email, name: name ?? email.split('@')[0], role: role ?? 'editor' })
          memberRow = get(db, 'SELECT id, email, name, role FROM members WHERE id = ?', id)
        }
        const previous = readSessionCookie(request, config)
        if (previous) sessions.destroy(previous)
        setSessionCookie(reply, config, sessions.create(memberRow.id).token)
        return { member: memberRow }
      })
    }

    app.post('/auth/logout', { config: { public: true }, schema: { response: { 204: { type: 'null', description: 'Sesión cerrada en el servidor.' } } } }, async (request, reply) => {
      sessions.destroy(readSessionCookie(request, config)) // OWASP: invalidated on the server, not only on the client
      clearSessionCookie(reply, config)
      return reply.code(204).send()
    })
  }

  return { name: 'local', identify, routes, login }
}

