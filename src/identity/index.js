// Identidad (MASTER-SPEC §7.7): un contrato `identify(request) → { member_id, role } | null` con dos
// implementaciones, `local` y `delegated`. Aquí se arma el conjunto: cookie, CSRF, límite de intentos por IP,
// el gancho `requireRole` y la política de «denegar por omisión» que verifica cada ruta al registrarse.

import fastifyCookie from '@fastify/cookie'
import fastifyRateLimit from '@fastify/rate-limit'
import { AppError, forbidden, unauthenticated } from '../domain/errors.js'
import { createSessions } from './sessions.js'
import { csrfGuard } from './csrf.js'
import { createLocalProvider } from './local.js'
import { createDelegatedProvider } from './delegated.js'

export const ROLES = ['member', 'editor']
const RANGO = { member: 1, editor: 2 }

/** Rutas registradas con su política, para que una prueba recorra la tabla (informe 04 §6). */
export const routePolicies = new WeakMap()

export async function registerIdentity (app, { db, config, now = Date.now }) {
  const sessions = createSessions({ db, config, now })
  const delegado = config.identity.provider === 'delegated'
  const provider = delegado
    ? createDelegatedProvider({ db, config, sessions, now })
    : createLocalProvider({ db, config, sessions, now })

  await app.register(fastifyCookie)
  await app.register(fastifyRateLimit, {
    global: false,
    // La IP sale de `trustProxy` (lista exacta): tras un proxy, sin ella todos compartirían un contador (informe 04 §2.4).
    errorResponseBuilder: (_request, contexto) => new AppError(429, 'too_many_requests',
      `Demasiados intentos desde esta dirección. Se puede reintentar en ${Math.ceil(contexto.ttl / 1000)} s.`,
      { retryAfterSeconds: Math.ceil(contexto.ttl / 1000) })
  })

  app.decorateRequest('member', null)
  app.addHook('onRequest', csrfGuard(config))

  /**
   * Gancho de ruta que autentica y exige un rol mínimo. El editor puede todo lo del miembro.
   * Corre en `onRequest`: una carga multiparte de una persona sin sesión se rechaza antes de leerla.
   */
  function requireRole (rol) {
    if (!(rol in RANGO)) throw new Error(`Rol desconocido: ${rol}`)
    const gancho = async function requireRoleHook (request) {
      const identidad = request.member ? { member_id: request.member.id, role: request.member.role } : await provider.identify(request)
      if (!identidad) {
        throw unauthenticated('Se requiere iniciar sesión.', delegado && config.identity.delegated.mode === 'sso-redirect'
          ? { login_url: `${config.apiPrefix}/auth/sso/start` }
          : {})
      }
      request.member = { id: identidad.member_id, role: identidad.role, email: identidad.email, name: identidad.name, token: identidad.token }
      if (RANGO[identidad.role] < RANGO[rol]) throw forbidden('Esta acción corresponde a un editor.')
    }
    gancho.requiredRole = rol
    return gancho
  }

  // Denegar por omisión: toda ruta nueva declara `config.public: true` o un `requireRole(...)`.
  app.addHook('onRoute', (opciones) => {
    if (opciones.method === 'HEAD' || opciones.method === 'OPTIONS') return
    const ganchos = [].concat(opciones.onRequest ?? [])
    const conRol = ganchos.find((g) => g.requiredRole)
    const publica = opciones.config?.public === true
    if (!conRol && !publica) {
      throw new Error(`La ruta ${opciones.method} ${opciones.url} no declara su política: use requireRole('member'|'editor') o config.public.`)
    }
    const registro = routePolicies.get(app) ?? []
    registro.push({ method: opciones.method, url: opciones.url, policy: publica ? 'public' : conRol.requiredRole, schema: opciones.schema ?? null })
    routePolicies.set(app, registro)
  })

  return { provider, sessions, requireRole, registerRoutes: (instancia) => provider.routes(instancia) }
}
