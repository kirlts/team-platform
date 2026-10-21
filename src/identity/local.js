// Proveedor `local`: correo y contraseña (MASTER-SPEC §7.7, UD-002). Sesión en tabla, cookie `__Host-`.

import { get, run } from '../db/index.js'
import { tooMany, unauthenticated } from '../domain/errors.js'
import { dummyVerify, hashPassword, verifyPassword } from './password.js'
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies.js'

const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos.' // idéntico para correo inexistente, clave errónea y cuenta bloqueada (OWASP)

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
  const { login: limites, argon2: params } = config.identity
  // Espera exponencial para correos sin cuenta: sin esto, el 429 delataría qué correos existen.
  const desconocidos = new Map()

  function podarDesconocidos (t) {
    for (const [clave, v] of desconocidos) if (v.hasta + limites.backoffMaxSeconds * 1000 <= t) desconocidos.delete(clave)
  }

  const esperaMs = (fallos) => Math.min(limites.backoffMaxSeconds, limites.backoffBaseSeconds * 2 ** (fallos - 1)) * 1000

  function identify (request) {
    const token = readSessionCookie(request, config)
    const miembro = sessions.lookup(token)
    return miembro ? { member_id: miembro.id, role: miembro.role, email: miembro.email, name: miembro.name, token } : null
  }

  async function login (email, password) {
    const t = now()
    const miembro = get(db, `SELECT m.id, m.email, m.name, m.role, c.password_hash, c.failed_count, c.next_attempt_at
                              FROM members m JOIN credentials c ON c.member_id = m.id WHERE m.email = ?`, email)
    const clave = email.toLowerCase()

    // 1. Espera vigente por cuenta (existente o no).
    const espera = miembro ? miembro.next_attempt_at : (desconocidos.get(clave)?.hasta ?? 0)
    if (espera > t) {
      const segundos = Math.ceil((espera - t) / 1000)
      throw tooMany(`Demasiados intentos. Se puede reintentar en ${segundos} s.`, segundos)
    }

    // 2. Verificación. Sin cuenta se calcula igual un hash de relleno para igualar el tiempo.
    if (!miembro) {
      await dummyVerify(password, params)
      podarDesconocidos(t)
      const n = (desconocidos.get(clave)?.fallos ?? 0) + 1
      desconocidos.set(clave, { fallos: n, hasta: t + esperaMs(n) })
      throw unauthenticated(MENSAJE_CREDENCIALES)
    }
    if (miembro.failed_count >= limites.hardCap) {
      // NIST SP 800-63B-4 3.2.2: tope duro; sigue pidiendo el hash para no distinguirse por tiempo.
      await dummyVerify(password, params)
      throw unauthenticated(MENSAJE_CREDENCIALES)
    }
    const { ok, rehash } = await verifyPassword(password, miembro.password_hash, params)
    if (!ok) {
      const fallos = miembro.failed_count + 1
      run(db, 'UPDATE credentials SET failed_count = ?, next_attempt_at = ? WHERE member_id = ?', fallos, t + esperaMs(fallos), miembro.id)
      throw unauthenticated(MENSAJE_CREDENCIALES)
    }
    desconocidos.delete(clave)
    if (rehash) {
      // Los parámetros cambiaron desde que se guardó el hash (informe 04 §10): se vuelve a hashear al entrar.
      run(db, 'UPDATE credentials SET password_hash = ?, updated_at = ? WHERE member_id = ?', await hashPassword(password, params), now(), miembro.id)
    }
    run(db, 'UPDATE credentials SET failed_count = 0, next_attempt_at = 0 WHERE member_id = ?', miembro.id)
    return miembro
  }

  function routes (app) {
    app.post('/auth/login', {
      config: { public: true, rateLimit: { max: limites.ipMax, timeWindow: limites.ipWindowMs } },
      schema: {
        ...loginSchema,
        response: { 200: { type: 'object', properties: { member: { type: 'object', properties: { id: { type: 'integer' }, email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } } } } } }
      }
    }, async (request, reply) => {
      const previo = readSessionCookie(request, config)
      const miembro = await login(request.body.email.trim(), request.body.password)
      if (previo) sessions.destroy(previo)
      const { token } = sessions.create(miembro.id) // regenerada en cada inicio de sesión
      setSessionCookie(reply, config, token)
      return { member: { id: miembro.id, email: miembro.email, name: miembro.name, role: miembro.role } }
    })

    app.post('/auth/logout', { config: { public: true }, schema: { response: { 204: { type: 'null', description: 'Sesión cerrada en el servidor.' } } } }, async (request, reply) => {
      sessions.destroy(readSessionCookie(request, config)) // OWASP: se invalida en el servidor, no sólo en el cliente
      clearSessionCookie(reply, config)
      return reply.code(204).send()
    })
  }

  return { name: 'local', identify, routes, login }
}

