// Identity (MASTER-SPEC §7.7): a contract `identify(request) → { member_id, role } | null` with two
// implementations, `local` and `delegated`. This file assembles the set: cookie, CSRF, per-IP attempt limit,
// the `requireRole` hook and the «deny by default» policy that every route is checked against when registered.

import fastifyCookie from '@fastify/cookie'
import fastifyRateLimit from '@fastify/rate-limit'
import { AppError, forbidden, unauthenticated } from '../domain/errors.js'
import { createSessions } from './sessions.js'
import { csrfGuard } from './csrf.js'
import { createLocalProvider } from './local.js'
import { createDelegatedProvider } from './delegated.js'

export const ROLES = ['member', 'editor']
const RANK = { member: 1, editor: 2 }

/** Registered routes with their policy, so a test can walk the table (report 04 §6). */
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
    // The IP comes from `trustProxy` (exact list): behind a proxy, without it everyone would share one counter (report 04 §2.4).
    errorResponseBuilder: (_request, context) => new AppError(429, 'too_many_requests',
      `Demasiados intentos desde esta dirección. Se puede reintentar en ${Math.ceil(context.ttl / 1000)} s.`,
      { retryAfterSeconds: Math.ceil(context.ttl / 1000) })
  })

  app.decorateRequest('member', null)
  app.addHook('onRequest', csrfGuard(config))

  /**
   * Route hook that authenticates and requires a minimum role. The editor can do everything the member can.
   * Runs in `onRequest`: a multipart upload from a person without a session is rejected before it is read.
   */
  function requireRole (roleName) {
    if (!(roleName in RANK)) throw new Error(`Unknown role: ${roleName}`)
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

  // Deny by default: every new route declares `config.public: true` or a `requireRole(...)`.
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.method === 'HEAD' || routeOptions.method === 'OPTIONS') return
    const hookFns = [].concat(routeOptions.onRequest ?? [])
    const withRole = hookFns.find((g) => g.requiredRole)
    const isPublic = routeOptions.config?.public === true
    if (!withRole && !isPublic) {
      throw new Error(`Route ${routeOptions.method} ${routeOptions.url} does not declare its policy: use requireRole('member'|'editor') or config.public.`)
    }
    const registryList = routePolicies.get(app) ?? []
    registryList.push({ method: routeOptions.method, url: routeOptions.url, policy: isPublic ? 'public' : withRole.requiredRole, schema: routeOptions.schema ?? null })
    routePolicies.set(app, registryList)
  })

  return { provider, sessions, requireRole, registerRoutes: (instanceRef) => provider.routes(instanceRef) }
}
