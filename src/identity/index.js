// Identity (MASTER-SPEC §7.7): a contract `identify(request) → { member_id, role } | null` with two
// implementations, `local` and `delegated`. This file assembles the set: cookie, CSRF, per-IP attempt limit,
// the `requireRole` hook and the «deny by default» policy that every route is checked against when registered.
//
// Several sources at once (H-3720): `IDENTITY_PROVIDER=jwt,signed-header`. The header sources are tried in the listed
// order and the first one that identifies the request wins; then the session cookie of our own (issued by `local`
// login, the SSO return or a host source). A browser request identified by the host gets a session of our own, so
// `EventSource` (which cannot send headers) has a credential; it lives as long as the host's token and is renewed with it.

import fastifyCookie from '@fastify/cookie'
import fastifyRateLimit from '@fastify/rate-limit'
import { AppError, forbidden, unauthenticated } from '../domain/errors.js'
import { createSessions } from './sessions.js'
import { csrfGuard } from './csrf.js'
import { createLocalProvider } from './local.js'
import { createDelegatedSource } from './delegated.js'
import { clearSessionCookie, readSessionCookie, setSessionCookie } from './cookies.js'
import { identitySources } from '../config.js'

export const ROLES = ['member', 'editor']
const RANK = { member: 1, editor: 2 }

/** Registered routes with their policy, so a test can walk the table (report 04 §6). */
export const routePolicies = new WeakMap()

export async function registerIdentity (app, { db, config, now = Date.now }) {
  const sessions = createSessions({ db, config, now })
  const sourceNames = identitySources(config.identity)
  const local = sourceNames.includes('local') ? createLocalProvider({ db, config, sessions, now }) : null
  const delegatedSources = sourceNames.filter((x) => x !== 'local').map((x) => createDelegatedSource(x, { db, config, sessions, now }))
  const hasSso = sourceNames.includes('sso-redirect')

  /** The identity of the request and where it came from (`source`): a host source by name, or `session`. */
  async function identify (request) {
    for (const source of delegatedSources) {
      const found = await source.identify(request)
      if (found) return { ...found, source: source.name }
    }
    const token = readSessionCookie(request, config)
    const memberRow = sessions.lookup(token)
    return memberRow ? { member_id: memberRow.id, role: memberRow.role, email: memberRow.email, name: memberRow.name, token, source: 'session' } : null
  }

  /**
   * After validating the host: a session of our own for a browser (it sends Sec-Fetch-Site; curl or an agent do not, so
   * they do not leave a session per request). The same session is renewed while the host's token stays valid.
   */
  function issueOwnSession (request, reply, found) {
    if (!reply || !request.headers['sec-fetch-site']) return
    const t = now()
    const expiresAt = found.expiresAt ?? t + sessions.absoluteMs
    if (expiresAt <= t) return
    const current = readSessionCookie(request, config)
    const owner = current ? sessions.lookup(current) : null
    if (owner && owner.id === found.member_id && sessions.renew(current, expiresAt)) {
      setSessionCookie(reply, config, current, (expiresAt - t) / 1000)
      found.token = current
      return
    }
    if (current) sessions.destroy(current) // another member, or a dead session: never reused
    const { token, maxAgeSeconds } = sessions.create(found.member_id, { expiresAt })
    setSessionCookie(reply, config, token, maxAgeSeconds)
    found.token = token
  }

  const provider = {
    name: sourceNames.map((x) => (x === 'local' ? 'local' : `delegated:${x}`)).join(','),
    sources: sourceNames,
    identify,
    login: local?.login,
    routes (app) {
      local?.routes(app)
      for (const source of delegatedSources) source.routes(app)
      // UD-190: every source issues a session of our own, so every source has a sign-out. It closes our session; the host's
      // own sign-out is LOGOUT_URL, which the answer names for the panel to go there.
      app.post('/auth/logout', {
        config: { public: true },
        schema: {
          response: {
            200: { type: 'object', properties: { logout_url: { type: 'string' } }, description: 'Sesión cerrada; el anfitrión tiene su propia salida (LOGOUT_URL).' },
            204: { type: 'null', description: 'Sesión cerrada en el servidor.' }
          }
        }
      }, async (request, reply) => {
        sessions.destroy(readSessionCookie(request, config)) // OWASP: invalidated on the server, not only on the client
        clearSessionCookie(reply, config)
        if (config.identity.logoutUrl) return { logout_url: config.identity.logoutUrl }
        return reply.code(204).send()
      })
    }
  }

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
    const hookFn = async function requireRoleHook (request, reply) {
      const identityInfo = request.member ? { member_id: request.member.id, role: request.member.role, source: request.member.source } : await provider.identify(request)
      if (!identityInfo) {
        throw unauthenticated('Se requiere iniciar sesión.', hasSso ? { login_url: `${config.apiPrefix}/auth/sso/start` } : {})
      }
      if (!request.member && identityInfo.source !== 'session') issueOwnSession(request, reply, identityInfo)
      request.member = { id: identityInfo.member_id, role: identityInfo.role, email: identityInfo.email, name: identityInfo.name, token: identityInfo.token, source: identityInfo.source }
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
