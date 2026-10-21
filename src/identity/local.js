// Proveedor `local`: correo y contraseña (MASTER-SPEC §7.7, UD-002). Sesión en tabla, cookie `__Host-`.

import { get, run } from '../db/index.js'
import { createMember } from '../domain/members.js'
import { tooMany, unauthenticated } from '../domain/errors.js'
import { dummyVerify, hashPassword, verifyPassword } from './password.js'
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies.js'

const BAD_CREDENTIALS_MESSAGE = 'Correo o contraseña incorrectos.' // idéntico para correo inexistente, clave errónea y cuenta bloqueada (OWASP)

export const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', minLength: 3, maxLength: 254 },
      password: { type: 'string', minLength: 1, maxLength: 4096 } // el máximo de la política se aplica al crear; acá sólo se acota el trabajo
    }
  }
}

export function createLocalProvider ({ db, config, sessions, now = Date.now }) {
  const { login: caps, argon2: params } = config.identity
  // Espera exponencial para correos sin cuenta: sin esto, el 429 delataría qué correos existen.
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
    const memberRow = get(db, `SELECT m.id, m.email, m.name, m.role, c.password_hash, c.failed_count, c.next_attempt_at
                              FROM members m JOIN credentials c ON c.member_id = m.id WHERE m.email = ?`, email)
    const lookupKey = email.toLowerCase()

    // 1. Espera vigente por cuenta (existente o no).
    const waitUntil = memberRow ? memberRow.next_attempt_at : (unknownEmails.get(lookupKey)?.toVersion ?? 0)
    if (waitUntil > t) {
      const secondsCount = Math.ceil((waitUntil - t) / 1000)
      throw tooMany(`Demasiados intentos. Se puede reintentar en ${secondsCount} s.`, secondsCount)
    }

    // 2. Verificación. Sin cuenta se calcula igual un hash de relleno para igualar el tiempo.
    if (!memberRow) {
      await dummyVerify(password, params)
      pruneUnknown(t)
      const n = (unknownEmails.get(lookupKey)?.failures ?? 0) + 1
      unknownEmails.set(lookupKey, { failures: n, toVersion: t + backoffWaitMs(n) })
      throw unauthenticated(BAD_CREDENTIALS_MESSAGE)
    }
    if (memberRow.failed_count >= caps.hardCap) {
      // NIST SP 800-63B-4 3.2.2: tope duro; sigue pidiendo el hash para no distinguirse por tiempo.
      await dummyVerify(password, params)
      throw unauthenticated(BAD_CREDENTIALS_MESSAGE)
    }
    const { ok, rehash } = await verifyPassword(password, memberRow.password_hash, params)
    if (!ok) {
      const failures = memberRow.failed_count + 1
      run(db, 'UPDATE credentials SET failed_count = ?, next_attempt_at = ? WHERE member_id = ?', failures, t + backoffWaitMs(failures), memberRow.id)
      throw unauthenticated(BAD_CREDENTIALS_MESSAGE)
    }
    unknownEmails.delete(lookupKey)
    if (rehash) {
      // Los parámetros cambiaron desde que se guardó el hash (informe 04 §10): se vuelve a hashear al entrar.
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
      const { token } = sessions.create(memberRow.id) // regenerada en cada inicio de sesión
      setSessionCookie(reply, config, token)
      return { member: { id: memberRow.id, email: memberRow.email, name: memberRow.name, role: memberRow.role } }
    })

    // Sólo desarrollo (NODE_ENV=development): entra como cualquier correo sin contraseña, creando el miembro si
    // no existe, para probar el panel sin sembrar credenciales. No existe en producción.
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
        let memberRow = get(db, 'SELECT id, email, name, role FROM members WHERE email = ?', email)
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
      sessions.destroy(readSessionCookie(request, config)) // OWASP: se invalida en el servidor, no sólo en el cliente
      clearSessionCookie(reply, config)
      return reply.code(204).send()
    })
  }

  return { name: 'local', identify, routes, login }
}

