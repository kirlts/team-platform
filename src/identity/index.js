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
const RANK = { member: 1, editor: 2 }

/** Rutas registradas con su política, para que una prueba recorra la tabla (informe 04 §6). */
export const routePolicies = new WeakMap()

export async function registerIdentity (app, { db, config, now = Date.now }) {
  const sessions = createSessions({ db, config, now })
  const isDelegated = config.identity.provider === 'delegated'
  const provider = isDelegated
    ? createDelegatedProvider({ db, config, sessions, now })
    : createLocalProvider({ db, config, sessions, now })

  await app.register(fastifyCookie)
  await app.register(fastifyRateLimit, {
    global: false,
    // La IP sale de `trustProxy` (lista exacta): tras un proxy, sin ella todos compartirían un contador (informe 04 §2.4).
    errorResponseBuilder: (_request, context) => new AppError(429, 'too_many_requests',
      `Demasiados intentos desde esta dirección. Se puede reintentar en ${Math.ceil(context.ttl / 1000)} s.`,
      { retryAfterSeconds: Math.ceil(context.ttl / 1000) })
  })

  app.decorateRequest('member', null)
  app.addHook('onRequest', csrfGuard(config))

  /**
   * Gancho de ruta que autentica y exige un rol mínimo. El editor puede todo lo del miembro.
   * Corre en `onRequest`: una carga multiparte de una persona sin sesión se rechaza antes de leerla.
   */
  function requireRole (roleName) {
    if (!(roleName in RANK)) throw new Error(`Rol desconocido: ${roleName}`)
    const hookFn = async function requireRoleHook (request) {
      const identityInfo = request.member ? { member_id: request.member.id, role: request.member.role } : await provider.identify(request)
      if (!identityInfo) {
        throw unauthenticated('Se requiere iniciar sesión.', isDelegated && config.identity.delegated.mode === 'sso-redirect'
          ? { login_url: `${config.apiPrefix}/auth/sso/start` }
          : {})
      }
      request.member = { id: identityInfo.member_id, role: identityInfo.role, email: identityInfo.email, name: identityInfo.name, token: identityInfo.token }
      if (RANK[identityInfo.role] < RANK[roleName]) throw forbidden('Esta acción corresponde a un editor.')
    }
    hookFn.requiredRole = roleName
    return hookFn
  }

  // Denegar por omisión: toda ruta nueva declara `config.public: true` o un `requireRole(...)`.
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.method === 'HEAD' || routeOptions.method === 'OPTIONS') return
    const hookFns = [].concat(routeOptions.onRequest ?? [])
    const withRole = hookFns.find((g) => g.requiredRole)
    const isPublic = routeOptions.config?.public === true
    if (!withRole && !isPublic) {
      throw new Error(`La ruta ${routeOptions.method} ${routeOptions.url} no declara su política: use requireRole('member'|'editor') o config.public.`)
    }
    const registryList = routePolicies.get(app) ?? []
    registryList.push({ method: routeOptions.method, url: routeOptions.url, policy: isPublic ? 'public' : withRole.requiredRole, schema: routeOptions.schema ?? null })
    routePolicies.set(app, registryList)
  })

  return { provider, sessions, requireRole, registerRoutes: (instanceRef) => provider.routes(instanceRef) }
}
